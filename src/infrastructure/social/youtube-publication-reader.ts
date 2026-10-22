import type { YouTubeAccountCredentialProvider } from '../../application/ports/youtube-account-credential-provider.port';
import { defaultSocialPublicationPageSize, type PlatformPublication, type PlatformPublicationPage, type SocialPublicationPageSize, type SocialPublicationReader } from '../../application/ports/social-publication-reader.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import { YOUTUBE_READ_SCOPE, YOUTUBE_REPLY_SCOPE } from '../../application/ports/youtube-oauth.port';
import type { SocialAccount } from '../../domain/social/social-account';

const youtubeApi = 'https://www.googleapis.com/youtube/v3';

interface YouTubeChannelResponse {
  readonly items?: readonly {
    readonly contentDetails?: {
      readonly relatedPlaylists?: {
        readonly uploads?: unknown;
      };
    };
  }[];
}

interface YouTubePlaylistItem {
  readonly contentDetails?: {
    readonly videoId?: unknown;
  };
  readonly snippet?: {
    readonly title?: unknown;
    readonly description?: unknown;
    readonly publishedAt?: unknown;
    readonly resourceId?: {
      readonly videoId?: unknown;
    };
    readonly thumbnails?: {
      readonly medium?: { readonly url?: unknown };
      readonly default?: { readonly url?: unknown };
    };
  };
}

interface YouTubePlaylistItemsResponse {
  readonly items?: readonly YouTubePlaylistItem[];
  readonly nextPageToken?: unknown;
}

export class YouTubePublicationReader implements SocialPublicationReader {
  constructor(
    private readonly credentials: YouTubeAccountCredentialProvider,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listPublications(account: SocialAccount, cursor?: string, pageSize: SocialPublicationPageSize = defaultSocialPublicationPageSize): Promise<PlatformPublicationPage> {
    if (account.platform !== 'youtube') {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    }

    const canRead = await this.credentials.hasScopes(account, [YOUTUBE_READ_SCOPE])
      || await this.credentials.hasScopes(account, [YOUTUBE_REPLY_SCOPE]);
    if (!canRead) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
    }
    const accessToken = await this.credentials.resolveAccessToken(account);
    if (!accessToken?.trim()) {
      throw new SocialProviderError('SOCIAL_CREDENTIAL_UNAVAILABLE');
    }

    const channelsUrl = new URL(`${youtubeApi}/channels`);
    channelsUrl.searchParams.set('part', 'contentDetails');
    channelsUrl.searchParams.set('mine', 'true');
    const channels = await this.getJson<YouTubeChannelResponse>(channelsUrl, accessToken);
    if (!Array.isArray(channels.items)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (!channels.items.length) {
      return { items: [], nextCursor: null };
    }

    const uploadsPlaylistId = channels.items[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (typeof uploadsPlaylistId !== 'string' || !uploadsPlaylistId) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }

    const playlistUrl = new URL(`${youtubeApi}/playlistItems`);
    playlistUrl.searchParams.set('part', 'snippet,contentDetails');
    playlistUrl.searchParams.set('playlistId', uploadsPlaylistId);
    playlistUrl.searchParams.set('maxResults', String(pageSize));
    if (cursor) {
      playlistUrl.searchParams.set('pageToken', cursor);
    }
    const playlist = await this.getJson<YouTubePlaylistItemsResponse>(playlistUrl, accessToken);
    if (!Array.isArray(playlist.items)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (playlist.nextPageToken !== undefined && typeof playlist.nextPageToken !== 'string') {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }

    return {
      items: playlist.items
        .filter((item) => !this.isDeletedUnavailablePlaceholder(item))
        .map((item) => this.normalizePublication(item)),
      nextCursor: playlist.nextPageToken || null,
    };
  }

  private async getJson<Payload>(url: URL, accessToken: string): Promise<Payload> {
    let response: globalThis.Response;
    try {
      response = await this.fetcher(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) {
      if (response.status === 401) {
        throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
      }
      if (response.status === 403) {
        throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
      }
      if (response.status === 429) {
        throw new SocialProviderError('SOCIAL_PROVIDER_RATE_LIMITED');
      }
      if (response.status >= 500) {
        throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE');
      }
      throw new SocialProviderError('SOCIAL_PROVIDER_REQUEST_FAILED');
    }
    try {
      return await response.json() as Payload;
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
  }

  private normalizePublication(item: YouTubePlaylistItem): PlatformPublication {
    if (typeof item !== 'object' || item === null) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const id = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
    if (typeof id !== 'string' || !id) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const snippet = item.snippet;
    const thumbnail = snippet?.thumbnails?.medium?.url ?? snippet?.thumbnails?.default?.url;
    return {
      platform: 'youtube',
      externalPublicationId: id,
      title: this.optionalText(snippet?.title),
      description: this.optionalText(snippet?.description),
      permalink: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
      thumbnailUrl: this.optionalText(thumbnail),
      publishedAt: this.optionalText(snippet?.publishedAt),
    };
  }

  private isDeletedUnavailablePlaceholder(item: YouTubePlaylistItem): boolean {
    const title = typeof item?.snippet?.title === 'string' ? item.snippet.title.trim().toLowerCase() : '';
    const description = typeof item?.snippet?.description === 'string'
      ? item.snippet.description.trim().toLowerCase().replace(/\.$/, '')
      : '';
    return title === 'deleted video' && description === 'this video is unavailable';
  }

  private optionalText(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
  }
}
