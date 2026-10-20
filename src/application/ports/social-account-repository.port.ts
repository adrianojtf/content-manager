import type { SocialAccount, SocialPlatform } from '../../domain/social/social-account';
import type { SocialAccountId } from '../../domain/social/social-account-id';

export interface SocialAccountRepository {
  save(tenantId: string, account: SocialAccount): Promise<void>;
  findById(tenantId: string, id: SocialAccountId): Promise<SocialAccount | null>;
  findByProviderIdentity(tenantId: string, platform: SocialPlatform, externalAccountId: string): Promise<SocialAccount | null>;
  listByTenant(tenantId: string): Promise<readonly SocialAccount[]>;
}
