import type { JoseOidcAccessTokenVerifierConfig } from './jose-oidc-access-token-verifier';

export type OidcEnvironment = Readonly<Record<string, string | undefined>>;

export function oidcVerifierConfigFromEnvironment(environment: OidcEnvironment = process.env): JoseOidcAccessTokenVerifierConfig {
  return {
    issuer: requiredValue(environment, 'OIDC_ISSUER'),
    audience: requiredValue(environment, 'OIDC_AUDIENCE'),
    jwksUri: requiredValue(environment, 'OIDC_JWKS_URI'),
    allowedAlgorithms: ['RS256'],
  };
}

function requiredValue(environment: OidcEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required OIDC setting: ${name}`);
  }
  return value;
}
