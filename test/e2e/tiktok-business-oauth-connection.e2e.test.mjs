import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { TikTokBusinessOAuthError } = require('../../dist/application/social/tiktok-business-oauth-error.js');
const { createTikTokBusinessOAuthE2eModule } = require('../../dist-e2e/test/e2e/support/tiktok-business-oauth-e2e.module.js');

const account = { id: 'tiktok-account', platform: 'tiktok', externalAccountId: 'business-open-id-1', displayName: null };

test('TikTok Business OAuth HTTP flow redirects to configured authorization and connects only the token response identity', async () => {
  const callbackCalls = [];
  const begin = { execute: async () => ({ authorizationUrl: 'https://www.tiktok.com/authorize?state=state-1' }) };
  const complete = { execute: async (input) => { callbackCalls.push(input); return account; } };
  const app = await NestFactory.create(createTikTokBusinessOAuthE2eModule(begin, complete), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const authorization = await fetch(`${await app.getUrl()}/social/connections/tiktok/authorize`, { redirect: 'manual' });
    assert.equal(authorization.status, 302);
    assert.equal(authorization.headers.get('location'), 'https://www.tiktok.com/authorize?state=state-1');

    const callback = await fetch(`${await app.getUrl()}/social/connections/tiktok/callback?state=state-1&auth_code=one-time-code`);
    assert.equal(callback.status, 200);
    assert.deepEqual(await callback.json(), account);
    assert.deepEqual(callbackCalls, [{ state: 'state-1', authCode: 'one-time-code', providerError: undefined }]);
  } finally {
    await app.close();
  }
});

test('TikTok Business callback reads the configured state query parameter', async () => {
  const previousStateParameter = process.env.TIKTOK_BUSINESS_STATE_PARAMETER;
  process.env.TIKTOK_BUSINESS_STATE_PARAMETER = 'csrf_state';
  const completeCalls = [];
  const begin = { execute: async () => ({ authorizationUrl: 'https://www.tiktok.com/authorize' }) };
  const complete = { execute: async (input) => { completeCalls.push(input); return account; } };
  const app = await NestFactory.create(createTikTokBusinessOAuthE2eModule(begin, complete), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/social/connections/tiktok/callback?csrf_state=state-1&auth_code=one-time-code`);
    assert.equal(response.status, 200);
    assert.deepEqual(completeCalls, [{ state: 'state-1', authCode: 'one-time-code', providerError: undefined }]);
  } finally {
    await app.close();
    if (previousStateParameter === undefined) delete process.env.TIKTOK_BUSINESS_STATE_PARAMETER;
    else process.env.TIKTOK_BUSINESS_STATE_PARAMETER = previousStateParameter;
  }
});

test('TikTok Business OAuth callback accepts the provider alias and maps state failures to a stable error', async () => {
  const begin = { execute: async () => ({ authorizationUrl: 'https://www.tiktok.com/authorize' }) };
  const complete = { execute: async () => { throw new TikTokBusinessOAuthError('TIKTOK_BUSINESS_OAUTH_STATE_INVALID'); } };
  const app = await NestFactory.create(createTikTokBusinessOAuthE2eModule(begin, complete), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/social/connections/tiktok/callback?state=invalid&code=one-time-code`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { code: 'TIKTOK_BUSINESS_OAUTH_STATE_INVALID' });
  } finally {
    await app.close();
  }
});
