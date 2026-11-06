import type { JevCommentAnalysisResult } from './comment-evaluator.port';
import type { StoredPlatformComment } from './social-comment-repository.port';
import type { JevChoiceSignal } from './comment-evaluator.port';

export const responseEditCategories = [
  'FACTUAL_CORRECTION', 'RELEVANCE', 'TONE', 'CLARITY', 'LENGTH',
  'PERSONALIZATION', 'SAFETY', 'OTHER', 'UNCLEAR',
] as const;
export type ResponseEditCategory = typeof responseEditCategories[number];

export const observedResponseIssues = [
  'UNSUPPORTED_CLAIM', 'MISREAD_COMMENT', 'INCOMPLETE_ANSWER', 'TONE_MISMATCH',
  'TOO_VERBOSE', 'TOO_BRIEF', 'SAFETY_RISK', 'NO_CLEAR_ISSUE', 'INDETERMINATE',
] as const;
export type ObservedResponseIssue = typeof observedResponseIssues[number];

export const responseEditEvidenceSources = ['COMMENT', 'AI_RESPONSE', 'FINAL_RESPONSE', 'CREATOR_EDIT_REASON'] as const;
export type ResponseEditEvidenceSource = typeof responseEditEvidenceSources[number];

export interface ResponseEditClassification {
  readonly editCategory: ResponseEditCategory;
  readonly observedAiIssue: ObservedResponseIssue;
  readonly confidence: number;
  readonly evidenceSource: ResponseEditEvidenceSource;
  readonly signals: {
    readonly editCategory: JevChoiceSignal;
    readonly observedAiIssue: JevChoiceSignal;
    readonly evidenceSource: JevChoiceSignal;
  };
  readonly rationale: null;
  readonly provider: string;
  readonly model: string;
  readonly schemaVersion: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number } | null;
}

export interface ResponseEditClassifier {
  classify(input: {
    readonly comment: StoredPlatformComment;
    readonly analysis: JevCommentAnalysisResult;
    readonly aiText: string;
    readonly finalText: string;
    readonly editReason: string | null;
  }): Promise<ResponseEditClassification>;
}
