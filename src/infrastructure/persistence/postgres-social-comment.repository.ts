import type {
  SocialCommentPlatformSummary,
  SocialCommentRepository,
  StoredPlatformComment,
  StoredPlatformCreatorReply,
} from '../../application/ports/social-comment-repository.port';
import type { PlatformComment, PlatformCreatorReply } from '../../application/ports/social-comment.port';
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
  can_like: boolean;
  app_replied: boolean;
  app_liked: boolean;
  external_reply_status: 'REPLIED' | 'NOT_REPLIED' | 'UNKNOWN';
  last_synced_at: Date | string;
  retention_expires_at: Date | string;
  creator_reply_platform: string | null;
  creator_reply_external_id: string | null;
  creator_reply_text: string | null;
  creator_reply_created_at: Date | string | null;
  creator_reply_last_synced_at: Date | string | null;
}

const socialCommentSelect = `
  SELECT c.social_account_id, c.platform, c.external_publication_id, c.external_comment_id, c.external_thread_id,
         c.author_display_name, c.comment_text, c.provider_created_at, c.can_reply, c.can_like, c.app_replied, c.app_liked,
         c.external_reply_status, c.last_synced_at, c.retention_expires_at,
         r.platform AS creator_reply_platform, r.external_reply_id AS creator_reply_external_id,
         r.reply_text AS creator_reply_text, r.provider_created_at AS creator_reply_created_at,
         r.last_synced_at AS creator_reply_last_synced_at
  FROM social_comments c
  LEFT JOIN social_comment_replies r
    ON r.tenant_id = c.tenant_id
    AND r.social_account_id = c.social_account_id
    AND r.external_comment_id = c.external_comment_id`;

export class PostgresSocialCommentRepository implements SocialCommentRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async deleteExpired(tenantId: string, asOf: string): Promise<void> {
    if (!this.isValidDate(asOf)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    await this.deleteExpiredWith(tenantId, asOf);
  }

