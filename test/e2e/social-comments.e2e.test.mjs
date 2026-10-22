import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createSocialCommentsE2eModule } = require('../../dist-e2e/test/e2e/support/social-comments-e2e.module.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');
const { SyncPublicationComments } = require('../../dist/application/social/sync-publication-comments.js');
const { SetCommentLike } = require('../../dist/application/social/set-comment-like.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');

const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const tenantId = '30000000-0000-4000-8000-000000000001';
const account = SocialAccount.create({
  id: parseSocialAccountId(accountId),
  tenantId,
  platform: 'youtube',
  externalAccountId: 'UC-channel-1',
  displayName: 'Creator channel',
  credentialReference: 'vault/social/youtube/account-1',
});
const page = {
  account: { id: accountId, platform: 'youtube', externalAccountId: 'UC-channel-1', displayName: 'Creator channel' },
  publicationId: 'video-1',
  items: [{
    platform: 'youtube',
    externalCommentId: 'comment-1',
    externalThreadId: 'thread-1',
    externalPublicationId: 'video-1',
    canReply: true,
    creatorReplies: [{
      platform: 'youtube',
      externalReplyId: 'reply-1',
      externalCommentId: 'comment-1',
      externalPublicationId: 'video-1',
      text: 'Thanks for watching!',
      createdAt: '2026-10-13T12:10:00.000Z',
      socialAccountId: accountId,
      lastSyncedAt: '2026-10-13T12:00:00.000Z',
    }],
  }],
  nextCursor: 'next-comments',
  synchronizedAt: '2026-10-13T12:00:00.000Z',
  expiresAt: '2026-11-12T12:00:00.000Z',
};

async function runWithSyncUseCase(useCase, request, listComments, likeComment) {
  const app = await NestFactory.create(createSocialCommentsE2eModule(useCase, listComments, likeComment), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await request(await app.getUrl());
  } finally {
    await app.close();
  }
}

test('comment sync HTTP route derives tenant server-side and returns the persisted normalized page', async () => {
  const calls = [];
  const useCase = { execute: async (input) => { calls.push(input); return page; } };
  const response = await runWithSyncUseCase(useCase, (baseUrl) => fetch(`${baseUrl}/social/accounts/${accountId}/publications/video-1/comments/sync?cursor=cursor-one`, { method: 'POST' }));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), page);
  assert.deepEqual(calls, [{ accountId, publicationId: 'video-1', cursor: 'cursor-one' }]);
});

test('comment sync HTTP journey persists and returns only the connected creator direct reply', async () => {
  const rootComment = {
    platform: 'youtube',
    externalCommentId: 'comment-1',
    externalThreadId: 'thread-1',
    externalPublicationId: 'video-1',
    authorDisplayName: 'Viewer',
    text: 'Great episode',
    createdAt: '2026-10-12T14:00:00.000Z',
    canReply: true,
    canLike: false,
    externalReplyStatus: 'REPLIED',
  };
  const creatorReply = {
    platform: 'youtube',
    externalReplyId: 'reply-1',
    externalCommentId: 'comment-1',
    externalPublicationId: 'video-1',
    text: 'Thanks for watching!',
    createdAt: '2026-10-12T15:00:00.000Z',
  };
  const persisted = [];
  const useCase = new SyncPublicationComments(
    { findById: async () => account },
    {
      deleteExpired: async () => {},
      upsertPage: async (...args) => persisted.push(args),
      listByPublication: async () => [{
        ...rootComment,
        socialAccountId: account.id,
        appReplied: false,
        lastSyncedAt: '2026-10-13T12:00:00.000Z',
        expiresAt: '2026-11-12T12:00:00.000Z',
        creatorReplies: [{
          ...creatorReply,
          socialAccountId: account.id,
          lastSyncedAt: '2026-10-13T12:00:00.000Z',
        }],
      }],
    },
    { append: async (event) => ({ ...event, id: 'sync-event-1', expiresAt: '2026-11-12T12:00:00.000Z' }) },
    { resolveTenantId: async () => tenantId },
    { youtube: { getComments: async () => ({ items: [rootComment], creatorReplies: [creatorReply], nextCursor: null }) } },
    () => Date.parse('2026-10-13T12:00:00.000Z'),
  );
  const response = await runWithSyncUseCase(useCase, (baseUrl) => fetch(
    `${baseUrl}/social/accounts/${accountId}/publications/video-1/comments/sync`,
    { method: 'POST' },
  ));

  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.items[0].externalReplyStatus, 'REPLIED');
  assert.deepEqual(result.items[0].creatorReplies, [{
    ...creatorReply,
    socialAccountId: accountId,
    lastSyncedAt: '2026-10-13T12:00:00.000Z',
  }]);
  assert.deepEqual(persisted, [[account, 'video-1', [rootComment], '2026-10-13T12:00:00.000Z', '2026-11-12T12:00:00.000Z', [creatorReply]]]);
});

