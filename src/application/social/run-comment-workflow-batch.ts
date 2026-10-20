import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { BatchOperationIdGenerator } from '../ports/batch-operation-id-generator.port';
import type { CommentWorkflowEvent, CommentWorkflowEventRepository } from '../ports/comment-workflow-event-repository.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { SocialCommentRepository, StoredPlatformComment } from '../ports/social-comment-repository.port';
import type { SocialPlatform } from '../../domain/social/social-account';
import { parseSocialAccountId } from '../../domain/social/social-account-id';
import { CommentWorkflowAuditError } from './comment-workflow-audit-error';
import { EvaluateComment, GenerateCommentResponseSuggestion } from './comment-intelligence.usecases';
import { ListSocialPublications } from './list-social-publications';
import { SyncPublicationComments } from './sync-publication-comments';
import { IntelligenceProviderError } from './intelligence-provider-error';
import { SocialProviderError } from './social-provider-error';

export type CommentWorkflowBatchOperation = 'sync' | 'classify' | 'generate';
export type CommentWorkflowBatchScope = 'comment' | 'publication' | 'account' | 'platform';
export type CommentWorkflowBatchItemStatus = 'SUCCEEDED' | 'FAILED' | 'UNSUPPORTED';

export interface RunCommentWorkflowBatchInput {
  readonly operation: CommentWorkflowBatchOperation;
  readonly scope: CommentWorkflowBatchScope;
  readonly accountId?: string;
  readonly publicationId?: string;
  readonly externalCommentId?: string;
  readonly platform?: SocialPlatform;
  readonly language?: string;
}

export interface CommentWorkflowBatchItem {
  readonly accountId: string;
  readonly platform: SocialPlatform;
  readonly publicationId?: string;
  readonly externalCommentId?: string;
  readonly status: CommentWorkflowBatchItemStatus;
  readonly artifactId?: string;
  readonly commentsSynced?: number;
  readonly errorCode?: string;
}

export interface CommentWorkflowBatchResult {
  readonly batchOperationId: string;
  readonly operation: CommentWorkflowBatchOperation;
  readonly scope: CommentWorkflowBatchScope;
  readonly status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly results: readonly CommentWorkflowBatchItem[];
}

const maximumProviderPages = 1000;