  async upsertPage(
    account: SocialAccount,
    publicationId: string,
    comments: readonly PlatformComment[],
    syncedAt: string,
    expiresAt: string,
    creatorReplies: readonly PlatformCreatorReply[] = [],
  ): Promise<void> {
    if (typeof publicationId !== 'string' || !publicationId.trim()
      || !Array.isArray(comments) || !Array.isArray(creatorReplies)
      || !this.isValidDate(syncedAt) || !this.isValidDate(expiresAt) || Date.parse(expiresAt) <= Date.parse(syncedAt)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const commentIds = new Set<string>();
    for (const comment of comments) {
      if (typeof comment !== 'object' || comment === null
        || comment.platform !== account.platform || comment.externalPublicationId !== publicationId
        || typeof comment.externalCommentId !== 'string' || !comment.externalCommentId.trim()
        || typeof comment.externalThreadId !== 'string' || !comment.externalThreadId.trim()
        || typeof comment.canReply !== 'boolean' || typeof comment.canLike !== 'boolean'
        || (comment.externalReplyStatus !== undefined && !['REPLIED', 'NOT_REPLIED', 'UNKNOWN'].includes(comment.externalReplyStatus))
        || (comment.createdAt !== null && !this.isValidDate(comment.createdAt))
        || commentIds.has(comment.externalCommentId)) {
        throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
      }
      commentIds.add(comment.externalCommentId);
    }
    const replyIds = new Set<string>();
    for (const reply of creatorReplies) {
      if (typeof reply !== 'object' || reply === null
        || reply.platform !== account.platform || reply.externalPublicationId !== publicationId
        || typeof reply.externalCommentId !== 'string' || !reply.externalCommentId.trim()
        || typeof reply.externalReplyId !== 'string' || !reply.externalReplyId.trim()
        || (reply.text !== null && typeof reply.text !== 'string')
        || (reply.createdAt !== null && !this.isValidDate(reply.createdAt))
        || replyIds.has(reply.externalReplyId)) {
        throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
      }
      replyIds.add(reply.externalReplyId);
    }
    const repliedCommentIds = new Set(creatorReplies.map((reply) => reply.externalCommentId));
    if (comments.some((comment) => comment.externalReplyStatus === 'NOT_REPLIED' && repliedCommentIds.has(comment.externalCommentId))) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }

    await this.database.transaction(async (transaction) => {
      await this.deleteExpiredWith(account.tenantId, syncedAt, transaction);
      if (comments.length) {
        const values: unknown[] = [];
        const tuples = comments.map((comment, index) => {
          const offset = index * 14;
          values.push(
            account.tenantId,
            account.id,
            comment.platform,
            publicationId,
            comment.externalCommentId,
            comment.externalThreadId,
            comment.authorDisplayName,
            comment.text,
            comment.createdAt,
            comment.canReply,
            comment.canLike,
            repliedCommentIds.has(comment.externalCommentId) ? 'REPLIED' : comment.externalReplyStatus ?? 'UNKNOWN',
            syncedAt,
            expiresAt,
          );
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, FALSE, FALSE, $${offset + 12}, $${offset + 13}, $${offset + 14})`;
        });
        await transaction.query(
          `INSERT INTO social_comments (
             tenant_id, social_account_id, platform, external_publication_id, external_comment_id,
             external_thread_id, author_display_name, comment_text, provider_created_at, can_reply, can_like,
             app_replied, app_liked, external_reply_status, last_synced_at, retention_expires_at
           ) VALUES ${tuples.join(', ')}
           ON CONFLICT (tenant_id, social_account_id, external_comment_id) DO UPDATE SET
             platform = EXCLUDED.platform,
             external_publication_id = EXCLUDED.external_publication_id,
             external_thread_id = EXCLUDED.external_thread_id,
             author_display_name = EXCLUDED.author_display_name,
             comment_text = EXCLUDED.comment_text,
             provider_created_at = EXCLUDED.provider_created_at,
             can_reply = EXCLUDED.can_reply,
             can_like = EXCLUDED.can_like,
             external_reply_status = EXCLUDED.external_reply_status,
             last_synced_at = EXCLUDED.last_synced_at,
             retention_expires_at = EXCLUDED.retention_expires_at`,
          values,
        );
      }
      const notRepliedCommentIds = comments
        .filter((comment) => comment.externalReplyStatus === 'NOT_REPLIED')
        .map((comment) => comment.externalCommentId);
      if (notRepliedCommentIds.length) {
        const placeholders = notRepliedCommentIds.map((_, index) => `$${index + 3}`);
        await transaction.query(
          `DELETE FROM social_comment_replies
           WHERE tenant_id = $1 AND social_account_id = $2 AND external_comment_id IN (${placeholders.join(', ')})`,
          [account.tenantId, account.id, ...notRepliedCommentIds],
        );
      }
      if (creatorReplies.length) {
        const creatorReplyParentIds = [...new Set(creatorReplies.map((reply) => reply.externalCommentId))];
        const parentPlaceholders = creatorReplyParentIds.map((_, index) => `$${index + 6}`);
        const { rows: knownParents } = await transaction.query<{ external_comment_id: string }>(
          `UPDATE social_comments
           SET external_reply_status = 'REPLIED', last_synced_at = $4, retention_expires_at = $5
           WHERE tenant_id = $1 AND social_account_id = $2 AND external_publication_id = $3
             AND external_comment_id IN (${parentPlaceholders.join(', ')})
           RETURNING external_comment_id`,
          [account.tenantId, account.id, publicationId, syncedAt, expiresAt, ...creatorReplyParentIds],
        );
        const knownParentIds = new Set(knownParents.map((row) => row.external_comment_id));
        const persistedCreatorReplies = creatorReplies.filter((reply) => knownParentIds.has(reply.externalCommentId));
        const values: unknown[] = [];
        const tuples = persistedCreatorReplies.map((reply, index) => {
          const offset = index * 8;
          values.push(account.tenantId, account.id, reply.platform, reply.externalCommentId, reply.externalReplyId,
            reply.text, reply.createdAt, syncedAt);
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`;
        });
        if (persistedCreatorReplies.length) {
          await transaction.query(
            `INSERT INTO social_comment_replies (
               tenant_id, social_account_id, platform, external_comment_id, external_reply_id,
               reply_text, provider_created_at, last_synced_at
             ) VALUES ${tuples.join(', ')}
             ON CONFLICT (tenant_id, social_account_id, external_reply_id) DO UPDATE SET
               platform = EXCLUDED.platform,
               external_comment_id = EXCLUDED.external_comment_id,
               reply_text = EXCLUDED.reply_text,
               provider_created_at = EXCLUDED.provider_created_at,
               last_synced_at = EXCLUDED.last_synced_at`,
            values,
          );
        }
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

  async markLikedByApp(tenantId: string, socialAccountId: string, externalCommentId: string, liked: boolean, updatedAt: string): Promise<void> {
    if (typeof liked !== 'boolean' || !this.isValidDate(updatedAt)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const { rowCount } = await this.database.query(
      `UPDATE social_comments SET app_liked = $4
       WHERE tenant_id = $1 AND social_account_id = $2 AND external_comment_id = $3 AND retention_expires_at > $5`,
      [tenantId, socialAccountId, externalCommentId, liked, updatedAt],
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
      `${socialCommentSelect}
       WHERE c.tenant_id = $1 AND c.social_account_id = $2 AND c.external_publication_id = $3 AND c.retention_expires_at > $4
       ORDER BY c.provider_created_at DESC, c.external_comment_id, r.provider_created_at, r.external_reply_id`,
      [tenantId, socialAccountId, publicationId, asOf],
    );
    return this.restoreMany(rows);
  }

  async listByAccount(tenantId: string, socialAccountId: string, asOf: string): Promise<readonly StoredPlatformComment[]> {
    if (!this.isValidDate(asOf)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    await this.deleteExpired(tenantId, asOf);
    const { rows } = await this.database.query<SocialCommentRow>(
      `${socialCommentSelect}
       WHERE c.tenant_id = $1 AND c.social_account_id = $2 AND c.retention_expires_at > $3
       ORDER BY c.external_publication_id, c.provider_created_at DESC, c.external_comment_id, r.provider_created_at, r.external_reply_id`,
      [tenantId, socialAccountId, asOf],
    );
    return this.restoreMany(rows);
  }

  async listByTenant(tenantId: string, asOf: string): Promise<readonly StoredPlatformComment[]> {
    if (!this.isValidDate(asOf)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    await this.deleteExpired(tenantId, asOf);
    const { rows } = await this.database.query<SocialCommentRow>(
      `${socialCommentSelect}
       WHERE c.tenant_id = $1 AND c.retention_expires_at > $2
       ORDER BY c.social_account_id, c.external_publication_id, c.provider_created_at DESC, c.external_comment_id, r.provider_created_at, r.external_reply_id`,
      [tenantId, asOf],
    );
    return this.restoreMany(rows);
  }

  async findByExternalCommentId(tenantId: string, socialAccountId: string, externalCommentId: string, asOf: string): Promise<StoredPlatformComment | null> {
    if (!this.isValidDate(asOf)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    await this.deleteExpired(tenantId, asOf);
    const { rows } = await this.database.query<SocialCommentRow>(
      `${socialCommentSelect}
       WHERE c.tenant_id = $1 AND c.social_account_id = $2 AND c.external_comment_id = $3 AND c.retention_expires_at > $4
       ORDER BY r.provider_created_at, r.external_reply_id`,
      [tenantId, socialAccountId, externalCommentId, asOf],
    );
    return this.restoreMany(rows)[0] ?? null;
  }

  async summarizeByTenant(tenantId: string, asOf: string, sentSince: string): Promise<readonly SocialCommentPlatformSummary[]> {
    if (!this.isValidDate(asOf) || !this.isValidDate(sentSince)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const { rows } = await this.database.query<{
      platform: string;
      total_comments: string | number;
      unanswered_comments: string | number;
      unevaluated_comments: string | number;
    }>(
      `SELECT c.platform,
              COUNT(*) AS total_comments,
              SUM(CASE WHEN NOT c.app_replied AND c.external_reply_status = 'NOT_REPLIED' THEN 1 ELSE 0 END) AS unanswered_comments,
              SUM(CASE WHEN a.external_comment_id IS NULL THEN 1 ELSE 0 END) AS unevaluated_comments
       FROM social_comments c
       LEFT JOIN (
         SELECT DISTINCT tenant_id, social_account_id, external_comment_id
         FROM comment_workflow_events
         WHERE tenant_id = $1 AND event_type = 'COMMENT_ANALYSIS_CREATED' AND status <> 'FAILED' AND expires_at > $2
       ) a
         ON a.tenant_id = c.tenant_id
         AND a.social_account_id = c.social_account_id
         AND a.external_comment_id = c.external_comment_id
       WHERE c.tenant_id = $1 AND c.retention_expires_at > $2
       GROUP BY c.platform
       ORDER BY c.platform`,
      [tenantId, asOf],
    );
    const { rows: sentRows } = await this.database.query<{ platform: string; sent_replies_today: string | number }>(
      `SELECT c.platform, COUNT(*) AS sent_replies_today
       FROM comment_workflow_events e
       JOIN social_comments c
         ON c.tenant_id = e.tenant_id
         AND c.social_account_id = e.social_account_id
         AND c.external_comment_id = e.external_comment_id
       WHERE e.tenant_id = $1
         AND e.event_type = 'MANUAL_REPLY_RESULT'
         AND e.status = 'SUCCEEDED'
         AND e.recorded_at >= $3
         AND e.expires_at > $2
         AND c.retention_expires_at > $2
       GROUP BY c.platform`,
      [tenantId, asOf, sentSince],
    );
    const sentByPlatform = new Map(sentRows.map((row) => [row.platform, Number(row.sent_replies_today)]));
    return rows.map((row) => ({
      platform: row.platform,
      totalComments: Number(row.total_comments),
      unansweredComments: Number(row.unanswered_comments),
      unevaluatedComments: Number(row.unevaluated_comments),
      sentRepliesToday: sentByPlatform.get(row.platform) ?? 0,
    }));
  }

  private restoreMany(rows: readonly SocialCommentRow[]): readonly StoredPlatformComment[] {
    const restored = new Map<string, {
      base: Omit<StoredPlatformComment, 'creatorReplies'>;
      creatorReplies: StoredPlatformCreatorReply[];
    }>();
    for (const row of rows) {
      const key = `${row.social_account_id}\u0000${row.external_comment_id}`;
      let comment = restored.get(key);
      if (!comment) {
        comment = { base: this.restoreComment(row), creatorReplies: [] };
        restored.set(key, comment);
      }
      if (row.creator_reply_external_id) {
        comment.creatorReplies.push({
          platform: row.creator_reply_platform as PlatformComment['platform'],
          externalReplyId: row.creator_reply_external_id,
          externalCommentId: row.external_comment_id,
          externalPublicationId: row.external_publication_id,
          text: row.creator_reply_text,
          createdAt: this.toIsoString(row.creator_reply_created_at),
          socialAccountId: parseSocialAccountId(row.social_account_id),
          lastSyncedAt: this.toIsoString(row.creator_reply_last_synced_at) as string,
        });
      }
    }
    return [...restored.values()].map(({ base, creatorReplies }) => ({ ...base, creatorReplies }));
  }

  private restoreComment(row: SocialCommentRow): Omit<StoredPlatformComment, 'creatorReplies'> {
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
      canLike: row.can_like,
      externalReplyStatus: row.external_reply_status,
      appReplied: row.app_replied,
      appLiked: row.app_liked,
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
