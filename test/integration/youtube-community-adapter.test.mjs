import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { YouTubeCommunityAdapter } = require('../../dist/infrastructure/social/youtube-community.adapter.js');
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

function createAdapter(responses, scopesGranted = true) {
  const requests = [];
  const credentials = {
    resolveAccessToken: async (resolvedAccount) => {
      assert.equal(resolvedAccount.id, account.id);
      return 'test-only-token';
    },
    hasScopes: async (resolvedAccount, scopes) => {
      assert.equal(resolvedAccount.id, account.id);
      assert.ok(scopes.length);
      return scopesGranted;
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
  return { adapter: new YouTubeCommunityAdapter(credentials, fetcher), requests };
}

const thread = {
  id: 'thread-1',
  snippet: {
    videoId: 'video-1',
    canReply: true,
    topLevelComment: {
      id: 'comment-1',
      snippet: { authorDisplayName: 'Viewer', textDisplay: 'Great episode', publishedAt: '2026-10-12T14:00:00Z' },
    },
  },
};

test('YouTube community adapter normalizes comment thread identity and preserves pagination', async () => {
  const { adapter, requests } = createAdapter([jsonResponse({ items: [thread], nextPageToken: 'next-comments' })]);

  const page = await adapter.getComments(account, 'video-1', 'cursor-one');

  assert.deepEqual(page, {
    items: [{
      platform: 'youtube',
      externalCommentId: 'comment-1',
      externalThreadId: 'thread-1',
      externalPublicationId: 'video-1',
      authorDisplayName: 'Viewer',
      text: 'Great episode',
      createdAt: '2026-10-12T14:00:00Z',
      canReply: true,
      canLike: false,
      externalReplyStatus: 'UNKNOWN',
    }],
    creatorReplies: [],
    nextCursor: 'next-comments',
  });
  assert.equal(requests[0].url.pathname, '/youtube/v3/commentThreads');
  assert.equal(requests[0].url.searchParams.get('videoId'), 'video-1');
  assert.equal(requests[0].url.searchParams.get('pageToken'), 'cursor-one');
  assert.equal(requests[0].url.searchParams.get('maxResults'), '100');
});

test('YouTube community adapter reports creator reply state only when supported data proves it', async () => {
  const noReplies = createAdapter([jsonResponse({ items: [{ ...thread, snippet: { ...thread.snippet, totalReplyCount: 0 } }] })]);
  assert.equal((await noReplies.adapter.getComments(account, 'video-1')).items[0].externalReplyStatus, 'NOT_REPLIED');

  const creatorReply = createAdapter([jsonResponse({ items: [{
    ...thread,
    snippet: { ...thread.snippet, totalReplyCount: 2 },
    replies: { comments: [
      { id: 'viewer-reply', snippet: { authorChannelId: { value: 'UC-viewer' }, textDisplay: 'Viewer follow-up', publishedAt: '2026-10-12T14:30:00Z' } },
      { id: 'creator-reply', snippet: { authorChannelId: { value: account.externalAccountId }, textDisplay: 'Thanks for watching!', publishedAt: '2026-10-12T15:00:00Z' } },
    ] },
  }] })]);
  const pageWithCreatorReply = await creatorReply.adapter.getComments(account, 'video-1');
  assert.equal(pageWithCreatorReply.items[0].externalReplyStatus, 'REPLIED');
  assert.deepEqual(pageWithCreatorReply.creatorReplies, [{
    platform: 'youtube',
    externalReplyId: 'creator-reply',
    externalCommentId: 'comment-1',
    externalPublicationId: 'video-1',
    text: 'Thanks for watching!',
    createdAt: '2026-10-12T15:00:00.000Z',
  }]);

  const incompleteReplies = createAdapter([jsonResponse({ items: [{
    ...thread,
    snippet: { ...thread.snippet, totalReplyCount: 6 },
    replies: { comments: [{ snippet: { authorChannelId: { value: 'UC-viewer' } } }] },
  }] })]);
  const incompletePage = await incompleteReplies.adapter.getComments(account, 'video-1');
  assert.equal(incompletePage.items[0].externalReplyStatus, 'UNKNOWN');
  assert.deepEqual(incompletePage.creatorReplies, []);
});

test('YouTube community adapter blocks read and write calls when the credential lacks the requested scope', async () => {
  const { adapter, requests } = createAdapter([], false);

  await assert.rejects(adapter.getComments(account, 'video-1'), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED');
  await assert.rejects(adapter.reply(account, pageComment(), 'Thanks!'), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED');
  assert.deepEqual(requests, []);
});

test('YouTube community adapter reports comments-disabled videos as unsupported', async () => {
  const { adapter } = createAdapter([jsonResponse({ error: { errors: [{ reason: 'commentsDisabled' }] } }, 403)]);

  await assert.rejects(
    adapter.getComments(account, 'video-1'),
    (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_COMMENTS_DISABLED',
  );
});

test('YouTube community adapter blocks unsupported replies before any credential/provider call', async () => {
  const { adapter, requests } = createAdapter([]);

  await assert.rejects(
    adapter.reply(account, { ...pageComment(), canReply: false }, 'Thanks!'),
    (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_REPLY_UNSUPPORTED',
  );
  assert.deepEqual(requests, []);
});

test('YouTube community adapter rechecks the thread and sends only the edited text as a manual reply', async () => {
  const replyResponse = { id: 'reply-1' };
  const { adapter, requests } = createAdapter([
    jsonResponse({ items: [thread] }),
    jsonResponse(replyResponse),
  ]);

  const reply = await adapter.reply(account, pageComment(), 'My edited reply');

  assert.deepEqual(reply, { platform: 'youtube', externalReplyId: 'reply-1' });
  assert.equal(requests[0].url.searchParams.get('id'), 'thread-1');
  assert.equal(requests[1].url.pathname, '/youtube/v3/comments');
  assert.equal(requests[1].options.method, 'POST');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer test-only-token');
  assert.deepEqual(JSON.parse(requests[1].options.body), { snippet: { parentId: 'comment-1', textOriginal: 'My edited reply' } });
});

test('YouTube community adapter refuses stale/cross-publication comment context before posting', async () => {
  const { adapter, requests } = createAdapter([jsonResponse({ items: [{ ...thread, snippet: { ...thread.snippet, videoId: 'other-video' } }] })]);

  await assert.rejects(adapter.reply(account, pageComment(), 'Thanks!'), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_COMMENT_CONTEXT_MISMATCH');
  assert.equal(requests.length, 1);
});

test('YouTube community adapter marks uncertain reply outcomes ambiguous to prevent blind retry', async () => {
  const { adapter } = createAdapter([
    jsonResponse({ items: [thread] }),
    new Error('private network detail'),
  ]);

  await assert.rejects(adapter.reply(account, pageComment(), 'Thanks!'), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS' && !error.message.includes('private network detail'));
});

function pageComment() {
  return {
    platform: 'youtube',
    externalCommentId: 'comment-1',
    externalThreadId: 'thread-1',
    externalPublicationId: 'video-1',
    authorDisplayName: 'Viewer',
    text: 'Great episode',
    createdAt: '2026-10-12T14:00:00Z',
    canReply: true,
    canLike: false,
  };
}
