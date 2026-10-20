import type { SocialCommentReader, SocialCommentResponder, PlatformComment, PlatformCommentPage, PlatformCommentReply } from '../../application/ports/social-comment.port';
import type { YouTubeAccountCredentialProvider } from '../../application/ports/youtube-account-credential-provider.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import { YOUTUBE_READ_SCOPE, YOUTUBE_REPLY_SCOPE } from '../../application/ports/youtube-oauth.port';
import type { SocialAccount } from '../../domain/social/social-account';

const youtubeApi = 'https://www.googleapis.com/youtube/v3';

interface YouTubeCommentReply {
  readonly snippet?: { readonly authorChannelId?: { readonly value?: unknown } };
}

interface YouTubeCommentThread {
  readonly id?: unknown;
  readonly replies?: { readonly comments?: readonly YouTubeCommentReply[] };
  readonly snippet?: {
    readonly videoId?: unknown;
    readonly canReply?: unknown;
    readonly totalReplyCount?: unknown;
    readonly topLevelComment?: {
      readonly id?: unknown;
      readonly snippet?: {
        readonly authorDisplayName?: unknown;
        readonly textDisplay?: unknown;
        readonly publishedAt?: unknown;
      };
    };
  };
}

interface YouTubeCommentThreadsResponse {
  readonly items?: readonly YouTubeCommentThread[];
  readonly nextPageToken?: unknown;
}

interface YouTubeReplyResponse {
  readonly id?: unknown;
}

export class YouTubeCommunityAdapter implements SocialCommentReader, SocialCommentResponder {
  constructor(
    private readonly credentials: YouTubeAccountCredentialProvider,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getComments(account: SocialAccount, publicationId: string, cursor?: string): Promise<PlatformCommentPage> {
    if (account.platform !== 'youtube') {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    }
    const canRead = await this.credentials.hasScopes(account, [YOUTUBE_READ_SCOPE])
      || await this.credentials.hasScopes(account, [YOUTUBE_REPLY_SCOPE]);
    if (!canRead) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
    }
    const accessToken = await this.accessToken(account);
    const url = new URL(`${youtubeApi}/commentThreads`);
    url.searchParams.set('part', 'snippet,replies');
    url.searchParams.set('videoId', publicationId);
    url.searchParams.set('maxResults', '100');
    if (cursor) {
      url.searchParams.set('pageToken', cursor);
    }
    const payload = await this.getJson<YouTubeCommentThreadsResponse>(url, accessToken);
    if (!Array.isArray(payload.items) || (payload.nextPageToken !== undefined && typeof payload.nextPageToken !== 'string')) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    return {
      items: payload.items.map((thread) => this.normalizeComment(account, publicationId, thread)),
      nextCursor: payload.nextPageToken || null,
    };
  }

  async reply(account: SocialAccount, comment: PlatformComment, editedText: string): Promise<PlatformCommentReply> {
    if (account.platform !== 'youtube' || comment.platform !== 'youtube') {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    }
    if (!comment.canReply) {
      throw new SocialProviderError('SOCIAL_REPLY_UNSUPPORTED');
    }
    if (!editedText.trim()) {
      throw new SocialProviderError('SOCIAL_REPLY_TEXT_REQUIRED');
    }
    if (!await this.credentials.hasScopes(account, [YOUTUBE_REPLY_SCOPE])) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED');
    }

    const accessToken = await this.accessToken(account);
    const threadUrl = new URL(`${youtubeApi}/commentThreads`);
    threadUrl.searchParams.set('part', 'snippet');
    threadUrl.searchParams.set('id', comment.externalThreadId);
    const threadPayload = await this.getJson<YouTubeCommentThreadsResponse>(threadUrl, accessToken);
    const thread = threadPayload.items?.find((item) => item.id === comment.externalThreadId);
    if (!thread || thread.snippet?.videoId !== comment.externalPublicationId
      || thread.snippet?.topLevelComment?.id !== comment.externalCommentId) {
      throw new SocialProviderError('SOCIAL_COMMENT_CONTEXT_MISMATCH');
    }
    if (thread.snippet.canReply !== true) {
      throw new SocialProviderError('SOCIAL_REPLY_UNSUPPORTED');
    }

    const replyUrl = new URL(`${youtubeApi}/comments`);
    replyUrl.searchParams.set('part', 'snippet');
    const payload = await this.postReply(replyUrl, accessToken, {
      snippet: { parentId: comment.externalCommentId, textOriginal: editedText },
    });
    if (typeof payload.id !== 'string' || !payload.id) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    }
    return { platform: 'youtube', externalReplyId: payload.id };
  }

  private async accessToken(account: SocialAccount): Promise<string> {
    if (account.platform !== 'youtube') {
      throw new SocialProviderError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
    }
    return this.credentials.resolveAccessToken(account);
  }

  private async getJson<Payload>(url: URL, accessToken: string): Promise<Payload> {
    let response: globalThis.Response;
    try {
      response = await this.fetcher(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) {
      await this.mapReadError(response);
    }
    try {
      return await response.json() as Payload;
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
  }

  private async postReply(url: URL, accessToken: string, body: unknown): Promise<YouTubeReplyResponse> {
    let response: globalThis.Response;
    try {
      response = await this.fetcher(url.toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
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
        throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
      }
      throw new SocialProviderError('SOCIAL_PROVIDER_REQUEST_FAILED');
    }
    try {
      return await response.json() as YouTubeReplyResponse;
    } catch {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
    }
  }

  private async mapReadError(response: globalThis.Response): Promise<never> {
    if (response.status === 401) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
    }
    if (response.status === 403) {
      const payload = await response.json().catch(() => null) as { error?: { errors?: readonly { reason?: unknown }[] } } | null;
      if (payload?.error?.errors?.some((detail) => detail.reason === 'commentsDisabled')) {
        throw new SocialProviderError('SOCIAL_COMMENTS_DISABLED');
      }
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

  private normalizeComment(account: SocialAccount, publicationId: string, thread: YouTubeCommentThread): PlatformComment {
    if (typeof thread !== 'object' || thread === null) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const snippet = thread.snippet;
    const topLevelComment = snippet?.topLevelComment;
    if (!snippet || typeof thread.id !== 'string' || !thread.id || typeof topLevelComment?.id !== 'string' || !topLevelComment.id) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (typeof snippet.videoId === 'string' && snippet.videoId !== publicationId) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const replies = thread.replies?.comments;
    const creatorReplied = Array.isArray(replies)
      && replies.some((reply) => reply.snippet?.authorChannelId?.value === account.externalAccountId);
    return {
      platform: 'youtube',
      externalCommentId: topLevelComment.id,
      externalThreadId: thread.id,
      externalPublicationId: publicationId,
      authorDisplayName: this.optionalText(topLevelComment.snippet?.authorDisplayName),
      text: this.optionalText(topLevelComment.snippet?.textDisplay),
      createdAt: this.optionalText(topLevelComment.snippet?.publishedAt),
      canReply: account.platform === 'youtube' && snippet.canReply === true,
      externalReplyStatus: snippet.totalReplyCount === 0 ? 'NOT_REPLIED' : creatorReplied ? 'REPLIED' : 'UNKNOWN',
    };
  }

  private optionalText(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
  }
}
