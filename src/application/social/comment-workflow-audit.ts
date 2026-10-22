import type { CommentWorkflowEvent, CommentWorkflowEventRepository } from '../ports/comment-workflow-event-repository.port';
import type {
  JevCommentAnalysisResult,
  JevProviderUsage,
  JevScoreSignal,
} from '../ports/comment-evaluator.port';
import type { GeneratedResponseSuggestion } from '../ports/response-suggestion-generator.port';
import type { ResponseToneProfile } from '../ports/response-tone-settings.repository.port';
import type { VerifiedReleaseScheduleSnapshot } from '../ports/verified-release-schedule.repository.port';
import { defaultResponseToneProfile, isValidResponseToneProfile, type ResponseToneProfileSource } from './response-tone-settings';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import { parseSocialAccountId } from '../../domain/social/social-account-id';
import { CommentWorkflowAuditError } from './comment-workflow-audit-error';
import { SocialProviderError } from './social-provider-error';
import { isValidStoredVerifiedReleaseSchedule } from '../../domain/social/verified-release-schedule';

export function isValidJevCommentAnalysisResult(value: unknown): value is JevCommentAnalysisResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const analysis = value as Partial<JevCommentAnalysisResult>;
  const labels = [analysis.sentiment, analysis.emotion, analysis.intent, analysis.topic, analysis.provider, analysis.model, analysis.schemaVersion];
  const scores = [analysis.spamScore, analysis.toxicityScore, analysis.engagementValue, analysis.confidence];
  return !labels.some((label) => typeof label !== 'string' || !label.trim())
    && (analysis.entity === null || (typeof analysis.entity === 'string' && Boolean(analysis.entity.trim())))
    && !scores.some((score) => typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1)
    && (analysis.continuationRequestProbability === undefined || isUnitScore(analysis.continuationRequestProbability))
    && (analysis.rationale === null || typeof analysis.rationale === 'string')
    && (analysis.signals === undefined || isValidCommentAnalysisSignals(analysis.signals))
    && (analysis.usage === undefined || analysis.usage === null || isValidProviderUsage(analysis.usage));
}

function isValidCommentAnalysisSignals(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isValidChoiceSignal(value.sentiment)
    && isValidChoiceSignal(value.emotion)
    && isValidChoiceSignal(value.intent)
    && isValidChoiceSignal(value.topic)
    && isValidNoulSignal(value.spam)
    && isValidNoulSignal(value.toxicity)
    && isValidScoreSignal(value.engagement)
    && isValidNoulSignal(value.needsExternalFacts)
    && isValidNoulSignal(value.requestsContinuation);
}

function isValidResponseEvaluationSignals(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isValidScoreSignal(value.relevance)
    && isValidScoreSignal(value.tone)
    && isValidScoreSignal(value.helpfulness)
    && isValidNoulSignal(value.factualRisk)
    && isValidNoulSignal(value.toxicityRisk)
    && isValidNoulSignal(value.hallucinationRisk)
    && (value.scheduleConsistency === undefined || isValidNoulSignal(value.scheduleConsistency))
    && isValidChoiceSignal(value.publishRecommendation);
}

function isValidVerifiedReleaseScheduleSnapshot(value: unknown): value is VerifiedReleaseScheduleSnapshot {
  if (!isRecord(value)) return false;
  if (value.status === 'UNCONFIGURED') return value.schedule === null;
  return (value.status === 'ACTIVE' || value.status === 'DISABLED')
    && (value.source === 'ACCOUNT' || value.source === 'TENANT')
    && isValidStoredVerifiedReleaseSchedule(value.schedule)
    && (value.status === 'ACTIVE' ? value.schedule.enabled : !value.schedule.enabled);
}

function isValidChoiceSignal(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isUnitScore(value.confidence) && isProbabilityMap(value.probabilities);
}

function isValidScoreSignal(value: unknown): value is JevScoreSignal {
  if (!isRecord(value)) return false;
  const probabilities = value.probabilities;
  const legend = value.legend;
  if (typeof value.rawScore !== 'number' || !Number.isFinite(value.rawScore) || value.rawScore < 0 || value.rawScore > 4
    || typeof value.normalizedScore !== 'number' || !Number.isFinite(value.normalizedScore) || value.normalizedScore < 0 || value.normalizedScore > 1
    || Math.abs(value.normalizedScore - value.rawScore / 4) > 1e-9
    || !isUnitScore(value.confidence)
    || !isProbabilityMap(probabilities)
    || !isStringMap(legend)) {
    return false;
  }
  return Object.keys(probabilities).length === 5
    && Object.keys(legend).length === 5
    && [0, 1, 2, 3, 4].every((level) => Object.hasOwn(probabilities, String(level)) && Object.hasOwn(legend, String(level)));
}

