import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { SyncPublicationComments, ListPublicationComments } = require('../../dist/application/social/sync-publication-comments.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001');
const account = SocialAccount.create({
  id: accountId,
  tenantId,
  platform: 'youtube',
  externalAccountId: 'UC-channel-1',
  displayName: 'Creator channel',
  credentialReference: 'vault/social/youtube/account-1',
});
const page = {
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
    externalReplyStatus: 'REPLIED',
  }],
  creatorReplies: [{
    platform: 'youtube',
    externalReplyId: 'reply-1',
    externalCommentId: 'comment-1',
    externalPublicationId: 'video-1',
    text: 'Thank you for watching!',
    createdAt: '2026-10-12T15:00:00Z',
  }],
  nextCursor: 'next-comments',
};
const syncTime = Date.parse('2026-10-13T12:00:00.000Z');

function createUseCase({ foundAccount = account, response = page, readerPlatform = 'youtube' } = {}) {
  const calls = [];
  const accounts = { findById: async (scope, id) => { calls.push({ operation: 'findAccount', scope, id }); return foundAccount; } };
  const comments = {
    deleteExpired: async (...args) => calls.push({ operation: 'deleteExpired', args }),
    upsertPage: async (...args) => calls.push({ operation: 'savePage', args }),
    listByPublication: async (...args) => {
      calls.push({ operation: 'listPublication', args });
      return response.items.map((item) => ({
        ...item,
        externalReplyStatus: item.externalReplyStatus ?? 'UNKNOWN',
        socialAccountId: account.id,
        appReplied: false,
        appLiked: false,
        lastSyncedAt: '2026-10-13T12:00:00.000Z',
        expiresAt: '2026-11-12T12:00:00.000Z',
        creatorReplies: (response.creatorReplies ?? [])
          .filter((reply) => reply.externalCommentId === item.externalCommentId)
          .map((reply) => ({ ...reply, socialAccountId: account.id, lastSyncedAt: '2026-10-13T12:00:00.000Z' })),
      }));
    },
  };
  const events = { append: async (event) => { calls.push({ operation: 'audit', event }); return { ...event, id: 'workflow-event-1', expiresAt: '2026-11-12T12:00:00.000Z' }; } };
  const reader = { getComments: async (...args) => { calls.push({ operation: 'readComments', args }); if (response instanceof Error) throw response; return response; } };
  const readers = readerPlatform ? { [readerPlatform]: reader } : {};
  const tenant = { resolveTenantId: async () => tenantId };
  return { useCase: new SyncPublicationComments(accounts, comments, events, tenant, readers, () => syncTime), calls };
}

test('SyncPublicationComments resolves tenant server-side, preserves provider cursor, and persists a 30-day page', async () => {
  const { useCase, calls } = createUseCase();

  const result = await useCase.execute({ accountId, publicationId: 'video-1', cursor: 'cursor-one' });

  assert.deepEqual(calls[0], { operation: 'findAccount', scope: tenantId, id: accountId });
  assert.deepEqual(calls[1], { operation: 'deleteExpired', args: [tenantId, '2026-10-13T12:00:00.000Z'] });
  assert.deepEqual(calls[2], { operation: 'readComments', args: [account, 'video-1', 'cursor-one'] });
  assert.deepEqual(calls[3], {
    operation: 'savePage',
    args: [account, 'video-1', page.items, '2026-10-13T12:00:00.000Z', '2026-11-12T12:00:00.000Z', page.creatorReplies],
  });
  assert.deepEqual(calls[4], {
    operation: 'listPublication',
    args: [tenantId, account.id, 'video-1', '2026-10-13T12:00:00.000Z'],
  });
  assert.deepEqual(calls[5], {
    operation: 'audit',
    event: {
      tenantId,
      socialAccountId: account.id,
      externalCommentId: 'comment-1',
      eventType: 'COMMENT_SYNCED',
      actorSource: 'APPLICATION',
      status: 'SUCCEEDED',
      operationId: null,
      batchOperationId: null,
      parentEventId: null,
      payload: { externalPublicationId: 'video-1' },
      recordedAt: '2026-10-13T12:00:00.000Z',
    },
  });
  assert.deepEqual(result, {
    account: { id: account.id, platform: 'youtube', externalAccountId: account.externalAccountId, displayName: account.displayName },
    publicationId: 'video-1',
    items: [{
      ...page.items[0],
      socialAccountId: account.id,
      appReplied: false,
      appLiked: false,
      lastSyncedAt: '2026-10-13T12:00:00.000Z',
      expiresAt: '2026-11-12T12:00:00.000Z',
      creatorReplies: [{ ...page.creatorReplies[0], socialAccountId: account.id, lastSyncedAt: '2026-10-13T12:00:00.000Z' }],
    }],
    nextCursor: page.nextCursor,
    synchronizedAt: '2026-10-13T12:00:00.000Z',
    expiresAt: '2026-11-12T12:00:00.000Z',
  });
  assert.equal(JSON.stringify(result).includes('credentialReference'), false);
});