export class RunCommentWorkflowBatch {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly comments: SocialCommentRepository,
    private readonly publications: ListSocialPublications,
    private readonly syncComments: SyncPublicationComments,
    private readonly evaluateComment: EvaluateComment,
    private readonly generateSuggestion: GenerateCommentResponseSuggestion,
    private readonly tenant: PilotTenantContext,
    private readonly batchIds: BatchOperationIdGenerator,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: RunCommentWorkflowBatchInput): Promise<CommentWorkflowBatchResult> {
    this.validateInput(input);
    const tenantId = await this.tenant.resolveTenantId();
    const batchOperationId = this.batchIds.generate();
    const startedAt = new Date(this.now()).toISOString();
    const results = input.operation === 'sync'
      ? await this.syncScope(tenantId, input, batchOperationId)
      : await this.processComments(tenantId, input, batchOperationId);
    const successCount = results.filter((result) => result.status === 'SUCCEEDED').length;
    const failureCount = results.length - successCount;
    return {
      batchOperationId,
      operation: input.operation,
      scope: input.scope,
      status: failureCount === 0 ? 'SUCCEEDED' : successCount > 0 ? 'PARTIAL' : 'FAILED',
      startedAt,
      completedAt: new Date(this.now()).toISOString(),
      results,
    };
  }

  private validateInput(input: RunCommentWorkflowBatchInput): void {
    const operations: readonly string[] = ['sync', 'classify', 'generate'];
    const scopes: readonly string[] = ['comment', 'publication', 'account', 'platform'];
    const hasAccount = typeof input.accountId === 'string' && Boolean(input.accountId.trim());
    const hasPublication = typeof input.publicationId === 'string' && Boolean(input.publicationId.trim());
    const hasComment = typeof input.externalCommentId === 'string' && Boolean(input.externalCommentId.trim());
    const hasPlatform = input.platform === 'youtube' || input.platform === 'instagram' || input.platform === 'facebook' || input.platform === 'tiktok';
    const hasLanguage = typeof input.language === 'string' && Boolean(input.language.trim());
    const validScope = input.scope === 'comment'
      ? input.operation !== 'sync' && hasAccount && hasComment && !hasPublication && input.platform === undefined
      : input.scope === 'publication'
        ? hasAccount && hasPublication && !hasComment && input.platform === undefined
        : input.scope === 'account'
          ? hasAccount && !hasPublication && !hasComment && input.platform === undefined
          : input.scope === 'platform'
            ? hasPlatform && !hasAccount && !hasPublication && !hasComment
            : false;
    if (!operations.includes(input.operation) || !scopes.includes(input.scope) || !validScope
      || (input.operation === 'generate' && !hasLanguage)
      || (input.operation !== 'generate' && input.language !== undefined)) {
      throw new CommentWorkflowAuditError('COMMENT_WORKFLOW_BATCH_INPUT_INVALID');
    }
  }

  private async processComments(tenantId: string, input: RunCommentWorkflowBatchInput, batchOperationId: string): Promise<CommentWorkflowBatchItem[]> {
    const asOf = new Date(this.now()).toISOString();
    let comments: readonly StoredPlatformComment[];
    if (input.scope === 'comment') {
      const accountId = parseSocialAccountId(input.accountId as string);
      const account = await this.accounts.findById(tenantId, accountId);
      if (!account) throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
      const comment = await this.comments.findByExternalCommentId(tenantId, accountId, input.externalCommentId as string, asOf);
      if (!comment) throw new CommentWorkflowAuditError('COMMENT_NOT_FOUND');
      comments = [comment];
    } else if (input.scope === 'publication') {
      const accountId = parseSocialAccountId(input.accountId as string);
      const account = await this.accounts.findById(tenantId, accountId);
      if (!account) throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
      comments = await this.comments.listByPublication(tenantId, accountId, input.publicationId as string, asOf);
    } else if (input.scope === 'account') {
      const accountId = parseSocialAccountId(input.accountId as string);
      const account = await this.accounts.findById(tenantId, accountId);
      if (!account) throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
      comments = await this.comments.listByAccount(tenantId, accountId, asOf);
    } else if (input.scope === 'platform') {
      comments = (await this.comments.listByTenant(tenantId, asOf)).filter((comment) => comment.platform === input.platform);
    } else {
      comments = [];
    }

    const results: CommentWorkflowBatchItem[] = [];
    for (const comment of comments) {
      const commentAccountId = comment.socialAccountId;
      try {
        const artifact = input.operation === 'classify'
          ? await this.evaluateComment.execute({ accountId: commentAccountId, externalCommentId: comment.externalCommentId, batchOperationId })
          : await this.generateSuggestion.execute({ accountId: commentAccountId, externalCommentId: comment.externalCommentId, language: input.language as string, batchOperationId });
        results.push({
          accountId: commentAccountId,
          platform: comment.platform,
          publicationId: comment.externalPublicationId,
          externalCommentId: comment.externalCommentId,
          status: 'SUCCEEDED',
          artifactId: artifact.id,
        });
      } catch (error) {
        results.push({
          accountId: commentAccountId,
          platform: comment.platform,
          publicationId: comment.externalPublicationId,
          externalCommentId: comment.externalCommentId,
          status: this.isUnsupported(error) ? 'UNSUPPORTED' : 'FAILED',
          errorCode: this.errorCode(error),
        });
      }
    }
    return results;
  }

  private async syncScope(tenantId: string, input: RunCommentWorkflowBatchInput, batchOperationId: string): Promise<CommentWorkflowBatchItem[]> {
    const accounts = input.scope === 'account'
      ? [await this.requireAccount(tenantId, input.accountId as string)]
      : input.scope === 'publication'
        ? [await this.requireAccount(tenantId, input.accountId as string)]
        : input.scope === 'platform'
          ? (await this.accounts.listByTenant(tenantId)).filter((account) => account.platform === input.platform)
          : await this.accounts.listByTenant(tenantId);
    const results: CommentWorkflowBatchItem[] = [];
    for (const account of accounts) {
      if (input.scope === 'publication') {
        await this.syncPublication(account.id, account.platform, input.publicationId as string, batchOperationId, results);
      } else {
        await this.syncAccountPublications(account.id, account.platform, batchOperationId, results);
      }
    }
    return results;
  }

  private async syncAccountPublications(accountId: string, platform: SocialPlatform, batchOperationId: string, results: CommentWorkflowBatchItem[]): Promise<void> {
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    for (let pageNumber = 0; pageNumber < maximumProviderPages; pageNumber += 1) {
      let result: Awaited<ReturnType<ListSocialPublications['execute']>>[number] | undefined;
      try {
        const pages = await this.publications.execute({ accountId, cursors: cursor ? { [accountId]: cursor } : undefined });
        result = pages.find((item) => item.account.id === accountId);
      } catch (error) {
        results.push({ accountId, platform, status: this.isUnsupported(error) ? 'UNSUPPORTED' : 'FAILED', errorCode: this.errorCode(error) });
        return;
      }
      if (!result) {
        results.push({ accountId, platform, status: 'FAILED', errorCode: 'SOCIAL_PROVIDER_RESPONSE_INVALID' });
        return;
      }
      if (result.status !== 'available') {
        results.push({ accountId, platform, status: result.status === 'unsupported' ? 'UNSUPPORTED' : 'FAILED', errorCode: result.errorCode });
        return;
      }
      for (const publication of result.items) {
        await this.syncPublication(accountId, platform, publication.externalPublicationId, batchOperationId, results);
      }
      if (!result.nextCursor) return;
      if (seenCursors.has(result.nextCursor)) {
        results.push({ accountId, platform, status: 'FAILED', errorCode: 'SOCIAL_PROVIDER_RESPONSE_INVALID' });
        return;
      }
      seenCursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    results.push({ accountId, platform, status: 'FAILED', errorCode: 'SOCIAL_PROVIDER_RESPONSE_INVALID' });
  }

  private async syncPublication(accountId: string, platform: SocialPlatform, publicationId: string, batchOperationId: string, results: CommentWorkflowBatchItem[]): Promise<void> {
    let cursor: string | undefined;
    let commentsSynced = 0;
    const seenCursors = new Set<string>();
    for (let pageNumber = 0; pageNumber < maximumProviderPages; pageNumber += 1) {
      try {
        const page = await this.syncComments.execute({ accountId, publicationId, cursor, batchOperationId });
        commentsSynced += page.items.length;
        if (page.items.length) {
          results.push(...page.items.map((comment) => ({
            accountId,
            platform: comment.platform,
            publicationId,
            externalCommentId: comment.externalCommentId,
            status: 'SUCCEEDED' as const,
            commentsSynced: 1,
          })));
        } else if (pageNumber === 0) {
          results.push({ accountId, platform, publicationId, status: 'SUCCEEDED', commentsSynced: 0 });
        }
        if (!page.nextCursor) return;
        if (seenCursors.has(page.nextCursor)) {
          results.push({ accountId, platform, publicationId, status: 'FAILED', commentsSynced, errorCode: 'SOCIAL_PROVIDER_RESPONSE_INVALID' });
          return;
        }
        seenCursors.add(page.nextCursor);
        cursor = page.nextCursor;
      } catch (error) {
        results.push({ accountId, platform, publicationId, status: this.isUnsupported(error) ? 'UNSUPPORTED' : 'FAILED', commentsSynced, errorCode: this.errorCode(error) });
        return;
      }
    }
    results.push({ accountId, platform, publicationId, status: 'FAILED', commentsSynced, errorCode: 'SOCIAL_PROVIDER_RESPONSE_INVALID' });
  }

  private async requireAccount(tenantId: string, accountId: string) {
    const account = await this.accounts.findById(tenantId, parseSocialAccountId(accountId));
    if (!account) throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    return account;
  }

  private isUnsupported(error: unknown): boolean {
    return error instanceof SocialProviderError
      && ['SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED', 'SOCIAL_COMMENTS_DISABLED', 'SOCIAL_REPLY_UNSUPPORTED'].includes(error.code);
  }

  private errorCode(error: unknown): string {
    if (error instanceof SocialProviderError || error instanceof IntelligenceProviderError || error instanceof CommentWorkflowAuditError) {
      return error.code;
    }
    return 'COMMENT_WORKFLOW_FAILED';
  }
}

export interface ListCommentWorkflowBatchEventsInput {
  readonly batchOperationId: string;
}

export class ListCommentWorkflowBatchEvents {
  constructor(
    private readonly events: CommentWorkflowEventRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: ListCommentWorkflowBatchEventsInput): Promise<readonly CommentWorkflowEvent[]> {
    if (typeof input.batchOperationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.batchOperationId)) {
      throw new CommentWorkflowAuditError('COMMENT_WORKFLOW_BATCH_INPUT_INVALID');
    }
    const tenantId = await this.tenant.resolveTenantId();
    return this.events.listByBatchOperationId(tenantId, input.batchOperationId, new Date(this.now()).toISOString());
  }
}
