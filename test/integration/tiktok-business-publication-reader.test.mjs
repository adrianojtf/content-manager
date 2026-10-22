import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { TikTokBusinessPublicationReader } = require('../../dist/infrastructure/social/tiktok-business-publication-reader.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');

const account = SocialAccount.create({
  id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400100'),
  tenantId: '30000000-0000-4000-8000-000000000001',
  platform: 'tiktok',
  externalAccountId: 'business-open-id-1',
  displayName: 'TikTok business',
  credentialReference: 'vault/social/tiktok/account-1',
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createReader(responses, grantedScopes = ['video.list']) {
  const requests = [];
  const credentials = {
    hasScopes: async (_tenantId, _reference, _platform, scopes) => scopes.every((scope) => grantedScopes.includes(scope)),
    resolveAccessToken: async () => 'tiktok-test-token',
  };
  const fetcher = async (url, options) => {
    requests.push({ url: new URL(url), options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { reader: new TikTokBusinessPublicationReader(credentials, fetcher), requests };
}

test('TikTok Business publication reader normalizes owned videos and preserves cursor pagination', async () => {
  const { reader, requests } = createReader([jsonResponse({
    code: 0,
    data: {
      videos: [{ item_id: 'video-1', caption: 'Episode 1', share_url: 'https://www.tiktok.com/@creator/video/video-1', create_time: 1760356800, thumbnail_url: 'https://cdn.invalid/thumb.jpg' }],
      cursor: 50,
      has_more: true,
    },
  })]);

  const page = await reader.listPublications(account, '20', 10);

  assert.deepEqual(page, {
    items: [{
      platform: 'tiktok', externalPublicationId: 'video-1', title: null, description: 'Episode 1',
      permalink: 'https://www.tiktok.com/@creator/video/video-1', thumbnailUrl: 'https://cdn.invalid/thumb.jpg',
      publishedAt: new Date(1760356800 * 1000).toISOString(),
    }],
    nextCursor: '50',
  });
  assert.equal(requests[0].url.pathname, '/open_api/v1.3/business/video/list/');
  assert.equal(requests[0].url.searchParams.get('business_id'), account.externalAccountId);
  assert.equal(requests[0].url.searchParams.get('cursor'), '20');
  assert.equal(requests[0].url.searchParams.get('max_count'), '10');
  assert.deepEqual(JSON.parse(requests[0].url.searchParams.get('fields')), ['item_id', 'caption', 'share_url', 'create_time', 'thumbnail_url']);
  assert.equal(requests[0].options.headers['Access-Token'], 'tiktok-test-token');
});

test('TikTok Business publication reader requires the video-list permission before provider calls', async () => {
  const { reader, requests } = createReader([], []);
  await assert.rejects(reader.listPublications(account), (error) => error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED');
  assert.deepEqual(requests, []);
});
