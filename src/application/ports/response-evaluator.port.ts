import type { JevChoiceSignal, JevCommentAnalysisResult, JevNoulSignal, JevProviderUsage, JevScoreSignal } from './comment-evaluator.port';
import type { StoredPlatformComment } from './social-comment-repository.port';
import type { ActiveVerifiedReleaseScheduleContext } from './verified-release-schedule.repository.port';

export interface JevResponseEvaluationSignals {
  readonly relevance: JevScoreSignal;
  readonly tone: JevScoreSignal;
  readonly helpfulness: JevScoreSignal;
  readonly factualRisk: JevNoulSignal;
  readonly toxicityRisk: JevNoulSignal;
  readonly hallucinationRisk: JevNoulSignal;
  readonly scheduleConsistency?: JevNoulSignal;
  readonly publishRecommendation: JevChoiceSignal;
}

export interface JevResponseEvaluationResult {
  readonly relevance: number;
  readonly tone: number;
  readonly helpfulness: number;
  readonly factualRisk: number;
  readonly toxicityRisk: number;
  readonly hallucinationRisk: number;
  readonly scheduleConsistency?: number;
  readonly publishRecommendation: 'APPROVE' | 'REVIEW' | 'REJECT';
  readonly confidence: number;
  readonly rationale: string | null;
  readonly provider: string;
  readonly model: string;
  readonly schemaVersion: string;
  readonly signals?: JevResponseEvaluationSignals;
  readonly usage?: JevProviderUsage | null;
}

export interface ResponseEvaluator {
  evaluate(input: {
    readonly comment: StoredPlatformComment;
    readonly analysis: JevCommentAnalysisResult;
    readonly responseText: string;
    readonly verifiedReleaseSchedule?: ActiveVerifiedReleaseScheduleContext;
  }): Promise<JevResponseEvaluationResult>;
}
