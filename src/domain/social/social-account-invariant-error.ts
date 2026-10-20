export type SocialAccountInvariantCode =
  | 'SOCIAL_ACCOUNT_ID_INVALID'
  | 'SOCIAL_ACCOUNT_TENANT_REQUIRED'
  | 'SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED'
  | 'SOCIAL_ACCOUNT_EXTERNAL_ID_REQUIRED'
  | 'SOCIAL_ACCOUNT_CREDENTIAL_REFERENCE_REQUIRED'
  | 'SOCIAL_ACCOUNT_TENANT_MISMATCH'
  | 'SOCIAL_ACCOUNT_ALREADY_CONNECTED';

export class SocialAccountInvariantError extends Error {
  constructor(readonly code: SocialAccountInvariantCode) {
    super(code);
    this.name = 'SocialAccountInvariantError';
  }
}
