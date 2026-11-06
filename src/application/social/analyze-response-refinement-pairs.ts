import type { ResponseEvaluator, JevResponseEvaluationResult } from '../ports/response-evaluator.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type {
  ResponseRefinementAnalysisQuery,
  ResponseRefinementAnalysisRepository,
  ResponseRefinementScoreDeltas,
  ResponseRefinementAnalysisIdGenerator,
  ResponseRefinementAnalysisCandidate,
  ResponseRefinementAnalysisFilters,
  ResponseRefinementAnalysisRetryCandidate,
} from '../ports/response-refinement-analysis.repository.port';
import type { ResponseEditClassifier } from '../ports/response-edit-classifier.port';
import { parseSocialAccountId } from '../../domain/social/social-account-id';
import { runWithConcurrency } from '../run-with-concurrency';
import { ResponseRefinementAnalysisError } from './response-refinement-analysis-error';

const supportedPlatforms = new Set(['youtube', 'instagram', 'facebook', 'tiktok']);
const supportedLanguages = new Set(['pt-BR', 'en-US', 'es-ES']);
const maxPairsPerRequest = 25;
const analysisConcurrency = 4;
const defaultWindowMilliseconds = 90 * 24 * 60 * 60 * 1000;
const maxWindowMilliseconds = 365 * 24 * 60 * 60 * 1000;

interface AnalyzeResponseRefinementPairsInput {
  readonly confirmExternalProcessing: boolean;
  readonly accountId?: string;
  readonly platform?: string;
  readonly language?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly after?: string | null;
  readonly retryClassificationFromAnalysisRequestId?: string;
}

interface AnalyzedPairResult {
  readonly analysisId: string;
  readonly status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  readonly skipReason: string | null;
  readonly platform: string;
  readonly language: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly category: string | null;
  readonly observedAiIssue: string | null;
  readonly confidence: number | null;
  readonly scoreDeltas: ResponseRefinementScoreDeltas | null;
  readonly capabilityErrors: Readonly<Record<string, string>>;
}

export class AnalyzeResponseRefinementPairs {
  constructor(
    private readonly query: ResponseRefinementAnalysisQuery,
    private readonly analyses: ResponseRefinementAnalysisRepository,
    private readonly evaluator: ResponseEvaluator,
    private readonly classifier: ResponseEditClassifier,
    private readonly tenant: PilotTenantContext,
    private readonly ids: ResponseRefinementAnalysisIdGenerator,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: AnalyzeResponseRefinementPairsInput) {
    if (input.confirmExternalProcessing !== true) {
      throw new ResponseRefinementAnalysisError('RESPONSE_REFINEMENT_CONSENT_REQUIRED');
    }
    const tenantId = await this.tenant.resolveTenantId();
    const asOf = new Date(this.now()).toISOString();
    const retryRequestId = input.retryClassificationFromAnalysisRequestId;
    if (retryRequestId !== undefined && !/^[0-9a-f-]{36}$/i.test(retryRequestId)) {
      throw new ResponseRefinementAnalysisError('RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID');
    }
    const page = retryRequestId
      ? { ...(await this.query.listRetryCandidates(tenantId, retryRequestId, asOf)), nextCursor: null }
      : await this.query.listCandidates(tenantId, this.filters(input), asOf);
    const candidates = page.items;
    const analysisRequestId = this.ids.generate();
    const outcomes = await runWithConcurrency(
      candidates,
      analysisConcurrency,
      async (candidate) => retryRequestId
        ? this.retryClassification(analysisRequestId, tenantId, candidate as ResponseRefinementAnalysisRetryCandidate, asOf)
        : this.analyzeCandidate(analysisRequestId, tenantId, candidate, asOf),
    );
    const items = outcomes.map((outcome) => this.safeResult(outcome));
    return {
      analysisRequestId,
      selectedCount: items.length,
      analyzedCount: items.filter((item) => item.status === 'SUCCEEDED' || item.status === 'PARTIAL').length,
      skippedCount: items.filter((item) => item.status === 'SKIPPED').length,
      failedCount: items.filter((item) => item.status === 'FAILED' || item.status === 'PARTIAL').length,
      nextCursor: page.nextCursor,
      items,
    };
  }

