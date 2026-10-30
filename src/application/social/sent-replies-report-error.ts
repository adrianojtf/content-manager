export type SentRepliesReportErrorCode =
  | 'SENT_REPLIES_REPORT_FILTER_INVALID'
  | 'SENT_REPLIES_REPORT_CURSOR_INVALID'
  | 'SENT_REPLIES_REPORT_DATA_INVALID';

export class SentRepliesReportError extends Error {
  constructor(readonly code: SentRepliesReportErrorCode) {
    super(code);
    this.name = 'SentRepliesReportError';
  }
}
