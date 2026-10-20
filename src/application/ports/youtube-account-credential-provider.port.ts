import type { SocialAccount } from '../../domain/social/social-account';

export interface YouTubeAccessTokenRefresher {
  refreshAccessToken(refreshToken: string): Promise<{ readonly accessToken: string; readonly expiresAt: string }>;
}

export interface YouTubeAccountCredentialProvider {
  hasScopes(account: SocialAccount, scopes: readonly string[]): Promise<boolean>;
  resolveAccessToken(account: SocialAccount): Promise<string>;
}
