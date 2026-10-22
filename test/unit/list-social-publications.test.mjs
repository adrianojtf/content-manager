import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ListSocialPublications } = require('../../dist/application/social/list-social-publications.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const youtube = SocialAccount.create({
  id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001'),
  tenantId,
  platform: 'youtube',
  externalAccountId: 'UC-channel-1',
  displayName: 'Creator channel',
  credentialReference: 'vault/social/youtube/account-1',
});
const instagram = SocialAccount.create({
  id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400002'),
  tenantId,
  platform: 'instagram',
  externalAccountId: 'ig-account-1',
  displayName: 'Creator Instagram',
  credentialReference: 'vault/social/instagram/account-1',
});

function publication(externalPublicationId, overrides = {}) {
  return {
    platform: 'youtube',
    externalPublicationId,
    title: null,
    description: null,
    permalink: null,
    thumbnailUrl: null,
    publishedAt: null,
    ...overrides,
  };
}

function makeUseCase({ accounts = [youtube, instagram], readers = {}, publicationRepository } = {}) {
  const calls = [];
  const publicationWrites = [];
  const repository = { listByTenant: async (scope) => { assert.equal(scope, tenantId); return accounts; } };
  const publications = publicationRepository ?? {
    upsertPage: async (...args) => publicationWrites.push(args),
  };
  const pilotTenant = { resolveTenantId: async () => tenantId };
  const readerRegistry = Object.fromEntries(Object.entries(readers).map(([platform, result]) => [platform, {
    listPublications: async (account, cursor, pageSize) => {
      calls.push({ accountId: account.id, cursor, pageSize });
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  }]));
  return {
    useCase: new ListSocialPublications(repository, pilotTenant, readerRegistry, publications, () => Date.parse('2026-10-13T12:00:00.000Z')),
    calls,
    publicationWrites,
  };
}

test('ListSocialPublications resolves tenant server-side and returns account-level partial outcomes without credential references', async () => {
  const page = { items: [publication('video-1')], nextCursor: 'next-youtube' };
  const { useCase, calls } = makeUseCase({ readers: { youtube: page } });

  const result = await useCase.execute({ cursors: { [youtube.id]: 'cursor-one' } });

  assert.deepEqual(calls, [{ accountId: youtube.id, cursor: 'cursor-one', pageSize: 5 }]);
  assert.deepEqual(result, [
    {
      account: { id: youtube.id, platform: 'youtube', externalAccountId: 'UC-channel-1', displayName: 'Creator channel' },
      status: 'available',
      items: page.items,
      nextCursor: 'next-youtube',
    },
    {
      account: { id: instagram.id, platform: 'instagram', externalAccountId: 'ig-account-1', displayName: 'Creator Instagram' },
      status: 'unsupported',
      errorCode: 'SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED',
    },
  ]);
  assert.equal(JSON.stringify(result).includes('credentialReference'), false);
  assert.equal(JSON.stringify(result).includes('vault/social'), false);
});

test('ListSocialPublications preserves one provider failure without discarding another account result', async () => {
  const youtubePage = { items: [publication('video-1')], nextCursor: null };
  const { useCase, publicationWrites } = makeUseCase({
    readers: {
      youtube: youtubePage,
      instagram: new SocialProviderError('SOCIAL_PROVIDER_RATE_LIMITED'),
    },
  });

  const result = await useCase.execute();

  assert.equal(result[0].status, 'available');
  assert.deepEqual(result[0].items, youtubePage.items);
  assert.deepEqual(result[1], {
    account: { id: instagram.id, platform: 'instagram', externalAccountId: 'ig-account-1', displayName: 'Creator Instagram' },
    status: 'failed',
    errorCode: 'SOCIAL_PROVIDER_RATE_LIMITED',
  });
  assert.equal(publicationWrites.length, 1);
  assert.equal(publicationWrites[0][0], youtube);
});

test('ListSocialPublications filters to an account ID only within the server-resolved tenant', async () => {
  const page = { items: [publication('video-1')], nextCursor: 'next-youtube' };
  const { useCase, calls } = makeUseCase({ readers: { youtube: page } });

  const result = await useCase.execute({ accountId: youtube.id });

  assert.equal(result.length, 1);
  assert.equal(result[0].account.id, youtube.id);
  assert.deepEqual(calls, [{ accountId: youtube.id, cursor: undefined, pageSize: 5 }]);
});

test('ListSocialPublications passes an allowed page size to each provider reader', async () => {
  const { useCase, calls } = makeUseCase({
    accounts: [youtube],
    readers: { youtube: { items: [], nextCursor: null } },
  });

  await useCase.execute({ pageSize: 25 });

  assert.deepEqual(calls, [{ accountId: youtube.id, cursor: undefined, pageSize: 25 }]);
});

test('ListSocialPublications persists each successful provider page with the server-owned account and sync time', async () => {
  const page = {
    items: [
      publication('video-1', { title: 'Episode 1', permalink: 'https://youtube.example/1', publishedAt: '2026-10-12T10:00:00.000Z' }),
    ],
    nextCursor: 'next-youtube',
  };
  const { useCase, publicationWrites } = makeUseCase({ accounts: [youtube], readers: { youtube: page } });

  const result = await useCase.execute({ accountId: youtube.id });

  assert.equal(result[0].status, 'available');
  assert.deepEqual(publicationWrites, [[youtube, page.items, '2026-10-13T12:00:00.000Z']]);
});

test('ListSocialPublications reports persistence failures without exposing database details', async () => {
  const page = { items: [publication('video-1')], nextCursor: null };
  const { useCase } = makeUseCase({
    accounts: [youtube],
    readers: { youtube: page },
    publicationRepository: { upsertPage: async () => { throw new Error('database connection string'); } },
  });

  const [result] = await useCase.execute({ accountId: youtube.id });

  assert.deepEqual(result, {
    account: { id: youtube.id, platform: 'youtube', externalAccountId: 'UC-channel-1', displayName: 'Creator channel' },
    status: 'failed',
    errorCode: 'SOCIAL_PUBLICATION_PERSISTENCE_FAILED',
  });
  assert.equal(JSON.stringify(result).includes('database connection string'), false);
});

test('ListSocialPublications filters providers to the requested platform', async () => {
  const { useCase, calls } = makeUseCase({
    readers: {
      youtube: { items: [], nextCursor: null },
      instagram: { items: [], nextCursor: null },
    },
  });

  const results = await useCase.execute({ platform: 'instagram' });

  assert.deepEqual(results.map(({ account }) => account.platform), ['instagram']);
  assert.deepEqual(calls, [{ accountId: instagram.id, cursor: undefined, pageSize: 5 }]);
});

test('ListSocialPublications returns an empty list without calling a provider when no accounts are connected', async () => {
  const { useCase, calls } = makeUseCase({ accounts: [], readers: { youtube: { items: [], nextCursor: null } } });

  assert.deepEqual(await useCase.execute(), []);
  assert.deepEqual(calls, []);
});
