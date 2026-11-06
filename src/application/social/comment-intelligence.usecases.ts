import type { CommentEvaluator, JevCommentAnalysisResult } from '../ports/comment-evaluator.port';
import type { ResponseEvaluator } from '../ports/response-evaluator.port';
import type { CommentWorkflowEvent, CommentWorkflowEventRepository } from '../ports/comment-workflow-event-repository.port';
import type { ResponseSuggestionGenerator } from '../ports/response-suggestion-generator.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { SocialCommentRepository } from '../ports/social-comment-repository.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { ResponseTonePrimary, ResponseToneProfile, ResponseToneSettingsRepository, TenantResponseToneSettingsRepository } from '../ports/response-tone-settings.repository.port';
import { isValidStoredVerifiedReleaseSchedule } from '../../domain/social/verified-release-schedule';
import type {
  TenantVerifiedReleaseScheduleRepository,
  VerifiedReleaseScheduleRepository,
  VerifiedReleaseScheduleSnapshot,
} from '../ports/verified-release-schedule.repository.port';
import { parseSocialAccountId } from '../../domain/social/social-account-id';
import { CommentWorkflowAuditError } from './comment-workflow-audit-error';
import { isLatestResponseVersionForSelection, isResponseVersionEventType, isValidJevCommentAnalysisResult, type RecordCommentAnalysis, type RecordResponseEvaluation, type RecordResponseSuggestion } from './comment-workflow-audit';
import { IntelligenceProviderError } from './intelligence-provider-error';
import { SocialProviderError } from './social-provider-error';
import { defaultResponseToneProfile, isValidResponseTonePrimary, resolveResponseToneProfile, type ResponseToneProfileSource } from './response-tone-settings';
import { ResponseToneSettingsError } from './response-tone-settings-error';
import {
  resolveVerifiedReleaseSchedule,
  responseGenerationScheduleContext,
  verifiedReleaseScheduleSnapshot,
  type ResolvedVerifiedReleaseSchedule,
} from './verified-release-schedule';
import { VerifiedReleaseScheduleError } from './verified-release-schedule-error';
import { runWithConcurrency } from '../run-with-concurrency';

export interface EvaluateCommentInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly batchOperationId?: string | null;
}

export interface GenerateCommentResponseSuggestionInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly analysisEventId?: string;
  readonly toneOverride?: ResponseTonePrimary;
  readonly batchOperationId?: string | null;
}

export const generatedResponseLanguages = ['pt-BR', 'en-US', 'es-ES'] as const;

