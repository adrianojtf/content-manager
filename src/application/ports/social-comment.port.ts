import type { SocialAccount, SocialPlatform } from '../../domain/social/social-account';

export type ExternalReplyStatus = 'REPLIED' | 'NOT_REPLIED' | 'UNKNOWN';
export type SocialCommentLikeAction = 'LIKE' | 'UNLIKE';

export interface PlatformComment {
  readonly platform: SocialPlatform;
  readonly externalReplyStatus?: ExternalReplyStatus;
  readonly externalCommentId: string;
  readonly externalThreadId: string;
  readonly externalPublicationId: string;
  readonly authorDisplayName: string | null;
  readonly text: string | null;
  readonly createdAt: string | null;
  readonly canReply: boolean;
  readonly canLike: boolean;
}

export interface PlatformCreatorReply {
  readonly platform: SocialPlatform;
  readonly externalReplyId: string;
  readonly externalCommentId: string;
  readonly externalPublicationId: string;
  readonly text: string | null;
  readonly createdAt: string | null;
}

export interface PlatformCommentPage {
  readonly items: readonly PlatformComment[];
  readonly creatorReplies: readonly PlatformCreatorReply[];
  readonly nextCursor: string | null;
}

export interface PlatformCommentReply {
  readonly platform: SocialPlatform;
  readonly externalReplyId: string;
}

export interface SocialCommentReader {
  getComments(account: SocialAccount, publicationId: string, cursor?: string): Promise<PlatformCommentPage>;
}

export interface SocialCommentResponder {
  reply(account: SocialAccount, comment: PlatformComment, editedText: string): Promise<PlatformCommentReply>;
}

export type SocialCommentResponderRegistry = Partial<Record<SocialPlatform, SocialCommentResponder>>;

export interface SocialCommentLiker {
  setLike(account: SocialAccount, comment: PlatformComment, action: SocialCommentLikeAction): Promise<void>;
}

export type SocialCommentLikerRegistry = Partial<Record<SocialPlatform, SocialCommentLiker>>;
