import type { SocialPlatform } from '../../domain/social/social-account';

export interface StoreSocialCredentialsInput {
  readonly tenantId: string;
  readonly platform: SocialPlatform;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly grantedScopes: readonly string[];
  readonly expiresAt: string | null;
  readonly refreshTokenExpiresAt?: string | null;
}

export interface SocialCredentialVault {
  storeCredentials(input: StoreSocialCredentialsInput): Promise<string>;
  resolveAccessToken(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<string | null>;
  resolveRefreshToken(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<string | null>;
  resolveRefreshTokenExpiresAt(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<string | null>;
  resolveAccessTokenExpiresAt(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<string | null>;
  updateAccessToken(tenantId: string, credentialReference: string, platform: SocialPlatform, accessToken: string, expiresAt: string, refreshToken?: string | null, grantedScopes?: readonly string[], refreshTokenExpiresAt?: string | null): Promise<void>;
  hasScopes(tenantId: string, credentialReference: string, platform: SocialPlatform, scopes: readonly string[]): Promise<boolean>;
  deleteCredentials(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<void>;
}
