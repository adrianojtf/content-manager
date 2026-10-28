export type ResponseRefinementPairErrorCode =
  | 'RESPONSE_REFINEMENT_PAIR_INVALID'
  | 'RESPONSE_REFINEMENT_PAIR_DATA_INVALID';

export class ResponseRefinementPairError extends Error {
  constructor(readonly code: ResponseRefinementPairErrorCode) {
    super(code);
    this.name = 'ResponseRefinementPairError';
  }
}
