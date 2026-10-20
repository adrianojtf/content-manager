import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { AuthenticationError } from '../../application/identity/authentication-error';
import type { OidcAccessTokenVerifier, OidcIdentity } from '../../application/ports/oidc-access-token-verifier.port';

export type OidcSigningAlgorithm = 'RS256' | 'PS256' | 'ES256';

export interface JoseOidcAccessTokenVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  readonly allowedAlgorithms: readonly OidcSigningAlgorithm[];
  readonly allowInsecureLocalhost?: boolean;
}

const supportedAlgorithms = new Set<OidcSigningAlgorithm>(['RS256', 'PS256', 'ES256']);
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export class JoseOidcAccessTokenVerifier implements OidcAccessTokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: JoseOidcAccessTokenVerifierConfig) {
    const issuer = new URL(config.issuer);
    const jwksUri = new URL(config.jwksUri);
    if (!config.audience || config.allowedAlgorithms.length === 0 || config.allowedAlgorithms.some((algorithm) => !supportedAlgorithms.has(algorithm))) {
      throw new Error('Invalid OIDC verifier configuration');
    }
    if (!this.isSecureEndpoint(issuer, config.allowInsecureLocalhost) || !this.isSecureEndpoint(jwksUri, config.allowInsecureLocalhost)) {
      throw new Error('OIDC issuer and JWKS endpoints must use HTTPS');
    }
    this.jwks = createRemoteJWKSet(jwksUri);
  }

  async verifyAccessToken(token: string): Promise<OidcIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: [...this.config.allowedAlgorithms],
        requiredClaims: ['exp', 'sub'],
      });
      if (typeof payload.iss !== 'string' || typeof payload.sub !== 'string' || !payload.sub) {
        throw new AuthenticationError('ACCESS_TOKEN_INVALID');
      }
      return { issuer: payload.iss, subject: payload.sub };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      if (error instanceof errors.JOSEError) {
        throw new AuthenticationError('ACCESS_TOKEN_INVALID');
      }
      throw new AuthenticationError('IDENTITY_PROVIDER_UNAVAILABLE');
    }
  }

  private isSecureEndpoint(endpoint: URL, allowInsecureLocalhost = false): boolean {
    return endpoint.protocol === 'https:' || (allowInsecureLocalhost && endpoint.protocol === 'http:' && localHosts.has(endpoint.hostname));
  }
}
