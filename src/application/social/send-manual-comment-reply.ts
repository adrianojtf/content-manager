import type { CommentWorkflowEvent, CommentWorkflowEventRepository } from '../ports/comment-workflow-event-repository.port';
import type { ManualReplyAttemptIdGenerator } from '../ports/manual-reply-attempt-id-generator.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { SocialCommentRepository } from '../ports/social-comment-repository.port';
import type { SocialCommentResponder } from '../ports/social-comment.port';
import { parseSocialAccountId } from '../../domain/social/social-account-id';
import { CommentWorkflowAuditError } from './comment-workflow-audit-error';
import { isLatestResponseVersionForSelection, isResponseVersionEventType } from './comment-workflow-audit';
import { SocialProviderError } from './social-provider-error';

export interface SendManualCommentReplyInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly revisionEventId: string;
}

export class SendManualCommentReply {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly comments: SocialCommentRepository,
    private readonly responder: SocialCommentResponder,
    private readonly events: CommentWorkflowEventRepository,
    private readonly tenant: PilotTenantContext,
    private readonly attemptIds: ManualReplyAttemptIdGenerator,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: SendManualCommentReplyInput): Promise<CommentWorkflowEvent> {
    const tenantId = await this.tenant.resolveTenantId();
    const accountId = parseSocialAccountId(input.accountId);
    const account = await this.accounts.findById(tenantId, accountId);
    if (!account) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    }
    const recordedAt = new Date(this.now()).toISOString();
    const comment = await this.comments.findByExternalCommentId(tenantId, account.id, input.externalCommentId, recordedAt);
    if (!comment) {
      throw new CommentWorkflowAuditError('COMMENT_NOT_FOUND');
    }
    const history = await this.events.listByComment(tenantId, account.id, comment.externalCommentId, recordedAt);
    const revision = history.find((event) => event.id === input.revisionEventId
      && isResponseVersionEventType(event.eventType) && event.status !== 'FAILED' && event.status !== 'UNSUPPORTED');
    if (!revision || !isLatestResponseVersionForSelection(history, revision.id)) {
      throw new CommentWorkflowAuditError('MANUAL_REPLY_REVISION_STALE');
    }
    const responseRootId = revision.eventType === 'RESPONSE_SUGGESTION_GENERATED' || revision.eventType === 'MANUAL_RESPONSE_CREATED'
      ? revision.id
      : revision.eventType === 'RESPONSE_SUGGESTION_EDITED'
        ? revision.payload.originalSuggestionEventId
        : revision.payload.originalManualResponseEventId;
    const text = revision.payload.text;
    if (typeof text !== 'string' || !text.trim() || typeof responseRootId !== 'string') {
      throw new CommentWorkflowAuditError('RESPONSE_SUGGESTION_INVALID');
    }
    const evaluation = history.filter((event) => event.eventType === 'RESPONSE_EVALUATED'
      && event.parentEventId === revision.id && event.payload.revisionEventId === revision.id).at(-1);
    if (history.some((event) => event.eventType === 'MANUAL_REPLY_ATTEMPTED'
      && (event.payload.responseVersionEventId === revision.id || event.payload.revisionEventId === revision.id))) {
      throw new CommentWorkflowAuditError('MANUAL_REPLY_ATTEMPT_ALREADY_EXISTS');
    }
    if (!comment.canReply) {
      throw new SocialProviderError('SOCIAL_REPLY_UNSUPPORTED');
    }

    const attemptId = this.attemptIds.generate();
    const attempt = await this.events.append({
      tenantId,
      socialAccountId: account.id,
      externalCommentId: comment.externalCommentId,
      eventType: 'MANUAL_REPLY_ATTEMPTED',
      actorSource: 'CREATOR_LOCAL',
      status: 'IN_PROGRESS',
      operationId: attemptId,
      batchOperationId: null,
      parentEventId: revision.id,
      payload: { attemptId, responseRootEventId: responseRootId, responseVersionEventId: revision.id, revisionEventId: revision.id, text, evaluationEventId: evaluation?.id ?? null },
      recordedAt,
    });

    try {
      const reply = await this.responder.reply(account, comment, text);
      let appReplyStatusPersisted = true;
      try {
        await this.comments.markRepliedByApp(tenantId, account.id, comment.externalCommentId, new Date(this.now()).toISOString());
      } catch {
        appReplyStatusPersisted = false;
      }
      return await this.events.append({
        tenantId,
        socialAccountId: account.id,
        externalCommentId: comment.externalCommentId,
        eventType: 'MANUAL_REPLY_RESULT',
        actorSource: 'SOCIAL_PLATFORM',
        status: 'SUCCEEDED',
        operationId: attemptId,
        batchOperationId: null,
        parentEventId: attempt.id,
        payload: { attemptId, responseVersionEventId: revision.id, revisionEventId: revision.id, externalReplyId: reply.externalReplyId, platform: reply.platform, appReplyStatusPersisted },
        recordedAt: new Date(this.now()).toISOString(),
      });
    } catch (error) {
      const code = error instanceof SocialProviderError ? error.code : 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS';
      await this.events.append({
        tenantId,
        socialAccountId: account.id,
        externalCommentId: comment.externalCommentId,
        eventType: 'MANUAL_REPLY_RESULT',
        actorSource: 'APPLICATION',
        status: code === 'SOCIAL_REPLY_UNSUPPORTED' ? 'UNSUPPORTED' : 'FAILED',
        operationId: attemptId,
        batchOperationId: null,
        parentEventId: attempt.id,
        payload: { attemptId, responseVersionEventId: revision.id, revisionEventId: revision.id, errorCode: code, outcome: code === 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS' ? 'AMBIGUOUS' : 'FAILED' },
        recordedAt: new Date(this.now()).toISOString(),
      });
      throw error instanceof SocialProviderError ? error : new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    }
  }
}