  private async analyzeCandidate(
    analysisRequestId: string,
    tenantId: string,
    candidate: ResponseRefinementAnalysisCandidate,
    recordedAt: string,
  ): Promise<AnalyzedPairResult> {
    const { pair, context } = candidate;
    const sourceMetadata = {
      platform: pair.platform,
      language: pair.language,
      provider: pair.aiProvider,
      model: pair.aiModel,
      promptVersion: pair.promptVersion || 'UNKNOWN',
    };
    const emptyResult = {
      analysisRequestId,
      tenantId,
      pairId: pair.id,
      promptVersion: sourceMetadata.promptVersion,
      recordedAt,
    };
    if (context.status !== 'AVAILABLE' || !context.comment || !context.analysis) {
      const skipReason = context.status === 'AVAILABLE' ? 'SOURCE_CONTEXT_INVALID' : context.status;
      const saved = await this.analyses.append({
        ...emptyResult,
        sourceAnalysisId: null,
        sourceContextUpdatedAt: context.sourceContextUpdatedAt ?? null,
        status: 'SKIPPED',
        skipReason,
        aiEvaluation: null,
        finalEvaluation: null,
        editClassification: null,
        scoreDeltas: null,
        capabilityErrors: {},
      });
      return {
        analysisId: saved.id, status: 'SKIPPED', skipReason, ...sourceMetadata,
        category: null, observedAiIssue: null, confidence: null, scoreDeltas: null, capabilityErrors: {},
      };
    }

    let aiEvaluation: JevResponseEvaluationResult | null = null;
    let finalEvaluation: JevResponseEvaluationResult | null = null;
    let editClassification: Awaited<ReturnType<ResponseEditClassifier['classify']>> | null = null;
    const capabilityErrors: Record<string, string> = {};
    const sharedContext = {
      comment: context.comment,
      analysis: context.analysis,
      ...(context.verifiedReleaseSchedule ? { verifiedReleaseSchedule: context.verifiedReleaseSchedule } : {}),
    };
    try {
      aiEvaluation = await this.evaluator.evaluate({ ...sharedContext, responseText: pair.aiText });
    } catch (error) {
      capabilityErrors.aiEvaluation = this.errorCode(error);
    }
    try {
      finalEvaluation = await this.evaluator.evaluate({ ...sharedContext, responseText: pair.finalText });
    } catch (error) {
      capabilityErrors.finalEvaluation = this.errorCode(error);
    }
    try {
      editClassification = await this.classifier.classify({
        comment: context.comment,
        analysis: context.analysis,
        aiText: pair.aiText,
        finalText: pair.finalText,
        editReason: pair.lastEditReason,
      });
    } catch (error) {
      capabilityErrors.editClassification = this.errorCode(error);
    }
    const successfulCapabilities = Number(aiEvaluation !== null) + Number(finalEvaluation !== null) + Number(editClassification !== null);
    const status = successfulCapabilities === 3 ? 'SUCCEEDED'
      : successfulCapabilities > 0 ? 'PARTIAL'
        : 'FAILED';
    const scoreDeltas = aiEvaluation && finalEvaluation ? this.scoreDeltas(aiEvaluation, finalEvaluation) : null;
    const saved = await this.analyses.append({
      ...emptyResult,
      sourceAnalysisId: null,
      sourceContextUpdatedAt: context.sourceContextUpdatedAt ?? null,
      status,
      skipReason: null,
      aiEvaluation,
      finalEvaluation,
      editClassification,
      scoreDeltas,
      capabilityErrors,
    });
    return {
      analysisId: saved.id,
      status,
      skipReason: null,
      ...sourceMetadata,
      category: editClassification?.editCategory ?? null,
      observedAiIssue: editClassification?.observedAiIssue ?? null,
      confidence: editClassification?.confidence ?? null,
      scoreDeltas,
      capabilityErrors,
    };
  }

