import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { InstagramOAuthError } = require('../../dist/application/social/instagram-oauth-error.js');
const { createInstagramOAuthE2eModule } = require('../../dist-e2e/test/e2e/support/instagram-oauth-e2e.module.js');

const account = { id: 'instagram-account', platform: 'instagram', externalAccountId: '17841400000000001', displayName: 'creator_name' };

test('Instagram OAuth HTTP flow redirects to Instagram Login and returns only the connected account', async () => {
  const calls = [];
  const begin = { execute: async () => ({ authorizationUrl: 'https://www.instagram.com/oauth/authorize?state=state-1' }) };
  const complete = { execute: async (input) => { calls.push(input); return account; } };
  const app = await NestFactory.create(createInstagramOAuthE2eModule(begin, complete), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const authorization = await fetch(`${await app.getUrl()}/social/connections/instagram/authorize`, { redirect: 'manual' });
    assert.equal(authorization.status, 302);
    assert.equal(authorization.headers.get('location'), 'https://www.instagram.com/oauth/authorize?state=state-1');

    const callback = await fetch(`${await app.getUrl()}/social/connections/instagram/callback?state=state-1&code=authorization-code`);
    assert.equal(callback.status, 200);
    assert.deepEqual(await callback.json(), account);
    assert.deepEqual(calls, [{ state: 'state-1', code: 'authorization-code', providerError: undefined }]);
  } finally {
    await app.close();
  }
});

test('Instagram OAuth HTTP callback maps state failures to a stable client error', async () => {
  const begin = { execute: async () => ({ authorizationUrl: 'https://www.instagram.com/oauth/authorize' }) };
  const complete = { execute: async () => { throw new InstagramOAuthError('INSTAGRAM_OAUTH_STATE_INVALID'); } };
  const app = await NestFactory.create(createInstagramOAuthE2eModule(begin, complete), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/social/connections/instagram/callback?state=invalid&code=code`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { code: 'INSTAGRAM_OAUTH_STATE_INVALID' });
  } finally {
    await app.close();
  }
});
