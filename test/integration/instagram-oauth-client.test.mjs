import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { InstagramOAuthClient } = require('../../dist/infrastructure/social/instagram-oauth-client.js');
const { InstagramOAuthError } = require('../../dist/application/social/instagram-oauth-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const environment = {
  INSTAGRAM_OAUTH_CLIENT_ID: 'test-instagram-client-id',
  INSTAGRAM_OAUTH_CLIENT_SECRET: 'test-instagram-client-secret',
  INSTAGRAM_OAUTH_REDIRECT_URI: 'http://localhost:3000/social/connections/instagram/callback',
  META_GRAPH_API_VERSION: 'v25.0',
};

function createClient(responses, env = environment) {
  const requests = [];
  const credentials = { storeCredentials: async (input) => { requests.push({ stored: input }); return 'instagram-credential-reference'; } };
  const fetcher = async (url, options = {}) => {
    requests.push({ url: new URL(url), options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { client: new InstagramOAuthClient(credentials, env, fetcher, () => Date.parse('2026-10-14T12:00:00.000Z')), requests };
}

function jsonResponse(body, status = 200) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
}

function rawJsonResponse(text, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
}

test('Instagram Login authorization URL uses state and only professional account and comment scopes', async () => {
  const { client } = createClient([]);
  const url = new URL(await client.buildAuthorizationUrl('csrf-state'));

  assert.equal(url.origin, 'https://www.instagram.com');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), environment.INSTAGRAM_OAUTH_CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), environment.INSTAGRAM_OAUTH_REDIRECT_URI);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'csrf-state');
  assert.equal(url.searchParams.get('enable_fb_login'), 'false');
  assert.deepEqual(new Set(url.searchParams.get('scope').split(',')), new Set(['instagram_business_basic', 'instagram_business_manage_comments']));
  assert.equal(url.searchParams.has('code_challenge'), false);
});

test('Instagram code exchange validates grants, upgrades token, verifies professional identity, and stores only the long-lived token', async () => {
  const { client, requests } = createClient([
    jsonResponse({ data: [{ access_token: 'short-token-secret', user_id: '17841400000000001', permissions: 'instagram_business_basic,instagram_business_manage_comments' }] }),
    jsonResponse({ access_token: 'long-token-secret', token_type: 'bearer', expires_in: 5183944 }),
    jsonResponse({ id: 'app-scoped-1', user_id: '17841400000000001', username: 'creator_name', account_type: 'CREATOR' }),
  ]);

  const account = await client.completeAuthorization('authorization-code', tenantId);

  assert.deepEqual(account, { externalAccountId: '17841400000000001', displayName: 'creator_name', credentialReference: 'instagram-credential-reference' });
  assert.equal(requests[0].url.origin, 'https://api.instagram.com');
  assert.equal(requests[0].url.pathname, '/oauth/access_token');
  assert.equal(requests[0].options.body.get('grant_type'), 'authorization_code');
  assert.equal(requests[0].options.body.get('client_secret'), environment.INSTAGRAM_OAUTH_CLIENT_SECRET);
  assert.equal(requests[0].options.body.get('code'), 'authorization-code');
  assert.equal(requests[1].url.origin, 'https://graph.instagram.com');
  assert.equal(requests[1].url.pathname, '/access_token');
  assert.equal(requests[1].url.searchParams.get('grant_type'), 'ig_exchange_token');
  assert.equal(requests[1].url.searchParams.get('access_token'), 'short-token-secret');
  assert.equal(requests[2].url.pathname, '/v25.0/me');
  assert.equal(requests[2].url.searchParams.get('fields'), 'id,user_id,username');
  assert.deepEqual(requests[3].stored, {
    tenantId,
    platform: 'instagram',
    accessToken: 'long-token-secret',
    refreshToken: null,
    grantedScopes: ['instagram_business_basic', 'instagram_business_manage_comments'],
    expiresAt: '2026-12-13T11:59:04.000Z',
  });
  assert.equal(JSON.stringify(account).includes('long-token-secret'), false);
  assert.equal(JSON.stringify(account).includes('short-token-secret'), false);
});


