import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { oidcVerifierConfigFromEnvironment } = require('../../dist/infrastructure/identity/oidc-verifier-config.js');
const {
  OIDC_ACCESS_TOKEN_VERIFIER,
  OIDC_IDENTITY_REPOSITORY,
  OidcAuthenticationModule,
} = require('../../dist/presentation/http/oidc-authentication.module.js');

const environment = {
  OIDC_ISSUER: 'https://tenant.auth0.example/',
  OIDC_AUDIENCE: 'https://api.example.test',
  OIDC_JWKS_URI: 'https://tenant.auth0.example/.well-known/jwks.json',
};

test('OIDC environment configuration maps Auth0 metadata and restricts signing to RS256', () => {
  assert.deepEqual(oidcVerifierConfigFromEnvironment(environment), {
    issuer: environment.OIDC_ISSUER,
    audience: environment.OIDC_AUDIENCE,
    jwksUri: environment.OIDC_JWKS_URI,
    allowedAlgorithms: ['RS256'],
  });
});

test('OIDC environment configuration requires issuer, audience, and JWKS metadata', () => {
  for (const key of Object.keys(environment)) {
    const incomplete = { ...environment };
    delete incomplete[key];
    assert.throws(() => oidcVerifierConfigFromEnvironment(incomplete), new RegExp(key));
  }
});

test('Nest OIDC module can be composed from runtime configuration and an identity repository', () => {
  const identities = { findByIssuerAndSubject: async () => null };
  const module = OidcAuthenticationModule.registerFromEnvironment(identities, environment);
  const providerTokens = module.providers.map((provider) => typeof provider === 'function' ? provider : provider.provide);

  assert.equal(module.module, OidcAuthenticationModule);
  assert.ok(providerTokens.includes(OIDC_ACCESS_TOKEN_VERIFIER));
  assert.ok(providerTokens.includes(OIDC_IDENTITY_REPOSITORY));
});
