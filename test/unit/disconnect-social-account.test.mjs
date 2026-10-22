import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { DisconnectSocialAccount, SocialAccountDisconnectError } = require('../../dist/application/social/disconnect-social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400101');

test('disconnect removes an account only in the server-resolved tenant', async () => {
  const calls = [];
  const useCase = new DisconnectSocialAccount(
    { disconnect: async (...args) => { calls.push(['disconnect', ...args]); return true; } },
    { resolveTenantId: async () => { calls.push(['tenant']); return tenantId; } },
  );

  await useCase.execute(accountId);

  assert.deepEqual(calls, [['tenant'], ['disconnect', tenantId, accountId]]);
});

test('disconnect returns the same not-found error for missing or other-tenant accounts', async () => {
  const useCase = new DisconnectSocialAccount(
    { disconnect: async () => false },
    { resolveTenantId: async () => tenantId },
  );

  await assert.rejects(useCase.execute(accountId), (error) => (
    error instanceof SocialAccountDisconnectError && error.code === 'SOCIAL_ACCOUNT_NOT_FOUND'
  ));
});

test('disconnect validates the account ID before resolving tenant scope', async () => {
  let tenantResolved = false;
  const useCase = new DisconnectSocialAccount(
    { disconnect: async () => true },
    { resolveTenantId: async () => { tenantResolved = true; return tenantId; } },
  );

  await assert.rejects(useCase.execute('not-an-id'), (error) => error.code === 'SOCIAL_ACCOUNT_ID_INVALID');
  assert.equal(tenantResolved, false);
});
