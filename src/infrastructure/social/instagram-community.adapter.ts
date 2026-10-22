import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { PlatformComment, PlatformCommentPage, PlatformCommentReply, PlatformCreatorReply, SocialCommentReader, SocialCommentResponder } from '../../application/ports/social-comment.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';
import { MetaGraphCommunityHttpClient, type MetaCommunityEnvironment } from './meta-graph-community-http';
import type { InstagramAccountCredentialResolver } from './instagram-account-credential-resolver';

export const INSTAGRAM_READ_SCOPE = 'instagram_business_basic';
export const INSTAGRAM_COMMENT_SCOPE = 'instagram_business_manage_comments';

interface InstagramCommentReplyEntry {
  readonly id?: unknown;
  readonly text?: unknown;
  readonly timestamp?: unknown;
  readonly username?: unknown;
  readonly from?: { readonly id?: unknown; readonly username?: unknown };
}

interface InstagramAuthor {
  readonly id?: unknown;
  readonly username?: unknown;
}

interface InstagramComment {
  readonly id?: unknown;
  readonly text?: unknown;
  readonly timestamp?: unknown;
  readonly username?: unknown;
  readonly hidden?: unknown;
  readonly parent_id?: unknown;
  readonly from?: InstagramAuthor;
  readonly replies?: {
    readonly data?: readonly InstagramCommentReplyEntry[];
    readonly paging?: { readonly next?: unknown };
  };
}

interface InstagramCommentPage {
  readonly data?: readonly InstagramComment[];
  readonly paging?: { readonly cursors?: { readonly after?: unknown }; readonly next?: unknown };
}

export class InstagramCommunityAdapter implements SocialCommentReader, SocialCommentResponder {
  private readonly graph: MetaGraphCommunityHttpClient;

  constructor(credentials: SocialCredentialVault, private readonly environment: MetaCommunityEnvironment = process.env, fetcher: typeof fetch = fetch, instagramCredentials?: InstagramAccountCredentialResolver) {
    this.graph = new MetaGraphCommunityHttpClient(credentials, environment, fetcher, instagramCredentials);
  }

