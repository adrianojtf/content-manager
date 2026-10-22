import type { PlatformComment, PlatformCreatorReply } from './social-comment.port';
import type { SocialAccount } from '../../domain/social/social-account';
import type { SocialAccountId } from '../../domain/social/social-account-id';

export interface StoredPlatformComment extends PlatformComment {
  readonly socialAccountId: SocialAccountId;
  readonly appReplied: boolean;
  readonly appLiked: boolean;
  readonly lastSyncedAt: string;
  readonly expiresAt: string;
  readonly creatorReplies: readonly StoredPlatformCreatorReply[];
}

export interface StoredPlatformCreatorReply extends PlatformCreatorReply {
  readonly socialAccountId: SocialAccountId;
  readonly lastSyncedAt: string;
}

export interface SocialCommentPlatformSummary {
  readonly platform: string;
  readonly totalComments: number;
  readonly unansweredComments: number;
  readonly unevaluatedComments: number;
  readonly sentRepliesToday: number;
}

export interface SocialCommentRepository {
  deleteExpired(tenantId: string, asOf: string): Promise<void>;
  upsertPage(account: SocialAccount, publicationId: string, comments: readonly PlatformComment[], syncedAt: string, expiresAt: string, creatorReplies?: readonly PlatformCreatorReply[]): Promise<void>;
  markRepliedByApp(tenantId: string, socialAccountId: SocialAccountId, externalCommentId: string, repliedAt: string): Promise<void>;
  markLikedByApp(tenantId: string, socialAccountId: SocialAccountId, externalCommentId: string, liked: boolean, updatedAt: string): Promise<void>;
  listByPublication(tenantId: string, socialAccountId: SocialAccountId, publicationId: string, asOf: string): Promise<readonly StoredPlatformComment[]>;
  listByAccount(tenantId: string, socialAccountId: SocialAccountId, asOf: string): Promise<readonly StoredPlatformComment[]>;
  listByTenant(tenantId: string, asOf: string): Promise<readonly StoredPlatformComment[]>;
  findByExternalCommentId(tenantId: string, socialAccountId: SocialAccountId, externalCommentId: string, asOf: string): Promise<StoredPlatformComment | null>;
  summarizeByTenant(tenantId: string, asOf: string, sentSince: string): Promise<readonly SocialCommentPlatformSummary[]>;
}
