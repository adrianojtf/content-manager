import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { FacebookAuthorizedPage, FacebookOAuthProvider, FacebookPageCandidate } from '../../application/ports/facebook-oauth.port';
import { FACEBOOK_PAGE_SCOPES } from '../../application/ports/facebook-oauth.port';
import { FacebookOAuthError } from '../../application/social/facebook-oauth-error';
import { InMemoryFacebookPageSelectionStore } from './in-memory-facebook-page-selection-store';

export type FacebookOAuthEnvironment = Readonly<Record<string, string | undefined>>;

interface FacebookTokenResponse {
  readonly access_token?: unknown;
  readonly token_type?: unknown;
  readonly expires_in?: unknown;
}

interface FacebookPermissionsResponse {
  readonly data?: readonly { readonly permission?: unknown; readonly status?: unknown }[];
}

interface FacebookPage {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly access_token?: unknown;
  readonly tasks?: unknown;
}

interface FacebookPageResponse {
  readonly data?: readonly FacebookPage[];
  readonly paging?: { readonly cursors?: { readonly after?: unknown }; readonly next?: unknown };
}

interface OAuthConfiguration {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
  readonly graphApiVersion: string;
}

interface StoredPage extends FacebookPageCandidate {
  readonly accessToken: string;
  readonly tasks: readonly string[];
}

export class FacebookOAuthClient implements FacebookOAuthProvider {
  constructor(
    private readonly credentials: SocialCredentialVault,
    private readonly environment: FacebookOAuthEnvironment = process.env,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly selections: InMemoryFacebookPageSelectionStore = new InMemoryFacebookPageSelectionStore(now),
  ) {}

  async buildAuthorizationUrl(state: string): Promise<string> {
    const config = this.configuration(false);
    const url = new URL(`https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', FACEBOOK_PAGE_SCOPES.join(','));
    url.searchParams.set('state', state);
    return url.toString();
  }

  async beginPageSelection(code: string, tenantId: string): Promise<{ readonly selectionId: string; readonly pages: readonly FacebookPageCandidate[] }> {
    const config = this.configuration(true);
    const shortToken = await this.exchangeCode(config, code);
    const longToken = await this.exchangeLongLivedToken(config, shortToken.accessToken);
    const grantedScopes = await this.getGrantedScopes(config, longToken.accessToken);
    if (!FACEBOOK_PAGE_SCOPES.every((scope) => grantedScopes.includes(scope))) {
      throw new FacebookOAuthError('FACEBOOK_OAUTH_SCOPE_MISSING');
    }
    const pages = await this.listManagedPages(config, longToken.accessToken);
    if (!pages.length) throw new FacebookOAuthError('FACEBOOK_OAUTH_NO_MANAGED_PAGES');
    const manageablePages = pages.filter((page) => page.tasks.includes('MODERATE'));
    if (!manageablePages.length) throw new FacebookOAuthError('FACEBOOK_OAUTH_PAGE_ACCESS_UNAVAILABLE');

    const credentialReference = await this.credentials.storeCredentials({
      tenantId,
      platform: 'facebook',
      accessToken: longToken.accessToken,
      refreshToken: null,
      grantedScopes,
      expiresAt: new Date(Math.min(Date.parse(longToken.expiresAt), this.now() + 5 * 60 * 1000)).toISOString(),
    });
    let selectionId: string;
    try {
      selectionId = this.selections.issue({
        tenantId,
        credentialReference,
        grantedScopes,
        pages: manageablePages.map(({ externalAccountId, displayName }) => ({ externalAccountId, displayName })),
      });
    } catch {
      await this.credentials.deleteCredentials(tenantId, credentialReference, 'facebook');
      throw new FacebookOAuthError('FACEBOOK_OAUTH_PROVIDER_UNAVAILABLE');
    }
    return {
      selectionId,
      pages: manageablePages.map(({ externalAccountId, displayName }) => ({ externalAccountId, displayName })),
    };
  }

  async selectPage(selectionId: string, pageId: string, tenantId: string): Promise<FacebookAuthorizedPage> {
    const pending = this.selections.consume(selectionId, tenantId, pageId);
    if (!pending) throw new FacebookOAuthError('FACEBOOK_OAUTH_PAGE_SELECTION_INVALID');
    let pageCredentialReference: string | null = null;
    try {
      const userAccessToken = await this.credentials.resolveAccessToken(tenantId, pending.credentialReference, 'facebook');
      if (!userAccessToken) throw new FacebookOAuthError('FACEBOOK_OAUTH_PAGE_SELECTION_INVALID');
      const config = this.configuration(true);
      const pages = await this.listManagedPages(config, userAccessToken);
      const selected = pages.find((page) => page.externalAccountId === pageId && page.tasks.includes('MODERATE'));
      if (!selected) throw new FacebookOAuthError('FACEBOOK_OAUTH_PAGE_SELECTION_INVALID');

      pageCredentialReference = await this.credentials.storeCredentials({
        tenantId,
        platform: 'facebook',
        accessToken: selected.accessToken,
        refreshToken: null,
        grantedScopes: pending.grantedScopes,
        expiresAt: null,
      });
      await this.credentials.deleteCredentials(tenantId, pending.credentialReference, 'facebook');
      return { externalAccountId: selected.externalAccountId, displayName: selected.displayName, credentialReference: pageCredentialReference };
    } catch (error) {
      const references = [pageCredentialReference, pending.credentialReference].filter((reference): reference is string => reference !== null);
      let cleanupFailed = false;
      for (const reference of references) {
        try {
          await this.credentials.deleteCredentials(tenantId, reference, 'facebook');
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed) throw new FacebookOAuthError('FACEBOOK_OAUTH_CREDENTIAL_CLEANUP_FAILED');
      throw error;
    }
  }

  private async exchangeCode(config: OAuthConfiguration, code: string): Promise<{ accessToken: string; expiresIn: number }> {
    const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/oauth/access_token`);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('client_secret', config.clientSecret as string);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('code', code);
    const payload = await this.getJson<FacebookTokenResponse>(url, undefined, 'FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED');
    return this.validateToken(payload, 'FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED');
  }

