import type { StoredPlatformComment } from './social-comment-repository.port';

export interface JevCommentAnalysisResult {
  readonly sentiment: string;
  readonly emotion: string;
  readonly intent: string;
  readonly topic: string;
  readonly entity: string | null;
  readonly spamScore: number;
  readonly toxicityScore: number;
  readonly engagementValue: number;
  readonly confidence: number;
  readonly rationale: string | null;
  readonly provider: string;
  readonly model: string;
  readonly schemaVersion: string;
}

export interface CommentEvaluator {
  evaluate(input: { readonly comment: StoredPlatformComment }): Promise<JevCommentAnalysisResult>;
}
