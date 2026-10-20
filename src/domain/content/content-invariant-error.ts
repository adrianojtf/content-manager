export type ContentInvariantErrorCode =
  | 'CONTENT_ID_INVALID'
  | 'CONTENT_TITLE_REQUIRED'
  | 'CONTENT_DESCRIPTION_REQUIRED'
  | 'CONTENT_MEDIA_REFERENCE_REQUIRED'
  | 'CONTENT_TENANT_REQUIRED'
  | 'CONTENT_TENANT_MISMATCH'
  | 'CONTENT_STATE_INVALID';

export class ContentInvariantError extends Error {
  constructor(readonly code: ContentInvariantErrorCode) {
    super(code);
    this.name = 'ContentInvariantError';
  }
}
