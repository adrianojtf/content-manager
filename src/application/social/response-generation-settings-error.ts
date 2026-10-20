export type ResponseGenerationSettingsErrorCode =
  | 'RESPONSE_GENERATION_SETTINGS_NOT_CONFIGURED'
  | 'RESPONSE_GENERATION_SETTINGS_INVALID'
  | 'RESPONSE_GENERATION_PROVIDER_UNAVAILABLE';

export class ResponseGenerationSettingsError extends Error {
  constructor(readonly code: ResponseGenerationSettingsErrorCode) {
    super(code);
    this.name = 'ResponseGenerationSettingsError';
  }
}
