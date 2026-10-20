import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createSocialCommentsE2eModule } = require('../../dist-e2e/test/e2e/support/social-comments-e2e.module.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');

const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const page = {
  account: { id: accountId, platform: 'youtube', externalAccountId: 'UC-channel-1', displayName: 'Creator channel' },
  publicationId: 'video-1',
  items: [{ platform: 'youtube', externalCommentId: 'comment-1', externalThreadId: 'thread-1', externalPublicationId: 'video-1', canReply: true }],
  nextCursor: 'next-comments',
  synchronizedAt: '2026-10-13T12:00:00.000Z',
  expiresAt: '2026-11-12T12:00:00.000Z',
};

async function runWithSyncUseCase(useCase, request, listComments) {
  const app = await NestFactory.create(createSocialCommentsE2eModule(useCase, listComments), { logger: false });
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

test('comment listing HTTP route returns persisted app and external reply states', async () => {
  const comments = [{ externalCommentId: 'comment-1', appReplied: true, externalReplyStatus: 'UNKNOWN' }];
  const calls = [];
  const listComments = { execute: async (input) => { calls.push(input); return comments; } };
  const response = await runWithSyncUseCase({ execute: async () => page }, (baseUrl) => fetch(`${baseUrl}/social/accounts/${accountId}/publications/video-1/comments`), listComments);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), comments);
  assert.deepEqual(calls, [{ accountId, publicationId: 'video-1' }]);
});

test('comment sync HTTP route returns stable provider failures without leaking provider text', async () => {
  const useCase = { execute: async () => { throw new SocialProviderError('SOCIAL_PROVIDER_RATE_LIMITED'); } };
  const response = await runWithSyncUseCase(useCase, (baseUrl) => fetch(`${baseUrl}/social/accounts/${accountId}/publications/video-1/comments/sync`, { method: 'POST' }));

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { code: 'SOCIAL_PROVIDER_RATE_LIMITED' });
});