export interface GenerateCommentResponseSuggestionResult {
  readonly variants: readonly CommentWorkflowEvent[];
  readonly failures: readonly { readonly language: string; readonly errorCode: string }[];
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
    private readonly tenantToneSettings: TenantResponseToneSettingsRepository,
    private readonly scheduleSettings: VerifiedReleaseScheduleRepository,
    private readonly tenantScheduleSettings: TenantVerifiedReleaseScheduleRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: GenerateCommentResponseSuggestionInput): Promise<GenerateCommentResponseSuggestionResult> {
    if (input.toneOverride !== undefined && !isValidResponseTonePrimary(input.toneOverride)) {
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

    let storedAccountSchedule;
    let storedTenantSchedule = null;
    try {
      storedAccountSchedule = await this.scheduleSettings.get(tenantId, account.id);
      if (storedAccountSchedule && !isValidStoredVerifiedReleaseSchedule(storedAccountSchedule)) {
        throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_DATA_INVALID');
      }
      if (!storedAccountSchedule) {
        storedTenantSchedule = await this.tenantScheduleSettings.get(tenantId);
        if (storedTenantSchedule && !isValidStoredVerifiedReleaseSchedule(storedTenantSchedule)) {
          throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_DATA_INVALID');
        }
      }
    } catch (error) {
      const scheduleError = error instanceof VerifiedReleaseScheduleError
        ? error
        : new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE');
      const fallbackTone = input.toneOverride
        ? { ...defaultResponseToneProfile, primaryTone: input.toneOverride }
        : defaultResponseToneProfile;
      for (const language of generatedResponseLanguages) {
        await this.recordSuggestionFailure(
          tenantId,
          account.id,
          comment.externalCommentId,
          analysisEvent.id,
          language,
          fallbackTone,
          null,
          input.batchOperationId,
          scheduleError,
          scheduleError.code,
          null,
        );
      }
      throw scheduleError;
    }
    const resolvedSchedule: ResolvedVerifiedReleaseSchedule = resolveVerifiedReleaseSchedule(storedAccountSchedule, storedTenantSchedule);
    const scheduleSnapshot = verifiedReleaseScheduleSnapshot(resolvedSchedule);
    const scheduleContext = responseGenerationScheduleContext(scheduleSnapshot);

    let storedAccountToneProfile;
    let storedTenantToneProfile = null;
    try {
      storedAccountToneProfile = await this.toneSettings.get(tenantId, account.id);
      if (!storedAccountToneProfile) {
        storedTenantToneProfile = await this.tenantToneSettings.get(tenantId);
      }
    } catch {
      const error = new ResponseToneSettingsError('RESPONSE_TONE_SETTINGS_UNAVAILABLE');
      const fallbackTone = input.toneOverride
        ? { ...defaultResponseToneProfile, primaryTone: input.toneOverride }
        : defaultResponseToneProfile;
      for (const language of generatedResponseLanguages) {
        await this.recordSuggestionFailure(
          tenantId,
          account.id,
          comment.externalCommentId,
          analysisEvent.id,
          language,
          fallbackTone,
          null,
          input.batchOperationId,
          error,
          error.code,
          scheduleSnapshot,
        );
      }
      throw error;
    }
    const resolvedTone = resolveResponseToneProfile(storedAccountToneProfile, storedTenantToneProfile);
    const usedToneProfile: ResponseToneProfile = input.toneOverride
      ? { ...resolvedTone.profile, primaryTone: input.toneOverride }
      : resolvedTone.profile;
    const usedToneProfileSource: ResponseToneProfileSource = resolvedTone.source;

    type LanguageOutcome = { readonly variant: CommentWorkflowEvent } | { readonly failure: { language: string; errorCode: string }; error: unknown };
    const outcomes = await runWithConcurrency(generatedResponseLanguages, generatedResponseLanguages.length, async (language): Promise<LanguageOutcome> => {
      try {
        const suggestion = await this.generator.generate({
          comment,
          analysis,
          language,
          toneProfile: usedToneProfile,
          verifiedReleaseSchedule: scheduleContext,
        });
        if (suggestion.language !== language) {
          throw new CommentWorkflowAuditError('RESPONSE_SUGGESTION_INVALID');
        }
        return {
          variant: await this.recordSuggestion.execute({
            accountId: account.id,
            externalCommentId: comment.externalCommentId,
            sourceAnalysisEventId: analysisEvent.id,
            suggestion,
            toneProfile: usedToneProfile,
            toneProfileSource: usedToneProfileSource,
            verifiedReleaseScheduleSnapshot: verifiedReleaseScheduleSnapshot(resolvedSchedule),
            batchOperationId: input.batchOperationId,
          }),
        };
      } catch (error) {
        const errorCode = this.suggestionErrorCode(error);
        await this.recordSuggestionFailure(
          tenantId,
          account.id,
          comment.externalCommentId,
          analysisEvent.id,
          language,
          usedToneProfile,
          usedToneProfileSource,
          input.batchOperationId,
          error,
          errorCode,
          verifiedReleaseScheduleSnapshot(resolvedSchedule),
        );
        return { failure: { language, errorCode }, error };
      }
    });
    const variants: CommentWorkflowEvent[] = [];
    const failures: { language: string; errorCode: string }[] = [];
    let lastError: unknown = null;
    for (const outcome of outcomes) {
      if ('variant' in outcome) {
        variants.push(outcome.variant);
      } else {
        failures.push(outcome.failure);
        lastError = outcome.error;
      }
    }
    if (variants.length === 0 && lastError) throw lastError;
    return { variants, failures };
  }

  private async recordSuggestionFailure(
    tenantId: string,
    socialAccountId: string,
    externalCommentId: string,
    analysisEventId: string,
    language: string,
    toneProfile: ResponseToneProfile | null,
    toneProfileSource: ResponseToneProfileSource | null,
    batchOperationId: string | null | undefined,
    error: unknown,
    knownErrorCode?: string,
    scheduleSnapshot: VerifiedReleaseScheduleSnapshot | null = null,
  ): Promise<void> {
    await this.workflowEvents.append({
      tenantId,
      socialAccountId,
      externalCommentId,
      eventType: 'RESPONSE_SUGGESTION_GENERATED',
      actorSource: 'GENERATOR',
      status: 'FAILED',
      operationId: null,
      batchOperationId: batchOperationId ?? null,
      parentEventId: analysisEventId,
      payload: {
        errorCode: knownErrorCode ?? this.suggestionErrorCode(error),
        language,
        toneProfile,
        ...(toneProfileSource !== null ? { toneProfileSource } : {}),
        verifiedReleaseScheduleSnapshot: scheduleSnapshot,
      },
      recordedAt: new Date(this.now()).toISOString(),
    });
  }

  private suggestionErrorCode(error: unknown): string {
    return error instanceof IntelligenceProviderError || error instanceof ResponseToneSettingsError || error instanceof VerifiedReleaseScheduleError
      ? error.code
      : error instanceof CommentWorkflowAuditError
        ? error.code
        : 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID';
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
    private readonly scheduleSettings: VerifiedReleaseScheduleRepository,
    private readonly tenantScheduleSettings: TenantVerifiedReleaseScheduleRepository,
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
    const revision = history.find((event) => event.id === input.revisionEventId
      && isResponseVersionEventType(event.eventType) && event.status !== 'FAILED' && event.status !== 'UNSUPPORTED');
    if (!revision || !isLatestResponseVersionForSelection(history, revision.id)) {
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

    let storedAccountSchedule;
    let storedTenantSchedule = null;
    try {
      storedAccountSchedule = await this.scheduleSettings.get(tenantId, account.id);
      if (storedAccountSchedule && !isValidStoredVerifiedReleaseSchedule(storedAccountSchedule)) {
        throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_DATA_INVALID');
      }
      if (!storedAccountSchedule) {
        storedTenantSchedule = await this.tenantScheduleSettings.get(tenantId);
        if (storedTenantSchedule && !isValidStoredVerifiedReleaseSchedule(storedTenantSchedule)) {
          throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_DATA_INVALID');
        }
      }
    } catch (error) {
      const scheduleError = error instanceof VerifiedReleaseScheduleError
        ? error
        : new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE');
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
        payload: {
          revisionEventId: revision.id,
          errorCode: scheduleError.code,
          verifiedReleaseScheduleSnapshot: null,
        },
        recordedAt: new Date(this.now()).toISOString(),
      });
      throw scheduleError;
    }
    const scheduleSnapshot = verifiedReleaseScheduleSnapshot(
      resolveVerifiedReleaseSchedule(storedAccountSchedule, storedTenantSchedule),
    );
    const verifiedReleaseSchedule = scheduleSnapshot.status === 'ACTIVE'
      ? {
        daysOfWeek: [...scheduleSnapshot.schedule.daysOfWeek],
        localTime: scheduleSnapshot.schedule.localTime,
        timeZone: scheduleSnapshot.schedule.timeZone,
      }
      : undefined;
    try {
      const evaluation = await this.evaluator.evaluate({
        comment,
        analysis: effectiveAnalysis,
        responseText,
        ...(verifiedReleaseSchedule ? { verifiedReleaseSchedule } : {}),
      });
      return await this.recordEvaluation.execute({
        accountId: account.id,
        externalCommentId: comment.externalCommentId,
        revisionEventId: revision.id,
        evaluation: { ...evaluation },
        verifiedReleaseScheduleSnapshot: scheduleSnapshot,
      });
    } catch (error) {
      const errorCode = error instanceof IntelligenceProviderError
        ? error.code
        : error instanceof CommentWorkflowAuditError || error instanceof VerifiedReleaseScheduleError
          ? error.code
          : 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID';
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
        payload: {
          revisionEventId: revision.id,
          errorCode,
          verifiedReleaseScheduleSnapshot: scheduleSnapshot,
        },
        recordedAt: new Date(this.now()).toISOString(),
      });
      throw error;
    }
  }
}
