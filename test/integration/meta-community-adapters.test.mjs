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
    data: [{ id: 'ig-comment-1', text: 'Hello', timestamp: '2026-10-14T12:00:00+0000', username: 'viewer', hidden: false, replies: { data: [] } }],
    paging: { cursors: { after: 'ig-cursor-2' }, next: 'https://graph.instagram.com/next' },
  })], ['instagram_business_basic', 'instagram_business_manage_comments']);

  const page = await adapter.getComments(instagram, 'ig-media-1', 'ig-cursor-1');

  assert.deepEqual(page, {
    items: [{ platform: 'instagram', externalCommentId: 'ig-comment-1', externalThreadId: 'ig-comment-1', externalPublicationId: 'ig-media-1', authorDisplayName: 'viewer', text: 'Hello', createdAt: '2026-10-14T12:00:00.000Z', canReply: true, canLike: false, externalReplyStatus: 'NOT_REPLIED' }],
    creatorReplies: [],
    nextCursor: 'ig-cursor-2',
  });
  assert.equal(requests[0].url.hostname, 'graph.instagram.com');
  assert.equal(requests[0].url.pathname, '/v22.0/ig-media-1/comments');
  assert.equal(requests[0].url.searchParams.get('after'), 'ig-cursor-1');
  assert.equal(requests[0].url.searchParams.get('fields'), 'id,text,timestamp,username,hidden,parent_id,from{id,username},replies{id,text,timestamp,username,from{id,username}}');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer meta-test-token');
});

test('Instagram adapter resolves comment authors from from.username when username is omitted', async () => {
  const { adapter } = createAdapter(InstagramCommunityAdapter, [jsonResponse({
    data: [{
      id: 'ig-comment-1',
      text: 'Hello',
      timestamp: '2026-10-14T12:00:00+0000',
      from: { id: 'viewer-9', username: 'commenter_name' },
      hidden: false,
    }],
  })], ['instagram_business_basic', 'instagram_business_manage_comments']);

  const page = await adapter.getComments(instagram, 'ig-media-1');

  assert.equal(page.items[0].authorDisplayName, 'commenter_name');
});

test('Instagram adapter persists direct replies authored by the connected professional account', async () => {
  const { adapter } = createAdapter(InstagramCommunityAdapter, [jsonResponse({
    data: [{
      id: 'ig-comment-1',
      text: 'Hello',
      timestamp: '2026-10-14T12:00:00+0000',
      username: 'viewer',
      hidden: false,
      replies: { data: [
        { id: 'ig-reply-1', text: 'Thanks!', timestamp: '2026-10-14T13:00:00+0000', username: 'Connected professional account', from: { id: 'ig-user-1', username: 'Connected professional account' } },
        { id: 'ig-reply-2', text: 'Me too', timestamp: '2026-10-14T13:30:00+0000', username: 'fan', from: { id: 'viewer-2', username: 'fan' } },
        { id: 'ig-reply-3', text: 'Unattributed', timestamp: '2026-10-14T14:00:00+0000', username: 'someone' },
      ] },
    }],
  })], ['instagram_business_basic', 'instagram_business_manage_comments']);

  const page = await adapter.getComments(instagram, 'ig-media-1');

  assert.equal(page.items[0].externalReplyStatus, 'REPLIED');
  assert.deepEqual(page.creatorReplies, [{
    platform: 'instagram',
    externalReplyId: 'ig-reply-1',
    externalCommentId: 'ig-comment-1',
    externalPublicationId: 'ig-media-1',
    text: 'Thanks!',
    createdAt: '2026-10-14T13:00:00.000Z',
  }]);
});

test('Instagram reports replies without creator attribution and truncated reply pages as UNKNOWN', async () => {
  const { adapter } = createAdapter(InstagramCommunityAdapter, [jsonResponse({
    data: [{
      id: 'ig-comment-1',
      text: 'Hello',
      timestamp: '2026-10-14T12:00:00+0000',
      username: 'viewer',
      hidden: false,
      replies: { data: [{ id: 'ig-reply-9', text: 'Fan reply', username: 'fan', from: { id: 'viewer-2' } }], paging: { next: 'https://graph.instagram.com/more-replies' } },
    }],
  })], ['instagram_business_basic', 'instagram_business_manage_comments']);

  const page = await adapter.getComments(instagram, 'ig-media-1');

  assert.equal(page.items[0].externalReplyStatus, 'UNKNOWN');
  assert.deepEqual(page.creatorReplies, []);
});