function isValidNoulSignal(value: unknown): value is { readonly probability: number } {
  return isRecord(value) && isUnitScore(value.probability);
}

function isProbabilityMap(value: unknown): value is Readonly<Record<string, number>> {
  return isRecord(value) && Object.keys(value).length > 0
    && Object.values(value).every(isUnitScore);
}

function isStringMap(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.keys(value).length > 0
    && Object.values(value).every((entry) => typeof entry === 'string' && Boolean(entry.trim()));
}

function isValidProviderUsage(value: unknown): value is JevProviderUsage {
  return isRecord(value)
    && Number.isSafeInteger(value.inputTokens) && (value.inputTokens as number) >= 0
    && Number.isSafeInteger(value.outputTokens) && (value.outputTokens as number) >= 0;
}

function isUnitScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface RecordCommentAnalysisInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly analysis: JevCommentAnalysisResult;
  readonly batchOperationId?: string | null;
}

export interface CorrectCommentAnalysisInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly analysisEventId: string;
  readonly correctedFields: Readonly<Record<string, unknown>>;
  readonly reason?: string | null;
}

export interface RecordResponseSuggestionInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly sourceAnalysisEventId?: string | null;
  readonly suggestion: GeneratedResponseSuggestion;
  readonly toneProfile?: ResponseToneProfile;
  readonly toneProfileSource?: ResponseToneProfileSource;
  readonly verifiedReleaseScheduleSnapshot?: VerifiedReleaseScheduleSnapshot | null;
  readonly batchOperationId?: string | null;
}

export interface ReviseResponseSuggestionInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly suggestionEventId: string;
  readonly previousRevisionId?: string | null;
  readonly text: string;
  readonly reason?: string | null;
}

export interface ManualResponseInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly text: string;
  readonly reason?: string | null;
}

export interface ReviseManualResponseInput extends ManualResponseInput {
  readonly responseEventId: string;
  readonly previousRevisionId?: string | null;
}

export interface RecordResponseEvaluationInput {
  readonly accountId: string;
  readonly externalCommentId: string;
  readonly revisionEventId: string;
  readonly evaluation: Readonly<Record<string, unknown>>;
  readonly verifiedReleaseScheduleSnapshot?: VerifiedReleaseScheduleSnapshot | null;
}

export function isResponseVersionEventType(eventType: string): boolean {
  return eventType === 'RESPONSE_SUGGESTION_GENERATED'
    || eventType === 'RESPONSE_SUGGESTION_EDITED'
    || eventType === 'MANUAL_RESPONSE_CREATED'
    || eventType === 'MANUAL_RESPONSE_EDITED';
}

export function isLatestResponseVersionForSelection(history: readonly CommentWorkflowEvent[], revisionEventId: string): boolean {
  const versions = history.filter((event) => isResponseVersionEventType(event.eventType)
    && event.status !== 'FAILED' && event.status !== 'UNSUPPORTED');
  const revision = versions.find((event) => event.id === revisionEventId);
  if (!revision) return false;

  const rootId = responseVersionRootId(revision);
  if (!rootId) return false;
  const root = versions.find((event) => event.id === rootId);
  if (!root) return false;

  const latestInLineage = [...versions].reverse().find((event) => responseVersionRootId(event) === rootId);
  if (latestInLineage?.id !== revision.id) return false;

  const latestManualVersion = [...versions].reverse().find((event) => isManualResponseEventType(event.eventType));
  if (root.eventType !== 'RESPONSE_SUGGESTION_GENERATED') {
    return latestManualVersion?.id === revision.id;
  }

  const latestSuggestionForLanguage = [...versions].reverse().find((event) => (
    event.eventType === 'RESPONSE_SUGGESTION_GENERATED'
    && event.payload.language === root.payload.language
  ));
  if (latestSuggestionForLanguage?.id !== root.id) return false;
  return !latestManualVersion || versions.indexOf(latestManualVersion) < versions.indexOf(revision);
}

function responseVersionRootId(event: CommentWorkflowEvent): string | null {
  if (event.eventType === 'RESPONSE_SUGGESTION_GENERATED' || event.eventType === 'MANUAL_RESPONSE_CREATED') {
    return event.id;
  }
  const rootId = event.eventType === 'RESPONSE_SUGGESTION_EDITED'
    ? event.payload.originalSuggestionEventId
    : event.payload.originalManualResponseEventId;
  return typeof rootId === 'string' ? rootId : null;
}

