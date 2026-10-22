import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { InstagramAuthorizedAccount, InstagramOAuthProvider } from '../../application/ports/instagram-oauth.port';
import { INSTAGRAM_OAUTH_SCOPES } from '../../application/ports/instagram-oauth.port';
import { InstagramOAuthError } from '../../application/social/instagram-oauth-error';

export type InstagramOAuthEnvironment = Readonly<Record<string, string | undefined>>;

interface InstagramShortTokenEntry {
  readonly access_token?: unknown;
  readonly user_id?: unknown;
  readonly permissions?: unknown;
}

interface InstagramShortTokenResponse extends InstagramShortTokenEntry {
  readonly data?: readonly InstagramShortTokenEntry[];
}

interface InstagramTokenResponse {
  readonly access_token?: unknown;
  readonly token_type?: unknown;
  readonly expires_in?: unknown;
}

interface InstagramUserEntry {
  readonly id?: unknown;
  readonly user_id?: unknown;
  readonly username?: unknown;
}

interface InstagramUserResponse extends InstagramUserEntry {
  readonly data?: readonly InstagramUserEntry[];
}

interface OAuthConfiguration {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly clientSecret?: string;
}

const authorizationEndpoint = 'https://www.instagram.com/oauth/authorize';
const shortTokenEndpoint = 'https://api.instagram.com/oauth/access_token';
const longTokenEndpoint = 'https://graph.instagram.com/access_token';
const refreshTokenEndpoint = 'https://graph.instagram.com/refresh_access_token';