test('Instagram code exchange accepts the documented flat token payload without leaking it', async () => {
  const { client, requests } = createClient([
    jsonResponse({ access_token: 'short-token-secret', user_id: '17841400000000001', permissions: ['instagram_business_basic', 'instagram_business_manage_comments'] }),
    jsonResponse({ access_token: 'long-token-secret', token_type: 'bearer', expires_in: 5183944 }),
    jsonResponse({ id: 'app-scoped-1', user_id: '17841400000000001', username: 'creator_name' }),
  ]);

  const account = await client.completeAuthorization('authorization-code', tenantId);

  assert.deepEqual(account, { externalAccountId: '17841400000000001', displayName: 'creator_name', credentialReference: 'instagram-credential-reference' });
  assert.equal(requests[1].url.pathname, '/access_token');
  assert.deepEqual(requests[3].stored?.accessToken, 'long-token-secret');
  assert.deepEqual(requests[3].stored?.grantedScopes, ['instagram_business_basic', 'instagram_business_manage_comments']);
  assert.equal(JSON.stringify(account).includes('token-secret'), false);
});

test('Instagram OAuth accepts a token user_id matching the app-scoped id and stores the professional user_id', async () => {
  const { client, requests } = createClient([
    jsonResponse({ access_token: 'short-token-secret', user_id: 'app-scoped-7', permissions: 'instagram_business_basic,instagram_business_manage_comments' }),
    jsonResponse({ access_token: 'long-token-secret', token_type: 'bearer', expires_in: 3600 }),
    jsonResponse({ data: [{ id: 'app-scoped-7', user_id: '17841400000000009', username: 'creator_name' }] }),
  ]);

  const account = await client.completeAuthorization('code', tenantId);

  assert.equal(account.externalAccountId, '17841400000000009');
  assert.deepEqual(requests[3].stored?.accessToken, 'long-token-secret');
});

test('Instagram OAuth preserves numeric IDs larger than Number.MAX_SAFE_INTEGER', async () => {
  const { client, requests } = createClient([
    rawJsonResponse('{"access_token":"short-token-secret","user_id":17841400000000001,"permissions":"instagram_business_basic,instagram_business_manage_comments"}'),
    jsonResponse({ access_token: 'long-token-secret', token_type: 'bearer', expires_in: 3600 }),
    jsonResponse({ id: 'app-scoped-1', user_id: '17841400000000001', username: 'creator_name' }),
  ]);

  const account = await client.completeAuthorization('code', tenantId);

  assert.equal(account.externalAccountId, '17841400000000001');
  assert.equal(requests[1].url.searchParams.get('access_token'), 'short-token-secret');
});

