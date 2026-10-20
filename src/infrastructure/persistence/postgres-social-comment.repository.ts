import type { SocialCommentRepository, StoredPlatformComment } from '../../application/ports/social-comment-repository.port';
import type { PlatformComment } from '../../application/ports/social-comment.port';
import type { RelationalDatabase, RelationalQueryExecutor } from '../../application/ports/relational-database.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import { CommentWorkflowAuditError } from '../../application/social/comment-workflow-audit-error';
import type { SocialAccount } from '../../domain/social/social-account';
import { parseSocialAccountId } from '../../domain/social/social-account-id';

interface SocialCommentRow extends Record<string, unknown> {
  social_account_id: string;
  platform: string;
  external_publication_id: string;
  external_comment_id: string;
  external_thread_id: string;
  author_display_name: string | null;
  comment_text: string | null;
  provider_created_at: Date | string | null;
  can_reply: boolean;
  app_replied: boolean;
  external_reply_status: 'REPLIED' | 'NOT_REPLIED' | 'UNKNOWN';
  last_synced_at: Date | string;
  retention_expires_at: Date | string;
}

export class PostgresSocialCommentRepository implements SocialCommentRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async deleteExpired(tenantId: string, asOf: string): Promise<void> {
    if (!this.isValidDate(asOf)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    await this.deleteExpiredWith(tenantId, asOf);
  }

