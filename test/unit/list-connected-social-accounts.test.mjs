import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ListConnectedSocialAccounts } = require('../../dist/application/social/list-connected-social-accounts.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');

const tenantId = '30000000-0000-4000-8000-000000000001';

test('account profile listing returns tenant-scoped safe summaries without resolving credentials or calling providers', async () => {
  const accounts = [
    SocialAccount.create({
      id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400101'),
      tenantId,
      platform: 'instagram',
      externalAccountId: 'ig-user-1',
      displayName: 'Creator IG',
      credentialReference: 'vault-secret-reference',
    }),
    SocialAccount.create({
      id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400102'),
      tenantId,
      platform: 'facebook',
      externalAccountId: 'page-2',
      displayName: null,
      credentialReference: 'another-vault-reference',
    }),
  ];
  const calls = [];
  const useCase = new ListConnectedSocialAccounts(
    { listByTenant: async (...args) => { calls.push(['list', ...args]); return accounts; } },
    { resolveTenantId: async () => { calls.push(['tenant']); return tenantId; } },
  );

  const result = await useCase.execute();

  assert.deepEqual(result, [
    { id: '5b7f1f84-25a8-4bd8-a7df-680dc4400101', platform: 'instagram', externalAccountId: 'ig-user-1', displayName: 'Creator IG' },
    { id: '5b7f1f84-25a8-4bd8-a7df-680dc4400102', platform: 'facebook', externalAccountId: 'page-2', displayName: null },
  ]);
  assert.deepEqual(calls, [['tenant'], ['list', tenantId]]);
  assert.equal(JSON.stringify(result).includes('vault-secret-reference'), false);
  assert.equal(JSON.stringify(result).includes('tenantId'), false);
});
