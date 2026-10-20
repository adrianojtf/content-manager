export const INSTAGRAM_READ_SCOPE = 'instagram_business_basic';
export const INSTAGRAM_COMMENT_SCOPE = 'instagram_business_manage_comments';
export const INSTAGRAM_OAUTH_SCOPES = [INSTAGRAM_READ_SCOPE, INSTAGRAM_COMMENT_SCOPE] as const;
export type InstagramOAuthScope = typeof INSTAGRAM_OAUTH_SCOPES[number];

export interface InstagramOAuthFlowStateStore {
  issue(): { readonly state: string };
  consume(state: string): boolean;
}

export interface InstagramAuthorizedAccount {
  readonly externalAccountId: string;
  readonly displayName: string | null;
  readonly credentialReference: string;
}

export interface RefreshedInstagramAccessToken {
  readonly accessToken: string;
  readonly expiresAt: string;
}

export interface InstagramOAuthProvider {
  buildAuthorizationUrl(state: string): Promise<string>;
  completeAuthorization(code: string, tenantId: string): Promise<InstagramAuthorizedAccount>;
}

export interface InstagramAccessTokenRefresher {
  refreshAccessToken(accessToken: string): Promise<RefreshedInstagramAccessToken>;
}
