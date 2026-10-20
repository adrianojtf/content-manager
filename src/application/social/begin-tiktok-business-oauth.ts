import type { TikTokBusinessOAuthFlowStateStore, TikTokBusinessOAuthProvider } from '../ports/tiktok-business-oauth.port';

export interface BeginTikTokBusinessOAuthResult {
  readonly authorizationUrl: string;
}

export class BeginTikTokBusinessOAuth {
  constructor(
    private readonly states: TikTokBusinessOAuthFlowStateStore,
    private readonly provider: TikTokBusinessOAuthProvider,
  ) {}

  async execute(): Promise<BeginTikTokBusinessOAuthResult> {
    const flow = this.states.issue();
    try {
      return { authorizationUrl: await this.provider.buildAuthorizationUrl(flow.state) };
    } catch (error) {
      this.states.consume(flow.state);
      throw error;
    }
  }
}
