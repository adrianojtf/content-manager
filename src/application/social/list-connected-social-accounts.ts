import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialPlatform } from '../../domain/social/social-account';
import type { SocialAccountId } from '../../domain/social/social-account-id';

export interface ConnectedSocialAccountSummary {
  readonly id: SocialAccountId;
  readonly platform: SocialPlatform;
  readonly externalAccountId: string;
  readonly displayName: string | null;
}

export class ListConnectedSocialAccounts {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(): Promise<readonly ConnectedSocialAccountSummary[]> {
    const tenantId = await this.tenant.resolveTenantId();
    const accounts = await this.accounts.listByTenant(tenantId);
    return accounts.map(({ id, platform, externalAccountId, displayName }) => ({
      id,
      platform,
      externalAccountId,
      displayName,
    }));
  }
}
