import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { TikTokBusinessAuthorizedAccount, TikTokBusinessOAuthProvider, RefreshedTikTokBusinessAccessToken } from '../../application/ports/tiktok-business-oauth.port';
import { TIKTOK_BUSINESS_REQUIRED_SCOPES } from '../../application/ports/tiktok-business-oauth.port';
import { TikTokBusinessOAuthError } from '../../application/social/tiktok-business-oauth-error';

export type TikTokBusinessOAuthEnvironment = Readonly<Record<string, string | undefined>>;

interface TikTokTokenData {
  readonly open_id?: unknown;
  readonly access_token?: unknown;
  readonly expires_in?: unknown;
  readonly refresh_token?: unknown;
  readonly refresh_token_expires_in?: unknown;
  readonly scope?: unknown;
  readonly token_type?: unknown;
}

interface TikTokApiResponse<Data> {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly data?: Data;
}

interface TikTokOAuthConfiguration {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri?: string;
  readonly authorizationUrl?: string;
  readonly stateParameter: string;
}

const tokenEndpoint = 'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/';
const refreshEndpoint = 'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/refresh_token/';

export class TikTokBusinessOAuthClient implements TikTokBusinessOAuthProvider {
  constructor(
    private readonly credentials: SocialCredentialVault,
    private readonly environment: TikTokBusinessOAuthEnvironment = process.env,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async buildAuthorizationUrl(state: string): Promise<string> {
    const config = this.configuration(false);
    const url = new URL(config.authorizationUrl as string);
    url.searchParams.set(config.stateParameter, state);
    return url.toString();
  }

  async completeAuthorization(authCode: string, tenantId: string): Promise<TikTokBusinessAuthorizedAccount> {
    const config = this.configuration(true);
    const token = await this.requestToken(tokenEndpoint, {
      client_id: config.clientId,
      client_secret: config.clientSecret as string,
      grant_type: 'authorization_code',
      auth_code: authCode,
      redirect_uri: config.redirectUri as string,
    }, 'TIKTOK_BUSINESS_OAUTH_TOKEN_EXCHANGE_FAILED');
    const grantedScopes = this.parseScopes(token.scope);
    if (!TIKTOK_BUSINESS_REQUIRED_SCOPES.every((scope) => grantedScopes.includes(scope))) {
      throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_SCOPE_MISSING');
    }
    const identity = this.accountIdentity(token);
    const credentialReference = await this.credentials.storeCredentials({
      tenantId,
      platform: 'tiktok',
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      grantedScopes,
      expiresAt: token.expiresAt,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt,
    });
    return { ...identity, credentialReference };
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshedTikTokBusinessAccessToken> {
    const config = this.configuration(true, false);
    const token = await this.requestToken(refreshEndpoint, {
      client_id: config.clientId,
      client_secret: config.clientSecret as string,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }, 'TIKTOK_BUSINESS_OAUTH_REFRESH_FAILED');
    const grantedScopes = this.parseScopes(token.scope);
    if (!TIKTOK_BUSINESS_REQUIRED_SCOPES.every((scope) => grantedScopes.includes(scope))) {
      throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_SCOPE_MISSING');
    }
    const identity = this.accountIdentity(token);
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt,
      externalAccountId: identity.externalAccountId,
      grantedScopes,
    };
  }

  private async requestToken(endpoint: string, body: Readonly<Record<string, string>>, failureCode: 'TIKTOK_BUSINESS_OAUTH_TOKEN_EXCHANGE_FAILED' | 'TIKTOK_BUSINESS_OAUTH_REFRESH_FAILED'): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; refreshTokenExpiresAt: string; externalAccountId: string; scope: string }> {
    let response: globalThis.Response;
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) throw new TikTokBusinessOAuthError(failureCode);
    let payload: TikTokApiResponse<TikTokTokenData>;
    try {
      payload = await response.json() as TikTokApiResponse<TikTokTokenData>;
    } catch {
      throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_RESPONSE_INVALID');
    }
    if (payload.code !== 0 || typeof payload.data !== 'object' || payload.data === null || Array.isArray(payload.data)) {
      throw new TikTokBusinessOAuthError(failureCode);
    }
    const data = payload.data;
    if (typeof data.open_id !== 'string' || !data.open_id.trim()) {
      throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_ACCOUNT_INVALID');
    }
    if (typeof data.access_token !== 'string' || !data.access_token.trim()
      || typeof data.refresh_token !== 'string' || !data.refresh_token.trim()
      || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer'
      || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0
      || typeof data.refresh_token_expires_in !== 'number' || !Number.isFinite(data.refresh_token_expires_in) || data.refresh_token_expires_in <= 0
      || typeof data.scope !== 'string') {
      throw new TikTokBusinessOAuthError(failureCode);
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(this.now() + data.expires_in * 1000).toISOString(),
      refreshTokenExpiresAt: new Date(this.now() + data.refresh_token_expires_in * 1000).toISOString(),
      externalAccountId: data.open_id,
      scope: data.scope,
    };
  }

  private accountIdentity(token: { readonly externalAccountId: string }): Omit<TikTokBusinessAuthorizedAccount, 'credentialReference'> {
    if (!token.externalAccountId.trim()) throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_ACCOUNT_INVALID');
    return { externalAccountId: token.externalAccountId, displayName: null };
  }

  private parseScopes(value: string): readonly string[] {
    return [...new Set(value.split(',').map((scope) => scope.trim()).filter(Boolean))];
  }

  private configuration(requireSecret: boolean, requireAuthorizationSettings = true): TikTokOAuthConfiguration {
    const clientId = this.environment.TIKTOK_BUSINESS_CLIENT_ID?.trim();
    const clientSecret = this.environment.TIKTOK_BUSINESS_CLIENT_SECRET?.trim();
    const redirectUri = this.environment.TIKTOK_BUSINESS_REDIRECT_URI?.trim();
    const authorizationUrl = this.environment.TIKTOK_BUSINESS_AUTHORIZATION_URL?.trim();
    const stateParameter = this.environment.TIKTOK_BUSINESS_STATE_PARAMETER?.trim() || 'state';
    if (!clientId || (requireSecret && !clientSecret)
      || (requireAuthorizationSettings && (!redirectUri || !authorizationUrl))) {
      throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_CONFIGURATION_REQUIRED');
    }
    if (!requireAuthorizationSettings) {
      return { clientId, stateParameter, ...(clientSecret ? { clientSecret } : {}) };
    }
    let redirect: URL;
    let authorization: URL;
    try {
      redirect = new URL(redirectUri as string);
      authorization = new URL(authorizationUrl as string);
    } catch {
      throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_CONFIGURATION_INVALID');
    }
    const localHttp = redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if ((redirect.protocol !== 'https:' && !localHttp) || authorization.protocol !== 'https:'
      || !/(^|\.)tiktok\.com$/i.test(authorization.hostname)
      || authorization.username || authorization.password || authorization.hash
      || authorization.searchParams.has('client_secret') || authorization.searchParams.has('secret')
      || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(stateParameter)) {
      throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_CONFIGURATION_INVALID');
    }
    return {
      clientId,
      redirectUri: redirect.toString(),
      authorizationUrl: authorization.toString(),
      stateParameter,
      ...(clientSecret ? { clientSecret } : {}),
    };
  }
}
