export interface OidcIdentity {
  readonly issuer: string;
  readonly subject: string;
}

export interface OidcAccessTokenVerifier {
  verifyAccessToken(token: string): Promise<OidcIdentity>;
}
