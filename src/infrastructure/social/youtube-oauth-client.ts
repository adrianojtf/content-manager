import { createHash } from 'node:crypto';
import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { YouTubeAccessTokenRefresher } from '../../application/ports/youtube-account-credential-provider.port';
import type { YouTubeAuthorizedAccount, YouTubeOAuthProvider, YouTubeOAuthScope } from '../../application/ports/youtube-oauth.port';
import { YOUTUBE_READ_SCOPE, YOUTUBE_REPLY_SCOPE } from '../../application/ports/youtube-oauth.port';
import { YouTubeOAuthError } from '../../application/social/youtube-oauth-error';

export type YouTubeOAuthEnvironment = Readonly<Record<string, string | undefined>>;

interface YouTubeTokenResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly token_type?: unknown;
  readonly expires_in?: unknown;
  readonly scope?: unknown;
}

interface YouTubeChannelResponse {
  readonly items?: readonly {
    readonly id?: unknown;
    readonly snippet?: { readonly title?: unknown };
  }[];
}

interface OAuthConfiguration {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly clientSecret?: string;
}

const authorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const channelEndpoint = 'https://www.googleapis.com/youtube/v3/channels';

export class YouTubeOAuthClient implements YouTubeOAuthProvider, YouTubeAccessTokenRefresher {
  constructor(
    private readonly credentials: SocialCredentialVault,
    private readonly environment: YouTubeOAuthEnvironment = process.env,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async buildAuthorizationUrl(state: string, codeVerifier: string, scopes: readonly YouTubeOAuthScope[]): Promise<string> {
    const config = this.configuration(false);
    this.validateScopes(scopes);
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const url = new URL(authorizationEndpoint);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  }

  async completeAuthorization(code: string, codeVerifier: string, scopes: readonly YouTubeOAuthScope[], tenantId: string): Promise<YouTubeAuthorizedAccount> {
    const config = this.configuration(true);
    this.validateScopes(scopes);
    const tokens = await this.exchangeCode(config, code, codeVerifier);
    const tokenScopes = typeof tokens.scope === 'string' ? new Set(tokens.scope.split(/\s+/)) : new Set<string>();
    if (!scopes.every((scope) => tokenScopes.has(scope))) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_SCOPE_MISSING');
    }
    if (typeof tokens.access_token !== 'string' || !tokens.access_token.trim() || tokens.token_type !== 'Bearer'
      || typeof tokens.expires_in !== 'number' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0
      || (tokens.refresh_token !== undefined && tokens.refresh_token !== null && typeof tokens.refresh_token !== 'string')) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_RESPONSE_INVALID');
    }

    const channel = await this.findAuthorizedChannel(tokens.access_token);
    const credentialReference = await this.credentials.storeCredentials({
      tenantId,
      platform: 'youtube',
      accessToken: tokens.access_token,
      refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null,
      grantedScopes: [...tokenScopes],
      expiresAt: new Date(this.now() + tokens.expires_in * 1000).toISOString(),
    });
    return { ...channel, credentialReference };
  }

  async refreshAccessToken(refreshToken: string): Promise<{ readonly accessToken: string; readonly expiresAt: string }> {
    const config = this.configuration(true);
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret as string,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    let response: globalThis.Response;
    try {
      response = await this.fetcher(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_TOKEN_EXCHANGE_FAILED');
    }
    let tokens: YouTubeTokenResponse;
    try {
      tokens = await response.json() as YouTubeTokenResponse;
    } catch {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_RESPONSE_INVALID');
    }
    if (typeof tokens.access_token !== 'string' || !tokens.access_token.trim() || tokens.token_type !== 'Bearer'
      || typeof tokens.expires_in !== 'number' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_RESPONSE_INVALID');
    }
    return {
      accessToken: tokens.access_token,
      expiresAt: new Date(this.now() + tokens.expires_in * 1000).toISOString(),
    };
  }

  private async exchangeCode(config: OAuthConfiguration, code: string, codeVerifier: string): Promise<YouTubeTokenResponse> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret as string,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    });
    let response: globalThis.Response;
    try {
      response = await this.fetcher(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_TOKEN_EXCHANGE_FAILED');
    }
    try {
      return await response.json() as YouTubeTokenResponse;
    } catch {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_RESPONSE_INVALID');
    }
  }

  private async findAuthorizedChannel(accessToken: string): Promise<Omit<YouTubeAuthorizedAccount, 'credentialReference'>> {
    const url = new URL(channelEndpoint);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('mine', 'true');
    let response: globalThis.Response;
    try {
      response = await this.fetcher(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_PROVIDER_UNAVAILABLE');
    }
    let payload: YouTubeChannelResponse;
    try {
      payload = await response.json() as YouTubeChannelResponse;
    } catch {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_RESPONSE_INVALID');
    }
    const channel = payload.items?.[0];
    if (typeof channel?.id !== 'string' || !channel.id) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_CHANNEL_NOT_FOUND');
    }
    return {
      externalAccountId: channel.id,
      displayName: typeof channel.snippet?.title === 'string' ? channel.snippet.title : null,
    };
  }

  private configuration(requireSecret: boolean): OAuthConfiguration {
    const clientId = this.environment.YOUTUBE_OAUTH_CLIENT_ID?.trim();
    const redirectUri = this.environment.YOUTUBE_OAUTH_REDIRECT_URI?.trim();
    const clientSecret = this.environment.YOUTUBE_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !redirectUri || (requireSecret && !clientSecret)) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_CONFIGURATION_REQUIRED');
    }
    let redirect: URL;
    try {
      redirect = new URL(redirectUri);
    } catch {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_CONFIGURATION_INVALID');
    }
    const isLocalHttp = redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if (redirect.protocol !== 'https:' && !isLocalHttp) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_CONFIGURATION_INVALID');
    }
    return { clientId, redirectUri: redirect.toString(), ...(clientSecret ? { clientSecret } : {}) };
  }

  private validateScopes(scopes: readonly YouTubeOAuthScope[]): void {
    if (!scopes.length || scopes.some((scope) => scope !== YOUTUBE_READ_SCOPE && scope !== YOUTUBE_REPLY_SCOPE)) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_CONFIGURATION_INVALID');
    }
  }
}