function isManualResponseEventType(eventType: string): boolean {
  return eventType === 'MANUAL_RESPONSE_CREATED' || eventType === 'MANUAL_RESPONSE_EDITED';
}

export interface CommentWorkflowHistoryInput {
  readonly accountId: string;
  readonly externalCommentId: string;
}

export class RecordCommentAnalysis {
  constructor(
    private readonly events: CommentWorkflowEventRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: RecordCommentAnalysisInput): Promise<CommentWorkflowEvent> {
    this.validateAnalysis(input.analysis);
    const tenantId = await this.tenant.resolveTenantId();
    const history = await this.events.listByComment(tenantId, input.accountId, input.externalCommentId, new Date(this.now()).toISOString());
    const priorAnalysis = history.filter((event) => event.eventType === 'COMMENT_ANALYSIS_CREATED').at(-1);
    return this.events.append({
      tenantId,
      socialAccountId: parseSocialAccountId(input.accountId),
      externalCommentId: input.externalCommentId,
      eventType: 'COMMENT_ANALYSIS_CREATED',
      actorSource: 'AI',
      status: 'SUCCEEDED',
      operationId: null,
      batchOperationId: input.batchOperationId ?? null,
      parentEventId: priorAnalysis?.id ?? null,
      payload: { ...input.analysis },
      recordedAt: new Date(this.now()).toISOString(),
    });
  }

  private validateAnalysis(analysis: JevCommentAnalysisResult): void {
    if (!isValidJevCommentAnalysisResult(analysis)) {
      throw new CommentWorkflowAuditError('COMMENT_ANALYSIS_INVALID');
    }
  }
}

export class CorrectCommentAnalysis {
  private readonly editableLabels = new Set(['sentiment', 'emotion', 'intent', 'topic', 'entity']);
  private readonly editableScores = new Set(['spamScore', 'toxicityScore', 'engagementValue']);

  constructor(
    private readonly events: CommentWorkflowEventRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: CorrectCommentAnalysisInput): Promise<CommentWorkflowEvent> {
    this.validateCorrections(input.correctedFields);
    if (input.reason !== undefined && input.reason !== null && typeof input.reason !== 'string') {
      throw new CommentWorkflowAuditError('COMMENT_ANALYSIS_CORRECTION_INVALID');
    }
    const tenantId = await this.tenant.resolveTenantId();
    const history = await this.events.listByComment(tenantId, input.accountId, input.externalCommentId, new Date(this.now()).toISOString());
    const analysis = history.find((event) => event.id === input.analysisEventId && event.eventType === 'COMMENT_ANALYSIS_CREATED');
    if (!analysis) {
      throw new CommentWorkflowAuditError('COMMENT_ANALYSIS_NOT_FOUND');
    }
    return this.events.append({
      tenantId,
      socialAccountId: parseSocialAccountId(input.accountId),
      externalCommentId: input.externalCommentId,
      eventType: 'COMMENT_ANALYSIS_CORRECTED',
      actorSource: 'CREATOR_LOCAL',
      status: 'SUCCEEDED',
      operationId: null,
      batchOperationId: null,
      parentEventId: analysis.id,
      payload: { correctedFields: input.correctedFields, reason: input.reason?.trim() || null },
      recordedAt: new Date(this.now()).toISOString(),
    });
  }

  private validateCorrections(fields: Readonly<Record<string, unknown>>): void {
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      throw new CommentWorkflowAuditError('COMMENT_ANALYSIS_CORRECTION_INVALID');
    }
    const entries = Object.entries(fields);
    if (!entries.length || entries.some(([key, value]) => {
      if (this.editableLabels.has(key)) {
        return key === 'entity' ? (value !== null && (typeof value !== 'string' || !value.trim())) : (typeof value !== 'string' || !value.trim());
      }
      if (this.editableScores.has(key)) {
        return typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1;
      }
      return true;
    })) {
      throw new CommentWorkflowAuditError('COMMENT_ANALYSIS_CORRECTION_INVALID');
    }
  }
}