test('comment listing HTTP route returns persisted app/external reply states and creator reply details', async () => {
  const comments = [{
    externalCommentId: 'comment-1',
    appReplied: true,
    externalReplyStatus: 'REPLIED',
    creatorReplies: [{
      externalReplyId: 'reply-1',
      externalCommentId: 'comment-1',
      text: 'Thanks for watching!',
    }],
  }];
  const calls = [];
  const listComments = { execute: async (input) => { calls.push(input); return comments; } };
  const response = await runWithSyncUseCase({ execute: async () => page }, (baseUrl) => fetch(`${baseUrl}/social/accounts/${accountId}/publications/video-1/comments`), listComments);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), comments);
  assert.deepEqual(calls, [{ accountId, publicationId: 'video-1' }]);
});

test('comment like HTTP route dispatches explicit like/unlike actions and returns persisted app state', async () => {
  const likedActions = [];
  const events = [];
  let appLiked = false;
  const tiktokAccount = SocialAccount.create({
    id: parseSocialAccountId(accountId),
    tenantId,
    platform: 'tiktok',
    externalAccountId: 'business-open-id-1',
    displayName: 'TikTok business',
    credentialReference: 'vault/social/tiktok/account-1',
  });
  const storedComment = {
    platform: 'tiktok',
    socialAccountId: account.id,
    externalCommentId: 'comment-1',
    externalThreadId: 'comment-1',
    externalPublicationId: 'video-1',
    authorDisplayName: 'Viewer',
    text: 'Great video',
    createdAt: null,
    canReply: true,
    canLike: true,
    appReplied: false,
    appLiked: false,
    externalReplyStatus: 'UNKNOWN',
    lastSyncedAt: '2026-10-13T12:00:00.000Z',
    expiresAt: '2026-11-12T12:00:00.000Z',
    creatorReplies: [],
  };
  const useCase = new SetCommentLike(
    { findById: async () => tiktokAccount },
    {
      findByExternalCommentId: async () => ({ ...storedComment, appLiked }),
      markLikedByApp: async (_tenantId, _accountId, _commentId, next) => { appLiked = next; },
    },
    { setLike: async (_account, _comment, action) => { likedActions.push(action); } },
    {
      append: async (event) => {
        const stored = { ...event, id: `like-event-${events.length + 1}`, expiresAt: storedComment.expiresAt };
        events.push(stored);
        return stored;
      },
      listByComment: async () => events,
    },
    { resolveTenantId: async () => tenantId },
    () => Date.parse('2026-10-13T12:00:00.000Z'),
  );

  const responses = await runWithSyncUseCase(
    { execute: async () => page },
    async (baseUrl) => {
      const like = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/comment-1/like`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'LIKE' }),
      });
      const likeResult = await like.json();
      const unlike = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/comment-1/like`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'UNLIKE' }),
      });
      const unlikeResult = await unlike.json();
      const invalid = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/comment-1/like`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'HEART' }),
      });
      return { like, likeResult, unlike, unlikeResult, invalid };
    },
    { execute: async () => [] },
    useCase,
  );

  assert.equal(responses.like.status, 201);
  assert.deepEqual(responses.likeResult, { appLiked: true });
  assert.equal(responses.unlike.status, 201);
  assert.deepEqual(responses.unlikeResult, { appLiked: false });
  assert.equal(responses.invalid.status, 400);
  assert.deepEqual(await responses.invalid.json(), { code: 'SOCIAL_COMMENT_LIKE_ACTION_INVALID' });
  assert.deepEqual(likedActions, ['LIKE', 'UNLIKE']);
  assert.deepEqual(events.map((event) => event.payload.action), ['LIKE', 'UNLIKE']);
});

test('comment sync HTTP route returns stable provider failures without leaking provider text', async () => {
  const useCase = { execute: async () => { throw new SocialProviderError('SOCIAL_PROVIDER_RATE_LIMITED'); } };
  const response = await runWithSyncUseCase(useCase, (baseUrl) => fetch(`${baseUrl}/social/accounts/${accountId}/publications/video-1/comments/sync`, { method: 'POST' }));

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { code: 'SOCIAL_PROVIDER_RATE_LIMITED' });
});

test('comment sync HTTP route preserves expected provider codes for customer-facing mapping', async () => {
  const useCase = { execute: async () => { throw new SocialProviderError('SOCIAL_COMMENTS_DISABLED'); } };
  const response = await runWithSyncUseCase(useCase, (baseUrl) => fetch(`${baseUrl}/social/accounts/${accountId}/publications/video-1/comments/sync`, { method: 'POST' }));

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { code: 'SOCIAL_COMMENTS_DISABLED' });
});

test('comment sync HTTP route preserves safe provider availability codes', async () => {
  const useCase = { execute: async () => { throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE'); } };
  const response = await runWithSyncUseCase(useCase, (baseUrl) => fetch(`${baseUrl}/social/accounts/${accountId}/publications/video-1/comments/sync`, { method: 'POST' }));

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { code: 'SOCIAL_PROVIDER_UNAVAILABLE' });
});
