import type { AiResponseEditPair } from './response-refinement-pair-repository.port';
import type { JevCommentAnalysisResult } from './comment-evaluator.port';
import type { StoredPlatformComment } from './social-comment-repository.port';
import type { ActiveVerifiedReleaseScheduleContext } from './verified-release-schedule.repository.port';
import type { ResponseEditClassification } from './response-edit-classifier.port';
import type { JevResponseEvaluationResult } from './response-evaluator.port';

export type ResponseRefinementContextStatus =
  | 'AVAILABLE'
  | 'SOURCE_CONTEXT_EXPIRED'
  | 'SOURCE_LINEAGE_UNAVAILABLE'
  | 'SOURCE_RESULT_NOT_SUCCEEDED'
  | 'SOURCE_CONTEXT_INVALID';

export interface ResponseRefinementAnalysisContext {
  readonly status: ResponseRefinementContextStatus;
  readonly comment?: StoredPlatformComment;
  readonly analysis?: JevCommentAnalysisResult;
  readonly verifiedReleaseSchedule?: ActiveVerifiedReleaseScheduleContext;
  readonly sourceContextUpdatedAt?: string;
}

export interface ResponseRefinementAnalysisCandidate {
  readonly pair: AiResponseEditPair;
  readonly context: ResponseRefinementAnalysisContext;
}

export interface ResponseRefinementAnalysisFilters {
  readonly accountId: string | null;
  readonly platform: string | null;
  readonly language: string | null;
  readonly from: string;
  readonly to: string;
  readonly limit: number;
  readonly after: string | null;
}

export interface ResponseRefinementAnalysisQuery {
  listCandidates(
    tenantId: string,
    filters: ResponseRefinementAnalysisFilters,
    asOf: string,
  ): Promise<ResponseRefinementAnalysisCandidatePage>;
  listRetryCandidates(
    tenantId: string,
    analysisRequestId: string,
    asOf: string,
  ): Promise<ResponseRefinementAnalysisRetryPage>;
}

export interface ResponseRefinementAnalysisCandidatePage {
  readonly items: readonly ResponseRefinementAnalysisCandidate[];
  readonly nextCursor: string | null;
}

export type ResponseRefinementAnalysisStatus = 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';

export interface PriorResponseRefinementAnalysis {
  readonly id: string;
  readonly status: ResponseRefinementAnalysisStatus;
  readonly aiEvaluation: JevResponseEvaluationResult | null;
  readonly finalEvaluation: JevResponseEvaluationResult | null;
  readonly editClassification: ResponseEditClassification | null;
  readonly scoreDeltas: ResponseRefinementScoreDeltas | null;
  readonly capabilityErrors: Readonly<Record<string, string>>;
  readonly recordedAt: string;
}

export interface ResponseRefinementAnalysisRetryCandidate extends ResponseRefinementAnalysisCandidate {
  readonly previousAnalysis: PriorResponseRefinementAnalysis;
}

export interface ResponseRefinementAnalysisRetryPage {
  readonly items: readonly ResponseRefinementAnalysisRetryCandidate[];
}

export interface ResponseRefinementScoreDeltas {
  readonly relevance: number;
  readonly tone: number;
  readonly helpfulness: number;
  readonly factualRisk: number;
  readonly toxicityRisk: number;
  readonly hallucinationRisk: number;
  readonly scheduleConsistency: number | null;
  readonly publishRecommendation: {
    readonly ai: 'APPROVE' | 'REVIEW' | 'REJECT';
    readonly final: 'APPROVE' | 'REVIEW' | 'REJECT';
  };
}

export interface AppendResponseRefinementAnalysisInput {
  readonly analysisRequestId: string;
  readonly sourceAnalysisId: string | null;
  readonly tenantId: string;
  readonly pairId: string;
  readonly promptVersion: string;
  readonly sourceContextUpdatedAt: string | null;
  readonly status: ResponseRefinementAnalysisStatus;
  readonly skipReason: string | null;
  readonly aiEvaluation: JevResponseEvaluationResult | null;
  readonly finalEvaluation: JevResponseEvaluationResult | null;
  readonly editClassification: ResponseEditClassification | null;
  readonly scoreDeltas: ResponseRefinementScoreDeltas | null;
  readonly capabilityErrors: Readonly<Record<string, string>>;
  readonly recordedAt: string;
}

export interface ResponseRefinementAnalysisRepository {
  append(input: AppendResponseRefinementAnalysisInput): Promise<{ readonly id: string }>;
}

export interface ResponseRefinementAnalysisIdGenerator {
  generate(): string;
}
