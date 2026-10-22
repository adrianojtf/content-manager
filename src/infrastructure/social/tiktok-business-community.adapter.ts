import type { SocialCredentialVault } from '../../application/ports/social-credential-vault.port';
import type { PlatformComment, PlatformCommentPage, PlatformCommentReply, PlatformCreatorReply, SocialCommentLiker, SocialCommentLikeAction, SocialCommentReader, SocialCommentResponder } from '../../application/ports/social-comment.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';
import type { TikTokAccountCredentialResolver } from './tiktok-account-credential-resolver';

export const TIKTOK_COMMENT_READ_SCOPE = 'comment.list';
export const TIKTOK_COMMENT_MANAGE_SCOPE = 'comment.list.manage';

const tiktokBusinessApi = 'https://business-api.tiktok.com/open_api/v1.3';

interface TikTokComment {
  readonly comment_id?: unknown;
  readonly video_id?: unknown;
  readonly parent_comment_id?: unknown;
  readonly text?: unknown;
  readonly create_time?: unknown;
  readonly username?: unknown;
  readonly display_name?: unknown;
  readonly reply_count?: unknown;
  readonly owner?: unknown;
  readonly status?: unknown;
  readonly reply_list?: readonly TikTokComment[];
}

interface TikTokCommentListData {
  readonly comments?: readonly TikTokComment[];
  readonly cursor?: unknown;
  readonly has_more?: unknown;
}

interface TikTokApiResponse<Data> {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly data?: Data;
}

interface TikTokReplyData {
  readonly comment_id?: unknown;
}

export class TikTokBusinessCommunityAdapter implements SocialCommentReader, SocialCommentResponder, SocialCommentLiker {
  constructor(
    private readonly credentials: SocialCredentialVault,
    private readonly fetcher: typeof fetch = fetch,
    private readonly tokenResolver?: Pick<TikTokAccountCredentialResolver, 'resolveAccessToken'>,
  ) {}