  private async exchangeLongLivedToken(config: OAuthConfiguration, shortAccessToken: string): Promise<{ accessToken: string; expiresAt: string }> {
    const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('client_secret', config.clientSecret as string);
    url.searchParams.set('fb_exchange_token', shortAccessToken);
    const payload = await this.getJson<FacebookTokenResponse>(url, undefined, 'FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED');
    const token = this.validateToken(payload, 'FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED');
    return { accessToken: token.accessToken, expiresAt: new Date(this.now() + token.expiresIn * 1000).toISOString() };
  }

  private async getGrantedScopes(config: OAuthConfiguration, accessToken: string): Promise<readonly string[]> {
    const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/me/permissions`);
    const payload = await this.getJson<FacebookPermissionsResponse>(url, accessToken, 'FACEBOOK_OAUTH_PROVIDER_UNAVAILABLE');
    if (!Array.isArray(payload.data)) throw new FacebookOAuthError('FACEBOOK_OAUTH_RESPONSE_INVALID');
    return payload.data
      .filter((permission) => permission.status === 'granted' && typeof permission.permission === 'string')
      .map((permission) => permission.permission as string);
  }

  private async listManagedPages(config: OAuthConfiguration, accessToken: string): Promise<readonly StoredPage[]> {
    const pages: StoredPage[] = [];
    let cursor: string | null = null;
    do {
      const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/me/accounts`);
      url.searchParams.set('fields', 'id,name,access_token,tasks');
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('after', cursor);
      const payload = await this.getJson<FacebookPageResponse>(url, accessToken, 'FACEBOOK_OAUTH_PROVIDER_UNAVAILABLE');
      if (!Array.isArray(payload.data)) throw new FacebookOAuthError('FACEBOOK_OAUTH_RESPONSE_INVALID');
      pages.push(...payload.data.map((page) => this.normalizePage(page)));
      const next = payload.paging?.cursors?.after;
      if (payload.paging?.next && (typeof next !== 'string' || !next)) {
        throw new FacebookOAuthError('FACEBOOK_OAUTH_RESPONSE_INVALID');
      }
      cursor = payload.paging?.next ? next as string : null;
    } while (cursor);
    return pages;
  }

  private normalizePage(page: FacebookPage): StoredPage {
    if (typeof page.id !== 'string' || !page.id.trim() || typeof page.access_token !== 'string' || !page.access_token.trim()
      || !Array.isArray(page.tasks) || page.tasks.some((task) => typeof task !== 'string')) {
      throw new FacebookOAuthError('FACEBOOK_OAUTH_RESPONSE_INVALID');
    }
    return {
      externalAccountId: page.id,
      displayName: typeof page.name === 'string' && page.name.trim() ? page.name : null,
      accessToken: page.access_token,
      tasks: page.tasks as readonly string[],
    };
  }

  private validateToken(payload: FacebookTokenResponse, errorCode: 'FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED'): { accessToken: string; expiresIn: number } {
    if (typeof payload.access_token !== 'string' || !payload.access_token.trim()
      || typeof payload.token_type !== 'string' || payload.token_type.toLowerCase() !== 'bearer'
      || typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) {
      throw new FacebookOAuthError(errorCode);
    }
    return { accessToken: payload.access_token, expiresIn: payload.expires_in };
  }

  private async getJson<T>(url: URL, accessToken: string | undefined, failureCode: 'FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED' | 'FACEBOOK_OAUTH_PROVIDER_UNAVAILABLE'): Promise<T> {
    let response: globalThis.Response;
    try {
      response = await this.fetcher(url.toString(), accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined);
    } catch {
      throw new FacebookOAuthError('FACEBOOK_OAUTH_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) throw new FacebookOAuthError(failureCode);
    try {
      return await response.json() as T;
    } catch {
      throw new FacebookOAuthError('FACEBOOK_OAUTH_RESPONSE_INVALID');
    }
  }

  private configuration(requireSecret: boolean): OAuthConfiguration {
    const clientId = this.environment.FACEBOOK_OAUTH_CLIENT_ID?.trim();
    const clientSecret = this.environment.FACEBOOK_OAUTH_CLIENT_SECRET?.trim();
    const redirectUri = this.environment.FACEBOOK_OAUTH_REDIRECT_URI?.trim();
    const graphApiVersion = this.environment.META_GRAPH_API_VERSION?.trim();
    if (!clientId || !redirectUri || !graphApiVersion || (requireSecret && !clientSecret)) {
      throw new FacebookOAuthError('FACEBOOK_OAUTH_CONFIGURATION_REQUIRED');
    }
    if (!/^v\d+\.\d+$/.test(graphApiVersion)) throw new FacebookOAuthError('FACEBOOK_OAUTH_CONFIGURATION_INVALID');
    let redirect: URL;
    try {
      redirect = new URL(redirectUri);
    } catch {
      throw new FacebookOAuthError('FACEBOOK_OAUTH_CONFIGURATION_INVALID');
    }
    const isLocalHttp = redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if (redirect.protocol !== 'https:' && !isLocalHttp) throw new FacebookOAuthError('FACEBOOK_OAUTH_CONFIGURATION_INVALID');
    return { clientId, redirectUri: redirect.toString(), graphApiVersion, ...(clientSecret ? { clientSecret } : {}) };
  }
}
