import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import { defaultSocialPublicationPageSize, type PlatformPublication, type PlatformPublicationPage, type SocialPublicationPageSize, type SocialPublicationReader } from '../../application/ports/social-publication-reader.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';
import { INSTAGRAM_READ_SCOPE } from './instagram-community.adapter';
import { MetaGraphCommunityHttpClient, type MetaCommunityEnvironment } from './meta-graph-community-http';
import type { InstagramAccountCredentialResolver } from './instagram-account-credential-resolver';

interface InstagramMedia {
  readonly id?: unknown;
  readonly caption?: unknown;
  readonly permalink?: unknown;
  readonly thumbnail_url?: unknown;
  readonly timestamp?: unknown;
}

interface InstagramMediaPage {
  readonly data?: readonly InstagramMedia[];
  readonly paging?: { readonly cursors?: { readonly after?: unknown }; readonly next?: unknown };
}

export class InstagramPublicationReader implements SocialPublicationReader {
  private readonly graph: MetaGraphCommunityHttpClient;

  constructor(credentials: SocialCredentialVault, environment: MetaCommunityEnvironment = process.env, fetcher: typeof fetch = fetch, instagramCredentials?: InstagramAccountCredentialResolver) {
    this.graph = new MetaGraphCommunityHttpClient(credentials, environment, fetcher, instagramCredentials);
  }

  async listPublications(account: SocialAccount, cursor?: string, pageSize: SocialPublicationPageSize = defaultSocialPublicationPageSize): Promise<PlatformPublicationPage> {
    if (account.platform !== 'instagram') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    const query: Record<string, string> = { fields: 'id,caption,permalink,thumbnail_url,timestamp', limit: String(pageSize) };
    if (cursor) query.after = cursor;
    const payload = await this.graph.get(account, `/${encodeURIComponent(account.externalAccountId)}/media`, query, [INSTAGRAM_READ_SCOPE]) as InstagramMediaPage;
    if (!Array.isArray(payload.data)) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    const nextCursor = payload.paging?.cursors?.after;
    if (nextCursor !== undefined && typeof nextCursor !== 'string') throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    if (payload.paging?.next && !nextCursor) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    return { items: payload.data.map((media) => this.normalizeMedia(media)), nextCursor: nextCursor || null };
  }

  private normalizeMedia(media: InstagramMedia): PlatformPublication {
    if (typeof media.id !== 'string' || !media.id) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    return {
      platform: 'instagram',
      externalPublicationId: media.id,
      title: null,
      description: typeof media.caption === 'string' && media.caption.trim() ? media.caption : null,
      permalink: typeof media.permalink === 'string' && media.permalink ? media.permalink : null,
      thumbnailUrl: typeof media.thumbnail_url === 'string' && media.thumbnail_url ? media.thumbnail_url : null,
      publishedAt: this.isoTimestamp(media.timestamp),
    };
  }

  private isoTimestamp(value: unknown): string | null {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
    return new Date(value).toISOString();
  }
}
