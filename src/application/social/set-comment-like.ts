import type { CommentWorkflowEventRepository } from '../ports/comment-workflow-event-repository.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { SocialCommentRepository } from '../ports/social-comment-repository.port';
import type { SocialCommentLiker, SocialCommentLikeAction } from '../ports/social-comment.port';
import { parseSocialAccountId } from '../../domain/social/social-account-id';
import { SocialProviderError } from './social-provider-error';

export interface SetCommentLikeInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly action: SocialCommentLikeAction;
}

export interface SetCommentLikeResult {
  readonly appLiked: boolean;
}

export class SetCommentLike {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly comments: SocialCommentRepository,
    private readonly liker: SocialCommentLiker,
    private readonly events: CommentWorkflowEventRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: SetCommentLikeInput): Promise<SetCommentLikeResult> {
    if (input.action !== 'LIKE' && input.action !== 'UNLIKE') {
      throw new SocialProviderError('SOCIAL_COMMENT_LIKE_ACTION_INVALID');
    }
    const tenantId = await this.tenant.resolveTenantId();
    const account = await this.accounts.findById(tenantId, parseSocialAccountId(input.accountId));
    if (!account) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    }
    const asOf = new Date(this.now()).toISOString();
    const comment = await this.comments.findByExternalCommentId(tenantId, account.id, input.externalCommentId, asOf);
    if (!comment) {
      throw new SocialProviderError('SOCIAL_COMMENT_NOT_FOUND');
    }
    if (comment.platform !== account.platform) {
      throw new SocialProviderError('SOCIAL_COMMENT_CONTEXT_MISMATCH');
    }
    if (!comment.canLike) {
      throw new SocialProviderError('SOCIAL_COMMENT_LIKE_UNSUPPORTED');
    }

    const appLiked = input.action === 'LIKE';
    if (comment.appLiked === appLiked) return { appLiked };

    try {
      await this.liker.setLike(account, comment, input.action);
      await this.comments.markLikedByApp(tenantId, account.id, comment.externalCommentId, appLiked, asOf);
    } catch (error) {
      const errorCode = error instanceof SocialProviderError
        ? error.code
        : 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS';
      await this.events.append({
        tenantId,
        socialAccountId: account.id,
        externalCommentId: comment.externalCommentId,
        eventType: 'COMMENT_LIKE_CHANGED',
        actorSource: 'CREATOR_LOCAL',
        status: 'FAILED',
        operationId: null,
        batchOperationId: null,
        parentEventId: null,
        payload: { action: input.action, errorCode },
        recordedAt: new Date(this.now()).toISOString(),
      });
      throw error instanceof SocialProviderError
        ? error
        : new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    }

    await this.events.append({
      tenantId,
      socialAccountId: account.id,
      externalCommentId: comment.externalCommentId,
      eventType: 'COMMENT_LIKE_CHANGED',
      actorSource: 'CREATOR_LOCAL',
      status: 'SUCCEEDED',
      operationId: null,
      batchOperationId: null,
      parentEventId: null,
      payload: { action: input.action, appLiked },
      recordedAt: new Date(this.now()).toISOString(),
    });
    return { appLiked };
  }
}
