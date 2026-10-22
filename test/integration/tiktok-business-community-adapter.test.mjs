import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { TikTokBusinessCommunityAdapter } = require('../../dist/infrastructure/social/tiktok-business-community.adapter.js');
const { PlatformSocialCommentResponder } = require('../../dist/infrastructure/social/platform-social-comment-responder.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');

const account = SocialAccount.create({
  id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400099'),
  tenantId: '30000000-0000-4000-8000-000000000001',
  platform: 'tiktok',
  externalAccountId: 'business-open-id-1',
  displayName: 'TikTok business',
  credentialReference: 'vault/social/tiktok/account-1',
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createAdapter(responses, grantedScopes = ['comment.list', 'comment.list.manage']) {
  const requests = [];
  const credentialCalls = [];
  const credentials = {
    hasScopes: async (_tenantId, reference, platform, scopes) => {
      credentialCalls.push(['hasScopes', reference, platform, scopes]);
      return scopes.every((scope) => grantedScopes.includes(scope));
    },
    resolveAccessToken: async (_tenantId, reference, platform) => {
      credentialCalls.push(['resolveAccessToken', reference, platform]);
      return 'tiktok-test-token';
    },
  };
  const fetcher = async (url, options) => {
    requests.push({ url: new URL(url), options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { adapter: new TikTokBusinessCommunityAdapter(credentials, fetcher), credentialCalls, requests };
}

const comment = {
  platform: 'tiktok',
  externalReplyStatus: 'UNKNOWN',
  externalCommentId: 'comment-1',
  externalThreadId: 'comment-1',
  externalPublicationId: 'video-1',
  authorDisplayName: 'Viewer',
  text: 'Great video',
  createdAt: null,
  canReply: true,
  canLike: true,
};

test('platform responder registry dispatches TikTok replies only to the TikTok adapter', async () => {
  const calls = [];
  const registry = new PlatformSocialCommentResponder({
    youtube: { reply: async () => { throw new Error('wrong adapter'); } },
    tiktok: { reply: async (resolvedAccount, resolvedComment, text) => { calls.push([resolvedAccount.platform, resolvedComment.externalCommentId, text]); return { platform: 'tiktok', externalReplyId: 'reply-1' }; } },
  });

  const result = await registry.reply(account, comment, 'TikTok reply');

  assert.deepEqual(calls, [['tiktok', 'comment-1', 'TikTok reply']]);
  assert.deepEqual(result, { platform: 'tiktok', externalReplyId: 'reply-1' });
});

test('TikTok Business adapter normalizes comments, reply state, and pagination with its platform credential', async () => {
  const createdAt = 1760356800;
  const { adapter, credentialCalls, requests } = createAdapter([jsonResponse({
    code: 0,
    data: {
      comments: [
        { comment_id: 'comment-1', video_id: 'video-1', text: 'Great video', create_time: String(createdAt), username: 'viewer', display_name: 'Viewer', reply_count: 2, status: 'PUBLIC', owner: false, reply_list: [
          { comment_id: 'reply-1', parent_comment_id: 'comment-1', video_id: 'video-1', text: 'Viewer follow-up', create_time: String(createdAt + 100), owner: false },
          { comment_id: 'reply-2', parent_comment_id: 'comment-1', video_id: 'video-1', text: 'Thanks for watching!', create_time: String(createdAt + 200), owner: true },
        ] },
        { comment_id: 'comment-2', video_id: 'video-1', text: 'Question', create_time: String(createdAt), reply_count: 0, status: 'PUBLIC', owner: false },
        { comment_id: 'comment-3', video_id: 'video-1', text: 'Another', create_time: String(createdAt), reply_count: 4, status: 'PUBLIC', owner: false, reply_list: [{ comment_id: 'reply-3', owner: false }] },
      ],
      cursor: 200,
      has_more: true,
    },
  })]);

  const page = await adapter.getComments(account, 'video-1', '100');

  assert.deepEqual(page.items.map((item) => [item.externalCommentId, item.externalReplyStatus]), [
    ['comment-1', 'REPLIED'], ['comment-2', 'NOT_REPLIED'], ['comment-3', 'UNKNOWN'],
  ]);
  assert.deepEqual(page.creatorReplies, [{
    platform: 'tiktok',
    externalReplyId: 'reply-2',
    externalCommentId: 'comment-1',
    externalPublicationId: 'video-1',
    text: 'Thanks for watching!',
    createdAt: new Date((createdAt + 200) * 1000).toISOString(),
  }]);
  assert.equal(page.items[0].createdAt, new Date(createdAt * 1000).toISOString());
  assert.equal(page.items[0].externalThreadId, 'comment-1');
  assert.equal(page.items[0].canLike, true);
  assert.equal(page.nextCursor, '200');
  assert.equal(requests[0].url.pathname, '/open_api/v1.3/business/comment/list/');
  assert.equal(requests[0].url.searchParams.get('business_id'), account.externalAccountId);
  assert.equal(requests[0].url.searchParams.get('video_id'), 'video-1');
  assert.equal(requests[0].url.searchParams.get('cursor'), '100');
  assert.equal(requests[0].url.searchParams.get('include_replies'), 'true');
  assert.equal(requests[0].options.headers['Access-Token'], 'tiktok-test-token');
  assert.deepEqual(credentialCalls[0], ['hasScopes', account.credentialReference, 'tiktok', ['comment.list']]);
});

test('TikTok Business adapter returns a direct creator reply even when its parent arrived on an earlier page', async () => {
  const createdAt = 1760356800;
  const { adapter } = createAdapter([jsonResponse({
    code: 0,
    data: {
      comments: [{
        comment_id: 'reply-previous-parent',
        parent_comment_id: 'comment-from-previous-page',
        video_id: 'video-1',
        text: 'Creator follow-up',
        create_time: String(createdAt),
        owner: true,
      }],
      has_more: false,
    },
  })]);

  const page = await adapter.getComments(account, 'video-1');

  assert.deepEqual(page.items, []);
  assert.deepEqual(page.creatorReplies, [{
    platform: 'tiktok',
    externalReplyId: 'reply-previous-parent',
    externalCommentId: 'comment-from-previous-page',
    externalPublicationId: 'video-1',
    text: 'Creator follow-up',
    createdAt: new Date(createdAt * 1000).toISOString(),
  }]);
});

test('TikTok Business adapter creates one reply on the exact owned-video comment', async () => {
  const { adapter, requests } = createAdapter([jsonResponse({ code: 0, data: { comment_id: 'reply-1' } })]);

  const result = await adapter.reply(account, comment, 'Manual final response');

  assert.deepEqual(result, { platform: 'tiktok', externalReplyId: 'reply-1' });
  assert.equal(requests[0].url.pathname, '/open_api/v1.3/business/comment/reply/create/');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['Access-Token'], 'tiktok-test-token');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    business_id: account.externalAccountId,
    video_id: comment.externalPublicationId,
    comment_id: comment.externalCommentId,
    text: 'Manual final response',
  });
});

test('TikTok Business adapter likes and unlikes the selected owned-video comment', async () => {
  const { adapter, requests, credentialCalls } = createAdapter([
    jsonResponse({ code: 0, data: {} }),
    jsonResponse({ code: 0, data: {} }),
  ]);

  await adapter.setLike(account, comment, 'LIKE');
  await adapter.setLike(account, comment, 'UNLIKE');

  assert.equal(requests[0].url.pathname, '/open_api/v1.3/business/comment/like/');
  assert.equal(requests[1].url.pathname, '/open_api/v1.3/business/comment/like/');
  assert.deepEqual(requests.map(({ options }) => JSON.parse(options.body)), [
    { business_id: account.externalAccountId, comment_id: comment.externalCommentId, action: 'LIKE' },
    { business_id: account.externalAccountId, comment_id: comment.externalCommentId, action: 'UNLIKE' },
  ]);
  assert.deepEqual(credentialCalls.filter(([kind]) => kind === 'hasScopes').map(([, , , scopes]) => scopes), [
    ['comment.list.manage'],
    ['comment.list.manage'],
  ]);
});

test('TikTok Business adapter denies comment likes without comment-management scope', async () => {
  const { adapter, requests } = createAdapter([], ['comment.list']);

  await assert.rejects(
    adapter.setLike(account, comment, 'LIKE'),
    (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED',
  );
  assert.deepEqual(requests, []);
});

test('TikTok Business adapter checks reply capability/scopes and preserves ambiguous write outcomes', async () => {
  const unsupported = createAdapter([]);
  await assert.rejects(unsupported.adapter.reply(account, { ...comment, canReply: false }, 'Reply'), (error) => error.code === 'SOCIAL_REPLY_UNSUPPORTED');
  assert.deepEqual(unsupported.requests, []);

  const missingScope = createAdapter([], ['comment.list']);
  await assert.rejects(missingScope.adapter.reply(account, comment, 'Reply'), (error) => error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED');
  assert.deepEqual(missingScope.requests, []);

  const ambiguous = createAdapter([new Error('network detail')]);
  await assert.rejects(ambiguous.adapter.reply(account, comment, 'Reply'), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS' && !error.message.includes('network detail'));
});
