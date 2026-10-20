import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { PlatformComment, PlatformCommentPage, PlatformCommentReply, SocialCommentReader, SocialCommentResponder } from '../../application/ports/social-comment.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';
import { MetaGraphCommunityHttpClient, type MetaCommunityEnvironment } from './meta-graph-community-http';
import type { InstagramAccountCredentialResolver } from './instagram-account-credential-resolver';

export const FACEBOOK_COMMENT_READ_SCOPES = ['pages_read_engagement', 'pages_read_user_content'] as const;
export const FACEBOOK_COMMENT_MANAGE_SCOPE = 'pages_manage_engagement';

interface FacebookComment {
  readonly id?: unknown;
  readonly message?: unknown;
  readonly created_time?: unknown;
  readonly from?: { readonly name?: unknown; readonly id?: unknown };
  readonly can_comment?: unknown;
  readonly comment_count?: unknown;
  readonly parent?: { readonly id?: unknown };
}

interface FacebookCommentPage {
  readonly data?: readonly FacebookComment[];
  readonly paging?: { readonly cursors?: { readonly after?: unknown }; readonly next?: unknown };
}

export class FacebookPagesCommunityAdapter implements SocialCommentReader, SocialCommentResponder {
  private readonly graph: MetaGraphCommunityHttpClient;

  constructor(credentials: SocialCredentialVault, environment: MetaCommunityEnvironment = process.env, fetcher: typeof fetch = fetch, instagramCredentials?: InstagramAccountCredentialResolver) {
    this.graph = new MetaGraphCommunityHttpClient(credentials, environment, fetcher, instagramCredentials);
  }

  async getComments(account: SocialAccount, publicationId: string, cursor?: string): Promise<PlatformCommentPage> {
    this.requireFacebook(account);
    const query: Record<string, string> = { fields: 'id,message,created_time,from,can_comment,comment_count,parent', limit: '100', filter: 'stream' };
    if (cursor) query.after = cursor;
    const payload = await this.graph.get(account, `/${encodeURIComponent(publicationId)}/comments`, query, FACEBOOK_COMMENT_READ_SCOPES) as FacebookCommentPage;
    if (!Array.isArray(payload.data)) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    const nextCursor = payload.paging?.cursors?.after;
    if (nextCursor !== undefined && typeof nextCursor !== 'string') throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    if (payload.paging?.next && !nextCursor) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    return { items: payload.data.map((comment) => this.normalizeComment(account, publicationId, comment)), nextCursor: nextCursor || null };
  }

  async reply(account: SocialAccount, comment: PlatformComment, editedText: string): Promise<PlatformCommentReply> {
    this.requireFacebook(account);
    if (comment.platform !== 'facebook') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    if (!comment.canReply) throw new SocialProviderError('SOCIAL_REPLY_UNSUPPORTED');
    if (!editedText.trim()) throw new SocialProviderError('SOCIAL_REPLY_TEXT_REQUIRED');
    const payload = await this.graph.post(account, `/${encodeURIComponent(comment.externalCommentId)}/comments`, { message: editedText }, [FACEBOOK_COMMENT_MANAGE_SCOPE]);
    if (typeof payload.id !== 'string' || !payload.id) throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    return { platform: 'facebook', externalReplyId: payload.id };
  }

  private normalizeComment(account: SocialAccount, publicationId: string, comment: FacebookComment): PlatformComment {
    if (typeof comment.id !== 'string' || !comment.id || (comment.message !== undefined && comment.message !== null && typeof comment.message !== 'string')) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const createdAt = typeof comment.created_time === 'string' && Number.isFinite(Date.parse(comment.created_time))
      ? new Date(comment.created_time).toISOString()
      : null;
    return {
      platform: 'facebook',
      externalCommentId: comment.id,
      externalThreadId: typeof comment.parent?.id === 'string' && comment.parent.id ? comment.parent.id : comment.id,
      externalPublicationId: publicationId,
      authorDisplayName: typeof comment.from?.name === 'string' && comment.from.name ? comment.from.name : null,
      text: typeof comment.message === 'string' ? comment.message : null,
      createdAt,
      canReply: account.platform === 'facebook' && comment.can_comment !== false,
      externalReplyStatus: comment.comment_count === 0 ? 'NOT_REPLIED' : 'UNKNOWN',
    };
  }

  private requireFacebook(account: SocialAccount): void {
    if (account.platform !== 'facebook') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
  }
}