  async upsertPage(account: SocialAccount, publicationId: string, comments: readonly PlatformComment[], syncedAt: string, expiresAt: string): Promise<void> {
    if (!publicationId.trim() || !this.isValidDate(syncedAt) || !this.isValidDate(expiresAt) || Date.parse(expiresAt) <= Date.parse(syncedAt)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    for (const comment of comments) {
      if (comment.platform !== account.platform || comment.externalPublicationId !== publicationId
        || !comment.externalCommentId.trim() || !comment.externalThreadId.trim() || typeof comment.canReply !== 'boolean'
        || (comment.externalReplyStatus !== undefined && !['REPLIED', 'NOT_REPLIED', 'UNKNOWN'].includes(comment.externalReplyStatus))
        || (comment.createdAt !== null && !this.isValidDate(comment.createdAt))) {
        throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
      }
    }

    await this.database.transaction(async (transaction) => {
      await this.deleteExpiredWith(account.tenantId, syncedAt, transaction);
      for (const comment of comments) {
        await transaction.query(
          `INSERT INTO social_comments (
             tenant_id, social_account_id, platform, external_publication_id, external_comment_id,
             external_thread_id, author_display_name, comment_text, provider_created_at, can_reply,
             app_replied, external_reply_status, last_synced_at, retention_expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11, $12, $13)
           ON CONFLICT (tenant_id, social_account_id, external_comment_id) DO UPDATE SET
             platform = EXCLUDED.platform,
             external_publication_id = EXCLUDED.external_publication_id,
             external_thread_id = EXCLUDED.external_thread_id,
             author_display_name = EXCLUDED.author_display_name,
             comment_text = EXCLUDED.comment_text,
             provider_created_at = EXCLUDED.provider_created_at,
             can_reply = EXCLUDED.can_reply,
             external_reply_status = EXCLUDED.external_reply_status,
             last_synced_at = EXCLUDED.last_synced_at,
             retention_expires_at = EXCLUDED.retention_expires_at`,
          [account.tenantId, account.id, comment.platform, publicationId, comment.externalCommentId, comment.externalThreadId,
            comment.authorDisplayName, comment.text, comment.createdAt, comment.canReply, comment.externalReplyStatus ?? 'UNKNOWN', syncedAt, expiresAt],
        );
      }
    });
  }

  async markRepliedByApp(tenantId: string, socialAccountId: string, externalCommentId: string, repliedAt: string): Promise<void> {
    if (!this.isValidDate(repliedAt)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const { rowCount } = await this.database.query(
      `UPDATE social_comments SET app_replied = TRUE
       WHERE tenant_id = $1 AND social_account_id = $2 AND external_comment_id = $3 AND retention_expires_at > $4`,
      [tenantId, socialAccountId, externalCommentId, repliedAt],
    );
    if (!rowCount) {
      throw new CommentWorkflowAuditError('COMMENT_NOT_FOUND');
    }
  }

  async listByPublication(tenantId: string, socialAccountId: string, publicationId: string, asOf: string): Promise<readonly StoredPlatformComment[]> {
    if (!this.isValidDate(asOf)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    await this.deleteExpired(tenantId, asOf);
    const { rows } = await this.database.query<SocialCommentRow>(
      `SELECT social_account_id, platform, external_publication_id, external_comment_id, external_thread_id,
              author_display_name, comment_text, provider_created_at, can_reply, app_replied, external_reply_status, last_synced_at, retention_expires_at
       FROM social_comments
       WHERE tenant_id = $1 AND social_account_id = $2 AND external_publication_id = $3 AND retention_expires_at > $4
       ORDER BY provider_created_at DESC, external_comment_id`,
      [tenantId, socialAccountId, publicationId, asOf],
    );
    return rows.map((row) => this.restore(row));
  }

  async listByAccount(tenantId: string, socialAccountId: string, asOf: string): Promise<readonly StoredPlatformComment[]> {
    if (!this.isValidDate(asOf)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    await this.deleteExpired(tenantId, asOf);
    const { rows } = await this.database.query<SocialCommentRow>(
      `SELECT social_account_id, platform, external_publication_id, external_comment_id, external_thread_id,
              author_display_name, comment_text, provider_created_at, can_reply, app_replied, external_reply_status, last_synced_at, retention_expires_at
       FROM social_comments
       WHERE tenant_id = $1 AND social_account_id = $2 AND retention_expires_at > $3
       ORDER BY external_publication_id, provider_created_at DESC, external_comment_id`,
      [tenantId, socialAccountId, asOf],
    );
    return rows.map((row) => this.restore(row));
  }

  async listByTenant(tenantId: string, asOf: string): Promise<readonly StoredPlatformComment[]> {
    if (!this.isValidDate(asOf)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    await this.deleteExpired(tenantId, asOf);
    const { rows } = await this.database.query<SocialCommentRow>(
      `SELECT social_account_id, platform, external_publication_id, external_comment_id, external_thread_id,
              author_display_name, comment_text, provider_created_at, can_reply, app_replied, external_reply_status, last_synced_at, retention_expires_at
       FROM social_comments
       WHERE tenant_id = $1 AND retention_expires_at > $2
       ORDER BY social_account_id, external_publication_id, provider_created_at DESC, external_comment_id`,
      [tenantId, asOf],
    );
    return rows.map((row) => this.restore(row));
  }

  async findByExternalCommentId(tenantId: string, socialAccountId: string, externalCommentId: string, asOf: string): Promise<StoredPlatformComment | null> {
    if (!this.isValidDate(asOf)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    await this.deleteExpired(tenantId, asOf);
    const { rows } = await this.database.query<SocialCommentRow>(
      `SELECT social_account_id, platform, external_publication_id, external_comment_id, external_thread_id,
              author_display_name, comment_text, provider_created_at, can_reply, app_replied, external_reply_status, last_synced_at, retention_expires_at
       FROM social_comments
       WHERE tenant_id = $1 AND social_account_id = $2 AND external_comment_id = $3 AND retention_expires_at > $4`,
      [tenantId, socialAccountId, externalCommentId, asOf],
    );
    return rows[0] ? this.restore(rows[0]) : null;
  }

  private restore(row: SocialCommentRow): StoredPlatformComment {
    return {
      platform: row.platform as PlatformComment['platform'],
      socialAccountId: parseSocialAccountId(row.social_account_id),
      externalPublicationId: row.external_publication_id,
      externalCommentId: row.external_comment_id,
      externalThreadId: row.external_thread_id,
      authorDisplayName: row.author_display_name,
      text: row.comment_text,
      createdAt: this.toIsoString(row.provider_created_at),
      canReply: row.can_reply,
      externalReplyStatus: row.external_reply_status,
      appReplied: row.app_replied,
      lastSyncedAt: this.toIsoString(row.last_synced_at) as string,
      expiresAt: this.toIsoString(row.retention_expires_at) as string,
    };
  }

  private async deleteExpiredWith(tenantId: string, asOf: string, executor: RelationalQueryExecutor = this.database): Promise<void> {
    await executor.query('DELETE FROM social_comments WHERE tenant_id = $1 AND retention_expires_at <= $2', [tenantId, asOf]);
  }

  private isValidDate(value: string): boolean {
    return Number.isFinite(Date.parse(value));
  }

  private toIsoString(value: Date | string | null): string | null {
    if (value === null) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
}
