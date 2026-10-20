import type { RefreshedTikTokBusinessAccessToken, TikTokBusinessOAuthProvider } from '../../application/ports/tiktok-business-oauth.port';
import { TIKTOK_BUSINESS_REQUIRED_SCOPES } from '../../application/ports/tiktok-business-oauth.port';
import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import { TikTokBusinessOAuthError } from '../../application/social/tiktok-business-oauth-error';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';
import { SocialCredentialVaultError } from '../persistence/social-credential-vault-error';

const refreshBeforeExpiryMilliseconds = 60 * 60 * 1000;

export class TikTokAccountCredentialResolver {
  constructor(
    private readonly credentials: SocialCredentialVault,
    private readonly refresher: Pick<TikTokBusinessOAuthProvider, 'refreshAccessToken'>,
    private readonly now: () => number = Date.now,
  ) {}

  async resolveAccessToken(account: SocialAccount): Promise<string> {
    if (account.platform !== 'tiktok') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    const expiresAt = await this.credentials.resolveAccessTokenExpiresAt(account.tenantId, account.credentialReference, 'tiktok');
    const currentAccessToken = await this.credentials.resolveAccessToken(account.tenantId, account.credentialReference, 'tiktok');
    if (currentAccessToken && (!expiresAt || Date.parse(expiresAt) - this.now() > refreshBeforeExpiryMilliseconds)) {
      return currentAccessToken;
    }
    const refreshToken = await this.credentials.resolveRefreshToken(account.tenantId, account.credentialReference, 'tiktok');
    const refreshTokenExpiresAt = await this.credentials.resolveRefreshTokenExpiresAt(account.tenantId, account.credentialReference, 'tiktok');
    if (!refreshToken || (refreshTokenExpiresAt && Date.parse(refreshTokenExpiresAt) <= this.now())) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
    }

    let refreshed: RefreshedTikTokBusinessAccessToken;
    try {
      refreshed = await this.refresher.refreshAccessToken(refreshToken);
      if (refreshed.externalAccountId !== account.externalAccountId
        || !TIKTOK_BUSINESS_REQUIRED_SCOPES.every((scope) => refreshed.grantedScopes.includes(scope))) {
        throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
      }
      await this.credentials.updateAccessToken(
        account.tenantId,
        account.credentialReference,
        'tiktok',
        refreshed.accessToken,
        refreshed.expiresAt,
        refreshed.refreshToken,
        refreshed.grantedScopes,
        refreshed.refreshTokenExpiresAt,
      );
    } catch (error) {
      if (error instanceof SocialProviderError) throw error;
      if (error instanceof TikTokBusinessOAuthError) {
        if (error.code === 'TIKTOK_BUSINESS_OAUTH_REFRESH_FAILED' || error.code === 'TIKTOK_BUSINESS_OAUTH_ACCOUNT_INVALID') {
          throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
        }
        if (error.code === 'TIKTOK_BUSINESS_OAUTH_SCOPE_MISSING') {
          throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
        }
        if (error.code === 'TIKTOK_BUSINESS_OAUTH_PROVIDER_UNAVAILABLE') {
          throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE');
        }
      }
      if (error instanceof SocialCredentialVaultError) throw new SocialProviderError('SOCIAL_CREDENTIAL_UNAVAILABLE');
      throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE');
    }
    return refreshed.accessToken;
  }
}
