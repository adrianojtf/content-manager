import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { YouTubeAccountCredentialResolver } = require('../../dist/infrastructure/social/youtube-account-credential-resolver.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');
const { YouTubeOAuthError } = require('../../dist/application/social/youtube-oauth-error.js');

const account = { tenantId: '30000000-0000-4000-8000-000000000001', platform: 'youtube', credentialReference: 'credential-reference' };

function createResolver({ accessToken = 'valid-token', refreshToken = 'refresh-token', refreshResult = { accessToken: 'refreshed-token', expiresAt: '2099-01-01T00:00:00.000Z' }, refreshError = null } = {}) {
  const calls = [];
  const credentials = {
    resolveAccessToken: async (...args) => { calls.push({ operation: 'resolveAccess', args }); return accessToken; },
    resolveRefreshToken: async (...args) => { calls.push({ operation: 'resolveRefresh', args }); return refreshToken; },
    updateAccessToken: async (...args) => { calls.push({ operation: 'update', args }); },
    hasScopes: async (...args) => { calls.push({ operation: 'scopes', args }); return true; },
  };
  const refresher = {
    refreshAccessToken: async (token) => {
      calls.push({ operation: 'refresh', token });
      if (refreshError) throw refreshError;
      return refreshResult;
    },
  };
  return { resolver: new YouTubeAccountCredentialResolver(credentials, refresher), calls };
}

test('YouTube credential resolver reuses a valid access token without refresh', async () => {
  const { resolver, calls } = createResolver();

  assert.equal(await resolver.resolveAccessToken(account), 'valid-token');
  assert.deepEqual(calls.map((call) => call.operation), ['resolveAccess']);
});

test('YouTube credential resolver refreshes expired tokens and saves the replacement encrypted', async () => {
  const { resolver, calls } = createResolver({ accessToken: null });

  assert.equal(await resolver.resolveAccessToken(account), 'refreshed-token');
  assert.deepEqual(calls.map((call) => call.operation), ['resolveAccess', 'resolveRefresh', 'refresh', 'update']);
  assert.deepEqual(calls.at(-1).args, [account.tenantId, account.credentialReference, 'youtube', 'refreshed-token', '2099-01-01T00:00:00.000Z']);
});

test('YouTube credential resolver requires refresh credentials when the access token is unavailable', async () => {
  const { resolver } = createResolver({ accessToken: null, refreshToken: null });

  await assert.rejects(resolver.resolveAccessToken(account), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_CREDENTIAL_UNAVAILABLE');
});

test('YouTube credential resolver maps revoked refresh tokens to reauthorization-required', async () => {
  const { resolver } = createResolver({ accessToken: null, refreshError: new YouTubeOAuthError('YOUTUBE_OAUTH_TOKEN_EXCHANGE_FAILED') });

  await assert.rejects(resolver.resolveAccessToken(account), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
});

test('YouTube credential resolver checks tenant-scoped granted scopes', async () => {
  const { resolver, calls } = createResolver();

  assert.equal(await resolver.hasScopes(account, ['youtube.force-ssl']), true);
  assert.deepEqual(calls, [{ operation: 'scopes', args: [account.tenantId, account.credentialReference, 'youtube', ['youtube.force-ssl']] }]);
});