export class RecordResponseSuggestion {
  constructor(
    private readonly events: CommentWorkflowEventRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: RecordResponseSuggestionInput): Promise<CommentWorkflowEvent> {
    this.validateSuggestion(input.suggestion);
    const toneProfile = input.toneProfile ?? defaultResponseToneProfile;
    if (!isValidResponseToneProfile(toneProfile)) throw new CommentWorkflowAuditError('RESPONSE_SUGGESTION_INVALID');
    if (input.toneProfileSource !== undefined
      && input.toneProfileSource !== 'ACCOUNT' && input.toneProfileSource !== 'TENANT' && input.toneProfileSource !== 'DEFAULT') {
      throw new CommentWorkflowAuditError('RESPONSE_SUGGESTION_INVALID');
    }
    if (input.verifiedReleaseScheduleSnapshot !== undefined
      && input.verifiedReleaseScheduleSnapshot !== null
      && !isValidVerifiedReleaseScheduleSnapshot(input.verifiedReleaseScheduleSnapshot)) {
      throw new CommentWorkflowAuditError('RESPONSE_SUGGESTION_INVALID');
    }
    const tenantId = await this.tenant.resolveTenantId();
    const history = await this.events.listByComment(tenantId, input.accountId, input.externalCommentId, new Date(this.now()).toISOString());
    const sourceAnalysis = input.sourceAnalysisEventId
      ? history.find((event) => event.id === input.sourceAnalysisEventId && (event.eventType === 'COMMENT_ANALYSIS_CREATED' || event.eventType === 'COMMENT_ANALYSIS_CORRECTED'))
      : undefined;
    if (input.sourceAnalysisEventId && !sourceAnalysis) {
      throw new CommentWorkflowAuditError('COMMENT_ANALYSIS_NOT_FOUND');
    }
    return this.events.append({
      tenantId,
      socialAccountId: parseSocialAccountId(input.accountId),
      externalCommentId: input.externalCommentId,
      eventType: 'RESPONSE_SUGGESTION_GENERATED',
      actorSource: 'GENERATOR',
      status: 'SUCCEEDED',
      operationId: null,
      batchOperationId: input.batchOperationId ?? null,
      parentEventId: sourceAnalysis?.id ?? null,
      payload: {
        ...input.suggestion,
        toneProfile,
        ...(input.toneProfileSource !== undefined ? { toneProfileSource: input.toneProfileSource } : {}),
        verifiedReleaseScheduleSnapshot: input.verifiedReleaseScheduleSnapshot ?? null,
      },
      recordedAt: new Date(this.now()).toISOString(),
    });
  }

  private validateSuggestion(suggestion: GeneratedResponseSuggestion): void {
    if (typeof suggestion !== 'object' || suggestion === null || Array.isArray(suggestion)
      || typeof suggestion.text !== 'string' || !suggestion.text.trim()
      || typeof suggestion.language !== 'string' || !suggestion.language.trim()
      || typeof suggestion.intendedTone !== 'string' || !suggestion.intendedTone.trim()
      || typeof suggestion.provider !== 'string' || !suggestion.provider.trim()
      || typeof suggestion.model !== 'string' || !suggestion.model.trim()
      || !Number.isFinite(suggestion.confidence) || suggestion.confidence < 0 || suggestion.confidence > 1
      || (suggestion.rationale !== null && typeof suggestion.rationale !== 'string')) {
      throw new CommentWorkflowAuditError('RESPONSE_SUGGESTION_INVALID');
    }
  }
}

export class ReviseResponseSuggestion {
  constructor(
    private readonly events: CommentWorkflowEventRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: ReviseResponseSuggestionInput): Promise<CommentWorkflowEvent> {
    if (typeof input.text !== 'string' || !input.text.trim()
      || (input.reason !== undefined && input.reason !== null && typeof input.reason !== 'string')
      || (input.previousRevisionId !== undefined && input.previousRevisionId !== null && typeof input.previousRevisionId !== 'string')) {
      throw new CommentWorkflowAuditError('RESPONSE_SUGGESTION_REVISION_INVALID');
    }
    const tenantId = await this.tenant.resolveTenantId();
    const history = await this.events.listByComment(tenantId, input.accountId, input.externalCommentId, new Date(this.now()).toISOString());
    const suggestion = history.find((event) => event.id === input.suggestionEventId && event.eventType === 'RESPONSE_SUGGESTION_GENERATED');
    if (!suggestion) {
      throw new CommentWorkflowAuditError('RESPONSE_SUGGESTION_NOT_FOUND');
    }
    if (input.previousRevisionId) {
      const previous = history.find((event) => event.id === input.previousRevisionId && event.eventType === 'RESPONSE_SUGGESTION_EDITED');
      if (!previous || previous.payload.originalSuggestionEventId !== suggestion.id) {
        throw new CommentWorkflowAuditError('RESPONSE_SUGGESTION_NOT_FOUND');
      }
    }
    const priorRevisions = history.filter((event) => event.eventType === 'RESPONSE_SUGGESTION_EDITED' && event.payload.originalSuggestionEventId === suggestion.id);
    return this.events.append({
      tenantId,
      socialAccountId: parseSocialAccountId(input.accountId),
      externalCommentId: input.externalCommentId,
      eventType: 'RESPONSE_SUGGESTION_EDITED',
      actorSource: 'CREATOR_LOCAL',
      status: 'SUCCEEDED',
      operationId: null,
      batchOperationId: null,
      parentEventId: input.previousRevisionId ?? suggestion.id,
      payload: {
        originalSuggestionEventId: suggestion.id,
        revision: priorRevisions.length + 1,
        text: input.text,
        reason: input.reason?.trim() || null,
      },
      recordedAt: new Date(this.now()).toISOString(),
    });
  }
}

