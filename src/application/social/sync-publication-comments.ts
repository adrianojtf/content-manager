import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { SocialCommentRepository, StoredPlatformComment } from '../ports/social-comment-repository.port';
import type { CommentWorkflowEventRepository } from '../ports/comment-workflow-event-repository.port';
import type { ExternalReplyStatus, PlatformComment, PlatformCreatorReply, SocialCommentReader } from '../ports/social-comment.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialAccount, SocialPlatform } from '../../domain/social/social-account';
import { parseSocialAccountId } from '../../domain/social/social-account-id';
import { SocialProviderError } from './social-provider-error';

const commentRetentionMilliseconds = 30 * 24 * 60 * 60 * 1000;

export type SocialCommentReaderRegistry = Partial<Record<SocialPlatform, SocialCommentReader>>;

export interface SyncPublicationCommentsInput {
  readonly accountId: string;
  readonly publicationId: string;
  readonly cursor?: string;
  readonly batchOperationId?: string | null;
}

export interface SyncedPublicationCommentPage {
  readonly account: {
    readonly id: string;
    readonly platform: SocialPlatform;
    readonly externalAccountId: string;
    readonly displayName: string | null;
  };
  readonly publicationId: string;
  readonly items: readonly StoredPlatformComment[];
  readonly nextCursor: string | null;
  readonly synchronizedAt: string;
  readonly expiresAt: string;
}

export class SyncPublicationComments {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly comments: SocialCommentRepository,
    private readonly workflowEvents: CommentWorkflowEventRepository,
    private readonly pilotTenant: PilotTenantContext,
    private readonly readers: SocialCommentReaderRegistry,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: SyncPublicationCommentsInput): Promise<SyncedPublicationCommentPage> {
    const tenantId = await this.pilotTenant.resolveTenantId();
    const socialAccountId = parseSocialAccountId(input.accountId);
    const account = await this.accounts.findById(tenantId, socialAccountId);
    if (!account) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    }
    const reader = this.readers[account.platform];
    if (!reader) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    }
    await this.comments.deleteExpired(tenantId, new Date(this.now()).toISOString());
    const page = await reader.getComments(account, input.publicationId, input.cursor);
    if (typeof page !== 'object' || page === null || !Array.isArray(page.items)
      || !Array.isArray(page.creatorReplies)
      || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (page.items.some((comment) => !this.isValidComment(account, input.publicationId, comment))) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (!this.areValidCreatorReplies(account, input.publicationId, page.creatorReplies)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }

    const synchronizedAtMilliseconds = this.now();
    const synchronizedAt = new Date(synchronizedAtMilliseconds).toISOString();
    const expiresAt = new Date(synchronizedAtMilliseconds + commentRetentionMilliseconds).toISOString();
    const replyCommentIds = new Set(page.creatorReplies.map((reply) => reply.externalCommentId));
    const normalizedItems = page.items.map((comment) => ({
      ...comment,
      externalReplyStatus: replyCommentIds.has(comment.externalCommentId)
        ? 'REPLIED' as ExternalReplyStatus
        : comment.externalReplyStatus ?? 'UNKNOWN' as ExternalReplyStatus,
    }));
    await this.comments.upsertPage(account, input.publicationId, normalizedItems, synchronizedAt, expiresAt, page.creatorReplies);
    const normalizedIds = new Set(normalizedItems.map((comment) => comment.externalCommentId));
    const persistedItems = (await this.comments.listByPublication(tenantId, account.id, input.publicationId, synchronizedAt))
      .filter((comment) => normalizedIds.has(comment.externalCommentId));
    await Promise.all(normalizedItems.map((comment) => this.workflowEvents.append({
      tenantId,
      socialAccountId: account.id,
      externalCommentId: comment.externalCommentId,
      eventType: 'COMMENT_SYNCED',
      actorSource: 'APPLICATION',
      status: 'SUCCEEDED',
      operationId: null,
      batchOperationId: input.batchOperationId ?? null,
      parentEventId: null,
      payload: { externalPublicationId: input.publicationId },
      recordedAt: synchronizedAt,
    })));
    return {
      account: {
        id: account.id,
        platform: account.platform,
        externalAccountId: account.externalAccountId,
        displayName: account.displayName,
      },
      publicationId: input.publicationId,
      items: persistedItems,
      nextCursor: page.nextCursor,
      synchronizedAt,
      expiresAt,
    };
  }

  private isValidComment(account: SocialAccount, publicationId: string, comment: PlatformComment): boolean {
    return typeof comment === 'object' && comment !== null
      && comment.platform === account.platform
      && comment.externalPublicationId === publicationId
      && typeof comment.externalCommentId === 'string'
      && Boolean(comment.externalCommentId.trim())
      && typeof comment.externalThreadId === 'string'
      && Boolean(comment.externalThreadId.trim())
      && (comment.authorDisplayName === null || typeof comment.authorDisplayName === 'string')
      && (comment.text === null || typeof comment.text === 'string')
      && (comment.externalReplyStatus === undefined || ['REPLIED', 'NOT_REPLIED', 'UNKNOWN'].includes(comment.externalReplyStatus))
      && typeof comment.canReply === 'boolean'
      && typeof comment.canLike === 'boolean'
      && (comment.createdAt === null || (typeof comment.createdAt === 'string' && Number.isFinite(Date.parse(comment.createdAt))));
  }

  private areValidCreatorReplies(
    account: SocialAccount,
    publicationId: string,
    creatorReplies: readonly PlatformCreatorReply[],
  ): boolean {
    const replyIds = new Set<string>();
    for (const reply of creatorReplies) {
      if (typeof reply !== 'object' || reply === null
        || reply.platform !== account.platform
        || reply.externalPublicationId !== publicationId
        || typeof reply.externalCommentId !== 'string'
        || !reply.externalCommentId.trim()
        || typeof reply.externalReplyId !== 'string'
        || !reply.externalReplyId.trim()
        || replyIds.has(reply.externalReplyId)
        || (reply.text !== null && typeof reply.text !== 'string')
        || (reply.createdAt !== null && (typeof reply.createdAt !== 'string' || !Number.isFinite(Date.parse(reply.createdAt))))) {
        return false;
      }
      replyIds.add(reply.externalReplyId);
    }
    return true;
  }
}

export interface ListPublicationCommentsInput {
  readonly accountId: string;
  readonly publicationId: string;
}

export class ListPublicationComments {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly comments: SocialCommentRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: ListPublicationCommentsInput): Promise<readonly StoredPlatformComment[]> {
    const tenantId = await this.tenant.resolveTenantId();
    const accountId = parseSocialAccountId(input.accountId);
    const account = await this.accounts.findById(tenantId, accountId);
    if (!account) throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    return this.comments.listByPublication(tenantId, accountId, input.publicationId, new Date(this.now()).toISOString());
  }
}
