import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialAccountDisconnector } from '../ports/social-account-disconnector.port';
import { parseSocialAccountId } from '../../domain/social/social-account-id';

export class SocialAccountDisconnectError extends Error {
  constructor(readonly code: 'SOCIAL_ACCOUNT_NOT_FOUND') {
    super(code);
    this.name = 'SocialAccountDisconnectError';
  }
}

export class DisconnectSocialAccount {
  constructor(
    private readonly disconnector: SocialAccountDisconnector,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(accountId: string): Promise<void> {
    const validAccountId = parseSocialAccountId(accountId);
    const tenantId = await this.tenant.resolveTenantId();
    const disconnected = await this.disconnector.disconnect(tenantId, validAccountId);
    if (!disconnected) {
      throw new SocialAccountDisconnectError('SOCIAL_ACCOUNT_NOT_FOUND');
    }
  }
}
