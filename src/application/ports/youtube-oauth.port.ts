export const YOUTUBE_READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_REPLY_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

export type YouTubeOAuthScope = typeof YOUTUBE_READ_SCOPE | typeof YOUTUBE_REPLY_SCOPE;

export interface YouTubeOAuthFlow {
  readonly state: string;
  readonly codeVerifier: string;
  readonly scopes: readonly YouTubeOAuthScope[];
}

export interface ConsumedYouTubeOAuthFlow {
  readonly codeVerifier: string;
  readonly scopes: readonly YouTubeOAuthScope[];
}

export interface YouTubeOAuthFlowStateStore {
  issue(scopes: readonly YouTubeOAuthScope[]): YouTubeOAuthFlow;
  consume(state: string): ConsumedYouTubeOAuthFlow | null;
}

export interface YouTubeAuthorizedAccount {
  readonly externalAccountId: string;
  readonly displayName: string | null;
  readonly credentialReference: string;
}

export interface YouTubeOAuthProvider {
  buildAuthorizationUrl(state: string, codeVerifier: string, scopes: readonly YouTubeOAuthScope[]): Promise<string>;
  completeAuthorization(code: string, codeVerifier: string, scopes: readonly YouTubeOAuthScope[], tenantId: string): Promise<YouTubeAuthorizedAccount>;
}
