import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { SocialPlatform } from '../../domain/social/social-account';
import type { SocialAccount } from '../../domain/social/social-account';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { InstagramAccountCredentialResolver } from './instagram-account-credential-resolver';

export type MetaCommunityEnvironment = Readonly<Record<string, string | undefined>>;
type MetaPlatform = Extract<SocialPlatform, 'instagram' | 'facebook'>;

export class MetaGraphCommunityHttpClient {
  constructor(
    private readonly credentials: SocialCredentialVault,
    private readonly environment: MetaCommunityEnvironment = process.env,
    private readonly fetcher: typeof fetch = fetch,
    private readonly instagramCredentials?: Pick<InstagramAccountCredentialResolver, 'resolveAccessToken'>,
  ) {}

  get(account: SocialAccount, path: string, query: Readonly<Record<string, string>>, scopes: readonly string[]): Promise<Record<string, unknown>> {
    return this.request(account, path, 'GET', query, scopes, false);
  }

  post(account: SocialAccount, path: string, body: Readonly<Record<string, string>>, scopes: readonly string[]): Promise<Record<string, unknown>> {
    return this.request(account, path, 'POST', body, scopes, true);
  }

  delete(account: SocialAccount, path: string, scopes: readonly string[]): Promise<Record<string, unknown>> {
    return this.request(account, path, 'DELETE', {}, scopes, true);
  }

  private async request(
    account: SocialAccount,
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    parameters: Readonly<Record<string, string>>,
    scopes: readonly string[],
    write: boolean,
  ): Promise<Record<string, unknown>> {
    if (account.platform !== 'instagram' && account.platform !== 'facebook') {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    }
    const platform = account.platform as MetaPlatform;
    if (!await this.credentials.hasScopes(account.tenantId, account.credentialReference, platform, scopes)) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
    }
    const accessToken = platform === 'instagram' && this.instagramCredentials
      ? await this.instagramCredentials.resolveAccessToken(account)
      : await this.credentials.resolveAccessToken(account.tenantId, account.credentialReference, platform);
    if (!accessToken) throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
    const url = new URL(`${this.host(platform)}/${this.apiVersion()}${path}`);
    if (!write) {
      for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    }
    const request: RequestInit = method === 'POST'
      ? { method, headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(parameters).toString() }
      : { method, headers: { Authorization: `Bearer ${accessToken}` } };
    let response: globalThis.Response;
    try {
      response = await this.fetcher(url.toString(), request);
    } catch {
      throw new SocialProviderError(write ? 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS' : 'SOCIAL_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) this.mapHttpError(response.status, write);
    if (response.status === 204) return {};
    let payload: Record<string, unknown>;
    try {
      payload = await response.json() as Record<string, unknown>;
    } catch {
      throw new SocialProviderError(write ? 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS' : 'SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new SocialProviderError(write ? 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS' : 'SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (payload.error) throw new SocialProviderError('SOCIAL_PROVIDER_REQUEST_FAILED');
    return payload;
  }

  private host(platform: MetaPlatform): string {
    return platform === 'instagram' ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
  }

  private apiVersion(): string {
    const version = this.environment.META_GRAPH_API_VERSION?.trim();
    if (!version) throw new SocialProviderError('SOCIAL_PROVIDER_CONFIGURATION_REQUIRED');
    if (!/^v\d+\.\d+$/.test(version)) throw new SocialProviderError('SOCIAL_PROVIDER_CONFIGURATION_INVALID');
    return version;
  }

  private mapHttpError(status: number, write: boolean): never {
    if (status === 401) throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
    if (status === 403) throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
    if (status === 429) throw new SocialProviderError('SOCIAL_PROVIDER_RATE_LIMITED');
    if (status >= 500) throw new SocialProviderError(write ? 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS' : 'SOCIAL_PROVIDER_UNAVAILABLE');
    throw new SocialProviderError('SOCIAL_PROVIDER_REQUEST_FAILED');
  }
}