export class RecordManualResponse {
  constructor(
    protected readonly events: CommentWorkflowEventRepository,
    protected readonly tenant: PilotTenantContext,
    protected readonly now: () => number = Date.now,
  ) {}

  async execute(input: ManualResponseInput): Promise<CommentWorkflowEvent> {
    this.validate(input.text, input.reason);
    const tenantId = await this.tenant.resolveTenantId();
    return this.events.append({
      tenantId,
      socialAccountId: parseSocialAccountId(input.accountId),
      externalCommentId: input.externalCommentId,
      eventType: 'MANUAL_RESPONSE_CREATED',
      actorSource: 'CREATOR_LOCAL',
      status: 'SUCCEEDED',
      operationId: null,
      batchOperationId: null,
      parentEventId: null,
      payload: { text: input.text, reason: input.reason?.trim() || null },
      recordedAt: new Date(this.now()).toISOString(),
    });
  }

  protected validate(text: string, reason?: string | null): void {
    if (typeof text !== 'string' || !text.trim() || (reason !== undefined && reason !== null && typeof reason !== 'string')) {
      throw new CommentWorkflowAuditError('MANUAL_RESPONSE_INVALID');
    }
  }
}

export class ReviseManualResponse extends RecordManualResponse {
  async execute(input: ReviseManualResponseInput): Promise<CommentWorkflowEvent> {
    this.validate(input.text, input.reason);
    if ((input.previousRevisionId !== undefined && input.previousRevisionId !== null && typeof input.previousRevisionId !== 'string')) {
      throw new CommentWorkflowAuditError('MANUAL_RESPONSE_INVALID');
    }
    const tenantId = await this.tenant.resolveTenantId();
    const history = await this.events.listByComment(tenantId, input.accountId, input.externalCommentId, new Date(this.now()).toISOString());
    const response = history.find((event) => event.id === input.responseEventId && event.eventType === 'MANUAL_RESPONSE_CREATED');
    if (!response) {
      throw new CommentWorkflowAuditError('MANUAL_RESPONSE_NOT_FOUND');
    }
    if (input.previousRevisionId) {
      const previous = history.find((event) => event.id === input.previousRevisionId && event.eventType === 'MANUAL_RESPONSE_EDITED');
      if (!previous || previous.payload.originalManualResponseEventId !== response.id) {
        throw new CommentWorkflowAuditError('MANUAL_RESPONSE_NOT_FOUND');
      }
    }
    const priorRevisions = history.filter((event) => event.eventType === 'MANUAL_RESPONSE_EDITED' && event.payload.originalManualResponseEventId === response.id);
    return this.events.append({
      tenantId,
      socialAccountId: parseSocialAccountId(input.accountId),
      externalCommentId: input.externalCommentId,
      eventType: 'MANUAL_RESPONSE_EDITED',
      actorSource: 'CREATOR_LOCAL',
      status: 'SUCCEEDED',
      operationId: null,
      batchOperationId: null,
      parentEventId: input.previousRevisionId ?? response.id,
      payload: { originalManualResponseEventId: response.id, revision: priorRevisions.length + 1, text: input.text, reason: input.reason?.trim() || null },
      recordedAt: new Date(this.now()).toISOString(),
    });
  }
}