  async getComments(account: SocialAccount, publicationId: string, cursor?: string): Promise<PlatformCommentPage> {
    this.requireTikTokAccount(account);
    await this.requireScope(account, TIKTOK_COMMENT_READ_SCOPE);
    const accessToken = await this.accessToken(account);
    const url = new URL(`${tiktokBusinessApi}/business/comment/list/`);
    url.searchParams.set('business_id', account.externalAccountId);
    url.searchParams.set('video_id', publicationId);
    url.searchParams.set('include_replies', 'true');
    if (cursor !== undefined) {
      if (!/^\d+$/.test(cursor)) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
      url.searchParams.set('cursor', cursor);
    }
    const payload = await this.getJson<TikTokCommentListData>(url, accessToken);
    if (!Array.isArray(payload.comments) || typeof payload.has_more !== 'boolean'
      || (payload.cursor !== undefined && typeof payload.cursor !== 'number' && typeof payload.cursor !== 'string')) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (payload.comments.some((comment) => typeof comment !== 'object' || comment === null)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (payload.has_more && payload.cursor === undefined) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const rootComments = payload.comments.filter((comment) => !this.optionalId(comment.parent_comment_id));
    const creatorReplies = rootComments.flatMap((comment) => this.normalizeCreatorReplies(publicationId, comment));
    const creatorReplyIds = new Set(creatorReplies.map((reply) => reply.externalReplyId));
    const flattenedCreatorReplies = payload.comments.flatMap((comment): PlatformCreatorReply[] => {
      const parentCommentId = this.optionalId(comment.parent_comment_id);
      if (!parentCommentId || comment.owner !== true) return [];
      const reply = this.normalizeCreatorReply(publicationId, parentCommentId, comment);
      if (!reply || creatorReplyIds.has(reply.externalReplyId)) return [];
      creatorReplyIds.add(reply.externalReplyId);
      return [reply];
    });
    const allCreatorReplies = [...creatorReplies, ...flattenedCreatorReplies];
    const repliedCommentIds = new Set(allCreatorReplies.map((reply) => reply.externalCommentId));
    return {
      items: rootComments.map((comment) => {
        const normalized = this.normalizeComment(account, publicationId, comment);
        return repliedCommentIds.has(normalized.externalCommentId)
          ? { ...normalized, externalReplyStatus: 'REPLIED' as const }
          : normalized;
      }),
      creatorReplies: allCreatorReplies,
      nextCursor: payload.has_more ? String(payload.cursor) : null,
    };
  }

  async reply(account: SocialAccount, comment: PlatformComment, editedText: string): Promise<PlatformCommentReply> {
    this.requireTikTokAccount(account);
    if (comment.platform !== 'tiktok') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    if (!comment.canReply) throw new SocialProviderError('SOCIAL_REPLY_UNSUPPORTED');
    if (!editedText.trim()) throw new SocialProviderError('SOCIAL_REPLY_TEXT_REQUIRED');
    await this.requireScope(account, TIKTOK_COMMENT_MANAGE_SCOPE);
    const accessToken = await this.accessToken(account);
    let response: globalThis.Response;
    try {
      response = await this.fetcher(`${tiktokBusinessApi}/business/comment/reply/create/`, {
        method: 'POST',
        headers: { 'Access-Token': accessToken, 'content-type': 'application/json' },
        body: JSON.stringify({
          business_id: account.externalAccountId,
          video_id: comment.externalPublicationId,
          comment_id: comment.externalCommentId,
          text: editedText,
        }),
      });
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    }
    if (!response.ok) this.mapWriteError(response.status);
    let result: TikTokApiResponse<TikTokReplyData>;
    try {
      result = await response.json() as TikTokApiResponse<TikTokReplyData>;
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    }
    if (result.code !== 0) throw new SocialProviderError('SOCIAL_PROVIDER_REQUEST_FAILED');
    const replyId = result.data?.comment_id;
    if ((typeof replyId !== 'string' && typeof replyId !== 'number') || !String(replyId).trim()) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    }
    return { platform: 'tiktok', externalReplyId: String(replyId) };
  }

  async setLike(account: SocialAccount, comment: PlatformComment, action: SocialCommentLikeAction): Promise<void> {
    this.requireTikTokAccount(account);
    if (comment.platform !== 'tiktok') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    if (!comment.canLike) throw new SocialProviderError('SOCIAL_COMMENT_LIKE_UNSUPPORTED');
    if (action !== 'LIKE' && action !== 'UNLIKE') throw new SocialProviderError('SOCIAL_COMMENT_LIKE_ACTION_INVALID');
    await this.requireScope(account, TIKTOK_COMMENT_MANAGE_SCOPE);
    const accessToken = await this.accessToken(account);
    let response: globalThis.Response;
    try {
      response = await this.fetcher(`${tiktokBusinessApi}/business/comment/like/`, {
        method: 'POST',
        headers: { 'Access-Token': accessToken, 'content-type': 'application/json' },
        body: JSON.stringify({
          business_id: account.externalAccountId,
          comment_id: comment.externalCommentId,
          action,
        }),
      });
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    }
    if (!response.ok) this.mapWriteError(response.status);
    let result: TikTokApiResponse<Record<string, unknown>>;
    try {
      result = await response.json() as TikTokApiResponse<Record<string, unknown>>;
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    }
    if (result.code !== 0) throw new SocialProviderError('SOCIAL_PROVIDER_REQUEST_FAILED');
  }

