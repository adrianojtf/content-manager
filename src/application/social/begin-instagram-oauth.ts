import type { InstagramOAuthFlowStateStore, InstagramOAuthProvider } from '../ports/instagram-oauth.port';

export interface BeginInstagramOAuthResult {
  readonly authorizationUrl: string;
}

export class BeginInstagramOAuth {
  constructor(
    private readonly states: InstagramOAuthFlowStateStore,
    private readonly provider: InstagramOAuthProvider,
  ) {}

  async execute(): Promise<BeginInstagramOAuthResult> {
    const flow = this.states.issue();
    try {
      return { authorizationUrl: await this.provider.buildAuthorizationUrl(flow.state) };
    } catch (error) {
      this.states.consume(flow.state);
      throw error;
    }
  }
}
