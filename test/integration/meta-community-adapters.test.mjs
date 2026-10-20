import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { InstagramCommunityAdapter } = require('../../dist/infrastructure/social/instagram-community.adapter.js');
const { FacebookPagesCommunityAdapter } = require('../../dist/infrastructure/social/facebook-pages-community.adapter.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');

function createAccount(platform, externalAccountId) {
  return SocialAccount.create({
    id: parseSocialAccountId(platform === 'instagram' ? '5b7f1f84-25a8-4bd8-a7df-680dc4400200' : '5b7f1f84-25a8-4bd8-a7df-680dc4400300'),
    tenantId: '30000000-0000-4000-8000-000000000001',
    platform,
    externalAccountId,
    displayName: 'Connected professional account',
    credentialReference: `vault/social/${platform}/account-1`,
  });
}

const instagram = createAccount('instagram', 'ig-user-1');
const facebook = createAccount('facebook', 'page-1');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createAdapter(Adapter, responses, grantedScopes) {
  const requests = [];
  const credentials = {
    hasScopes: async (_tenantId, _reference, _platform, scopes) => scopes.every((scope) => grantedScopes.includes(scope)),
    resolveAccessToken: async () => 'meta-test-token',
  };
  const fetcher = async (url, options) => {
    requests.push({ url: new URL(url), options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { adapter: new Adapter(credentials, { META_GRAPH_API_VERSION: 'v22.0' }, fetcher), requests };
}

test('Instagram adapter reads comments from owned professional media and normalizes pagination', async () => {
  const { adapter, requests } = createAdapter(InstagramCommunityAdapter, [jsonResponse({
    data: [{ id: 'ig-comment-1', text: 'Hello', timestamp: '2026-10-14T12:00:00+0000', username: 'viewer', hidden: false, reply_count: 0 }],
    paging: { cursors: { after: 'ig-cursor-2' }, next: 'https://graph.instagram.com/next' },
  })], ['instagram_business_basic', 'instagram_business_manage_comments']);

  const page = await adapter.getComments(instagram, 'ig-media-1', 'ig-cursor-1');

  assert.deepEqual(page, {
    items: [{ platform: 'instagram', externalCommentId: 'ig-comment-1', externalThreadId: 'ig-comment-1', externalPublicationId: 'ig-media-1', authorDisplayName: 'viewer', text: 'Hello', createdAt: '2026-10-14T12:00:00.000Z', canReply: true, externalReplyStatus: 'NOT_REPLIED' }],
    nextCursor: 'ig-cursor-2',
  });
  assert.equal(requests[0].url.hostname, 'graph.instagram.com');
  assert.equal(requests[0].url.pathname, '/v22.0/ig-media-1/comments');
  assert.equal(requests[0].url.searchParams.get('after'), 'ig-cursor-1');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer meta-test-token');
});

test('Instagram adapter replies through the Instagram comment reply edge with the creator text', async () => {
  const { adapter, requests } = createAdapter(InstagramCommunityAdapter, [jsonResponse({ id: 'ig-reply-1' })], ['instagram_business_manage_comments']);

  const result = await adapter.reply(instagram, { platform: 'instagram', externalCommentId: 'ig-comment-1', externalThreadId: 'ig-comment-1', externalPublicationId: 'ig-media-1', authorDisplayName: 'viewer', text: 'Hello', createdAt: null, canReply: true, externalReplyStatus: 'UNKNOWN' }, 'Manual answer');

  assert.deepEqual(result, { platform: 'instagram', externalReplyId: 'ig-reply-1' });
  assert.equal(requests[0].url.pathname, '/v22.0/ig-comment-1/replies');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(new URLSearchParams(requests[0].options.body).get('message'), 'Manual answer');
});

test('Facebook Pages adapter reads Page post comments and replies to the selected comment', async () => {
  const { adapter, requests } = createAdapter(FacebookPagesCommunityAdapter, [
    jsonResponse({ data: [{ id: 'fb-comment-1', message: 'Hi', created_time: '2026-10-14T12:00:00+0000', from: { name: 'viewer' }, can_comment: true, comment_count: 0 }], paging: { cursors: { after: 'fb-cursor' } } }),
    jsonResponse({ id: 'fb-reply-1' }),
  ], ['pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement']);

  const page = await adapter.getComments(facebook, 'post-1');
  const result = await adapter.reply(facebook, page.items[0], 'Page response');

  assert.equal(page.items[0].externalCommentId, 'fb-comment-1');
  assert.equal(page.items[0].externalPublicationId, 'post-1');
  assert.equal(page.items[0].externalReplyStatus, 'NOT_REPLIED');
  assert.equal(page.nextCursor, 'fb-cursor');
  assert.deepEqual(result, { platform: 'facebook', externalReplyId: 'fb-reply-1' });
  assert.equal(requests[0].url.hostname, 'graph.facebook.com');
  assert.equal(requests[0].url.pathname, '/v22.0/post-1/comments');
  assert.equal(requests[1].url.pathname, '/v22.0/fb-comment-1/comments');
  assert.equal(new URLSearchParams(requests[1].options.body).get('message'), 'Page response');
});

test('Meta adapters deny missing comment permissions before provider calls', async () => {
  const instagramResult = createAdapter(InstagramCommunityAdapter, [], ['instagram_business_basic']);
  await assert.rejects(instagramResult.adapter.getComments(instagram, 'ig-media-1'), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED');
  assert.deepEqual(instagramResult.requests, []);

  const facebookResult = createAdapter(FacebookPagesCommunityAdapter, [], ['pages_read_engagement']);
  await assert.rejects(facebookResult.adapter.reply(facebook, { platform: 'facebook', externalCommentId: 'fb-comment-1', externalThreadId: 'fb-comment-1', externalPublicationId: 'post-1', authorDisplayName: null, text: 'Hello', createdAt: null, canReply: true, externalReplyStatus: 'UNKNOWN' }, 'Reply'), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED');
  assert.deepEqual(facebookResult.requests, []);
});