  private async requireScope(account: SocialAccount, scope: string): Promise<void> {
    if (!await this.credentials.hasScopes(account.tenantId, account.credentialReference, 'tiktok', [scope])) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
    }
  }

  private async accessToken(account: SocialAccount): Promise<string> {
    if (this.tokenResolver) return this.tokenResolver.resolveAccessToken(account);
    const token = await this.credentials.resolveAccessToken(account.tenantId, account.credentialReference, 'tiktok');
    if (!token) throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
    return token;
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

  private normalizeComment(account: SocialAccount, publicationId: string, value: TikTokComment): PlatformComment {
    if (typeof value !== 'object' || value === null) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    const commentId = this.requiredId(value.comment_id);
    const videoId = this.requiredId(value.video_id);
    if (videoId !== publicationId) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    const creatorReplied = this.directCreatorReplyValues(commentId, value).some((reply) => reply.owner === true);
    const replyCount = typeof value.reply_count === 'number' ? value.reply_count : null;
    return {
      platform: 'tiktok',
      externalCommentId: commentId,
      externalThreadId: this.optionalId(value.parent_comment_id) ?? commentId,
      externalPublicationId: videoId,
      authorDisplayName: this.optionalText(value.display_name) ?? this.optionalText(value.username),
      text: this.optionalText(value.text),
      createdAt: this.createdAt(value.create_time),
      canReply: value.status === 'PUBLIC' && value.owner !== true,
      canLike: value.status === 'PUBLIC',
      externalReplyStatus: creatorReplied ? 'REPLIED' : replyCount === 0 ? 'NOT_REPLIED' : 'UNKNOWN',
    };
  }

  private normalizeCreatorReplies(publicationId: string, comment: TikTokComment): readonly PlatformCreatorReply[] {
    const parentCommentId = this.requiredId(comment.comment_id);
    return this.directCreatorReplyValues(parentCommentId, comment).flatMap((reply) => {
      if (reply.owner !== true) return [];
      const normalized = this.normalizeCreatorReply(publicationId, parentCommentId, reply);
      return normalized ? [normalized] : [];
    });
  }

  private directCreatorReplyValues(parentCommentId: string, comment: TikTokComment): readonly TikTokComment[] {
    if (!Array.isArray(comment.reply_list)) return [];
    return comment.reply_list.filter((reply) => {
      if (typeof reply !== 'object' || reply === null) return false;
      const declaredParent = this.optionalId(reply.parent_comment_id);
      return !declaredParent || declaredParent === parentCommentId;
    });
  }

  private normalizeCreatorReply(publicationId: string, parentCommentId: string, value: TikTokComment): PlatformCreatorReply | null {
    const externalReplyId = this.optionalId(value.comment_id);
    if (!externalReplyId) return null;
    const replyPublicationId = this.optionalId(value.video_id);
    if (replyPublicationId && replyPublicationId !== publicationId) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const declaredParent = this.optionalId(value.parent_comment_id);
    if (declaredParent && declaredParent !== parentCommentId) return null;
    return {
      platform: 'tiktok',
      externalReplyId,
      externalCommentId: parentCommentId,
      externalPublicationId: publicationId,
      text: this.optionalText(value.text),
      createdAt: this.createdAt(value.create_time),
    };
  }

  private requiredId(value: unknown): string {
    const id = this.optionalId(value);
    if (!id) throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    return id;
  }

  private optionalId(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
  }

  private optionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private createdAt(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value * 1000).toISOString();
    }
    if (typeof value === 'string' && value.trim()) {
      const epoch = Number(value);
      const milliseconds = Number.isFinite(epoch) ? epoch * 1000 : Date.parse(value);
      return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
    }
    return null;
  }

  private requireTikTokAccount(account: SocialAccount): void {
    if (account.platform !== 'tiktok') throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
  }

  private mapReadError(status: number): never {
    if (status === 401) throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
    if (status === 403) throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
    if (status === 429) throw new SocialProviderError('SOCIAL_PROVIDER_RATE_LIMITED');
    if (status >= 500) throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE');
    throw new SocialProviderError('SOCIAL_PROVIDER_REQUEST_FAILED');
  }

  private mapWriteError(status: number): never {
    if (status === 401) throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
    if (status === 403) throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
    if (status === 429) throw new SocialProviderError('SOCIAL_PROVIDER_RATE_LIMITED');
    if (status >= 500) throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    throw new SocialProviderError('SOCIAL_PROVIDER_REQUEST_FAILED');
  }
}
