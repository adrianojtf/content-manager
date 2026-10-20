import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createSocialPublicationsE2eModule } = require('../../dist-e2e/test/e2e/support/social-publications-e2e.module.js');

const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const expected = [{
  account: { id: accountId, platform: 'youtube', externalAccountId: 'UC-channel-1', displayName: 'Creator channel' },
  status: 'available',
  items: [{ platform: 'youtube', externalPublicationId: 'video-1' }],
  nextCursor: 'cursor-next',
}];

test('social publications HTTP route returns normalized per-account results and forwards a scoped cursor', async () => {
  const calls = [];
  const useCase = { execute: async (input) => { calls.push(input); return expected; } };
  const app = await NestFactory.create(createSocialPublicationsE2eModule(useCase), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/social/publications?accountId=${accountId}&cursor=cursor-one`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    assert.deepEqual(calls, [{ accountId, cursors: { [accountId]: 'cursor-one' } }]);
  } finally {
    await app.close();
  }
});

test('social publications HTTP route rejects unscoped cursors and returns 404 for unknown tenant account IDs', async () => {
  const useCase = { execute: async ({ accountId } = {}) => accountId ? [] : expected };
  const app = await NestFactory.create(createSocialPublicationsE2eModule(useCase), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const cursorResponse = await fetch(`${await app.getUrl()}/social/publications?cursor=cursor-one`);
    assert.equal(cursorResponse.status, 400);

    const missingAccountResponse = await fetch(`${await app.getUrl()}/social/publications?accountId=5b7f1f84-25a8-4bd8-a7df-680dc4400099`);
    assert.equal(missingAccountResponse.status, 404);
  } finally {
    await app.close();
  }
});
