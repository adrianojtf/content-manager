import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { SetCommentLike } = require('../../dist/application/social/set-comment-like.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001');
const account = SocialAccount.create({
  id: accountId,
  tenantId,
  platform: 'facebook',
  externalAccountId: 'page-1',
  displayName: 'Creator Page',
  credentialReference: 'vault/social/facebook/page-1',
});
const comment = {
  platform: 'facebook',
  socialAccountId: accountId,
  externalCommentId: 'comment-1',
  externalThreadId: 'comment-1',
  externalPublicationId: 'post-1',
  authorDisplayName: 'Viewer',
  text: 'Great post!',
  createdAt: '2026-10-20T12:00:00.000Z',
  canReply: true,
  canLike: true,
  appReplied: false,
  appLiked: false,
  externalReplyStatus: 'UNKNOWN',
  lastSyncedAt: '2026-10-20T12:00:00.000Z',
  expiresAt: '2026-11-19T12:00:00.000Z',
  creatorReplies: [],
};
const now = () => Date.parse('2026-10-21T12:00:00.000Z');

function createUseCase({ initiallyLiked = false, likeError = null } = {}) {
  const storedComment = { ...comment, appLiked: initiallyLiked };
  const calls = [];
  const events = [];
  const useCase = new SetCommentLike(
    { findById: async (...args) => { calls.push(['findAccount', ...args]); return account; } },
    {
      findByExternalCommentId: async (...args) => { calls.push(['findComment', ...args]); return storedComment; },
      markLikedByApp: async (...args) => { calls.push(['markLikedByApp', ...args]); storedComment.appLiked = args[3]; },
    },
    { setLike: async (...args) => { calls.push(['setLike', ...args]); if (likeError) throw likeError; } },
    {
      listByComment: async () => events,
      append: async (event) => {
        const stored = { ...event, id: `event-${events.length + 1}`, expiresAt: comment.expiresAt };
        events.push(stored);
        return stored;
      },
    },
    { resolveTenantId: async () => tenantId },
    now,
  );
  return { useCase, calls, events, storedComment };
}

test('SetCommentLike persists app-owned like state and an audit event after the provider succeeds', async () => {
  const { useCase, calls, events, storedComment } = createUseCase();

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, action: 'LIKE' });

  assert.deepEqual(result, { appLiked: true });
  assert.equal(storedComment.appLiked, true);
  assert.deepEqual(calls.filter(([name]) => name === 'setLike').map(([, , target, action]) => [target.externalCommentId, action]), [['comment-1', 'LIKE']]);
  assert.equal(events[0].eventType, 'COMMENT_LIKE_CHANGED');
  assert.equal(events[0].status, 'SUCCEEDED');
  assert.deepEqual(events[0].payload, { action: 'LIKE', appLiked: true });
});

test('SetCommentLike sends an explicit unlike action and clears app-owned state', async () => {
  const { useCase, calls, storedComment } = createUseCase({ initiallyLiked: true });

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, action: 'UNLIKE' });

  assert.deepEqual(result, { appLiked: false });
  assert.equal(storedComment.appLiked, false);
  assert.equal(calls.find(([name]) => name === 'setLike')[3], 'UNLIKE');
});

test('SetCommentLike does not dispatch when the requested state is already recorded', async () => {
  const { useCase, calls } = createUseCase({ initiallyLiked: true });

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, action: 'LIKE' });

  assert.deepEqual(result, { appLiked: true });
  assert.equal(calls.some(([name]) => name === 'setLike'), false);
  assert.equal(calls.some(([name]) => name === 'markLikedByApp'), false);
});

test('SetCommentLike rejects unsupported comments and invalid actions without dispatching', async () => {
  const unsupported = createUseCase();
  unsupported.storedComment.canLike = false;
  await assert.rejects(
    unsupported.useCase.execute({ accountId, externalCommentId: comment.externalCommentId, action: 'LIKE' }),
    (error) => error.code === 'SOCIAL_COMMENT_LIKE_UNSUPPORTED',
  );

  const invalidAction = createUseCase();
  await assert.rejects(
    invalidAction.useCase.execute({ accountId, externalCommentId: comment.externalCommentId, action: 'HEART' }),
    (error) => error.code === 'SOCIAL_COMMENT_LIKE_ACTION_INVALID',
  );
  assert.equal(unsupported.calls.some(([name]) => name === 'setLike'), false);
  assert.equal(invalidAction.calls.some(([name]) => name === 'setLike'), false);
});

test('SetCommentLike records provider failures without changing the persisted like state', async () => {
  const { useCase, events, storedComment } = createUseCase({
    likeError: new SocialProviderError('SOCIAL_ACCOUNT_PERMISSION_DENIED'),
  });

  await assert.rejects(
    useCase.execute({ accountId, externalCommentId: comment.externalCommentId, action: 'LIKE' }),
    (error) => error.code === 'SOCIAL_ACCOUNT_PERMISSION_DENIED',
  );

  assert.equal(storedComment.appLiked, false);
  assert.equal(events[0].eventType, 'COMMENT_LIKE_CHANGED');
  assert.equal(events[0].status, 'FAILED');
  assert.deepEqual(events[0].payload, { action: 'LIKE', errorCode: 'SOCIAL_ACCOUNT_PERMISSION_DENIED' });
});
