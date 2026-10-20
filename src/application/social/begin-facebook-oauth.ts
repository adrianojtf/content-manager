import type { FacebookOAuthFlowStateStore, FacebookOAuthProvider } from '../ports/facebook-oauth.port';

export interface BeginFacebookOAuthResult {
  readonly authorizationUrl: string;
}

export class BeginFacebookOAuth {
  constructor(
    private readonly states: FacebookOAuthFlowStateStore,
    private readonly provider: FacebookOAuthProvider,
  ) {}

  async execute(): Promise<BeginFacebookOAuthResult> {
    const flow = this.states.issue();
    try {
      return { authorizationUrl: await this.provider.buildAuthorizationUrl(flow.state) };
    } catch (error) {
      this.states.consume(flow.state);
      throw error;
    }
  }
}
