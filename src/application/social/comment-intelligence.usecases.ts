import type { CommentEvaluator, JevCommentAnalysisResult } from '../ports/comment-evaluator.port';
import type { ResponseEvaluator } from '../ports/response-evaluator.port';
import type { CommentWorkflowEventRepository } from '../ports/comment-workflow-event-repository.port';
import type { ResponseSuggestionGenerator } from '../ports/response-suggestion-generator.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { SocialCommentRepository } from '../ports/social-comment-repository.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { ResponseToneProfile, ResponseToneSettingsRepository } from '../ports/response-tone-settings.repository.port';
import { parseSocialAccountId } from '../../domain/social/social-account-id';
import { CommentWorkflowAuditError } from './comment-workflow-audit-error';
import { isResponseVersionEventType, isValidJevCommentAnalysisResult, type RecordCommentAnalysis, type RecordResponseEvaluation, type RecordResponseSuggestion } from './comment-workflow-audit';
import { IntelligenceProviderError } from './intelligence-provider-error';
import { SocialProviderError } from './social-provider-error';
import { defaultResponseToneProfile } from './response-tone-settings';
import { ResponseToneSettingsError } from './response-tone-settings-error';

export interface EvaluateCommentInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly batchOperationId?: string | null;
}

export interface GenerateCommentResponseSuggestionInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly language: string;
  readonly analysisEventId?: string;
  readonly batchOperationId?: string | null;
}

export class EvaluateComment {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly comments: SocialCommentRepository,
    private readonly evaluator: CommentEvaluator,
    private readonly recordAnalysis: RecordCommentAnalysis,
    private readonly workflowEvents: CommentWorkflowEventRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: EvaluateCommentInput) {
    const tenantId = await this.tenant.resolveTenantId();
    const account = await this.accounts.findById(tenantId, parseSocialAccountId(input.accountId));
    if (!account) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    }
    const comment = await this.comments.findByExternalCommentId(tenantId, account.id, input.externalCommentId, new Date(this.now()).toISOString());
    if (!comment) {
      throw new CommentWorkflowAuditError('COMMENT_NOT_FOUND');
    }
    if (!comment.text?.trim()) {
      throw new SocialProviderError('SOCIAL_COMMENT_TEXT_UNAVAILABLE');
    }

    try {
      const analysis = await this.evaluator.evaluate({ comment });
      return await this.recordAnalysis.execute({
        accountId: account.id,
        externalCommentId: comment.externalCommentId,
        analysis,
        batchOperationId: input.batchOperationId,
      });
    } catch (error) {
      await this.recordFailure(tenantId, account.id, comment.externalCommentId, input.batchOperationId, error);
      throw error;
    }
  }

  private async recordFailure(tenantId: string, socialAccountId: string, externalCommentId: string, batchOperationId: string | null | undefined, error: unknown): Promise<void> {
    const errorCode = error instanceof IntelligenceProviderError
      ? error.code
      : error instanceof CommentWorkflowAuditError
        ? error.code
        : 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID';
    await this.workflowEvents.append({
      tenantId,
      socialAccountId,
      externalCommentId,
      eventType: 'COMMENT_CLASSIFIED',
      actorSource: 'AI',
      status: 'FAILED',
      operationId: null,
      batchOperationId: batchOperationId ?? null,
      parentEventId: null,
      payload: { errorCode },
      recordedAt: new Date(this.now()).toISOString(),
    });
  }
}

export class GenerateCommentResponseSuggestion {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly comments: SocialCommentRepository,
    private readonly generator: ResponseSuggestionGenerator,
    private readonly recordSuggestion: RecordResponseSuggestion,
    private readonly workflowEvents: CommentWorkflowEventRepository,
    private readonly tenant: PilotTenantContext,
    private readonly toneSettings: ResponseToneSettingsRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: GenerateCommentResponseSuggestionInput) {
    if (!input.language.trim()) {
      throw new CommentWorkflowAuditError('RESPONSE_SUGGESTION_INVALID');
    }
    const tenantId = await this.tenant.resolveTenantId();
    const account = await this.accounts.findById(tenantId, parseSocialAccountId(input.accountId));
    if (!account) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    }
    const comment = await this.comments.findByExternalCommentId(tenantId, account.id, input.externalCommentId, new Date(this.now()).toISOString());
    if (!comment) {
      throw new CommentWorkflowAuditError('COMMENT_NOT_FOUND');
    }
    if (!comment.text?.trim()) {
      throw new SocialProviderError('SOCIAL_COMMENT_TEXT_UNAVAILABLE');
    }

    const history = await this.workflowEvents.listByComment(tenantId, account.id, comment.externalCommentId, new Date(this.now()).toISOString());
    const analysisEvent = input.analysisEventId
      ? history.find((event) => event.id === input.analysisEventId && event.eventType === 'COMMENT_ANALYSIS_CREATED')
      : history.filter((event) => event.eventType === 'COMMENT_ANALYSIS_CREATED').at(-1);
    if (!analysisEvent) {
      throw new CommentWorkflowAuditError('COMMENT_ANALYSIS_NOT_FOUND');
    }
    const analysis = this.effectiveAnalysis(analysisEvent, history);
    let usedToneProfile: ResponseToneProfile | null = null;

    try {
      let storedToneProfile;
      try {
        storedToneProfile = await this.toneSettings.get(tenantId, account.id);
      } catch {
        throw new ResponseToneSettingsError('RESPONSE_TONE_SETTINGS_UNAVAILABLE');
      }
      usedToneProfile = storedToneProfile
        ? { primaryTone: storedToneProfile.primaryTone, modifiers: storedToneProfile.modifiers, customNote: storedToneProfile.customNote }
        : defaultResponseToneProfile;
      const suggestion = await this.generator.generate({ comment, analysis, language: input.language, toneProfile: usedToneProfile });
      return await this.recordSuggestion.execute({
        accountId: account.id,
        externalCommentId: comment.externalCommentId,
        sourceAnalysisEventId: analysisEvent.id,
        suggestion,
        toneProfile: usedToneProfile,
        batchOperationId: input.batchOperationId,
      });
    } catch (error) {
      const errorCode = error instanceof IntelligenceProviderError || error instanceof ResponseToneSettingsError
        ? error.code
        : error instanceof CommentWorkflowAuditError
          ? error.code
          : 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID';
      await this.workflowEvents.append({
        tenantId,
        socialAccountId: account.id,
        externalCommentId: comment.externalCommentId,
        eventType: 'RESPONSE_SUGGESTION_GENERATED',
        actorSource: 'GENERATOR',
        status: 'FAILED',
        operationId: null,
        batchOperationId: input.batchOperationId ?? null,
        parentEventId: analysisEvent.id,
        payload: { errorCode, language: input.language, toneProfile: usedToneProfile },
        recordedAt: new Date(this.now()).toISOString(),
      });
      throw error;
    }
  }

  private effectiveAnalysis(
    analysisEvent: Awaited<ReturnType<CommentWorkflowEventRepository['listByComment']>>[number],
    history: Awaited<ReturnType<CommentWorkflowEventRepository['listByComment']>>,
  ): JevCommentAnalysisResult {
    const correctedFields = history
      .filter((event) => event.eventType === 'COMMENT_ANALYSIS_CORRECTED' && event.parentEventId === analysisEvent.id)
      .reduce<Record<string, unknown>>((result, event) => {
        const fields = event.payload.correctedFields;
        if (typeof fields === 'object' && fields !== null && !Array.isArray(fields)) {
          Object.assign(result, fields);
        }
        return result;
      }, {});
    const effective = { ...analysisEvent.payload, ...correctedFields };
    if (!isValidJevCommentAnalysisResult(effective)) {
      throw new CommentWorkflowAuditError('COMMENT_ANALYSIS_INVALID');
    }
    return effective;
  }
}

export interface EvaluateResponseSuggestionInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly revisionEventId: string;
}

export class EvaluateResponseSuggestion {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly comments: SocialCommentRepository,
    private readonly evaluator: ResponseEvaluator,
    private readonly recordEvaluation: RecordResponseEvaluation,
    private readonly events: CommentWorkflowEventRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: EvaluateResponseSuggestionInput) {
    const tenantId = await this.tenant.resolveTenantId();
    const account = await this.accounts.findById(tenantId, parseSocialAccountId(input.accountId));
    if (!account) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    }
    const recordedAt = new Date(this.now()).toISOString();
    const comment = await this.comments.findByExternalCommentId(tenantId, account.id, input.externalCommentId, recordedAt);
    if (!comment) {
      throw new CommentWorkflowAuditError('COMMENT_NOT_FOUND');
    }
    const history = await this.events.listByComment(tenantId, account.id, comment.externalCommentId, recordedAt);
    const revision = history.find((event) => event.id === input.revisionEventId && isResponseVersionEventType(event.eventType));
    const latestRevision = history.filter((event) => isResponseVersionEventType(event.eventType)).at(-1);
    if (!revision || revision.id !== latestRevision?.id) {
      throw new CommentWorkflowAuditError('RESPONSE_EVALUATION_REVISION_STALE');
    }
    const responseText = revision.payload.text;
    if (typeof responseText !== 'string' || !responseText.trim()) {
      throw new CommentWorkflowAuditError('RESPONSE_SUGGESTION_INVALID');
    }
    const analysisEvent = history.filter((event) => event.eventType === 'COMMENT_ANALYSIS_CREATED').at(-1);
    if (!analysisEvent) {
      throw new CommentWorkflowAuditError('COMMENT_ANALYSIS_NOT_FOUND');
    }
    const correctedFields = history
      .filter((event) => event.eventType === 'COMMENT_ANALYSIS_CORRECTED' && event.parentEventId === analysisEvent.id)
      .reduce<Record<string, unknown>>((result, event) => {
        const fields = event.payload.correctedFields;
        if (typeof fields === 'object' && fields !== null && !Array.isArray(fields)) Object.assign(result, fields);
        return result;
      }, {});
    const effectiveAnalysis = { ...analysisEvent.payload, ...correctedFields };
    if (!isValidJevCommentAnalysisResult(effectiveAnalysis)) {
      throw new CommentWorkflowAuditError('COMMENT_ANALYSIS_INVALID');
    }
    try {
      const evaluation = await this.evaluator.evaluate({ comment, analysis: effectiveAnalysis, responseText });
      return await this.recordEvaluation.execute({
        accountId: account.id,
        externalCommentId: comment.externalCommentId,
        revisionEventId: revision.id,
        evaluation: { ...evaluation },
      });
    } catch (error) {
      const errorCode = error instanceof IntelligenceProviderError
        ? error.code
        : error instanceof CommentWorkflowAuditError ? error.code : 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID';
      await this.events.append({
        tenantId,
        socialAccountId: account.id,
        externalCommentId: comment.externalCommentId,
        eventType: 'RESPONSE_EVALUATED',
        actorSource: 'AI',
        status: 'FAILED',
        operationId: null,
        batchOperationId: null,
        parentEventId: revision.id,
        payload: { revisionEventId: revision.id, errorCode },
        recordedAt: new Date(this.now()).toISOString(),
      });
      throw error;
    }
  }
}
