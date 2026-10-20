import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { YouTubePublicationReader } = require('../../dist/infrastructure/social/youtube-publication-reader.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');

const account = SocialAccount.create({
  id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001'),
  tenantId: '30000000-0000-4000-8000-000000000001',
  platform: 'youtube',
  externalAccountId: 'UC-channel-1',
  displayName: 'Creator channel',
  credentialReference: 'vault/social/youtube/account-1',
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createReader(responses, credential = 'test-only-token', scopeGranted = true) {
  const requests = [];
  const credentials = {
    resolveAccessToken: async (resolvedAccount) => {
      assert.equal(resolvedAccount.id, account.id);
      return credential;
    },
    hasScopes: async (resolvedAccount, scopes) => {
      assert.equal(resolvedAccount.id, account.id);
      assert.ok(scopes.length);
      return scopeGranted;
    },
  };
  const fetcher = async (url, options) => {
    requests.push({ url: new URL(url), options });
    const response = responses.shift();
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
  return { reader: new YouTubePublicationReader(credentials, fetcher), requests };
}

test('YouTube reader lists and normalizes uploaded videos with provider pagination', async () => {
  const { reader, requests } = createReader([
    jsonResponse({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU-uploads-1' } } }] }),
    jsonResponse({
      items: [{
        contentDetails: { videoId: 'video-1' },
        snippet: {
          title: 'Episode title',
          description: 'Episode description',
          publishedAt: '2026-10-12T14:00:00Z',
          thumbnails: { medium: { url: 'https://i.ytimg.com/vi/video-1/mqdefault.jpg' } },
        },
      }],
      nextPageToken: 'page-two',
    }),
  ]);

  const page = await reader.listPublications(account, 'page-one');

  assert.deepEqual(page, {
    items: [{
      platform: 'youtube',
      externalPublicationId: 'video-1',
      title: 'Episode title',
      description: 'Episode description',
      permalink: 'https://www.youtube.com/watch?v=video-1',
      thumbnailUrl: 'https://i.ytimg.com/vi/video-1/mqdefault.jpg',
      publishedAt: '2026-10-12T14:00:00Z',
    }],
    nextCursor: 'page-two',
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.pathname, '/youtube/v3/channels');
  assert.equal(requests[0].url.searchParams.get('mine'), 'true');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-only-token');
  assert.equal(requests[1].url.searchParams.get('playlistId'), 'UU-uploads-1');
  assert.equal(requests[1].url.searchParams.get('pageToken'), 'page-one');
});

test('YouTube reader refuses to call the provider without a read scope', async () => {
  const { reader, requests } = createReader([], 'test-only-token', false);

  await assert.rejects(reader.listPublications(account), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED');
  assert.deepEqual(requests, []);
});

test('YouTube reader does not call the provider without a resolvable credential', async () => {
  const { reader, requests } = createReader([], null);

  await assert.rejects(reader.listPublications(account), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_CREDENTIAL_UNAVAILABLE');
  assert.deepEqual(requests, []);
});

test('YouTube reader rejects accounts from another platform without resolving credentials', async () => {
  const { reader, requests } = createReader([]);
  const instagramAccount = SocialAccount.create({ ...account, platform: 'instagram' });

  await assert.rejects(reader.listPublications(instagramAccount), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
  assert.deepEqual(requests, []);
});

test('YouTube reader maps authorization, rate-limit, and provider errors to stable codes', async (context) => {
  const cases = [
    [401, 'SOCIAL_ACCOUNT_AUTHORIZATION_REQUIRED'],
    [403, 'SOCIAL_ACCOUNT_PERMISSION_DENIED'],
    [429, 'SOCIAL_PROVIDER_RATE_LIMITED'],
    [503, 'SOCIAL_PROVIDER_UNAVAILABLE'],
  ];
  for (const [status, code] of cases) {
    await context.test(`${status} maps to ${code}`, async () => {
      const { reader } = createReader([jsonResponse({ error: { message: 'private provider detail' } }, status)]);
      await assert.rejects(reader.listPublications(account), (error) => error instanceof SocialProviderError && error.code === code && !error.message.includes('private provider detail'));
    });
  }
});

test('YouTube reader maps network errors without exposing provider details', async () => {
  const { reader } = createReader([new Error('private network detail')]);

  await assert.rejects(reader.listPublications(account), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_PROVIDER_UNAVAILABLE' && !error.message.includes('private network detail'));
});

test('YouTube reader rejects malformed API response data and never fabricates publication IDs', async (context) => {
  const invalidItems = [
    [{ snippet: { title: 'No video ID' } }],
    [null],
  ];
  for (const items of invalidItems) {
    await context.test('invalid playlist item', async () => {
      const { reader } = createReader([
        jsonResponse({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU-uploads-1' } } }] }),
        jsonResponse({ items }),
      ]);

      await assert.rejects(reader.listPublications(account), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_PROVIDER_RESPONSE_INVALID');
    });
  }
});
