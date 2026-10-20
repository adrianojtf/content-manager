import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AuthenticateOidcRequest } = require('../../dist/application/identity/authenticate-oidc-request.js');
const { AuthenticationError } = require('../../dist/application/identity/authentication-error.js');
const { OidcAuthenticationGuard, TenantMembershipGuard, PlatformAdminGuard } = require('../../dist/presentation/http/guards/oidc-authentication.guard.js');
const { OidcAuthenticationModule, OIDC_ACCESS_TOKEN_VERIFIER, OIDC_IDENTITY_REPOSITORY } = require('../../dist/presentation/http/oidc-authentication.module.js');

const externalIdentity = { issuer: 'https://issuer.example', subject: 'oidc-subject-1' };
const tenantIdentity = {
  userId: 'user-1',
  isActive: true,
  tenantId: 'tenant-1',
  tenantRole: 'OWNER',
  tenantIsActive: true,
  isPlatformAdmin: false,
};

function createAuthenticator(identity) {
  const tokens = [];
  const lookups = [];
  const verifier = {
    verifyAccessToken: async (token) => {
      tokens.push(token);
      return externalIdentity;
    },
  };
  const identities = {
    findByIssuerAndSubject: async (issuer, subject) => {
      lookups.push({ issuer, subject });
      return identity;
    },
  };

  return { authenticate: new AuthenticateOidcRequest(verifier, identities), lookups, tokens };
}

test('authentication maps verified OIDC identity to server-owned tenant context', async () => {
  const { authenticate, lookups, tokens } = createAuthenticator(tenantIdentity);

  const principal = await authenticate.execute('signed-access-token');

  assert.deepEqual(principal, {
    kind: 'tenant-user',
    userId: 'user-1',
    tenantId: 'tenant-1',
    tenantRole: 'OWNER',
  });
  assert.deepEqual(tokens, ['signed-access-token']);
  assert.deepEqual(lookups, [{ issuer: externalIdentity.issuer, subject: externalIdentity.subject }]);
});

test('authentication creates a separate platform-admin principal', async () => {
  const { authenticate } = createAuthenticator({
    userId: 'admin-1',
    isActive: true,
    tenantId: null,
    tenantRole: null,
    tenantIsActive: null,
    isPlatformAdmin: true,
  });

  assert.deepEqual(await authenticate.execute('signed-access-token'), {
    kind: 'platform-admin',
    userId: 'admin-1',
  });
});

test('authentication rejects missing tokens, unknown/inactive identities, and tenantless non-admin users', async () => {
  const unknown = createAuthenticator(null);
  await assert.rejects(unknown.authenticate.execute(undefined), (error) => error.code === 'AUTHENTICATION_REQUIRED');
  assert.deepEqual(unknown.tokens, []);
  await assert.rejects(unknown.authenticate.execute('signed-access-token'), (error) => error.code === 'IDENTITY_NOT_PROVISIONED');

  const inactive = createAuthenticator({ ...tenantIdentity, isActive: false });
  await assert.rejects(inactive.authenticate.execute('signed-access-token'), (error) => error.code === 'IDENTITY_INACTIVE');

  const unassigned = createAuthenticator({ ...tenantIdentity, tenantId: null, tenantRole: null });
  await assert.rejects(unassigned.authenticate.execute('signed-access-token'), (error) => error.code === 'TENANT_MEMBERSHIP_REQUIRED');

  const inactiveTenant = createAuthenticator({ ...tenantIdentity, tenantIsActive: false });
  await assert.rejects(inactiveTenant.authenticate.execute('signed-access-token'), (error) => error.code === 'TENANT_INACTIVE');
});

test('HTTP guard accepts only a Bearer token and stores the resolved principal on the request', async () => {
  const principal = { kind: 'tenant-user', userId: 'user-1', tenantId: 'tenant-1', tenantRole: 'MEMBER' };
  const calls = [];
  const guard = new OidcAuthenticationGuard({ execute: async (token) => { calls.push(token); return principal; } });
  const request = { headers: { authorization: 'Bearer token-value' } };
  const context = { switchToHttp: () => ({ getRequest: () => request }) };

  assert.equal(await guard.canActivate(context), true);
  assert.deepEqual(calls, ['token-value']);
  assert.deepEqual(request.principal, principal);
});

test('HTTP guard rejects missing or malformed Authorization headers without exposing tokens', async () => {
  const guard = new OidcAuthenticationGuard({ execute: async () => { throw new AuthenticationError('ACCESS_TOKEN_INVALID'); } });
  const request = { headers: { authorization: 'Basic secret' } };
  const context = { switchToHttp: () => ({ getRequest: () => request }) };

  await assert.rejects(guard.canActivate(context), (error) => error.getStatus() === 401);
  request.headers.authorization = 'Bearer token with spaces';
  await assert.rejects(guard.canActivate(context), (error) => error.getStatus() === 401);
  request.headers.authorization = 'Bearer token-value';
  await assert.rejects(guard.canActivate(context), (error) => error.getStatus() === 401 && !JSON.stringify(error.getResponse()).includes('token-value'));

  const unavailable = new OidcAuthenticationGuard({ execute: async () => { throw new AuthenticationError('IDENTITY_PROVIDER_UNAVAILABLE'); } });
  await assert.rejects(unavailable.canActivate(context), (error) => error.getStatus() === 503);
});

test('tenant and platform-admin guards enforce separate principals', async () => {
  const contextFor = (principal) => ({ switchToHttp: () => ({ getRequest: () => ({ principal }) }) });
  const tenant = { kind: 'tenant-user', userId: 'user-1', tenantId: 'tenant-1', tenantRole: 'OWNER' };
  const platformAdmin = { kind: 'platform-admin', userId: 'admin-1' };
  const tenantGuard = new TenantMembershipGuard();
  const adminGuard = new PlatformAdminGuard();

  assert.equal(await tenantGuard.canActivate(contextFor(tenant)), true);
  assert.equal(await adminGuard.canActivate(contextFor(platformAdmin)), true);
  assert.throws(() => tenantGuard.canActivate(contextFor(platformAdmin)), (error) => error.getStatus() === 403);
  assert.throws(() => adminGuard.canActivate(contextFor(tenant)), (error) => error.getStatus() === 403);
});

test('OIDC module binds the verifier, identity repository, and HTTP guards', () => {
  const dynamicModule = OidcAuthenticationModule.register({
    verifierConfig: {
      issuer: 'https://issuer.example',
      audience: 'content-manager-api',
      jwksUri: 'https://issuer.example/.well-known/jwks.json',
      allowedAlgorithms: ['RS256'],
    },
    identities: { findByIssuerAndSubject: async () => null },
  });
  const providerTokens = dynamicModule.providers.map((provider) => typeof provider === 'function' ? provider : provider.provide);

  assert.equal(dynamicModule.module, OidcAuthenticationModule);
  assert.ok(providerTokens.includes(OIDC_ACCESS_TOKEN_VERIFIER));
  assert.ok(providerTokens.includes(OIDC_IDENTITY_REPOSITORY));
  assert.ok(providerTokens.includes(OidcAuthenticationGuard));
  assert.ok(providerTokens.includes(TenantMembershipGuard));
  assert.ok(providerTokens.includes(PlatformAdminGuard));
  assert.ok(dynamicModule.exports.includes(OidcAuthenticationGuard));
});