test('SyncPublicationComments does not persist when account is absent or provider read fails', async () => {
  const missing = createUseCase({ foundAccount: null });
  await assert.rejects(missing.useCase.execute({ accountId, publicationId: 'video-1' }), (error) => error.code === 'SOCIAL_ACCOUNT_NOT_FOUND');
  assert.deepEqual(missing.calls.map((call) => call.operation), ['findAccount']);

  const failing = createUseCase({ response: new SocialProviderError('SOCIAL_PROVIDER_RATE_LIMITED') });
  await assert.rejects(failing.useCase.execute({ accountId, publicationId: 'video-1' }), (error) => error.code === 'SOCIAL_PROVIDER_RATE_LIMITED');
  assert.equal(failing.calls.some((call) => call.operation === 'deleteExpired'), true);
  assert.equal(failing.calls.some((call) => call.operation === 'savePage'), false);
});

test('ListPublicationComments returns persisted reply states using server-owned tenant scope', async () => {
  const calls = [];
  const stored = [{ ...page.items[0], socialAccountId: account.id, appReplied: true, externalReplyStatus: 'UNKNOWN', lastSyncedAt: '2026-10-13T12:00:00.000Z', expiresAt: '2026-11-12T12:00:00.000Z' }];
  const list = new ListPublicationComments(
    { findById: async (scope, id) => { calls.push(['findAccount', scope, id]); return account; } },
    { listByPublication: async (...args) => { calls.push(['listComments', ...args]); return stored; } },
    { resolveTenantId: async () => tenantId },
    () => syncTime,
  );

  assert.deepEqual(await list.execute({ accountId, publicationId: 'video-1' }), stored);
  assert.deepEqual(calls, [
    ['findAccount', tenantId, accountId],
    ['listComments', tenantId, accountId, 'video-1', '2026-10-13T12:00:00.000Z'],
  ]);
});

test('SyncPublicationComments rejects a comment page associated with another publication without persisting', async () => {
  const invalidPage = { ...page, items: [{ ...page.items[0], externalPublicationId: 'other-video' }] };
  const { useCase, calls } = createUseCase({ response: invalidPage });

  await assert.rejects(useCase.execute({ accountId, publicationId: 'video-1' }), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_PROVIDER_RESPONSE_INVALID');
  assert.equal(calls.some((call) => call.operation === 'savePage'), false);
});

test('SyncPublicationComments accepts a creator reply for a comment loaded on an earlier provider page', async () => {
  const priorPageReply = { ...page.creatorReplies[0], externalCommentId: 'earlier-comment' };
  const invalidPage = {
    items: [],
    creatorReplies: [priorPageReply],
    nextCursor: null,
  };
  const { useCase, calls } = createUseCase({ response: invalidPage });

  const result = await useCase.execute({ accountId, publicationId: 'video-1' });

  assert.equal(result.items.length, 0);
  assert.deepEqual(calls.find((call) => call.operation === 'savePage').args[5], [priorPageReply]);
});

test('SyncPublicationComments rejects a creator reply associated with another publication', async () => {
  const invalidPage = {
    ...page,
    creatorReplies: [{ ...page.creatorReplies[0], externalPublicationId: 'other-video' }],
  };
  const { useCase, calls } = createUseCase({ response: invalidPage });

  await assert.rejects(
    useCase.execute({ accountId, publicationId: 'video-1' }),
    (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_PROVIDER_RESPONSE_INVALID',
  );
  assert.equal(calls.some((call) => call.operation === 'savePage'), false);
});

test('SyncPublicationComments reports unsupported platform without calling a reader', async () => {
  const instagram = SocialAccount.create({ ...account, platform: 'instagram' });
  const { useCase, calls } = createUseCase({ foundAccount: instagram, readerPlatform: null });

  await assert.rejects(useCase.execute({ accountId, publicationId: 'video-1' }), (error) => error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
  assert.equal(calls.some((call) => call.operation === 'readComments'), false);
  assert.equal(calls.some((call) => call.operation === 'savePage'), false);
});
