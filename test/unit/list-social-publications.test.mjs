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

function makeUseCase({ accounts = [youtube, instagram], readers = {} } = {}) {
  const calls = [];
  const repository = { listByTenant: async (scope) => { assert.equal(scope, tenantId); return accounts; } };
  const pilotTenant = { resolveTenantId: async () => tenantId };
  const readerRegistry = Object.fromEntries(Object.entries(readers).map(([platform, result]) => [platform, {
    listPublications: async (account, cursor) => {
      calls.push({ accountId: account.id, cursor });
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  }]));
  return { useCase: new ListSocialPublications(repository, pilotTenant, readerRegistry), calls };
}

test('ListSocialPublications resolves tenant server-side and returns account-level partial outcomes without credential references', async () => {
  const page = { items: [{ platform: 'youtube', externalPublicationId: 'video-1' }], nextCursor: 'next-youtube' };
  const { useCase, calls } = makeUseCase({ readers: { youtube: page } });

  const result = await useCase.execute({ cursors: { [youtube.id]: 'cursor-one' } });

  assert.deepEqual(calls, [{ accountId: youtube.id, cursor: 'cursor-one' }]);
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
  const youtubePage = { items: [{ platform: 'youtube', externalPublicationId: 'video-1' }], nextCursor: null };
  const { useCase } = makeUseCase({
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
});

test('ListSocialPublications filters to an account ID only within the server-resolved tenant', async () => {
  const page = { items: [{ platform: 'youtube', externalPublicationId: 'video-1' }], nextCursor: 'next-youtube' };
  const { useCase, calls } = makeUseCase({ readers: { youtube: page } });

  const result = await useCase.execute({ accountId: youtube.id });

  assert.equal(result.length, 1);
  assert.equal(result[0].account.id, youtube.id);
  assert.deepEqual(calls, [{ accountId: youtube.id, cursor: undefined }]);
});

test('ListSocialPublications returns an empty list without calling a provider when no accounts are connected', async () => {
  const { useCase, calls } = makeUseCase({ accounts: [], readers: { youtube: { items: [], nextCursor: null } } });

  assert.deepEqual(await useCase.execute(), []);
  assert.deepEqual(calls, []);
});