  async getComments(account: SocialAccount, publicationId: string, cursor?: string): Promise<PlatformCommentPage> {
    this.requireInstagram(account);
    const query: Record<string, string> = { fields: 'id,text,timestamp,username,hidden,parent_id,from{id,username},replies{id,text,timestamp,username,from{id,username}}', limit: '100' };
    if (cursor) query.after = cursor;
    const payload = await this.graph.get(account, `/${encodeURIComponent(publicationId)}/comments`, query, [INSTAGRAM_READ_SCOPE, INSTAGRAM_COMMENT_SCOPE]) as InstagramCommentPage;
    if (this.environment.CONTENT_MANAGER_DEBUG_SYNC === '2') {
      console.log(`[instagram-sync] media=${publicationId} payload=${JSON.stringify(payload)}`);
    }
    if (!Array.isArray(payload.data)) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    if (payload.data.some((comment) => typeof comment !== 'object' || comment === null)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (payload.data.some((comment) => comment.parent_id !== undefined && comment.parent_id !== null && typeof comment.parent_id !== 'string')) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (payload.data.some((comment) => comment.replies !== undefined && (typeof comment.replies !== 'object' || comment.replies === null
      || (comment.replies.data !== undefined && !Array.isArray(comment.replies.data))
      || (Array.isArray(comment.replies.data) && comment.replies.data.some((reply: unknown) => typeof reply !== 'object' || reply === null))))) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const nextCursor = payload.paging?.cursors?.after;
    if (nextCursor !== undefined && typeof nextCursor !== 'string') throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    if (payload.paging?.next && !nextCursor) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    const topLevelComments = payload.data.filter((comment) => typeof comment.parent_id !== 'string' || !comment.parent_id.trim());
    const nestedParentIds = new Set(payload.data.flatMap((comment) => (
      typeof comment.parent_id === 'string' && comment.parent_id.trim() ? [comment.parent_id] : []
    )));
    if (this.environment.CONTENT_MANAGER_DEBUG_SYNC === '1') {
      const firstKeys = payload.data[0] ? Object.keys(payload.data[0]).join(',') : 'none';
      const noRepliesField = payload.data.filter((comment) => comment.replies === undefined).length;
      const emptyReplies = payload.data.filter((comment) => Array.isArray(comment.replies?.data) && comment.replies.data.length === 0).length;
      const withReplies = payload.data.filter((comment) => Array.isArray(comment.replies?.data) && comment.replies.data.length > 0).length;
      const repliesPaginated = payload.data.filter((comment) => Boolean(comment.replies?.paging?.next)).length;
      console.log(`[instagram-sync] media=${publicationId} total=${payload.data.length} nested=${payload.data.length - topLevelComments.length} topLevel=${topLevelComments.length} firstKeys=${firstKeys} noRepliesField=${noRepliesField} emptyReplies=${emptyReplies} withReplies=${withReplies} repliesPaginated=${repliesPaginated}`);
    }
    return {
      items: topLevelComments.map((comment) => this.normalizeComment(account, publicationId, comment, nestedParentIds.has(comment.id as string))),
      creatorReplies: topLevelComments.flatMap((comment) => this.normalizeCreatorReplies(account, publicationId, comment)),
      nextCursor: nextCursor || null,
    };
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

  private normalizeComment(account: SocialAccount, publicationId: string, comment: InstagramComment, hasNestedReplies: boolean): PlatformComment {
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
      authorDisplayName: this.authorName(comment),
      text: typeof comment.text === 'string' ? comment.text : null,
      createdAt,
      canReply: account.platform === 'instagram' && comment.hidden !== true,
      canLike: false,
      externalReplyStatus: this.replyStatus(account, comment, hasNestedReplies),
    };
  }

  private authorName(comment: InstagramComment): string | null {
    if (typeof comment.username === 'string' && comment.username.trim()) return comment.username;
    if (typeof comment.from?.username === 'string' && comment.from.username.trim()) return comment.from.username;
    return null;
  }

  private replyStatus(account: SocialAccount, comment: InstagramComment, hasNestedReplies: boolean): 'REPLIED' | 'NOT_REPLIED' | 'UNKNOWN' {
    if (comment.replies === undefined) return hasNestedReplies ? 'UNKNOWN' : 'NOT_REPLIED';
    const replies = comment.replies.data;
    if (!Array.isArray(replies) || comment.replies.paging?.next) return 'UNKNOWN';
    return replies.some((reply) => this.isCreatorReply(account, reply)) ? 'REPLIED' : 'NOT_REPLIED';
  }

  private isCreatorReply(account: SocialAccount, reply: InstagramCommentReplyEntry): boolean {
    return typeof reply.from?.id === 'string' && reply.from.id === account.externalAccountId;
  }

  private normalizeCreatorReplies(account: SocialAccount, publicationId: string, comment: InstagramComment): readonly PlatformCreatorReply[] {
    const replies = comment.replies?.data;
    if (!Array.isArray(replies) || typeof comment.id !== 'string') return [];
    const commentId = comment.id;
    return replies.flatMap((reply): PlatformCreatorReply[] => {
      if (!this.isCreatorReply(account, reply) || typeof reply.id !== 'string' || !reply.id.trim()) return [];
      const createdAt = typeof reply.timestamp === 'string' && Number.isFinite(Date.parse(reply.timestamp))
        ? new Date(reply.timestamp).toISOString()
        : null;
      return [{
        platform: 'instagram',
        externalReplyId: reply.id,
        externalCommentId: commentId,
        externalPublicationId: publicationId,
        text: typeof reply.text === 'string' ? reply.text : null,
        createdAt,
      }];
    });
  }

  private requireInstagram(account: SocialAccount): void {
    if (account.platform !== 'instagram') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
  }
}
