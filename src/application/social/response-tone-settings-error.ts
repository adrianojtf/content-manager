export type ResponseToneSettingsErrorCode = 'RESPONSE_TONE_SETTINGS_INVALID' | 'RESPONSE_TONE_SETTINGS_UNAVAILABLE';

export class ResponseToneSettingsError extends Error {
  constructor(readonly code: ResponseToneSettingsErrorCode) {
    super(code);
    this.name = 'ResponseToneSettingsError';
  }
}
