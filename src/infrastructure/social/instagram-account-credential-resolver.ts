import type { InstagramAccessTokenRefresher } from '../../application/ports/instagram-oauth.port';
import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import { InstagramOAuthError } from '../../application/social/instagram-oauth-error';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';
import { SocialCredentialVaultError } from '../persistence/social-credential-vault-error';

const refreshBeforeExpiryMilliseconds = 7 * 24 * 60 * 60 * 1000;

export class InstagramAccountCredentialResolver {
  constructor(
    private readonly credentials: SocialCredentialVault,
    private readonly refresher: InstagramAccessTokenRefresher,
    private readonly now: () => number = Date.now,
  ) {}

  async resolveAccessToken(account: SocialAccount): Promise<string> {
    if (account.platform !== 'instagram') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    const accessToken = await this.credentials.resolveAccessToken(account.tenantId, account.credentialReference, 'instagram');
    if (!accessToken) throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
    const expiresAt = await this.credentials.resolveAccessTokenExpiresAt(account.tenantId, account.credentialReference, 'instagram');
    if (!expiresAt || Date.parse(expiresAt) - this.now() > refreshBeforeExpiryMilliseconds) return accessToken;

    try {
      const refreshed = await this.refresher.refreshAccessToken(accessToken);
      await this.credentials.updateAccessToken(account.tenantId, account.credentialReference, 'instagram', refreshed.accessToken, refreshed.expiresAt);
      return refreshed.accessToken;
    } catch (error) {
      if (error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_TOKEN_REFRESH_FAILED') {
        throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
      }
      if (error instanceof SocialCredentialVaultError) throw new SocialProviderError('SOCIAL_CREDENTIAL_UNAVAILABLE');
      throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE');
    }
  }
}