export class InstagramOAuthClient implements InstagramOAuthProvider {
  constructor(
    private readonly credentials: SocialCredentialVault,
    private readonly environment: InstagramOAuthEnvironment = process.env,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async buildAuthorizationUrl(state: string): Promise<string> {
    const config = this.configuration(false);
    this.graphApiVersion();
    const url = new URL(authorizationEndpoint);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', INSTAGRAM_OAUTH_SCOPES.join(','));
    url.searchParams.set('state', state);
    url.searchParams.set('enable_fb_login', 'false');
    return url.toString();
  }

  async completeAuthorization(code: string, tenantId: string): Promise<InstagramAuthorizedAccount> {
    const config = this.configuration(true);
    const shortToken = await this.exchangeCode(config, code);
    const grantedScopes = this.parseGrantedScopes(shortToken.permissions);
    if (!INSTAGRAM_OAUTH_SCOPES.every((scope) => grantedScopes.includes(scope))) {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_SCOPE_MISSING');
    }
    const longToken = await this.exchangeLongLivedToken(config, shortToken.accessToken);
    const identity = await this.findAuthorizedAccount(longToken.accessToken, shortToken.userId);
    const credentialReference = await this.credentials.storeCredentials({
      tenantId,
      platform: 'instagram',
      accessToken: longToken.accessToken,
      refreshToken: null,
      grantedScopes,
      expiresAt: longToken.expiresAt,
    });
    return { ...identity, credentialReference };
  }

  async refreshAccessToken(accessToken: string): Promise<{ readonly accessToken: string; readonly expiresAt: string }> {
    const url = new URL(refreshTokenEndpoint);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', accessToken);
    let response: globalThis.Response;
    try {
      response = await this.fetcher(url.toString());
    } catch {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) throw new InstagramOAuthError('INSTAGRAM_OAUTH_TOKEN_REFRESH_FAILED');
    const payload = await this.parseJson<InstagramTokenResponse>(response, 'INSTAGRAM_OAUTH_RESPONSE_INVALID');
    return this.validateLongToken(payload, 'INSTAGRAM_OAUTH_TOKEN_REFRESH_FAILED');
  }

  private async exchangeCode(config: OAuthConfiguration, code: string): Promise<{ accessToken: string; userId: string; permissions: string | string[] }> {
    const body = new FormData();
    body.set('client_id', config.clientId);
    body.set('client_secret', config.clientSecret as string);
    body.set('grant_type', 'authorization_code');
    body.set('redirect_uri', config.redirectUri);
    body.set('code', code);
    let response: globalThis.Response;
    try {
      response = await this.fetcher(shortTokenEndpoint, { method: 'POST', body });
    } catch {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) throw new InstagramOAuthError('INSTAGRAM_OAUTH_TOKEN_EXCHANGE_FAILED');
    const payload = await this.parseJsonPreservingIds<InstagramShortTokenResponse>(response);
    const token = this.singleEntry<InstagramShortTokenEntry>(payload, ['access_token', 'user_id', 'permissions']);
    const userId = this.normalizeId(token.user_id);
    if (typeof token.access_token !== 'string' || !token.access_token.trim()
      || !userId || !this.isPermissionsList(token.permissions)) {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_RESPONSE_INVALID');
    }
    return { accessToken: token.access_token, userId, permissions: token.permissions };
  }

  private singleEntry<TEntry>(payload: { readonly data?: readonly TEntry[] } & TEntry, flatKeys: readonly (keyof TEntry)[]): TEntry {
    const flat = flatKeys.some((key) => typeof payload[key] !== 'undefined');
    if (flat && typeof payload.data !== 'undefined') throw new InstagramOAuthError('INSTAGRAM_OAUTH_RESPONSE_INVALID');
    if (typeof payload.data !== 'undefined') {
      if (payload.data.length !== 1) throw new InstagramOAuthError('INSTAGRAM_OAUTH_RESPONSE_INVALID');
      return payload.data[0];
    }
    return payload;
  }

  private normalizeId(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const id = String(value).trim();
    return id || undefined;
  }

  private isPermissionsList(value: unknown): value is string | string[] {
    return typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
  }

  private parseGrantedScopes(value: string | string[]): readonly string[] {
    const items = typeof value === 'string' ? value.split(',') : value;
    return [...new Set(items.map((scope) => scope.trim()).filter(Boolean))];
  }

  private async exchangeLongLivedToken(config: OAuthConfiguration, accessToken: string): Promise<{ accessToken: string; expiresAt: string }> {
    const url = new URL(longTokenEndpoint);
    url.searchParams.set('grant_type', 'ig_exchange_token');
    url.searchParams.set('client_secret', config.clientSecret as string);
    url.searchParams.set('access_token', accessToken);
    let response: globalThis.Response;
    try {
      response = await this.fetcher(url.toString());
    } catch {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) throw new InstagramOAuthError('INSTAGRAM_OAUTH_TOKEN_EXCHANGE_FAILED');
    const payload = await this.parseJson<InstagramTokenResponse>(response, 'INSTAGRAM_OAUTH_RESPONSE_INVALID');
    return this.validateLongToken(payload, 'INSTAGRAM_OAUTH_TOKEN_EXCHANGE_FAILED');
  }

  private validateLongToken(payload: InstagramTokenResponse, invalidCode: 'INSTAGRAM_OAUTH_TOKEN_EXCHANGE_FAILED' | 'INSTAGRAM_OAUTH_TOKEN_REFRESH_FAILED'): { accessToken: string; expiresAt: string } {
    if (typeof payload.access_token !== 'string' || !payload.access_token.trim()
      || typeof payload.token_type !== 'string' || payload.token_type.toLowerCase() !== 'bearer'
      || typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) {
      throw new InstagramOAuthError(invalidCode);
    }
    return { accessToken: payload.access_token, expiresAt: new Date(this.now() + payload.expires_in * 1000).toISOString() };
  }

  private async findAuthorizedAccount(accessToken: string, expectedId: string): Promise<Omit<InstagramAuthorizedAccount, 'credentialReference'>> {
    const version = this.graphApiVersion();
    const url = new URL(`https://graph.instagram.com/${version}/me`);
    url.searchParams.set('fields', 'id,user_id,username');
    let response: globalThis.Response;
    try {
      response = await this.fetcher(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) throw new InstagramOAuthError('INSTAGRAM_OAUTH_PROVIDER_UNAVAILABLE');
    const payload = await this.parseJsonPreservingIds<InstagramUserResponse>(response);
    const user = this.singleEntry<InstagramUserEntry>(payload, ['id', 'user_id', 'username']);
    const professionalId = this.normalizeId(user.user_id);
    if (!professionalId || typeof user.username !== 'string' || !user.username.trim()) {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_ACCOUNT_INVALID');
    }
    const appScopedId = this.normalizeId(user.id);
    if (expectedId !== professionalId && expectedId !== appScopedId) {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_ACCOUNT_ID_MISMATCH');
    }
    return { externalAccountId: professionalId, displayName: user.username };
  }

  private async parseJsonPreservingIds<T>(response: globalThis.Response): Promise<T> {
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_RESPONSE_INVALID');
    }
    try {
      return JSON.parse(text.replace(/"((?:user_)?id)"\s*:\s*(\d+)/g, '"$1":"$2"')) as T;
    } catch {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_RESPONSE_INVALID');
    }
  }

  private async parseJson<T>(response: globalThis.Response, errorCode: 'INSTAGRAM_OAUTH_RESPONSE_INVALID'): Promise<T> {
    try {
      return await response.json() as T;
    } catch {
      throw new InstagramOAuthError(errorCode);
    }
  }

  private configuration(requireSecret: boolean): OAuthConfiguration {
    const clientId = this.environment.INSTAGRAM_OAUTH_CLIENT_ID?.trim();
    const redirectUri = this.environment.INSTAGRAM_OAUTH_REDIRECT_URI?.trim();
    const clientSecret = this.environment.INSTAGRAM_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !redirectUri || (requireSecret && !clientSecret)) {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_CONFIGURATION_REQUIRED');
    }
    let redirect: URL;
    try {
      redirect = new URL(redirectUri);
    } catch {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_CONFIGURATION_INVALID');
    }
    const isLocalHttp = redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if (redirect.protocol !== 'https:' && !isLocalHttp) throw new InstagramOAuthError('INSTAGRAM_OAUTH_CONFIGURATION_INVALID');
    return { clientId, redirectUri: redirect.toString(), ...(clientSecret ? { clientSecret } : {}) };
  }

  private graphApiVersion(): string {
    const version = this.environment.META_GRAPH_API_VERSION?.trim();
    if (!version) throw new InstagramOAuthError('INSTAGRAM_OAUTH_CONFIGURATION_REQUIRED');
    if (!/^v\d+\.\d+$/.test(version)) throw new InstagramOAuthError('INSTAGRAM_OAUTH_CONFIGURATION_INVALID');
    return version;
  }
}
