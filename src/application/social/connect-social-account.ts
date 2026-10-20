import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialAccountIdGenerator } from '../ports/social-account-id-generator.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import { SocialAccount, type SocialPlatform } from '../../domain/social/social-account';

export interface ConnectSocialAccountInput {
  readonly platform: SocialPlatform;
  readonly externalAccountId: string;
  readonly displayName: string | null;
  readonly credentialReference: string;
}

export interface ConnectedSocialAccount {
  readonly id: string;
  readonly platform: SocialPlatform;
  readonly externalAccountId: string;
  readonly displayName: string | null;
}

export class ConnectSocialAccount {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly pilotTenant: PilotTenantContext,
    private readonly ids: SocialAccountIdGenerator,
  ) {}

  async execute(input: ConnectSocialAccountInput): Promise<ConnectedSocialAccount> {
    const tenantId = await this.pilotTenant.resolveTenantId();
    const existing = await this.accounts.findByProviderIdentity(tenantId, input.platform, input.externalAccountId);
    const account = SocialAccount.create({
      id: existing?.id ?? this.ids.generate(),
      tenantId,
      platform: input.platform,
      externalAccountId: input.externalAccountId,
      displayName: input.displayName,
      credentialReference: input.credentialReference,
    });
    await this.accounts.save(tenantId, account);

    return {
      id: account.id,
      platform: account.platform,
      externalAccountId: account.externalAccountId,
      displayName: account.displayName,
    };
  }
}
