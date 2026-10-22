import type { SocialAccountId } from '../../domain/social/social-account-id';
import type { SocialAccount } from '../../domain/social/social-account';
import type { PlatformPublication } from './social-publication-reader.port';

export interface StoredSocialPublication extends PlatformPublication {
  readonly tenantId: string;
  readonly socialAccountId: SocialAccountId;
  readonly lastSyncedAt: string;
}

export interface SocialPublicationRepository {
  upsertPage(account: SocialAccount, publications: readonly PlatformPublication[], syncedAt: string): Promise<void>;
  listByAccount(tenantId: string, socialAccountId: SocialAccountId): Promise<readonly StoredSocialPublication[]>;
}
