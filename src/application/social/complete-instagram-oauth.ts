import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialCredentialVault } from '../ports/social-credential-vault.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { InstagramOAuthFlowStateStore, InstagramOAuthProvider } from '../ports/instagram-oauth.port';
import type { ConnectSocialAccount, ConnectedSocialAccount } from './connect-social-account';
import { InstagramOAuthError } from './instagram-oauth-error';

export interface CompleteInstagramOAuthInput {
  readonly state?: string;
  readonly code?: string;
  readonly providerError?: string;
}

export class CompleteInstagramOAuth {
  constructor(
    private readonly states: InstagramOAuthFlowStateStore,
    private readonly provider: InstagramOAuthProvider,
    private readonly pilotTenant: PilotTenantContext,
    private readonly accounts: SocialAccountRepository,
    private readonly connectAccount: ConnectSocialAccount,
    private readonly credentials: SocialCredentialVault,
  ) {}

  async execute(input: CompleteInstagramOAuthInput): Promise<ConnectedSocialAccount> {
    if (!input.state || !this.states.consume(input.state)) {
      throw new InstagramOAuthError('INSTAGRAM_OAUTH_STATE_INVALID');
    }
    if (input.providerError) throw new InstagramOAuthError('INSTAGRAM_OAUTH_DENIED');
    if (!input.code) throw new InstagramOAuthError('INSTAGRAM_OAUTH_CODE_REQUIRED');

    const tenantId = await this.pilotTenant.resolveTenantId();
    const account = await this.provider.completeAuthorization(input.code, tenantId);
    let existing: Awaited<ReturnType<SocialAccountRepository['findByProviderIdentity']>>;
    let connected: ConnectedSocialAccount;
    try {
      existing = await this.accounts.findByProviderIdentity(tenantId, 'instagram', account.externalAccountId);
      connected = await this.connectAccount.execute({
        platform: 'instagram',
        externalAccountId: account.externalAccountId,
        displayName: account.displayName,
        credentialReference: account.credentialReference,
      });
    } catch (error) {
      try {
        await this.credentials.deleteCredentials(tenantId, account.credentialReference, 'instagram');
      } catch {
        throw new InstagramOAuthError('INSTAGRAM_OAUTH_CREDENTIAL_CLEANUP_FAILED');
      }
      throw error;
    }
    if (existing && existing.credentialReference !== account.credentialReference) {
      try {
        await this.credentials.deleteCredentials(tenantId, existing.credentialReference, 'instagram');
      } catch {
        throw new InstagramOAuthError('INSTAGRAM_OAUTH_CREDENTIAL_CLEANUP_FAILED');
      }
    }
    return connected;
  }
}
