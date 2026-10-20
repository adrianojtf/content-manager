import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialCredentialVault } from '../ports/social-credential-vault.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { FacebookOAuthProvider } from '../ports/facebook-oauth.port';
import type { ConnectSocialAccount, ConnectedSocialAccount } from './connect-social-account';
import { FacebookOAuthError } from './facebook-oauth-error';

export interface SelectFacebookPageInput {
  readonly selectionId: string;
  readonly pageId: string;
}

export class SelectFacebookPage {
  constructor(
    private readonly provider: FacebookOAuthProvider,
    private readonly pilotTenant: PilotTenantContext,
    private readonly accounts: SocialAccountRepository,
    private readonly connectAccount: ConnectSocialAccount,
    private readonly credentials: SocialCredentialVault,
  ) {}

  async execute(input: SelectFacebookPageInput): Promise<ConnectedSocialAccount> {
    const tenantId = await this.pilotTenant.resolveTenantId();
    const page = await this.provider.selectPage(input.selectionId, input.pageId, tenantId);
    let existing: Awaited<ReturnType<SocialAccountRepository['findByProviderIdentity']>>;
    let connected: ConnectedSocialAccount;
    try {
      existing = await this.accounts.findByProviderIdentity(tenantId, 'facebook', page.externalAccountId);
      connected = await this.connectAccount.execute({
        platform: 'facebook',
        externalAccountId: page.externalAccountId,
        displayName: page.displayName,
        credentialReference: page.credentialReference,
      });
    } catch (error) {
      try {
        await this.credentials.deleteCredentials(tenantId, page.credentialReference, 'facebook');
      } catch {
        throw new FacebookOAuthError('FACEBOOK_OAUTH_CREDENTIAL_CLEANUP_FAILED');
      }
      throw error;
    }
    if (existing && existing.credentialReference !== page.credentialReference) {
      try {
        await this.credentials.deleteCredentials(tenantId, existing.credentialReference, 'facebook');
      } catch {
        throw new FacebookOAuthError('FACEBOOK_OAUTH_CREDENTIAL_CLEANUP_FAILED');
      }
    }
    return connected;
  }
}
