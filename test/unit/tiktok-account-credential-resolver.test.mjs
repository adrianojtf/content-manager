import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { TikTokAccountCredentialResolver } = require('../../dist/infrastructure/social/tiktok-account-credential-resolver.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');
const { TikTokBusinessOAuthError } = require('../../dist/application/social/tiktok-business-oauth-error.js');

const account = { tenantId: 'tenant-1', platform: 'tiktok', credentialReference: 'credential-1', externalAccountId: 'business-open-id-1' };

test('TikTok credential resolver reuses a non-expiring access token without refresh', async () => {
  let refreshCalls = 0;
  const credentials = {
    resolveAccessToken: async () => 'current-access-token',
    resolveAccessTokenExpiresAt: async () => '2026-10-14T23:00:00.000Z',
    resolveRefreshToken: async () => 'refresh-token',
    resolveRefreshTokenExpiresAt: async () => '2027-10-14T12:00:00.000Z',
    updateAccessToken: async () => assert.fail('unexpected credential update'),
  };
  const resolver = new TikTokAccountCredentialResolver(credentials, { refreshAccessToken: async () => { refreshCalls += 1; } }, () => Date.parse('2026-10-14T12:00:00.000Z'));

  assert.equal(await resolver.resolveAccessToken(account), 'current-access-token');
  assert.equal(refreshCalls, 0);
});

test('TikTok credential resolver refreshes an expired access token and stores the replacement credentials encrypted', async () => {
  const events = [];
  const credentials = {
    resolveAccessToken: async () => null,
    resolveAccessTokenExpiresAt: async () => '2026-10-14T11:00:00.000Z',
    resolveRefreshToken: async () => 'old-refresh-token',
    resolveRefreshTokenExpiresAt: async () => '2027-10-14T12:00:00.000Z',
    updateAccessToken: async (...args) => events.push(args),
  };
  const refresher = { refreshAccessToken: async (token) => {
    events.push(token);
    return { accessToken: 'new-access-token', refreshToken: 'new-refresh-token', expiresAt: '2026-10-15T12:00:00.000Z', refreshTokenExpiresAt: '2027-10-14T12:00:00.000Z', externalAccountId: account.externalAccountId, grantedScopes: ['video.list', 'comment.list', 'comment.list.manage'] };
  } };
  const resolver = new TikTokAccountCredentialResolver(credentials, refresher, () => Date.parse('2026-10-14T12:00:00.000Z'));

  assert.equal(await resolver.resolveAccessToken(account), 'new-access-token');
  assert.deepEqual(events, [
    'old-refresh-token',
    ['tenant-1', 'credential-1', 'tiktok', 'new-access-token', '2026-10-15T12:00:00.000Z', 'new-refresh-token', ['video.list', 'comment.list', 'comment.list.manage'], '2027-10-14T12:00:00.000Z'],
  ]);
});

test('TikTok credential resolver requires reauthorization when the encrypted refresh token has expired', async () => {
  let refreshCalls = 0;
  const credentials = {
    resolveAccessToken: async () => null,
    resolveAccessTokenExpiresAt: async () => '2026-10-14T11:00:00.000Z',
    resolveRefreshToken: async () => 'expired-refresh-token',
    resolveRefreshTokenExpiresAt: async () => '2026-10-13T12:00:00.000Z',
    updateAccessToken: async () => assert.fail('unexpected credential update'),
  };
  const resolver = new TikTokAccountCredentialResolver(credentials, { refreshAccessToken: async () => { refreshCalls += 1; } }, () => Date.parse('2026-10-14T12:00:00.000Z'));

  await assert.rejects(resolver.resolveAccessToken(account), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
  assert.equal(refreshCalls, 0);
});

test('TikTok credential resolver maps missing or revoked refresh tokens to reauthorization and protects account identity', async () => {
  const credentials = {
    resolveAccessToken: async () => null,
    resolveAccessTokenExpiresAt: async () => '2026-10-14T11:00:00.000Z',
    resolveRefreshToken: async () => 'old-refresh-token',
    resolveRefreshTokenExpiresAt: async () => '2027-10-14T12:00:00.000Z',
    updateAccessToken: async () => assert.fail('unexpected credential update'),
  };
  const noRefresh = new TikTokAccountCredentialResolver({ ...credentials, resolveRefreshToken: async () => null }, { refreshAccessToken: async () => assert.fail('unexpected refresh') });
  await assert.rejects(noRefresh.resolveAccessToken(account), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');

  const revoked = new TikTokAccountCredentialResolver(credentials, { refreshAccessToken: async () => { throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_REFRESH_FAILED'); } });
  await assert.rejects(revoked.resolveAccessToken(account), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');

  const wrongIdentity = new TikTokAccountCredentialResolver(credentials, { refreshAccessToken: async () => ({ accessToken: 'new', refreshToken: 'new-refresh', expiresAt: '2026-10-15T12:00:00.000Z', externalAccountId: 'other-account', grantedScopes: [] }) });
  await assert.rejects(wrongIdentity.resolveAccessToken(account), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED');
});
