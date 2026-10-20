import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialCredentialVault } from '../ports/social-credential-vault.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { YouTubeOAuthFlowStateStore, YouTubeOAuthProvider } from '../ports/youtube-oauth.port';
import type { ConnectSocialAccount, ConnectedSocialAccount } from './connect-social-account';
import { YouTubeOAuthError } from './youtube-oauth-error';

export interface CompleteYouTubeOAuthInput {
  readonly state?: string;
  readonly code?: string;
  readonly providerError?: string;
}

export class CompleteYouTubeOAuth {
  constructor(
    private readonly states: YouTubeOAuthFlowStateStore,
    private readonly provider: YouTubeOAuthProvider,
    private readonly pilotTenant: PilotTenantContext,
    private readonly accounts: SocialAccountRepository,
    private readonly connectAccount: ConnectSocialAccount,
    private readonly credentials: SocialCredentialVault,
  ) {}

  async execute(input: CompleteYouTubeOAuthInput): Promise<ConnectedSocialAccount> {
    const flow = input.state ? this.states.consume(input.state) : null;
    if (!flow) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_STATE_INVALID');
    }
    if (input.providerError) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_DENIED');
    }
    if (!input.code) {
      throw new YouTubeOAuthError('YOUTUBE_OAUTH_CODE_REQUIRED');
    }

    const tenantId = await this.pilotTenant.resolveTenantId();
    const account = await this.provider.completeAuthorization(input.code, flow.codeVerifier, flow.scopes, tenantId);
    let existing: Awaited<ReturnType<SocialAccountRepository['findByProviderIdentity']>>;
    let connected: ConnectedSocialAccount;
    try {
      existing = await this.accounts.findByProviderIdentity(tenantId, 'youtube', account.externalAccountId);
      connected = await this.connectAccount.execute({
        platform: 'youtube',
        externalAccountId: account.externalAccountId,
        displayName: account.displayName,
        credentialReference: account.credentialReference,
      });
    } catch (error) {
      try {
        await this.credentials.deleteCredentials(tenantId, account.credentialReference, 'youtube');
      } catch {
        throw new YouTubeOAuthError('YOUTUBE_OAUTH_CREDENTIAL_CLEANUP_FAILED');
      }
      throw error;
    }
    if (existing && existing.credentialReference !== account.credentialReference) {
      try {
        await this.credentials.deleteCredentials(tenantId, existing.credentialReference, 'youtube');
      } catch {
        throw new YouTubeOAuthError('YOUTUBE_OAUTH_CREDENTIAL_CLEANUP_FAILED');
      }
    }
    return connected;
  }
}
