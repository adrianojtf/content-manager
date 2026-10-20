import type { JevCommentAnalysisResult } from './comment-evaluator.port';
import type { StoredPlatformComment } from './social-comment-repository.port';

export interface JevResponseEvaluationResult {
  readonly relevance: number;
  readonly tone: number;
  readonly helpfulness: number;
  readonly factualRisk: number;
  readonly toxicityRisk: number;
  readonly hallucinationRisk: number;
  readonly publishRecommendation: 'APPROVE' | 'REVIEW' | 'REJECT';
  readonly confidence: number;
  readonly rationale: string | null;
  readonly provider: string;
  readonly model: string;
  readonly schemaVersion: string;
}

export interface ResponseEvaluator {
  evaluate(input: { readonly comment: StoredPlatformComment; readonly analysis: JevCommentAnalysisResult; readonly responseText: string }): Promise<JevResponseEvaluationResult>;
}
