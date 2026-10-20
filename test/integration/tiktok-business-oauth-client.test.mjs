import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { TikTokBusinessOAuthClient } = require('../../dist/infrastructure/social/tiktok-business-oauth-client.js');
const { TikTokBusinessOAuthError } = require('../../dist/application/social/tiktok-business-oauth-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const scopes = ['video.list', 'comment.list', 'comment.list.manage'];
const authorizationUrl = 'https://www.tiktok.com/business-account-authorize/?app_id=test-app&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fsocial%2Fconnections%2Ftiktok%2Fcallback&scope=video.list%2Ccomment.list%2Ccomment.list.manage';
const environment = {
  TIKTOK_BUSINESS_CLIENT_ID: 'test-client-id',
  TIKTOK_BUSINESS_CLIENT_SECRET: 'test-client-secret',
  TIKTOK_BUSINESS_REDIRECT_URI: 'http://localhost:3000/social/connections/tiktok/callback',
  TIKTOK_BUSINESS_AUTHORIZATION_URL: authorizationUrl,
};

function createClient(responses, env = environment, now = () => Date.parse('2026-10-14T12:00:00.000Z')) {
  const requests = [];
  const credentials = {
    storeCredentials: async (input) => { requests.push({ stored: input }); return 'tiktok-vault-reference'; },
  };
  const fetcher = async (url, options = {}) => {
    requests.push({ url: new URL(url), options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { client: new TikTokBusinessOAuthClient(credentials, env, fetcher, now), requests };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function tokenResponse(overrides = {}) {
  return jsonResponse({
    code: 0,
    message: 'OK',
    data: {
      open_id: 'business-open-id-1',
      access_token: 'tiktok-access-token-secret',
      expires_in: 86400,
      refresh_token: 'tiktok-refresh-token-secret',
      refresh_token_expires_in: 31536000,
      scope: scopes.join(','),
      token_type: 'Bearer',
      ...overrides,
    },
  });
}

test('TikTok Business authorization uses the app-generated URL and binds a one-time state', async () => {
  const { client } = createClient([]);
  const url = new URL(await client.buildAuthorizationUrl('csrf-state-value'));

  assert.equal(url.origin, 'https://www.tiktok.com');
  assert.equal(url.searchParams.get('app_id'), 'test-app');
  assert.equal(url.searchParams.get('redirect_uri'), environment.TIKTOK_BUSINESS_REDIRECT_URI);
  assert.equal(url.searchParams.get('scope'), scopes.join(','));
  assert.equal(url.searchParams.get('state'), 'csrf-state-value');
  assert.equal(url.searchParams.has('code_challenge'), false);
});

test('TikTok Business code exchange preserves open_id and stores access/refresh tokens plus granted scopes only in the encrypted vault', async () => {
  const { client, requests } = createClient([tokenResponse()]);

  const account = await client.completeAuthorization('one-time-auth-code', tenantId);

  assert.deepEqual(account, { externalAccountId: 'business-open-id-1', displayName: null, credentialReference: 'tiktok-vault-reference' });
  assert.equal(requests[0].url.origin, 'https://business-api.tiktok.com');
  assert.equal(requests[0].url.pathname, '/open_api/v1.3/tt_user/oauth2/token/');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
    grant_type: 'authorization_code',
    auth_code: 'one-time-auth-code',
    redirect_uri: environment.TIKTOK_BUSINESS_REDIRECT_URI,
  });
  assert.deepEqual(requests[1].stored, {
    tenantId,
    platform: 'tiktok',
    accessToken: 'tiktok-access-token-secret',
    refreshToken: 'tiktok-refresh-token-secret',
    grantedScopes: scopes,
    expiresAt: '2026-10-15T12:00:00.000Z',
    refreshTokenExpiresAt: '2027-10-14T12:00:00.000Z',
  });
  assert.equal(JSON.stringify(account).includes('tiktok-access-token-secret'), false);
  assert.equal(JSON.stringify(account).includes('tiktok-refresh-token-secret'), false);
});

test('TikTok Business rejects missing scopes and invalid account identity before vault storage', async () => {
  const missingScopes = createClient([tokenResponse({ scope: 'video.list,comment.list' })]);
  await assert.rejects(missingScopes.client.completeAuthorization('code', tenantId), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_SCOPE_MISSING');
  assert.equal(missingScopes.requests.some((request) => request.stored), false);

  const invalidIdentity = createClient([tokenResponse({ open_id: '' })]);
  await assert.rejects(invalidIdentity.client.completeAuthorization('code', tenantId), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_ACCOUNT_INVALID');
  assert.equal(invalidIdentity.requests.some((request) => request.stored), false);
});

test('TikTok Business refresh uses the account-token endpoint, validates grants, and returns refresh-token rotation', async () => {
  const { client, requests } = createClient([tokenResponse({
    access_token: 'rotated-access-token',
    refresh_token: 'rotated-refresh-token',
    expires_in: 86400,
    refresh_token_expires_in: 31536000,
  })]);

  const refreshed = await client.refreshAccessToken('previous-refresh-token');

  assert.deepEqual(refreshed, {
    accessToken: 'rotated-access-token',
    refreshToken: 'rotated-refresh-token',
    expiresAt: '2026-10-15T12:00:00.000Z',
    refreshTokenExpiresAt: '2027-10-14T12:00:00.000Z',
    externalAccountId: 'business-open-id-1',
    grantedScopes: scopes,
  });
  assert.equal(requests[0].url.pathname, '/open_api/v1.3/tt_user/oauth2/refresh_token/');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
    grant_type: 'refresh_token',
    refresh_token: 'previous-refresh-token',
  });
  assert.equal(JSON.stringify(refreshed).includes('previous-refresh-token'), false);
});

test('TikTok Business refresh needs runtime client credentials but not the authorization URL or redirect URI', async () => {
  const refreshConfig = { TIKTOK_BUSINESS_CLIENT_ID: 'test-client-id', TIKTOK_BUSINESS_CLIENT_SECRET: 'test-client-secret' };
  const { client } = createClient([tokenResponse()], refreshConfig);

  const refreshed = await client.refreshAccessToken('previous-refresh-token');

  assert.equal(refreshed.accessToken, 'tiktok-access-token-secret');
});

test('TikTok Business OAuth config is lazy and rejects missing app URL/credentials or insecure URLs', async () => {
  const missing = createClient([], {});
  await assert.rejects(missing.client.buildAuthorizationUrl('state'), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_CONFIGURATION_REQUIRED');
  const missingSecret = createClient([], { ...environment, TIKTOK_BUSINESS_CLIENT_SECRET: '' });
  await assert.rejects(missingSecret.client.completeAuthorization('code', tenantId), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_CONFIGURATION_REQUIRED');
  const invalid = createClient([], { ...environment, TIKTOK_BUSINESS_AUTHORIZATION_URL: 'http://example.test/authorize' });
  await assert.rejects(invalid.client.buildAuthorizationUrl('state'), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_CONFIGURATION_INVALID');
  const secretInUrl = createClient([], { ...environment, TIKTOK_BUSINESS_AUTHORIZATION_URL: 'https://www.tiktok.com/authorize?client_secret=do-not-expose' });
  await assert.rejects(secretInUrl.client.buildAuthorizationUrl('state'), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_CONFIGURATION_INVALID');
});

test('TikTok Business OAuth hides provider error bodies and access tokens', async () => {
  const failed = createClient([jsonResponse({ code: 40101, message: 'private provider body', data: { access_token: 'do-not-leak' } }, 401)]);
  await assert.rejects(failed.client.completeAuthorization('code', tenantId), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_TOKEN_EXCHANGE_FAILED' && !error.message.includes('private provider body') && !error.message.includes('do-not-leak'));
});
