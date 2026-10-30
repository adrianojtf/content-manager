export type EpisodeReviewErrorCode =
  | 'ANALYTICS_EPISODE_INPUT_INVALID'
  | 'ANALYTICS_EPISODE_SERIES_NOT_FOUND'
  | 'ANALYTICS_EPISODE_SUGGESTION_NOT_FOUND'
  | 'ANALYTICS_EPISODE_SUGGESTION_NOT_PENDING'
  | 'ANALYTICS_EPISODE_IDENTITY_CONFLICT'
  | 'ANALYTICS_EPISODE_CODE_CONFLICT'
  | 'ANALYTICS_EPISODE_SOURCE_INVALID'
  | 'ANALYTICS_EPISODE_REVIEW_FAILED';

export class EpisodeReviewError extends Error {
  constructor(readonly code: EpisodeReviewErrorCode) {
    super(code);
    this.name = 'EpisodeReviewError';
  }
}
