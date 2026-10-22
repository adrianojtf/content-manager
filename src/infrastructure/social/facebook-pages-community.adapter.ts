import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { PlatformComment, PlatformCommentPage, PlatformCommentReply, PlatformCreatorReply, SocialCommentLiker, SocialCommentLikeAction, SocialCommentReader, SocialCommentResponder } from '../../application/ports/social-comment.port';
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
  readonly can_like?: unknown;
  readonly comment_count?: unknown;
  readonly parent?: { readonly id?: unknown };
}

interface FacebookCommentPage {
  readonly data?: readonly FacebookComment[];
  readonly paging?: { readonly cursors?: { readonly after?: unknown }; readonly next?: unknown };
}

export class FacebookPagesCommunityAdapter implements SocialCommentReader, SocialCommentResponder, SocialCommentLiker {
  private readonly graph: MetaGraphCommunityHttpClient;
  private readonly environment: MetaCommunityEnvironment;

  constructor(credentials: SocialCredentialVault, environment: MetaCommunityEnvironment = process.env, fetcher: typeof fetch = fetch, instagramCredentials?: InstagramAccountCredentialResolver) {
    this.environment = environment;
    this.graph = new MetaGraphCommunityHttpClient(credentials, environment, fetcher, instagramCredentials);
  }

  async getComments(account: SocialAccount, publicationId: string, cursor?: string): Promise<PlatformCommentPage> {
    this.requireFacebook(account);
    const query: Record<string, string> = { fields: 'id,message,created_time,from,can_comment,can_like,comment_count,parent', limit: '100', filter: 'stream' };
    if (cursor) query.after = cursor;
    const payload = await this.graph.get(account, `/${encodeURIComponent(publicationId)}/comments`, query, FACEBOOK_COMMENT_READ_SCOPES) as FacebookCommentPage;
    if (this.environment.CONTENT_MANAGER_DEBUG_SYNC) {
      const comments = Array.isArray(payload.data) ? payload.data : [];
      const withFromId = comments.filter((comment) => typeof comment.from?.id === 'string').length;
      const withName = comments.filter((comment) => typeof comment.from?.name === 'string' && comment.from.name).length;
      const firstKeys = comments[0] ? Object.keys(comments[0]).join(',') : 'none';
      console.log(`[facebook-sync] post=${publicationId} total=${comments.length} withFromId=${withFromId} withName=${withName} firstKeys=${firstKeys}`);
    }
    if (!Array.isArray(payload.data)) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    if (payload.data.some((comment) => typeof comment !== 'object' || comment === null)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (payload.data.some((comment) => comment.parent !== undefined && comment.parent !== null
      && (typeof comment.parent !== 'object' || comment.parent.id !== undefined && typeof comment.parent.id !== 'string'))) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const nextCursor = payload.paging?.cursors?.after;
    if (nextCursor !== undefined && typeof nextCursor !== 'string') throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    if (payload.paging?.next && !nextCursor) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    const topLevelComments = payload.data.filter((comment) => !this.parentCommentId(comment));
    const childCommentIds = new Set(payload.data.flatMap((comment) => (
      this.parentCommentId(comment) && typeof comment.id === 'string' && comment.id ? [comment.id] : []
    )));
    const creatorReplyParentIds = new Set<string>();
    const creatorReplies = payload.data.flatMap((comment): PlatformCreatorReply[] => {
      const parentCommentId = this.parentCommentId(comment);
      if (!parentCommentId || childCommentIds.has(parentCommentId) || comment.from?.id !== account.externalAccountId) {
        return [];
      }
      creatorReplyParentIds.add(parentCommentId);
      const normalized = this.normalizeCreatorReply(publicationId, parentCommentId, comment);
      return normalized ? [normalized] : [];
    });
    const items = topLevelComments.map((comment) => {
      const normalized = this.normalizeComment(account, publicationId, comment);
      return creatorReplyParentIds.has(normalized.externalCommentId)
        ? { ...normalized, externalReplyStatus: 'REPLIED' as const }
        : normalized;
    });
    return { items, creatorReplies, nextCursor: nextCursor || null };
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

  async setLike(account: SocialAccount, comment: PlatformComment, action: SocialCommentLikeAction): Promise<void> {
    this.requireFacebook(account);
    if (comment.platform !== 'facebook') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    if (!comment.canLike) throw new SocialProviderError('SOCIAL_COMMENT_LIKE_UNSUPPORTED');
    if (action !== 'LIKE' && action !== 'UNLIKE') throw new SocialProviderError('SOCIAL_COMMENT_LIKE_ACTION_INVALID');
    if (action === 'LIKE') {
      await this.graph.post(account, `/${encodeURIComponent(comment.externalCommentId)}/likes`, {}, [FACEBOOK_COMMENT_MANAGE_SCOPE]);
      return;
    }
    await this.graph.delete(account, `/${encodeURIComponent(comment.externalCommentId)}/likes`, [FACEBOOK_COMMENT_MANAGE_SCOPE]);
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
      canLike: account.platform === 'facebook' && comment.can_like === true,
      externalReplyStatus: comment.comment_count === 0 ? 'NOT_REPLIED' : 'UNKNOWN',
    };
  }

  private normalizeCreatorReply(publicationId: string, parentCommentId: string, comment: FacebookComment): PlatformCreatorReply | null {
    if (typeof comment.id !== 'string' || !comment.id.trim()) return null;
    return {
      platform: 'facebook',
      externalReplyId: comment.id,
      externalCommentId: parentCommentId,
      externalPublicationId: publicationId,
      text: typeof comment.message === 'string' ? comment.message : null,
      createdAt: this.isoTimestamp(comment.created_time),
    };
  }

  private parentCommentId(comment: FacebookComment): string | null {
    return typeof comment.parent?.id === 'string' && comment.parent.id.trim() ? comment.parent.id : null;
  }

  private isoTimestamp(value: unknown): string | null {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
    return new Date(value).toISOString();
  }

  private requireFacebook(account: SocialAccount): void {
    if (account.platform !== 'facebook') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
  }
}
