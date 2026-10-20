export type AuthenticationErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'ACCESS_TOKEN_INVALID'
  | 'IDENTITY_PROVIDER_UNAVAILABLE'
  | 'IDENTITY_NOT_PROVISIONED'
  | 'IDENTITY_INACTIVE'
  | 'TENANT_MEMBERSHIP_REQUIRED'
  | 'TENANT_INACTIVE';

export class AuthenticationError extends Error {
  constructor(readonly code: AuthenticationErrorCode) {
    super(code);
    this.name = 'AuthenticationError';
  }
}