test('Instagram reports comments whose replies edge is omitted with no nested replies as NOT_REPLIED', async () => {
  const { adapter } = createAdapter(InstagramCommunityAdapter, [jsonResponse({
    data: [{
      id: 'ig-comment-1',
      text: 'Hello',
      timestamp: '2026-10-14T12:00:00+0000',
      username: 'viewer',
      hidden: false,
    }],
  })], ['instagram_business_basic', 'instagram_business_manage_comments']);

  const page = await adapter.getComments(instagram, 'ig-media-1');

  assert.equal(page.items[0].externalReplyStatus, 'NOT_REPLIED');
  assert.deepEqual(page.creatorReplies, []);
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
    jsonResponse({ data: [{ id: 'fb-comment-1', message: 'Hi', created_time: '2026-10-14T12:00:00+0000', from: { name: 'viewer' }, can_comment: true, can_like: true, comment_count: 0 }], paging: { cursors: { after: 'fb-cursor' } } }),
    jsonResponse({ id: 'fb-reply-1' }),
  ], ['pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement']);

  const page = await adapter.getComments(facebook, 'post-1');
  const result = await adapter.reply(facebook, page.items[0], 'Page response');

  assert.equal(page.items[0].externalCommentId, 'fb-comment-1');
  assert.equal(page.items[0].externalPublicationId, 'post-1');
  assert.equal(page.items[0].canLike, true);
  assert.equal(page.items[0].externalReplyStatus, 'NOT_REPLIED');
  assert.equal(page.nextCursor, 'fb-cursor');
  assert.deepEqual(result, { platform: 'facebook', externalReplyId: 'fb-reply-1' });
  assert.equal(requests[0].url.hostname, 'graph.facebook.com');
  assert.equal(requests[0].url.pathname, '/v22.0/post-1/comments');
  assert.equal(requests[1].url.pathname, '/v22.0/fb-comment-1/comments');
  assert.equal(new URLSearchParams(requests[1].options.body).get('message'), 'Page response');
});

test('Facebook Pages adapter likes and unlikes the selected Page comment through its likes edge', async () => {
  const { adapter, requests } = createAdapter(FacebookPagesCommunityAdapter, [
    jsonResponse({ success: true }),
    jsonResponse({ success: true }),
  ], ['pages_manage_engagement']);
  const target = { platform: 'facebook', externalCommentId: 'fb-comment-1', externalPublicationId: 'post-1', canLike: true };

  await adapter.setLike(facebook, target, 'LIKE');
  await adapter.setLike(facebook, target, 'UNLIKE');

  assert.equal(requests[0].url.pathname, '/v22.0/fb-comment-1/likes');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[1].url.pathname, '/v22.0/fb-comment-1/likes');
  assert.equal(requests[1].options.method, 'DELETE');
  assert.deepEqual(requests.map(({ options }) => options.headers.Authorization), ['Bearer meta-test-token', 'Bearer meta-test-token']);
});

test('Instagram does not infer creator replies from a reply count or display-name match', async () => {
  const { adapter } = createAdapter(InstagramCommunityAdapter, [jsonResponse({
    data: [{
      id: 'ig-comment-1',
      text: 'Hello',
      timestamp: '2026-10-14T12:00:00+0000',
      username: 'Connected professional account',
      hidden: false,
      reply_count: 2,
    }, {
      id: 'ig-nested-reply',
      parent_id: 'ig-comment-1',
      text: 'A reply without reliable author identity',
      timestamp: '2026-10-14T13:00:00+0000',
      username: 'Connected professional account',
      hidden: false,
      reply_count: 0,
    }],
  })], ['instagram_business_basic', 'instagram_business_manage_comments']);

  const page = await adapter.getComments(instagram, 'ig-media-1');

  assert.equal(page.items[0].externalReplyStatus, 'UNKNOWN');
  assert.deepEqual(page.creatorReplies, []);
});

