export const FACEBOOK_PAGE_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
] as const;

export interface FacebookOAuthFlowStateStore {
  issue(): { readonly state: string };
  consume(state: string): boolean;
}

export interface FacebookPageCandidate {
  readonly externalAccountId: string;
  readonly displayName: string | null;
}

export interface FacebookPageSelection {
  readonly selectionId: string;
  readonly pages: readonly FacebookPageCandidate[];
}

export interface FacebookAuthorizedPage extends FacebookPageCandidate {
  readonly credentialReference: string;
}

export interface FacebookOAuthProvider {
  buildAuthorizationUrl(state: string): Promise<string>;
  beginPageSelection(code: string, tenantId: string): Promise<FacebookPageSelection>;
  selectPage(selectionId: string, pageId: string, tenantId: string): Promise<FacebookAuthorizedPage>;
}
