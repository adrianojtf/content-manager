import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { YouTubeOAuthClient } = require('../../dist/infrastructure/social/youtube-oauth-client.js');
const { YouTubeOAuthError } = require('../../dist/application/social/youtube-oauth-error.js');

const readonlyScope = 'https://www.googleapis.com/auth/youtube.readonly';
const replyScope = 'https://www.googleapis.com/auth/youtube.force-ssl';
const tenantId = '30000000-0000-4000-8000-000000000001';
const environment = {
  YOUTUBE_OAUTH_CLIENT_ID: 'test-client-id',
  YOUTUBE_OAUTH_CLIENT_SECRET: 'test-client-secret',
  YOUTUBE_OAUTH_REDIRECT_URI: 'http://localhost:3000/social/connections/youtube/callback',
};

function createClient(responses, env = environment) {
  const requests = [];
  const credentials = { storeCredentials: async (input) => { requests.push({ stored: input }); return 'credential-reference'; } };
  const fetcher = async (url, options) => {
    requests.push({ url: new URL(url), options });
    const response = responses.shift();
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
  return { client: new YouTubeOAuthClient(credentials, env, fetcher, () => Date.parse('2026-10-13T12:00:00.000Z')), requests };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('YouTube OAuth authorization URL uses state, S256 PKCE, local callback and only requested scopes', async () => {
  const { client } = createClient([]);
  const url = new URL(await client.buildAuthorizationUrl('oauth-state', 'verifier-value', [readonlyScope]));

  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.pathname, '/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), environment.YOUTUBE_OAUTH_CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), environment.YOUTUBE_OAUTH_REDIRECT_URI);
  assert.equal(url.searchParams.get('state'), 'oauth-state');
  assert.equal(url.searchParams.get('scope'), readonlyScope);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update('verifier-value').digest('base64url'));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('scope').includes(replyScope), false);
});

test('YouTube OAuth code exchange validates scope, resolves the channel, and stores tokens only in the vault', async () => {
  const { client, requests } = createClient([
    jsonResponse({
      access_token: 'access-token-secret',
      refresh_token: 'refresh-token-secret',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: readonlyScope,
    }),
    jsonResponse({ items: [{ id: 'UC-channel-1', snippet: { title: 'Creator channel' } }] }),
  ]);

  const connected = await client.completeAuthorization('authorization-code', 'pkce-verifier', [readonlyScope], tenantId);

  assert.deepEqual(connected, {
    externalAccountId: 'UC-channel-1',
    displayName: 'Creator channel',
    credentialReference: 'credential-reference',
  });
  assert.equal(requests[0].url.origin, 'https://oauth2.googleapis.com');
  assert.equal(requests[0].options.body.get('client_secret'), environment.YOUTUBE_OAUTH_CLIENT_SECRET);
  assert.equal(requests[0].options.body.get('code_verifier'), 'pkce-verifier');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer access-token-secret');
  assert.deepEqual(requests[2].stored, {
    tenantId,
    platform: 'youtube',
    accessToken: 'access-token-secret',
    refreshToken: 'refresh-token-secret',
    grantedScopes: [readonlyScope],
    expiresAt: '2026-10-13T13:00:00.000Z',
  });
  assert.equal(JSON.stringify(connected).includes('access-token-secret'), false);
  assert.equal(JSON.stringify(connected).includes('refresh-token-secret'), false);
});

test('YouTube OAuth configuration stays lazy and permits only HTTPS or localhost redirect URIs', async () => {
  const { client: unconfigured } = createClient([], {});
  await assert.rejects(unconfigured.buildAuthorizationUrl('state', 'verifier', [readonlyScope]), (error) => error instanceof YouTubeOAuthError && error.code === 'YOUTUBE_OAUTH_CONFIGURATION_REQUIRED');

  const { client: insecure } = createClient([], { ...environment, YOUTUBE_OAUTH_REDIRECT_URI: 'http://example.com/callback' });
  await assert.rejects(insecure.buildAuthorizationUrl('state', 'verifier', [readonlyScope]), (error) => error instanceof YouTubeOAuthError && error.code === 'YOUTUBE_OAUTH_CONFIGURATION_INVALID');
});

test('YouTube OAuth client refreshes access tokens without exposing refresh token details', async () => {
  const { client, requests } = createClient([
    jsonResponse({ access_token: 'new-access-token', token_type: 'Bearer', expires_in: 3600 }),
  ]);

  const result = await client.refreshAccessToken('refresh-token-secret');

  assert.deepEqual(result, { accessToken: 'new-access-token', expiresAt: '2026-10-13T13:00:00.000Z' });
  assert.equal(requests[0].options.body.get('grant_type'), 'refresh_token');
  assert.equal(requests[0].options.body.get('refresh_token'), 'refresh-token-secret');
});

test('YouTube OAuth rejects missing grants and hides provider error bodies', async () => {
  const { client } = createClient([jsonResponse({ access_token: 'access-token-secret', expires_in: 3600, scope: 'openid' })]);
  await assert.rejects(
    client.completeAuthorization('authorization-code', 'pkce-verifier', [readonlyScope], tenantId),
    (error) => error instanceof YouTubeOAuthError && error.code === 'YOUTUBE_OAUTH_SCOPE_MISSING' && !error.message.includes('access-token-secret'),
  );

  const { client: failedClient } = createClient([jsonResponse({ error: 'invalid_grant', error_description: 'sensitive provider details' }, 400)]);
  await assert.rejects(
    failedClient.completeAuthorization('authorization-code', 'pkce-verifier', [readonlyScope], tenantId),
    (error) => error instanceof YouTubeOAuthError && error.code === 'YOUTUBE_OAUTH_TOKEN_EXCHANGE_FAILED' && !error.message.includes('sensitive provider details'),
  );
});