export class RecordResponseEvaluation {
  constructor(
    private readonly events: CommentWorkflowEventRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: RecordResponseEvaluationInput): Promise<CommentWorkflowEvent> {
    this.validateEvaluation(input.evaluation, input.verifiedReleaseScheduleSnapshot);
    const tenantId = await this.tenant.resolveTenantId();
    const history = await this.events.listByComment(tenantId, input.accountId, input.externalCommentId, new Date(this.now()).toISOString());
    const revision = history.find((event) => event.id === input.revisionEventId
      && isResponseVersionEventType(event.eventType) && event.status !== 'FAILED' && event.status !== 'UNSUPPORTED');
    if (!revision || !isLatestResponseVersionForSelection(history, revision.id)) {
      throw new CommentWorkflowAuditError('RESPONSE_EVALUATION_REVISION_STALE');
    }
    return this.events.append({
      tenantId,
      socialAccountId: parseSocialAccountId(input.accountId),
      externalCommentId: input.externalCommentId,
      eventType: 'RESPONSE_EVALUATED',
      actorSource: 'AI',
      status: 'SUCCEEDED',
      operationId: null,
      batchOperationId: null,
      parentEventId: revision.id,
      payload: {
        revisionEventId: revision.id,
        evaluation: { ...input.evaluation },
        ...(input.verifiedReleaseScheduleSnapshot !== undefined
          ? { verifiedReleaseScheduleSnapshot: input.verifiedReleaseScheduleSnapshot }
          : {}),
      },
      recordedAt: new Date(this.now()).toISOString(),
    });
  }

  private validateEvaluation(
    evaluation: Readonly<Record<string, unknown>>,
    scheduleSnapshot?: VerifiedReleaseScheduleSnapshot | null,
  ): void {
    if (typeof evaluation !== 'object' || evaluation === null || Array.isArray(evaluation)) {
      throw new CommentWorkflowAuditError('RESPONSE_EVALUATION_INVALID');
    }
    const scheduleConsistencySignal = isRecord(evaluation.signals)
      ? evaluation.signals.scheduleConsistency
      : undefined;
    const scheduleConsistencyMatches = isValidNoulSignal(scheduleConsistencySignal)
      && typeof evaluation.scheduleConsistency === 'number'
      && Math.abs(evaluation.scheduleConsistency - scheduleConsistencySignal.probability) <= 1e-9;
    const scores = [evaluation.relevance, evaluation.tone, evaluation.helpfulness, evaluation.factualRisk, evaluation.toxicityRisk, evaluation.hallucinationRisk, evaluation.confidence];
    if (!['provider', 'model', 'schemaVersion'].every((key) => typeof evaluation[key] === 'string' && Boolean((evaluation[key] as string).trim()))
      || scores.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
      || !['APPROVE', 'REVIEW', 'REJECT'].includes(evaluation.publishRecommendation as string)
      || (evaluation.rationale !== null && typeof evaluation.rationale !== 'string')
      || (evaluation.scheduleConsistency !== undefined && !isUnitScore(evaluation.scheduleConsistency))
      || (evaluation.signals !== undefined && !isValidResponseEvaluationSignals(evaluation.signals))
      || (evaluation.usage !== undefined && evaluation.usage !== null && !isValidProviderUsage(evaluation.usage))
      || (scheduleSnapshot !== undefined && scheduleSnapshot !== null && !isValidVerifiedReleaseScheduleSnapshot(scheduleSnapshot))
      || ((evaluation.scheduleConsistency !== undefined || scheduleConsistencySignal !== undefined)
        && (scheduleSnapshot === undefined || scheduleSnapshot === null))
      || (scheduleSnapshot?.status === 'ACTIVE'
        && (!isUnitScore(evaluation.scheduleConsistency)
          || !isRecord(evaluation.signals)
          || !scheduleConsistencyMatches))
      || (scheduleSnapshot !== undefined && scheduleSnapshot !== null && scheduleSnapshot.status !== 'ACTIVE'
        && (evaluation.scheduleConsistency !== undefined || scheduleConsistencySignal !== undefined))) {
      throw new CommentWorkflowAuditError('RESPONSE_EVALUATION_INVALID');
    }
  }
}

export class ListCommentWorkflow {
  constructor(
    private readonly events: CommentWorkflowEventRepository,
    private readonly accounts: SocialAccountRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: CommentWorkflowHistoryInput): Promise<readonly CommentWorkflowEvent[]> {
    const tenantId = await this.tenant.resolveTenantId();
    const accountId = parseSocialAccountId(input.accountId);
    const account = await this.accounts.findById(tenantId, accountId);
    if (!account) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    }
    return this.events.listByComment(tenantId, input.accountId, input.externalCommentId, new Date(this.now()).toISOString());
  }
}
