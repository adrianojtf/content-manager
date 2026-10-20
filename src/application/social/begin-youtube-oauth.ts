import type { YouTubeOAuthFlowStateStore, YouTubeOAuthProvider, YouTubeOAuthScope } from '../ports/youtube-oauth.port';
import { YOUTUBE_READ_SCOPE, YOUTUBE_REPLY_SCOPE } from '../ports/youtube-oauth.port';

export interface BeginYouTubeOAuthInput {
  readonly enableReplies?: boolean;
}

export interface BeginYouTubeOAuthResult {
  readonly authorizationUrl: string;
}

export class BeginYouTubeOAuth {
  constructor(
    private readonly states: YouTubeOAuthFlowStateStore,
    private readonly provider: YouTubeOAuthProvider,
  ) {}

  async execute(input: BeginYouTubeOAuthInput = {}): Promise<BeginYouTubeOAuthResult> {
    const scopes: readonly YouTubeOAuthScope[] = input.enableReplies ? [YOUTUBE_REPLY_SCOPE] : [YOUTUBE_READ_SCOPE];
    const flow = this.states.issue(scopes);
    try {
      return { authorizationUrl: await this.provider.buildAuthorizationUrl(flow.state, flow.codeVerifier, flow.scopes) };
    } catch (error) {
      this.states.consume(flow.state);
      throw error;
    }
  }
}