test('Facebook stream persists only direct replies authored by the connected Page', async () => {
  const { adapter } = createAdapter(FacebookPagesCommunityAdapter, [jsonResponse({
    data: [
      { id: 'fb-comment-1', message: 'Hi', created_time: '2026-10-14T12:00:00+0000', from: { id: 'viewer-1', name: 'Viewer' }, can_comment: true, comment_count: 3 },
      { id: 'fb-creator-reply', message: 'Thanks!', created_time: '2026-10-14T13:00:00+0000', from: { id: 'page-1', name: 'Connected Page' }, can_comment: true, parent: { id: 'fb-comment-1' } },
      { id: 'fb-viewer-reply', message: 'Nice', created_time: '2026-10-14T13:30:00+0000', from: { id: 'viewer-2', name: 'Another viewer' }, can_comment: true, parent: { id: 'fb-comment-1' } },
      { id: 'fb-nested-reply', message: 'Further thread', created_time: '2026-10-14T14:00:00+0000', from: { id: 'page-1', name: 'Connected Page' }, can_comment: true, parent: { id: 'fb-viewer-reply' } },
    ],
  })], ['pages_read_engagement', 'pages_read_user_content']);

  const page = await adapter.getComments(facebook, 'post-1');

  assert.deepEqual(page.items.map(({ externalCommentId, externalReplyStatus }) => [externalCommentId, externalReplyStatus]), [
    ['fb-comment-1', 'REPLIED'],
  ]);
  assert.deepEqual(page.creatorReplies, [{
    platform: 'facebook',
    externalReplyId: 'fb-creator-reply',
    externalCommentId: 'fb-comment-1',
    externalPublicationId: 'post-1',
    text: 'Thanks!',
    createdAt: '2026-10-14T13:00:00.000Z',
  }]);
});

test('Facebook stream returns creator replies whose parent may have been synchronized on an earlier page', async () => {
  const { adapter } = createAdapter(FacebookPagesCommunityAdapter, [jsonResponse({
    data: [{
      id: 'fb-creator-reply',
      message: 'Following up on my earlier response.',
      created_time: '2026-10-14T13:00:00+0000',
      from: { id: 'page-1', name: 'Connected Page' },
      can_comment: true,
      parent: { id: 'fb-comment-from-previous-page' },
    }],
  })], ['pages_read_engagement', 'pages_read_user_content']);

  const page = await adapter.getComments(facebook, 'post-1', 'cursor-next');

  assert.deepEqual(page.items, []);
  assert.deepEqual(page.creatorReplies, [{
    platform: 'facebook',
    externalReplyId: 'fb-creator-reply',
    externalCommentId: 'fb-comment-from-previous-page',
    externalPublicationId: 'post-1',
    text: 'Following up on my earlier response.',
    createdAt: '2026-10-14T13:00:00.000Z',
  }]);
});

test('Facebook confirms creator reply state without fabricating a reply record when the provider omits its ID', async () => {
  const { adapter } = createAdapter(FacebookPagesCommunityAdapter, [jsonResponse({
    data: [
      { id: 'fb-comment-1', message: 'Hi', created_time: '2026-10-14T12:00:00+0000', from: { id: 'viewer-1', name: 'Viewer' }, can_comment: true, comment_count: 1 },
      { message: 'Thanks!', created_time: '2026-10-14T13:00:00+0000', from: { id: 'page-1', name: 'Connected Page' }, parent: { id: 'fb-comment-1' } },
    ],
  })], ['pages_read_engagement', 'pages_read_user_content']);

  const page = await adapter.getComments(facebook, 'post-1');

  assert.equal(page.items[0].externalReplyStatus, 'REPLIED');
  assert.deepEqual(page.creatorReplies, []);
});

test('Meta adapters deny missing comment permissions before provider calls', async () => {
  const instagramResult = createAdapter(InstagramCommunityAdapter, [], ['instagram_business_basic']);
  await assert.rejects(instagramResult.adapter.getComments(instagram, 'ig-media-1'), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED');
  assert.deepEqual(instagramResult.requests, []);

  const facebookResult = createAdapter(FacebookPagesCommunityAdapter, [], ['pages_read_engagement']);
  await assert.rejects(facebookResult.adapter.reply(facebook, { platform: 'facebook', externalCommentId: 'fb-comment-1', externalThreadId: 'fb-comment-1', externalPublicationId: 'post-1', authorDisplayName: null, text: 'Hello', createdAt: null, canReply: true, externalReplyStatus: 'UNKNOWN' }, 'Reply'), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED');
  assert.deepEqual(facebookResult.requests, []);
});

test('Facebook Pages adapter denies comment likes without the Page engagement permission', async () => {
  const { adapter, requests } = createAdapter(FacebookPagesCommunityAdapter, [], ['pages_read_user_content']);

  await assert.rejects(
    adapter.setLike(facebook, { platform: 'facebook', externalCommentId: 'fb-comment-1', canLike: true }, 'LIKE'),
    (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED',
  );
  assert.deepEqual(requests, []);
});
