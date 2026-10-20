import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { FacebookOAuthClient } = require('../../dist/infrastructure/social/facebook-oauth-client.js');
const { FacebookOAuthError } = require('../../dist/application/social/facebook-oauth-error.js');
const { InMemoryFacebookPageSelectionStore } = require('../../dist/infrastructure/social/in-memory-facebook-page-selection-store.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const environment = {
  FACEBOOK_OAUTH_CLIENT_ID: 'test-facebook-client-id',
  FACEBOOK_OAUTH_CLIENT_SECRET: 'test-facebook-client-secret',
  FACEBOOK_OAUTH_REDIRECT_URI: 'http://localhost:3000/social/connections/facebook/callback',
  META_GRAPH_API_VERSION: 'v25.0',
};

function createClient(responses, env = environment, now = () => Date.parse('2026-10-14T12:00:00.000Z')) {
  const requests = [];
  const credentials = {
    storeCredentials: async (input) => { requests.push({ stored: input }); return `credential-${requests.filter((request) => request.stored).length}`; },
    resolveAccessToken: async (scope, reference, platform) => {
      requests.push({ resolved: { scope, reference, platform } });
      return 'long-lived-user-token-secret';
    },
    deleteCredentials: async (scope, reference, platform) => requests.push({ deleted: { scope, reference, platform } }),
  };
  const fetcher = async (url, options = {}) => {
    requests.push({ url: new URL(url), options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { client: new FacebookOAuthClient(credentials, env, fetcher, now, new InMemoryFacebookPageSelectionStore(now)), requests };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const permissionResponse = { data: [
  { permission: 'pages_show_list', status: 'granted' },
  { permission: 'pages_read_engagement', status: 'granted' },
  { permission: 'pages_read_user_content', status: 'granted' },
  { permission: 'pages_manage_engagement', status: 'granted' },
] };
const pageResponse = { data: [
  { id: 'page-1', name: 'Creator Page', access_token: 'page-one-token-secret', tasks: ['MODERATE', 'ANALYZE'] },
  { id: 'page-2', name: 'Studio Page', access_token: 'page-two-token-secret', tasks: ['MODERATE', 'MANAGE'] },
] };

function callbackResponses() {
  return [
    jsonResponse({ access_token: 'short-user-token-secret', token_type: 'bearer', expires_in: 3600 }),
    jsonResponse({ access_token: 'long-lived-user-token-secret', token_type: 'bearer', expires_in: 5184000 }),
    jsonResponse(permissionResponse),
    jsonResponse(pageResponse),
    jsonResponse(pageResponse),
  ];
}

test('Facebook Login authorization URL uses state and only Page read/comment management permissions', async () => {
  const { client } = createClient([]);
  const url = new URL(await client.buildAuthorizationUrl('csrf-state'));

  assert.equal(url.origin, 'https://www.facebook.com');
  assert.equal(url.pathname, '/v25.0/dialog/oauth');
  assert.equal(url.searchParams.get('client_id'), environment.FACEBOOK_OAUTH_CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), environment.FACEBOOK_OAUTH_REDIRECT_URI);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'csrf-state');
  assert.deepEqual(new Set(url.searchParams.get('scope').split(',')), new Set(['pages_show_list', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement']));
  assert.equal(url.searchParams.has('code_challenge'), false);
});

test('Facebook code exchange validates permissions, returns selectable Pages, and stores the temporary user token only in the vault', async () => {
  const { client, requests } = createClient(callbackResponses());
  const selection = await client.beginPageSelection('authorization-code', tenantId);

  assert.deepEqual(selection.pages, [{ externalAccountId: 'page-1', displayName: 'Creator Page' }, { externalAccountId: 'page-2', displayName: 'Studio Page' }]);
  assert.ok(selection.selectionId);
  assert.equal(JSON.stringify(selection).includes('page-one-token-secret'), false);
  assert.equal(requests[0].url.pathname, '/v25.0/oauth/access_token');
  assert.equal(requests[0].url.searchParams.get('code'), 'authorization-code');
  assert.equal(requests[0].url.searchParams.get('client_secret'), environment.FACEBOOK_OAUTH_CLIENT_SECRET);
  assert.equal(requests[1].url.searchParams.get('grant_type'), 'fb_exchange_token');
  assert.equal(requests[1].url.searchParams.get('fb_exchange_token'), 'short-user-token-secret');
  assert.equal(requests[2].url.pathname, '/v25.0/me/permissions');
  assert.equal(requests[3].url.pathname, '/v25.0/me/accounts');
  assert.deepEqual(requests[4].stored, {
    tenantId,
    platform: 'facebook',
    accessToken: 'long-lived-user-token-secret',
    refreshToken: null,
    grantedScopes: ['pages_show_list', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement'],
    expiresAt: '2026-10-14T12:05:00.000Z',
  });
});

test('Facebook Page token is stored only after explicit Page selection', async () => {
  const { client, requests } = createClient(callbackResponses());
  const selection = await client.beginPageSelection('authorization-code', tenantId);
  const callbackCredentialStores = requests.filter((request) => request.stored);
  assert.equal(callbackCredentialStores.length, 1);
  await assert.rejects(client.selectPage(selection.selectionId, 'page-1', 'other-tenant'), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_PAGE_SELECTION_INVALID');

  const account = await client.selectPage(selection.selectionId, 'page-2', tenantId);

  assert.deepEqual(account, { externalAccountId: 'page-2', displayName: 'Studio Page', credentialReference: 'credential-2' });
  assert.equal(requests.filter((request) => request.url?.pathname === '/v25.0/me/accounts').length, 2);
  assert.deepEqual(requests.find((request) => request.stored?.accessToken === 'page-two-token-secret').stored, {
    tenantId,
    platform: 'facebook',
    accessToken: 'page-two-token-secret',
    refreshToken: null,
    grantedScopes: ['pages_show_list', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement'],
    expiresAt: null,
  });
  assert.equal(requests.some((request) => request.stored?.accessToken === 'page-one-token-secret'), false);
  assert.equal(requests.some((request) => request.deleted?.reference === 'credential-1'), true);
});

test('Facebook rejects missing permissions, Pages without moderation access, invalid selections, and replay', async () => {
  const insufficient = createClient([
    jsonResponse({ access_token: 'short-user-token-secret', token_type: 'bearer', expires_in: 3600 }),
    jsonResponse({ access_token: 'long-lived-user-token-secret', token_type: 'bearer', expires_in: 5184000 }),
    jsonResponse({ data: [{ permission: 'pages_show_list', status: 'granted' }] }),
  ]);
  await assert.rejects(insufficient.client.beginPageSelection('code', tenantId), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_SCOPE_MISSING');
  assert.equal(insufficient.requests.some((request) => request.url?.pathname.endsWith('/me/accounts')), false);

  const invalidPageIdentity = createClient([
    jsonResponse({ access_token: 'short-user-token-secret', token_type: 'bearer', expires_in: 3600 }),
    jsonResponse({ access_token: 'long-lived-user-token-secret', token_type: 'bearer', expires_in: 5184000 }),
    jsonResponse(permissionResponse),
    jsonResponse({ data: [{ name: 'Missing Page ID', access_token: 'page-token-secret', tasks: ['MODERATE'] }] }),
  ]);
  await assert.rejects(invalidPageIdentity.client.beginPageSelection('code', tenantId), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_RESPONSE_INVALID');
  assert.equal(invalidPageIdentity.requests.some((request) => request.stored), false);

  const noModeration = createClient([
    jsonResponse({ access_token: 'short-user-token-secret', token_type: 'bearer', expires_in: 3600 }),
    jsonResponse({ access_token: 'long-lived-user-token-secret', token_type: 'bearer', expires_in: 5184000 }),
    jsonResponse(permissionResponse),
    jsonResponse({ data: [{ id: 'page-1', name: 'Read Only Page', access_token: 'page-token-secret', tasks: ['ANALYZE'] }] }),
  ]);
  await assert.rejects(noModeration.client.beginPageSelection('code', tenantId), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_PAGE_ACCESS_UNAVAILABLE');

  const { client, requests } = createClient(callbackResponses());
  const selection = await client.beginPageSelection('code', tenantId);
  await assert.rejects(client.selectPage(selection.selectionId, 'not-selected', tenantId), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_PAGE_SELECTION_INVALID');
  await client.selectPage(selection.selectionId, 'page-1', tenantId);
  await assert.rejects(client.selectPage(selection.selectionId, 'page-1', tenantId), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_PAGE_SELECTION_INVALID');
  assert.equal(requests.filter((request) => request.stored?.accessToken === 'page-one-token-secret').length, 1);
});

test('Facebook OAuth configuration is lazy, validates HTTPS callbacks, and maps provider failures safely', async () => {
  const missing = createClient([], {});
  await assert.rejects(missing.client.buildAuthorizationUrl('state'), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_CONFIGURATION_REQUIRED');
  const invalid = createClient([], { ...environment, FACEBOOK_OAUTH_REDIRECT_URI: 'http://example.com/callback' });
  await assert.rejects(invalid.client.buildAuthorizationUrl('state'), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_CONFIGURATION_INVALID');
  const failed = createClient([jsonResponse({ error: { message: 'sensitive provider detail', access_token: 'private-token' } }, 400)]);
  await assert.rejects(failed.client.beginPageSelection('code', tenantId), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED' && !error.message.includes('sensitive provider detail') && !error.message.includes('private-token'));
});
