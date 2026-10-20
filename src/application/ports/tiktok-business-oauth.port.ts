export const TIKTOK_BUSINESS_VIDEO_SCOPE = 'video.list';
export const TIKTOK_BUSINESS_COMMENT_READ_SCOPE = 'comment.list';
export const TIKTOK_BUSINESS_COMMENT_MANAGE_SCOPE = 'comment.list.manage';
export const TIKTOK_BUSINESS_REQUIRED_SCOPES = [
  TIKTOK_BUSINESS_VIDEO_SCOPE,
  TIKTOK_BUSINESS_COMMENT_READ_SCOPE,
  TIKTOK_BUSINESS_COMMENT_MANAGE_SCOPE,
] as const;

export interface TikTokBusinessOAuthFlowStateStore {
  issue(): { readonly state: string };
  consume(state: string): boolean;
}

export interface TikTokBusinessAuthorizedAccount {
  readonly externalAccountId: string;
  readonly displayName: string | null;
  readonly credentialReference: string;
}

export interface RefreshedTikTokBusinessAccessToken {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
  readonly refreshTokenExpiresAt: string;
  readonly externalAccountId: string;
  readonly grantedScopes: readonly string[];
}

export interface TikTokBusinessOAuthProvider {
  buildAuthorizationUrl(state: string): Promise<string>;
  completeAuthorization(authCode: string, tenantId: string): Promise<TikTokBusinessAuthorizedAccount>;
  refreshAccessToken(refreshToken: string): Promise<RefreshedTikTokBusinessAccessToken>;
}