  private async retryClassification(
    analysisRequestId: string,
    tenantId: string,
    candidate: ResponseRefinementAnalysisRetryCandidate,
    recordedAt: string,
  ): Promise<AnalyzedPairResult> {
    const { pair, context, previousAnalysis } = candidate;
    const metadata = {
      platform: pair.platform,
      language: pair.language,
      provider: pair.aiProvider,
      model: pair.aiModel,
      promptVersion: pair.promptVersion || 'UNKNOWN',
    };
    const skip = async (reason: string) => {
      const saved = await this.analyses.append({
        analysisRequestId,
        sourceAnalysisId: previousAnalysis.id,
        tenantId,
        pairId: pair.id,
        promptVersion: metadata.promptVersion,
        sourceContextUpdatedAt: context.sourceContextUpdatedAt ?? null,
        status: 'SKIPPED',
        skipReason: reason,
        aiEvaluation: previousAnalysis.aiEvaluation,
        finalEvaluation: previousAnalysis.finalEvaluation,
        editClassification: null,
        scoreDeltas: previousAnalysis.scoreDeltas,
        capabilityErrors: {},
        recordedAt,
      });
      return {
        analysisId: saved.id,
        status: 'SKIPPED' as const,
        skipReason: reason,
        ...metadata,
        category: null,
        observedAiIssue: null,
        confidence: null,
        scoreDeltas: previousAnalysis.scoreDeltas,
        capabilityErrors: {},
      };
    };
    if (context.status !== 'AVAILABLE' || !context.comment || !context.analysis
      || !context.sourceContextUpdatedAt) {
      return skip(context.status === 'AVAILABLE' ? 'SOURCE_CONTEXT_INVALID' : context.status);
    }
    if (Date.parse(context.sourceContextUpdatedAt) > Date.parse(previousAnalysis.recordedAt)) {
      return skip('SOURCE_CONTEXT_CHANGED');
    }
    if (!previousAnalysis.aiEvaluation || !previousAnalysis.finalEvaluation || previousAnalysis.editClassification) {
      return skip('CLASSIFICATION_RETRY_NOT_APPLICABLE');
    }
    let editClassification: Awaited<ReturnType<ResponseEditClassifier['classify']>> | null = null;
    const capabilityErrors: Record<string, string> = {};
    try {
      editClassification = await this.classifier.classify({
        comment: context.comment,
        analysis: context.analysis,
        aiText: pair.aiText,
        finalText: pair.finalText,
        editReason: pair.lastEditReason,
      });
    } catch (error) {
      capabilityErrors.editClassification = this.errorCode(error);
    }
    const status = editClassification ? 'SUCCEEDED' : 'PARTIAL';
    const saved = await this.analyses.append({
      analysisRequestId,
      sourceAnalysisId: previousAnalysis.id,
      tenantId,
      pairId: pair.id,
      promptVersion: metadata.promptVersion,
      sourceContextUpdatedAt: context.sourceContextUpdatedAt,
      status,
      skipReason: null,
      aiEvaluation: previousAnalysis.aiEvaluation,
      finalEvaluation: previousAnalysis.finalEvaluation,
      editClassification,
      scoreDeltas: previousAnalysis.scoreDeltas,
      capabilityErrors,
      recordedAt,
    });
    return {
      analysisId: saved.id,
      status,
      skipReason: null,
      ...metadata,
      category: editClassification?.editCategory ?? null,
      observedAiIssue: editClassification?.observedAiIssue ?? null,
      confidence: editClassification?.confidence ?? null,
      scoreDeltas: previousAnalysis.scoreDeltas,
      capabilityErrors,
    };
  }

  private filters(input: AnalyzeResponseRefinementPairsInput): ResponseRefinementAnalysisFilters {
    const limit = input.limit ?? maxPairsPerRequest;
    if (!Number.isInteger(limit) || limit < 1 || limit > maxPairsPerRequest
      || (input.after !== undefined && input.after !== null
        && (typeof input.after !== 'string' || !input.after.trim() || input.after.length > 2048))) {
      throw new ResponseRefinementAnalysisError('RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID');
    }
    let accountId: string | null = null;
    if (input.accountId !== undefined) {
      try {
        accountId = parseSocialAccountId(input.accountId);
      } catch {
        throw new ResponseRefinementAnalysisError('RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID');
      }
    }
    const platform = input.platform ?? null;
    const language = input.language ?? null;
    if ((platform !== null && !supportedPlatforms.has(platform))
      || (language !== null && !supportedLanguages.has(language))) {
      throw new ResponseRefinementAnalysisError('RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID');
    }
    const requestTime = this.now();
    const from = input.from === undefined && input.to === undefined
      ? new Date(requestTime - defaultWindowMilliseconds).toISOString()
      : input.from;
    const to = input.from === undefined && input.to === undefined
      ? new Date(requestTime).toISOString()
      : input.to;
    if (typeof from !== 'string' || typeof to !== 'string'
      || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))
      || Date.parse(from) >= Date.parse(to)
      || Date.parse(to) - Date.parse(from) > maxWindowMilliseconds) {
      throw new ResponseRefinementAnalysisError('RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID');
    }
    return {
      accountId,
      platform,
      language,
      from: new Date(Date.parse(from)).toISOString(),
      to: new Date(Date.parse(to)).toISOString(),
      limit,
      after: input.after ?? null,
    };
  }

  private safeResult(result: AnalyzedPairResult): AnalyzedPairResult {
    return result;
  }

  private scoreDeltas(
    ai: JevResponseEvaluationResult,
    final: JevResponseEvaluationResult,
  ): ResponseRefinementScoreDeltas {
    return {
      relevance: final.relevance - ai.relevance,
      tone: final.tone - ai.tone,
      helpfulness: final.helpfulness - ai.helpfulness,
      factualRisk: final.factualRisk - ai.factualRisk,
      toxicityRisk: final.toxicityRisk - ai.toxicityRisk,
      hallucinationRisk: final.hallucinationRisk - ai.hallucinationRisk,
      scheduleConsistency: final.scheduleConsistency !== undefined && ai.scheduleConsistency !== undefined
        ? final.scheduleConsistency - ai.scheduleConsistency
        : null,
      publishRecommendation: {
        ai: ai.publishRecommendation,
        final: final.publishRecommendation,
      },
    };
  }

  private errorCode(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
      return error.code;
    }
    return 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID';
  }
}
