import type { SocialAccount, SocialPlatform } from '../../domain/social/social-account';

export type ExternalReplyStatus = 'REPLIED' | 'NOT_REPLIED' | 'UNKNOWN';

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
}

export interface PlatformCommentPage {
  readonly items: readonly PlatformComment[];
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
