import type { PlatformComment } from './social-comment.port';
import type { SocialAccount } from '../../domain/social/social-account';
import type { SocialAccountId } from '../../domain/social/social-account-id';

export interface StoredPlatformComment extends PlatformComment {
  readonly socialAccountId: SocialAccountId;
  readonly appReplied: boolean;
  readonly lastSyncedAt: string;
  readonly expiresAt: string;
}

export interface SocialCommentRepository {
  deleteExpired(tenantId: string, asOf: string): Promise<void>;
  upsertPage(account: SocialAccount, publicationId: string, comments: readonly PlatformComment[], syncedAt: string, expiresAt: string): Promise<void>;
  markRepliedByApp(tenantId: string, socialAccountId: SocialAccountId, externalCommentId: string, repliedAt: string): Promise<void>;
  listByPublication(tenantId: string, socialAccountId: SocialAccountId, publicationId: string, asOf: string): Promise<readonly StoredPlatformComment[]>;
  listByAccount(tenantId: string, socialAccountId: SocialAccountId, asOf: string): Promise<readonly StoredPlatformComment[]>;
  listByTenant(tenantId: string, asOf: string): Promise<readonly StoredPlatformComment[]>;
  findByExternalCommentId(tenantId: string, socialAccountId: SocialAccountId, externalCommentId: string, asOf: string): Promise<StoredPlatformComment | null>;
}
