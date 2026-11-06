import type { StoredPlatformComment } from './social-comment-repository.port';
import type { JevCommentAnalysisResult } from './comment-evaluator.port';
import type { ResponseToneProfile } from './response-tone-settings.repository.port';
import type { ResponseGenerationScheduleContext } from './verified-release-schedule.repository.port';

export interface GeneratedResponseSuggestion {
  readonly text: string;
  readonly language: string;
  readonly intendedTone: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion?: string;
  readonly confidence: number;
  readonly rationale: string | null;
}

export interface ResponseSuggestionGenerator {
  generate(input: {
    readonly comment: StoredPlatformComment;
    readonly analysis: JevCommentAnalysisResult;
    readonly language: string;
    readonly toneProfile: ResponseToneProfile;
    readonly verifiedReleaseSchedule: ResponseGenerationScheduleContext;
    readonly model?: string;
  }): Promise<GeneratedResponseSuggestion>;
}
