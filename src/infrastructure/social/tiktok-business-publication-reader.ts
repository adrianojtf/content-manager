import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { PlatformPublication, PlatformPublicationPage, SocialPublicationReader } from '../../application/ports/social-publication-reader.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';
import type { TikTokAccountCredentialResolver } from './tiktok-account-credential-resolver';

const tiktokBusinessApi = 'https://business-api.tiktok.com/open_api/v1.3';
const tiktokVideoListScope = 'video.list';
const publicationFields = ['item_id', 'caption', 'share_url', 'create_time', 'thumbnail_url'];

interface TikTokVideo {
  readonly item_id?: unknown;
  readonly caption?: unknown;
  readonly share_url?: unknown;
  readonly create_time?: unknown;
  readonly thumbnail_url?: unknown;
}

interface TikTokVideoListData {
  readonly videos?: readonly TikTokVideo[];
  readonly cursor?: unknown;
  readonly has_more?: unknown;
}

interface TikTokApiResponse<Data> {
  readonly code?: unknown;
  readonly data?: Data;
}

export class TikTokBusinessPublicationReader implements SocialPublicationReader {
  constructor(
    private readonly credentials: SocialCredentialVault,
    private readonly fetcher: typeof fetch = fetch,
    private readonly tokenResolver?: Pick<TikTokAccountCredentialResolver, 'resolveAccessToken'>,
  ) {}

  async listPublications(account: SocialAccount, cursor?: string): Promise<PlatformPublicationPage> {
    if (account.platform !== 'tiktok') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    if (!await this.credentials.hasScopes(account.tenantId, account.credentialReference, 'tiktok', [tiktokVideoListScope])) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
    }
    const accessToken = this.tokenResolver
      ? await this.tokenResolver.resolveAccessToken(account)
      : await this.credentials.resolveAccessToken(account.tenantId, account.credentialReference, 'tiktok');
    if (!accessToken) throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
    const url = new URL(`${tiktokBusinessApi}/business/video/list/`);
    url.searchParams.set('business_id', account.externalAccountId);
    url.searchParams.set('fields', JSON.stringify(publicationFields));
    if (cursor !== undefined) {
      if (!/^\d+$/.test(cursor)) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
      url.searchParams.set('cursor', cursor);
    }
    const payload = await this.getJson<TikTokVideoListData>(url, accessToken);
    if (!Array.isArray(payload.videos) || typeof payload.has_more !== 'boolean'
      || (payload.cursor !== undefined && typeof payload.cursor !== 'number' && typeof payload.cursor !== 'string')
      || (payload.has_more && payload.cursor === undefined)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    return {
      items: payload.videos.map((video) => this.normalizeVideo(video)),
      nextCursor: payload.has_more ? String(payload.cursor) : null,
    };
  }

  private async getJson<Data>(url: URL, accessToken: string): Promise<Data> {
    let response: globalThis.Response;
    try {
      response = await this.fetcher(url.toString(), { headers: { 'Access-Token': accessToken } });
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) this.mapReadError(response.status);
    let result: TikTokApiResponse<Data>;
    try {
      result = await response.json() as TikTokApiResponse<Data>;
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (result.code !== 0 || typeof result.data !== 'object' || result.data === null || Array.isArray(result.data)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_REQUEST_FAILED');
    }
    return result.data;
  }

  private normalizeVideo(video: TikTokVideo): PlatformPublication {
    if (typeof video !== 'object' || video === null) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    const externalPublicationId = this.requiredId(video.item_id);
    return {
      platform: 'tiktok',
      externalPublicationId,
      title: null,
      description: this.optionalText(video.caption),
      permalink: this.optionalText(video.share_url),
      thumbnailUrl: this.optionalText(video.thumbnail_url),
      publishedAt: this.isoTimestamp(video.create_time),
    };
  }

  private requiredId(value: unknown): string {
    if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim()) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    return String(value);
  }

  private optionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private isoTimestamp(value: unknown): string | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const numeric = Number(value);
    const time = Number.isFinite(numeric) ? numeric * 1000 : Date.parse(String(value));
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }

  private mapReadError(status: number): never {
    if (status === 401) throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
    if (status === 403) throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
    if (status === 429) throw new SocialProviderError('SOCIAL_PROVIDER_RATE_LIMITED');
    if (status >= 500) throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE');
    throw new SocialProviderError('SOCIAL_PROVIDER_REQUEST_FAILED');
  }
}
