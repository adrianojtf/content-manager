import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { SocialAccountDisconnectError } = require('../../dist-e2e/src/application/social/disconnect-social-account.js');
const { createSocialAccountsE2eModule } = require('../../dist-e2e/test/e2e/support/social-accounts-e2e.module.js');

test('profile settings account list returns safe connected-account summaries without contacting providers', async () => {
  const accounts = [
    { id: '5b7f1f84-25a8-4bd8-a7df-680dc4400101', platform: 'youtube', externalAccountId: 'UC-safe', displayName: 'Creator channel' },
  ];
  let calls = 0;
  const app = await NestFactory.create(createSocialAccountsE2eModule({
    execute: async () => { calls += 1; return accounts; },
  }, {
    execute: async () => {},
  }), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/social/accounts`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), accounts);
  } finally {
    await app.close();
  }
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(accounts).includes('credentialReference'), false);
});

test('profile settings can disconnect an account and return not found for an absent account', async () => {
  const disconnected = [];
  const app = await NestFactory.create(createSocialAccountsE2eModule({
    execute: async () => [],
  }, {
    execute: async (accountId) => {
      if (accountId === '5b7f1f84-25a8-4bd8-a7df-680dc4400102') {
        throw new SocialAccountDisconnectError('SOCIAL_ACCOUNT_NOT_FOUND');
      }
      disconnected.push(accountId);
    },
  }), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await app.getUrl();
    const success = await fetch(`${baseUrl}/social/accounts/5b7f1f84-25a8-4bd8-a7df-680dc4400101`, { method: 'DELETE' });
    assert.equal(success.status, 204);
    const notFound = await fetch(`${baseUrl}/social/accounts/5b7f1f84-25a8-4bd8-a7df-680dc4400102`, { method: 'DELETE' });
    assert.equal(notFound.status, 404);
    assert.deepEqual(await notFound.json(), { code: 'SOCIAL_ACCOUNT_NOT_FOUND' });
  } finally {
    await app.close();
  }
  assert.deepEqual(disconnected, ['5b7f1f84-25a8-4bd8-a7df-680dc4400101']);
});
