import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialCredentialVault } from '../ports/social-credential-vault.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { TikTokBusinessOAuthFlowStateStore, TikTokBusinessOAuthProvider } from '../ports/tiktok-business-oauth.port';
import type { ConnectSocialAccount, ConnectedSocialAccount } from './connect-social-account';
import { TikTokBusinessOAuthError } from './tiktok-business-oauth-error';

export interface CompleteTikTokBusinessOAuthInput {
  readonly state?: string;
  readonly authCode?: string;
  readonly providerError?: string;
}

export class CompleteTikTokBusinessOAuth {
  constructor(
    private readonly states: TikTokBusinessOAuthFlowStateStore,
    private readonly provider: TikTokBusinessOAuthProvider,
    private readonly pilotTenant: PilotTenantContext,
    private readonly accounts: SocialAccountRepository,
    private readonly connectAccount: ConnectSocialAccount,
    private readonly credentials: SocialCredentialVault,
  ) {}

  async execute(input: CompleteTikTokBusinessOAuthInput): Promise<ConnectedSocialAccount> {
    if (!input.state || !this.states.consume(input.state)) {
      throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_STATE_INVALID');
    }
    if (input.providerError) throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_DENIED');
    if (!input.authCode) throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_CODE_REQUIRED');

    const tenantId = await this.pilotTenant.resolveTenantId();
    const account = await this.provider.completeAuthorization(input.authCode, tenantId);
    let existing: Awaited<ReturnType<SocialAccountRepository['findByProviderIdentity']>>;
    let connected: ConnectedSocialAccount;
    try {
      existing = await this.accounts.findByProviderIdentity(tenantId, 'tiktok', account.externalAccountId);
      connected = await this.connectAccount.execute({
        platform: 'tiktok',
        externalAccountId: account.externalAccountId,
        displayName: account.displayName,
        credentialReference: account.credentialReference,
      });
    } catch (error) {
      try {
        await this.credentials.deleteCredentials(tenantId, account.credentialReference, 'tiktok');
      } catch {
        throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_CREDENTIAL_CLEANUP_FAILED');
      }
      throw error;
    }
    if (existing && existing.credentialReference !== account.credentialReference) {
      try {
        await this.credentials.deleteCredentials(tenantId, existing.credentialReference, 'tiktok');
      } catch {
        throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_CREDENTIAL_CLEANUP_FAILED');
      }
    }
    return connected;
  }
}
