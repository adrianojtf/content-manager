import type { StoredPlatformComment } from './social-comment-repository.port';

export interface JevChoiceSignal {
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface JevScoreSignal {
  readonly rawScore: number;
  readonly normalizedScore: number;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly legend: Readonly<Record<string, string>>;
}

export interface JevNoulSignal {
  readonly probability: number;
}

export interface JevProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface JevCommentAnalysisSignals {
  readonly sentiment: JevChoiceSignal;
  readonly emotion: JevChoiceSignal;
  readonly intent: JevChoiceSignal;
  readonly topic: JevChoiceSignal;
  readonly spam: JevNoulSignal;
  readonly toxicity: JevNoulSignal;
  readonly engagement: JevScoreSignal;
  readonly needsExternalFacts: JevNoulSignal;
  readonly requestsContinuation: JevNoulSignal;
}

export interface JevCommentAnalysisResult {
  readonly sentiment: string;
  readonly emotion: string;
  readonly intent: string;
  readonly topic: string;
  readonly entity: string | null;
  readonly spamScore: number;
  readonly toxicityScore: number;
  readonly engagementValue: number;
  readonly continuationRequestProbability?: number;
  readonly confidence: number;
  readonly rationale: string | null;
  readonly provider: string;
  readonly model: string;
  readonly schemaVersion: string;
  readonly signals?: JevCommentAnalysisSignals;
  readonly usage?: JevProviderUsage | null;
}

export interface CommentEvaluator {
  evaluate(input: { readonly comment: StoredPlatformComment }): Promise<JevCommentAnalysisResult>;
}
