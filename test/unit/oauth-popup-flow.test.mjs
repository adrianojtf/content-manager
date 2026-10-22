import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOAuthAuthorizePath, normalizeOAuthCallbackResult, openOAuthPopup } from '../../web/oauth-flow.mjs';

test('OAuth popup routes use the provider endpoints and keep YouTube reply access opt-in', () => {
  assert.equal(buildOAuthAuthorizePath('youtube'), '/social/connections/youtube/authorize');
  assert.equal(buildOAuthAuthorizePath('youtube', { enableReplies: true }), '/social/connections/youtube/authorize?enableReplies=true');
  assert.equal(buildOAuthAuthorizePath('instagram'), '/social/connections/instagram/authorize');
  assert.equal(buildOAuthAuthorizePath('facebook'), '/social/connections/facebook/authorize');
  assert.equal(buildOAuthAuthorizePath('tiktok'), '/social/connections/tiktok/authorize');
  assert.throws(() => buildOAuthAuthorizePath('unknown'), /SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED/);
});

test('OAuth callback payloads distinguish connected accounts from explicit Facebook Page selection', () => {
  const account = {
    id: 'account-1',
    platform: 'youtube',
    externalAccountId: 'UC-one',
    displayName: 'Creator',
    credentialReference: 'must-not-be-kept',
    accessToken: 'must-not-be-kept',
  };
  assert.deepEqual(normalizeOAuthCallbackResult('youtube', account), {
    type: 'connected',
    account: { id: 'account-1', platform: 'youtube', externalAccountId: 'UC-one', displayName: 'Creator' },
  });
  assert.deepEqual(normalizeOAuthCallbackResult('facebook', {
    selectionId: 'one-time-selection',
    pages: [{ externalAccountId: 'page-1', displayName: 'Creator Page' }],
  }), {
    type: 'facebook-pages',
    selectionId: 'one-time-selection',
    pages: [{ pageId: 'page-1', displayName: 'Creator Page' }],
  });
  assert.throws(() => normalizeOAuthCallbackResult('instagram', { code: 'INSTAGRAM_OAUTH_DENIED' }), /INSTAGRAM_OAUTH_DENIED/);
});

test('OAuth popup reads the same-origin callback result and closes after successful account authorization', async () => {
  const popup = {
    closed: false,
    location: { href: 'http://localhost:3000/social/connections/youtube/callback' },
    document: { body: { innerText: JSON.stringify({ id: 'account-1', platform: 'youtube', externalAccountId: 'UC-one', displayName: 'Creator' }) } },
    close() { this.closed = true; },
  };
  const opened = [];
  const fakeWindow = {
    location: { origin: 'http://localhost:3000' },
    open: (...args) => { opened.push(args); return popup; },
    setInterval: (callback) => { queueMicrotask(callback); return 11; },
    clearInterval: () => {},
    setTimeout: () => 12,
    clearTimeout: () => {},
  };

  const result = await openOAuthPopup('youtube', { windowRef: fakeWindow });

  assert.deepEqual(result, {
    type: 'connected',
    account: { id: 'account-1', platform: 'youtube', externalAccountId: 'UC-one', displayName: 'Creator' },
  });
  assert.equal(opened[0][0], '/social/connections/youtube/authorize');
  assert.equal(popup.closed, true);
});

test('OAuth popup surfaces missing runtime configuration from the authorize endpoint', async () => {
  const popup = {
    closed: false,
    location: { href: 'http://localhost:3000/social/connections/tiktok/authorize' },
    document: { body: { innerText: JSON.stringify({ code: 'TIKTOK_BUSINESS_OAUTH_CONFIGURATION_REQUIRED' }) } },
    close() { this.closed = true; },
  };
  const fakeWindow = {
    location: { origin: 'http://localhost:3000' },
    open: () => popup,
    setInterval: (callback) => { queueMicrotask(callback); return 21; },
    clearInterval: () => {},
    setTimeout: () => 22,
    clearTimeout: () => {},
  };

  await assert.rejects(
    openOAuthPopup('tiktok', { windowRef: fakeWindow }),
    (error) => error.code === 'TIKTOK_BUSINESS_OAUTH_CONFIGURATION_REQUIRED',
  );
  assert.equal(popup.closed, true);
});
