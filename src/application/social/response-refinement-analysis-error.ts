export type ResponseRefinementAnalysisErrorCode =
  | 'RESPONSE_REFINEMENT_CONSENT_REQUIRED'
  | 'RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID'
  | 'RESPONSE_REFINEMENT_ANALYSIS_UNAVAILABLE';

export class ResponseRefinementAnalysisError extends Error {
  constructor(readonly code: ResponseRefinementAnalysisErrorCode) {
    super(code);
    this.name = 'ResponseRefinementAnalysisError';
  }
}