test('Instagram code exchange rejects missing or ambiguous token payloads without storing credentials', async () => {
  const missingPermissions = createClient([jsonResponse({ access_token: 'short-token-secret', user_id: 'ig-1' })]);
  await assert.rejects(missingPermissions.client.completeAuthorization('code', tenantId), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_RESPONSE_INVALID');
  assert.equal(missingPermissions.requests.some((request) => request.stored), false);

  const ambiguousWrapped = createClient([jsonResponse({ data: [
    { access_token: 'first-secret', user_id: 'ig-1', permissions: 'instagram_business_basic,instagram_business_manage_comments' },
    { access_token: 'second-secret', user_id: 'ig-2', permissions: 'instagram_business_basic,instagram_business_manage_comments' },
  ] })]);
  await assert.rejects(ambiguousWrapped.client.completeAuthorization('code', tenantId), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_RESPONSE_INVALID');
  assert.equal(ambiguousWrapped.requests.some((request) => request.stored), false);

  const ambiguousMixed = createClient([jsonResponse({ access_token: 'flat-secret', user_id: 'ig-1', permissions: 'instagram_business_basic,instagram_business_manage_comments', data: [
    { access_token: 'wrapped-secret', user_id: 'ig-2', permissions: 'instagram_business_basic,instagram_business_manage_comments' },
  ] })]);
  await assert.rejects(ambiguousMixed.client.completeAuthorization('code', tenantId), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_RESPONSE_INVALID');
  assert.equal(ambiguousMixed.requests.some((request) => request.stored), false);
});

test('Instagram OAuth rejects missing scopes and invalid or mismatched identities without storing credentials', async () => {
  const missingScopes = createClient([jsonResponse({ data: [{ access_token: 'short-token-secret', user_id: 'ig-1', permissions: 'instagram_business_basic' }] })]);
  await assert.rejects(missingScopes.client.completeAuthorization('code', tenantId), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_SCOPE_MISSING');
  assert.equal(missingScopes.requests.some((request) => request.stored), false);

  const invalidIdentity = createClient([
    jsonResponse({ data: [{ access_token: 'short-token-secret', user_id: 'ig-1', permissions: 'instagram_business_basic,instagram_business_manage_comments' }] }),
    jsonResponse({ access_token: 'long-token-secret', token_type: 'bearer', expires_in: 3600 }),
    jsonResponse({ id: 'ig-1', user_id: 'ig-1', username: ' ' }),
  ]);
  await assert.rejects(invalidIdentity.client.completeAuthorization('code', tenantId), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_ACCOUNT_INVALID');
  assert.equal(invalidIdentity.requests.some((request) => request.stored), false);

  const missingProfessionalId = createClient([
    jsonResponse({ data: [{ access_token: 'short-token-secret', user_id: 'ig-1', permissions: 'instagram_business_basic,instagram_business_manage_comments' }] }),
    jsonResponse({ access_token: 'long-token-secret', token_type: 'bearer', expires_in: 3600 }),
    jsonResponse({ id: 'ig-1', username: 'creator' }),
  ]);
  await assert.rejects(missingProfessionalId.client.completeAuthorization('code', tenantId), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_ACCOUNT_INVALID');
  assert.equal(missingProfessionalId.requests.some((request) => request.stored), false);

  const mismatch = createClient([
    jsonResponse({ data: [{ access_token: 'short-token-secret', user_id: 'ig-1', permissions: 'instagram_business_basic,instagram_business_manage_comments' }] }),
    jsonResponse({ access_token: 'long-token-secret', token_type: 'bearer', expires_in: 3600 }),
    jsonResponse({ id: 'ig-2', user_id: 'ig-3', username: 'creator', account_type: 'BUSINESS' }),
  ]);
  await assert.rejects(mismatch.client.completeAuthorization('code', tenantId), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_ACCOUNT_ID_MISMATCH');
  assert.equal(mismatch.requests.some((request) => request.stored), false);
});

test('Instagram OAuth configuration is lazy and rejects non-HTTPS remote callback URLs', async () => {
  const missing = createClient([], {});
  await assert.rejects(missing.client.buildAuthorizationUrl('state'), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_CONFIGURATION_REQUIRED');
  const invalid = createClient([], { ...environment, INSTAGRAM_OAUTH_REDIRECT_URI: 'http://example.com/callback' });
  await assert.rejects(invalid.client.buildAuthorizationUrl('state'), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_CONFIGURATION_INVALID');
});

test('Instagram OAuth authorization fails before redirect when the Meta Graph API version is absent or malformed', async () => {
  const missing = createClient([], { ...environment, META_GRAPH_API_VERSION: '' });
  await assert.rejects(missing.client.buildAuthorizationUrl('state'), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_CONFIGURATION_REQUIRED');
  const malformed = createClient([], { ...environment, META_GRAPH_API_VERSION: 'v25' });
  await assert.rejects(malformed.client.buildAuthorizationUrl('state'), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_CONFIGURATION_INVALID');
});

test('Instagram OAuth refresh uses the provider refresh grant and returns a new expiration', async () => {
  const { client, requests } = createClient([jsonResponse({ access_token: 'refreshed-token-secret', token_type: 'bearer', expires_in: 5183944 })]);
  const refreshed = await client.refreshAccessToken('current-token-secret');

  assert.deepEqual(refreshed, { accessToken: 'refreshed-token-secret', expiresAt: '2026-12-13T11:59:04.000Z' });
  assert.equal(requests[0].url.pathname, '/refresh_access_token');
  assert.equal(requests[0].url.searchParams.get('grant_type'), 'ig_refresh_token');
  assert.equal(requests[0].url.searchParams.get('access_token'), 'current-token-secret');
  assert.equal(JSON.stringify(refreshed).includes('current-token-secret'), false);
});

test('Instagram OAuth maps provider failures without returning provider bodies or tokens', async () => {
  const failed = createClient([jsonResponse({ error_message: 'private provider detail', access_token: 'leaked-token' }, 400)]);
  await assert.rejects(failed.client.completeAuthorization('code', tenantId), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_TOKEN_EXCHANGE_FAILED' && !error.message.includes('private provider detail') && !error.message.includes('leaked-token'));
});
