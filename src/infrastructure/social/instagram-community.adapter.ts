import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { PlatformComment, PlatformCommentPage, PlatformCommentReply, SocialCommentReader, SocialCommentResponder } from '../../application/ports/social-comment.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';
import { MetaGraphCommunityHttpClient, type MetaCommunityEnvironment } from './meta-graph-community-http';
import type { InstagramAccountCredentialResolver } from './instagram-account-credential-resolver';

export const INSTAGRAM_READ_SCOPE = 'instagram_business_basic';
export const INSTAGRAM_COMMENT_SCOPE = 'instagram_business_manage_comments';

interface InstagramComment {
  readonly id?: unknown;
  readonly text?: unknown;
  readonly timestamp?: unknown;
  readonly username?: unknown;
  readonly hidden?: unknown;
  readonly reply_count?: unknown;
  readonly parent_id?: unknown;
}

interface InstagramCommentPage {
  readonly data?: readonly InstagramComment[];
  readonly paging?: { readonly cursors?: { readonly after?: unknown }; readonly next?: unknown };
}

export class InstagramCommunityAdapter implements SocialCommentReader, SocialCommentResponder {
  private readonly graph: MetaGraphCommunityHttpClient;

  constructor(credentials: SocialCredentialVault, environment: MetaCommunityEnvironment = process.env, fetcher: typeof fetch = fetch, instagramCredentials?: InstagramAccountCredentialResolver) {
    this.graph = new MetaGraphCommunityHttpClient(credentials, environment, fetcher, instagramCredentials);
  }

  async getComments(account: SocialAccount, publicationId: string, cursor?: string): Promise<PlatformCommentPage> {
    this.requireInstagram(account);
    const query: Record<string, string> = { fields: 'id,text,timestamp,username,hidden,reply_count,parent_id', limit: '100' };
    if (cursor) query.after = cursor;
    const payload = await this.graph.get(account, `/${encodeURIComponent(publicationId)}/comments`, query, [INSTAGRAM_READ_SCOPE, INSTAGRAM_COMMENT_SCOPE]) as InstagramCommentPage;
    if (!Array.isArray(payload.data)) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    const nextCursor = payload.paging?.cursors?.after;
    if (nextCursor !== undefined && typeof nextCursor !== 'string') throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    if (payload.paging?.next && !nextCursor) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    return { items: payload.data.map((comment) => this.normalizeComment(account, publicationId, comment)), nextCursor: nextCursor || null };
  }

  async reply(account: SocialAccount, comment: PlatformComment, editedText: string): Promise<PlatformCommentReply> {
    this.requireInstagram(account);
    if (comment.platform !== 'instagram') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    if (!comment.canReply) throw new SocialProviderError('SOCIAL_REPLY_UNSUPPORTED');
    if (!editedText.trim()) throw new SocialProviderError('SOCIAL_REPLY_TEXT_REQUIRED');
    const payload = await this.graph.post(account, `/${encodeURIComponent(comment.externalCommentId)}/replies`, { message: editedText }, [INSTAGRAM_COMMENT_SCOPE]);
    if (typeof payload.id !== 'string' || !payload.id) throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    return { platform: 'instagram', externalReplyId: payload.id };
  }

  private normalizeComment(account: SocialAccount, publicationId: string, comment: InstagramComment): PlatformComment {
    if (typeof comment.id !== 'string' || !comment.id || (comment.text !== undefined && comment.text !== null && typeof comment.text !== 'string')) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const createdAt = typeof comment.timestamp === 'string' && Number.isFinite(Date.parse(comment.timestamp))
      ? new Date(comment.timestamp).toISOString()
      : null;
    return {
      platform: 'instagram',
      externalCommentId: comment.id,
      externalThreadId: typeof comment.parent_id === 'string' && comment.parent_id ? comment.parent_id : comment.id,
      externalPublicationId: publicationId,
      authorDisplayName: typeof comment.username === 'string' && comment.username ? comment.username : null,
      text: typeof comment.text === 'string' ? comment.text : null,
      createdAt,
      canReply: account.platform === 'instagram' && comment.hidden !== true,
      externalReplyStatus: comment.reply_count === 0 ? 'NOT_REPLIED' : 'UNKNOWN',
    };
  }

  private requireInstagram(account: SocialAccount): void {
    if (account.platform !== 'instagram') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
  }
}
