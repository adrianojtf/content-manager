import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createSocialPublicationsE2eModule } = require('../../dist-e2e/test/e2e/support/social-publications-e2e.module.js');
const { ListSocialPublications } = require('../../dist/application/social/list-social-publications.js');
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
const expected = [{
  account: { id: accountId, platform: 'youtube', externalAccountId: 'UC-channel-1', displayName: 'Creator channel' },
  status: 'available',
  items: [{ platform: 'youtube', externalPublicationId: 'video-1' }],
  nextCursor: 'cursor-next',
}];

test('social publications HTTP route returns normalized results and forwards the cursor and page size', async () => {
  const calls = [];
  const useCase = { execute: async (input) => { calls.push(input); return expected; } };
  const app = await NestFactory.create(createSocialPublicationsE2eModule(useCase), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/social/publications?accountId=${accountId}&cursor=cursor-one&pageSize=10&platform=youtube`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    assert.deepEqual(calls, [{ accountId, cursors: { [accountId]: 'cursor-one' }, pageSize: 10, platform: 'youtube' }]);
  } finally {
    await app.close();
  }
});

test('social publications HTTP journey persists only the fetched provider page', async () => {
  const items = [{
    platform: 'youtube',
    externalPublicationId: 'video-1',
    title: 'Episode 1',
    description: null,
    permalink: 'https://youtube.example/video-1',
    thumbnailUrl: null,
    publishedAt: '2026-10-12T10:00:00.000Z',
  }];
  const writes = [];
  const useCase = new ListSocialPublications(
    { listByTenant: async () => [account] },
    { resolveTenantId: async () => tenantId },
    { youtube: { listPublications: async () => ({ items, nextCursor: 'next-page' }) } },
    { upsertPage: async (...args) => writes.push(args) },
    () => Date.parse('2026-10-13T12:00:00.000Z'),
  );
  const app = await NestFactory.create(createSocialPublicationsE2eModule(useCase), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/social/publications?accountId=${accountId}&pageSize=5&platform=youtube`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{
      account: { id: accountId, platform: 'youtube', externalAccountId: 'UC-channel-1', displayName: 'Creator channel' },
      status: 'available',
      items,
      nextCursor: 'next-page',
    }]);
    assert.deepEqual(writes, [[account, items, '2026-10-13T12:00:00.000Z']]);
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

    const invalidPageSize = await fetch(`${await app.getUrl()}/social/publications?pageSize=7`);
    assert.equal(invalidPageSize.status, 400);
    const invalidPlatform = await fetch(`${await app.getUrl()}/social/publications?platform=all`);
    assert.equal(invalidPlatform.status, 400);

    const missingAccountResponse = await fetch(`${await app.getUrl()}/social/publications?accountId=5b7f1f84-25a8-4bd8-a7df-680dc4400099`);
    assert.equal(missingAccountResponse.status, 404);
  } finally {
    await app.close();
  }
});
