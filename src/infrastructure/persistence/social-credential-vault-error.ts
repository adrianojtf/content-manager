export type SocialCredentialVaultErrorCode =
  | 'SOCIAL_CREDENTIAL_ENCRYPTION_KEY_REQUIRED'
  | 'SOCIAL_CREDENTIAL_ENCRYPTION_KEY_INVALID'
  | 'SOCIAL_CREDENTIAL_INPUT_INVALID'
  | 'SOCIAL_CREDENTIAL_NOT_FOUND'
  | 'SOCIAL_CREDENTIAL_DECRYPTION_FAILED';

export class SocialCredentialVaultError extends Error {
  constructor(readonly code: SocialCredentialVaultErrorCode) {
    super(code);
    this.name = 'SocialCredentialVaultError';
  }
}
