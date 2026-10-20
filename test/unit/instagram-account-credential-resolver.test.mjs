import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { InstagramAccountCredentialResolver } = require('../../dist/infrastructure/social/instagram-account-credential-resolver.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');
const { InstagramOAuthError } = require('../../dist/application/social/instagram-oauth-error.js');

const account = { tenantId: 'tenant-1', platform: 'instagram', credentialReference: 'credential-1' };

test('Instagram credential resolver refreshes a token near expiry and updates the encrypted vault', async () => {
  const events = [];
  const credentials = {
    resolveAccessToken: async () => 'current-token',
    resolveAccessTokenExpiresAt: async () => '2026-10-16T11:59:59.000Z',
    updateAccessToken: async (...args) => events.push(args),
  };
  const refresher = { refreshAccessToken: async (token) => { events.push(token); return { accessToken: 'refreshed-token', expiresAt: '2026-12-13T12:00:00.000Z' }; } };
  const resolver = new InstagramAccountCredentialResolver(credentials, refresher, () => Date.parse('2026-10-14T12:00:00.000Z'));

  assert.equal(await resolver.resolveAccessToken(account), 'refreshed-token');
  assert.deepEqual(events, ['current-token', ['tenant-1', 'credential-1', 'instagram', 'refreshed-token', '2026-12-13T12:00:00.000Z']]);
});

test('Instagram credential resolver does not refresh a token with sufficient remaining lifetime', async () => {
  let refreshCalls = 0;
  const credentials = {
    resolveAccessToken: async () => 'current-token',
    resolveAccessTokenExpiresAt: async () => '2026-11-20T12:00:00.000Z',
    updateAccessToken: async () => assert.fail('unexpected token update'),
  };
  const resolver = new InstagramAccountCredentialResolver(credentials, { refreshAccessToken: async () => { refreshCalls += 1; } }, () => Date.parse('2026-10-14T12:00:00.000Z'));

  assert.equal(await resolver.resolveAccessToken(account), 'current-token');
  assert.equal(refreshCalls, 0);
});

test('Instagram credential resolver maps expired/revoked tokens to reauthorization and rejects other platforms', async () => {
  const credentials = {
    resolveAccessToken: async () => null,
    resolveAccessTokenExpiresAt: async () => '2026-10-13T12:00:00.000Z',
    updateAccessToken: async () => {},
  };
  const resolver = new InstagramAccountCredentialResolver(credentials, { refreshAccessToken: async () => { throw new InstagramOAuthError('INSTAGRAM_OAUTH_TOKEN_REFRESH_FAILED'); } });

  await assert.rejects(resolver.resolveAccessToken(account), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
  await assert.rejects(resolver.resolveAccessToken({ ...account, platform: 'facebook' }), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
});
