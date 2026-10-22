export type VerifiedReleaseScheduleErrorCode =
  | 'VERIFIED_RELEASE_SCHEDULE_INVALID'
  | 'VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE'
  | 'VERIFIED_RELEASE_SCHEDULE_DATA_INVALID'
  | 'VERIFIED_RELEASE_SCHEDULE_FAILED';

export class VerifiedReleaseScheduleError extends Error {
  constructor(readonly code: VerifiedReleaseScheduleErrorCode) {
    super(code);
    this.name = 'VerifiedReleaseScheduleError';
  }
}
