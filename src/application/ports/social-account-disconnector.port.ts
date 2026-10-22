import type { SocialAccountId } from '../../domain/social/social-account-id';

export interface SocialAccountDisconnector {
  disconnect(tenantId: string, accountId: SocialAccountId): Promise<boolean>;
}
