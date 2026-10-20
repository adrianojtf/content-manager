import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { FacebookOAuthFlowStateStore, FacebookOAuthProvider, FacebookPageSelection } from '../ports/facebook-oauth.port';
import { FacebookOAuthError } from './facebook-oauth-error';

export interface CompleteFacebookOAuthInput {
  readonly state?: string;
  readonly code?: string;
  readonly providerError?: string;
}

export class CompleteFacebookOAuth {
  constructor(
    private readonly states: FacebookOAuthFlowStateStore,
    private readonly provider: FacebookOAuthProvider,
    private readonly pilotTenant: PilotTenantContext,
  ) {}

  async execute(input: CompleteFacebookOAuthInput): Promise<FacebookPageSelection> {
    if (!input.state || !this.states.consume(input.state)) {
      throw new FacebookOAuthError('FACEBOOK_OAUTH_STATE_INVALID');
    }
    if (input.providerError) throw new FacebookOAuthError('FACEBOOK_OAUTH_DENIED');
    if (!input.code) throw new FacebookOAuthError('FACEBOOK_OAUTH_CODE_REQUIRED');
    return this.provider.beginPageSelection(input.code, await this.pilotTenant.resolveTenantId());
  }
}
