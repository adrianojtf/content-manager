import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { FacebookOAuthError } = require('../../dist/application/social/facebook-oauth-error.js');
const { createFacebookOAuthE2eModule } = require('../../dist-e2e/test/e2e/support/facebook-oauth-e2e.module.js');

const selection = { selectionId: 'one-time-selection', pages: [{ externalAccountId: 'page-1', displayName: 'Creator Page' }, { externalAccountId: 'page-2', displayName: 'Studio Page' }] };
const account = { id: 'facebook-page', platform: 'facebook', externalAccountId: 'page-2', displayName: 'Studio Page' };

test('Facebook OAuth HTTP flow returns Page candidates and connects only the explicitly selected Page', async () => {
  const calls = [];
  const begin = { execute: async () => ({ authorizationUrl: 'https://www.facebook.com/v25.0/dialog/oauth?state=state-1' }) };
  const complete = { execute: async (input) => { calls.push({ type: 'callback', input }); return selection; } };
  const select = { execute: async (input) => { calls.push({ type: 'select', input }); return account; } };
  const app = await NestFactory.create(createFacebookOAuthE2eModule(begin, complete, select), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const authorization = await fetch(`${await app.getUrl()}/social/connections/facebook/authorize`, { redirect: 'manual' });
    assert.equal(authorization.status, 302);
    assert.equal(authorization.headers.get('location'), 'https://www.facebook.com/v25.0/dialog/oauth?state=state-1');

    const callback = await fetch(`${await app.getUrl()}/social/connections/facebook/callback?state=state-1&code=authorization-code`);
    assert.equal(callback.status, 200);
    assert.deepEqual(await callback.json(), selection);

    const chosen = await fetch(`${await app.getUrl()}/social/connections/facebook/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectionId: selection.selectionId, pageId: 'page-2' }),
    });
    assert.equal(chosen.status, 201);
    assert.deepEqual(await chosen.json(), account);
    assert.deepEqual(calls, [
      { type: 'callback', input: { state: 'state-1', code: 'authorization-code', providerError: undefined } },
      { type: 'select', input: { selectionId: 'one-time-selection', pageId: 'page-2' } },
    ]);
  } finally {
    await app.close();
  }
});

test('Facebook OAuth HTTP selection maps invalid Page choice to a stable client error', async () => {
  const begin = { execute: async () => ({ authorizationUrl: 'https://www.facebook.com/v25.0/dialog/oauth' }) };
  const complete = { execute: async () => selection };
  const select = { execute: async () => { throw new FacebookOAuthError('FACEBOOK_OAUTH_PAGE_SELECTION_INVALID'); } };
  const app = await NestFactory.create(createFacebookOAuthE2eModule(begin, complete, select), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/social/connections/facebook/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectionId: 'selection', pageId: 'unlisted-page' }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { code: 'FACEBOOK_OAUTH_PAGE_SELECTION_INVALID' });
  } finally {
    await app.close();
  }
});
