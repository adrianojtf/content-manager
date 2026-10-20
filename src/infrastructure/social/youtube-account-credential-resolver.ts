import type { YouTubeAccountCredentialProvider, YouTubeAccessTokenRefresher } from '../../application/ports/youtube-account-credential-provider.port';
import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';
import { SocialCredentialVaultError } from '../persistence/social-credential-vault-error';
import { YouTubeOAuthError } from '../../application/social/youtube-oauth-error';

export class YouTubeAccountCredentialResolver implements YouTubeAccountCredentialProvider {
  constructor(
    private readonly credentials: SocialCredentialVault,
    private readonly refresher: YouTubeAccessTokenRefresher,
  ) {}

  async hasScopes(account: SocialAccount, scopes: readonly string[]): Promise<boolean> {
    this.requireYouTube(account);
    return this.credentials.hasScopes(account.tenantId, account.credentialReference, 'youtube', scopes);
  }

  async resolveAccessToken(account: SocialAccount): Promise<string> {
    this.requireYouTube(account);
    const currentToken = await this.credentials.resolveAccessToken(account.tenantId, account.credentialReference, 'youtube');
    if (currentToken) {
      return currentToken;
    }
    const refreshToken = await this.credentials.resolveRefreshToken(account.tenantId, account.credentialReference, 'youtube');
    if (!refreshToken) {
      throw new SocialProviderError('SOCIAL_CREDENTIAL_UNAVAILABLE');
    }

    let refreshed: { readonly accessToken: string; readonly expiresAt: string };
    try {
      refreshed = await this.refresher.refreshAccessToken(refreshToken);
    } catch (error) {
      if (error instanceof YouTubeOAuthError && error.code === 'YOUTUBE_OAUTH_TOKEN_EXCHANGE_FAILED') {
        throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
      }
      if (error instanceof SocialCredentialVaultError) {
        throw new SocialProviderError('SOCIAL_CREDENTIAL_UNAVAILABLE');
      }
      throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE');
    }

    await this.credentials.updateAccessToken(account.tenantId, account.credentialReference, 'youtube', refreshed.accessToken, refreshed.expiresAt);
    return refreshed.accessToken;
  }

  private requireYouTube(account: SocialAccount): void {
    if (account.platform !== 'youtube') {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    }
  }
}
