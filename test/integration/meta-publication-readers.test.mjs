import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { InstagramPublicationReader } = require('../../dist/infrastructure/social/instagram-publication-reader.js');
const { FacebookPagesPublicationReader } = require('../../dist/infrastructure/social/facebook-pages-publication-reader.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');

function account(platform, externalAccountId, id) {
  return SocialAccount.create({ id: parseSocialAccountId(id), tenantId: '30000000-0000-4000-8000-000000000001', platform, externalAccountId, displayName: 'Connected account', credentialReference: `vault/social/${platform}/account-1` });
}
const instagram = account('instagram', 'ig-user-1', '5b7f1f84-25a8-4bd8-a7df-680dc4400200');
const facebook = account('facebook', 'page-1', '5b7f1f84-25a8-4bd8-a7df-680dc4400300');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createReader(Reader, responses, grantedScopes) {
  const requests = [];
  const credentials = {
    hasScopes: async (_tenantId, _reference, _platform, scopes) => scopes.every((scope) => grantedScopes.includes(scope)),
    resolveAccessToken: async () => 'meta-test-token',
  };
  const fetcher = async (url, options) => { requests.push({ url: new URL(url), options }); return responses.shift(); };
  return { reader: new Reader(credentials, { META_GRAPH_API_VERSION: 'v22.0' }, fetcher), requests };
}

test('Instagram publication reader lists normalized account-owned media with cursor pagination', async () => {
  const { reader, requests } = createReader(InstagramPublicationReader, [jsonResponse({
    data: [{ id: 'ig-media-1', caption: 'Episode', permalink: 'https://instagram.invalid/p/1', thumbnail_url: 'https://cdn.invalid/1.jpg', timestamp: '2026-10-14T12:00:00+0000' }],
    paging: { cursors: { after: 'ig-next' }, next: 'https://graph.instagram.com/next' },
  })], ['instagram_business_basic']);

  const page = await reader.listPublications(instagram, 'ig-cursor');

  assert.deepEqual(page, { items: [{ platform: 'instagram', externalPublicationId: 'ig-media-1', title: null, description: 'Episode', permalink: 'https://instagram.invalid/p/1', thumbnailUrl: 'https://cdn.invalid/1.jpg', publishedAt: '2026-10-14T12:00:00.000Z' }], nextCursor: 'ig-next' });
  assert.equal(requests[0].url.pathname, '/v22.0/ig-user-1/media');
  assert.equal(requests[0].url.searchParams.get('after'), 'ig-cursor');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer meta-test-token');
});

test('Facebook Pages publication reader lists authorized Page posts and denies missing scopes', async () => {
  const { reader, requests } = createReader(FacebookPagesPublicationReader, [jsonResponse({
    data: [{ id: 'page-post-1', message: 'Video post', permalink_url: 'https://facebook.invalid/post/1', full_picture: 'https://cdn.invalid/1.jpg', created_time: '2026-10-14T12:00:00+0000' }],
    paging: { cursors: { after: 'fb-next' } },
  })], ['pages_read_engagement']);

  const page = await reader.listPublications(facebook);
  assert.equal(page.items[0].externalPublicationId, 'page-post-1');
  assert.equal(page.items[0].description, 'Video post');
  assert.equal(page.nextCursor, 'fb-next');
  assert.equal(requests[0].url.pathname, '/v22.0/page-1/posts');

  const denied = createReader(FacebookPagesPublicationReader, [], []);
  await assert.rejects(denied.reader.listPublications(facebook), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED');
  assert.deepEqual(denied.requests, []);
});
