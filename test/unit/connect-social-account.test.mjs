import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ConnectSocialAccount } = require('../../dist/application/social/connect-social-account.js');

const pilotTenantId = '10000000-0000-4000-8000-000000000001';
const input = {
  platform: 'youtube',
  externalAccountId: 'UC-channel-1',
  displayName: 'Creator channel',
  credentialReference: 'vault/social/youtube/account-1',
};

function createUseCase(existingAccount = null, tenantContext = { resolveTenantId: async () => pilotTenantId }) {
  const saves = [];
  const repository = {
    findByProviderIdentity: async () => existingAccount,
    save: async (tenantId, account) => saves.push({ tenantId, account }),
  };
  const ids = { generate: () => '5b7f1f84-25a8-4bd8-a7df-680dc4400001' };
  return { useCase: new ConnectSocialAccount(repository, tenantContext, ids), saves };
}

test('ConnectSocialAccount derives tenant on the server, persists provider identity, and never returns the credential reference', async () => {
  const { useCase, saves } = createUseCase();

  const result = await useCase.execute({ ...input, tenantId: '10000000-0000-4000-8000-000000000099' });

  assert.equal(saves.length, 1);
  assert.equal(saves[0].tenantId, pilotTenantId);
  assert.equal(saves[0].account.tenantId, pilotTenantId);
  assert.equal(saves[0].account.credentialReference, input.credentialReference);
  assert.deepEqual(result, {
    id: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
    platform: 'youtube',
    externalAccountId: input.externalAccountId,
    displayName: input.displayName,
  });
  assert.equal('credentialReference' in result, false);
});

test('ConnectSocialAccount reuses the connected account identity after reauthorization', async () => {
  const existingAccount = {
    id: '5b7f1f84-25a8-4bd8-a7df-680dc4400002',
    tenantId: pilotTenantId,
  };
  const { useCase, saves } = createUseCase(existingAccount);

  const result = await useCase.execute({ ...input, credentialReference: 'vault/social/youtube/account-1/refresh-2' });

  assert.equal(saves[0].account.id, existingAccount.id);
  assert.equal(saves[0].account.credentialReference, 'vault/social/youtube/account-1/refresh-2');
  assert.equal(result.id, existingAccount.id);
});

test('ConnectSocialAccount aborts before persistence if server tenant resolution fails', async () => {
  const tenantContext = { resolveTenantId: async () => { throw new Error('PILOT_TENANT_CONTEXT_UNAVAILABLE'); } };
  const { useCase, saves } = createUseCase(null, tenantContext);

  await assert.rejects(useCase.execute(input), /PILOT_TENANT_CONTEXT_UNAVAILABLE/);
  assert.deepEqual(saves, []);
});
