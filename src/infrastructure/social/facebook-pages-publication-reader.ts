import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { PlatformPublication, PlatformPublicationPage, SocialPublicationReader } from '../../application/ports/social-publication-reader.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';
import { MetaGraphCommunityHttpClient, type MetaCommunityEnvironment } from './meta-graph-community-http';
import type { InstagramAccountCredentialResolver } from './instagram-account-credential-resolver';

interface FacebookPost {
  readonly id?: unknown;
  readonly message?: unknown;
  readonly permalink_url?: unknown;
  readonly full_picture?: unknown;
  readonly created_time?: unknown;
}

interface FacebookPostPage {
  readonly data?: readonly FacebookPost[];
  readonly paging?: { readonly cursors?: { readonly after?: unknown }; readonly next?: unknown };
}

export class FacebookPagesPublicationReader implements SocialPublicationReader {
  private readonly graph: MetaGraphCommunityHttpClient;

  constructor(credentials: SocialCredentialVault, environment: MetaCommunityEnvironment = process.env, fetcher: typeof fetch = fetch, instagramCredentials?: InstagramAccountCredentialResolver) {
    this.graph = new MetaGraphCommunityHttpClient(credentials, environment, fetcher, instagramCredentials);
  }

  async listPublications(account: SocialAccount, cursor?: string): Promise<PlatformPublicationPage> {
    if (account.platform !== 'facebook') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    const query: Record<string, string> = { fields: 'id,message,permalink_url,full_picture,created_time', limit: '100' };
    if (cursor) query.after = cursor;
    const payload = await this.graph.get(account, `/${encodeURIComponent(account.externalAccountId)}/posts`, query, ['pages_read_engagement']) as FacebookPostPage;
    if (!Array.isArray(payload.data)) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    const nextCursor = payload.paging?.cursors?.after;
    if (nextCursor !== undefined && typeof nextCursor !== 'string') throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    if (payload.paging?.next && !nextCursor) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    return { items: payload.data.map((post) => this.normalizePost(post)), nextCursor: nextCursor || null };
  }

  private normalizePost(post: FacebookPost): PlatformPublication {
    if (typeof post.id !== 'string' || !post.id) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    return {
      platform: 'facebook',
      externalPublicationId: post.id,
      title: null,
      description: typeof post.message === 'string' && post.message.trim() ? post.message : null,
      permalink: typeof post.permalink_url === 'string' && post.permalink_url ? post.permalink_url : null,
      thumbnailUrl: typeof post.full_picture === 'string' && post.full_picture ? post.full_picture : null,
      publishedAt: typeof post.created_time === 'string' && Number.isFinite(Date.parse(post.created_time)) ? new Date(post.created_time).toISOString() : null,
    };
  }
}
