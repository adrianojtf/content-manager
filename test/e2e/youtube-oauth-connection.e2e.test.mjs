import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createYouTubeOAuthE2eModule } = require('../../dist-e2e/test/e2e/support/youtube-oauth-e2e.module.js');

const account = { id: 'account-id', platform: 'youtube', externalAccountId: 'UC-channel-1', displayName: 'Creator channel' };

test('YouTube OAuth authorize endpoint redirects to provider and forwards explicit reply opt-in', async () => {
  const calls = [];
  const begin = { execute: async (input) => { calls.push(input); return { authorizationUrl: 'https://accounts.google.test/authorize?state=oauth-state' }; } };
  const complete = { execute: async () => account };
  const app = await NestFactory.create(createYouTubeOAuthE2eModule(begin, complete), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const readOnlyResponse = await fetch(`${await app.getUrl()}/social/connections/youtube/authorize`, { redirect: 'manual' });
    assert.equal(readOnlyResponse.status, 302);
    assert.equal(readOnlyResponse.headers.get('location'), 'https://accounts.google.test/authorize?state=oauth-state');

    const replyResponse = await fetch(`${await app.getUrl()}/social/connections/youtube/authorize?enableReplies=true`, { redirect: 'manual' });
    assert.equal(replyResponse.status, 302);
    assert.deepEqual(calls, [{ enableReplies: false }, { enableReplies: true }]);
  } finally {
    await app.close();
  }
});

test('YouTube OAuth callback returns only sanitized account data', async () => {
  const calls = [];
  const begin = { execute: async () => ({ authorizationUrl: 'https://accounts.google.test/authorize' }) };
  const complete = { execute: async (input) => { calls.push(input); return account; } };
  const app = await NestFactory.create(createYouTubeOAuthE2eModule(begin, complete), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/social/connections/youtube/callback?state=oauth-state&code=authorization-code`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), account);
    assert.deepEqual(calls, [{ state: 'oauth-state', code: 'authorization-code', providerError: undefined }]);
  } finally {
    await app.close();
  }
});
