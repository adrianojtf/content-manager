import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { InMemoryYouTubeOAuthFlowStateStore } = require('../../dist/infrastructure/social/in-memory-youtube-oauth-flow-state-store.js');
const { BeginYouTubeOAuth } = require('../../dist/application/social/begin-youtube-oauth.js');
const { CompleteYouTubeOAuth } = require('../../dist/application/social/complete-youtube-oauth.js');
const { YouTubeOAuthError } = require('../../dist/application/social/youtube-oauth-error.js');

const readonlyScope = 'https://www.googleapis.com/auth/youtube.readonly';
const replyScope = 'https://www.googleapis.com/auth/youtube.force-ssl';
const tenantId = '30000000-0000-4000-8000-000000000001';

function createStateStore(now = () => Date.parse('2026-10-13T12:00:00.000Z')) {
  return new InMemoryYouTubeOAuthFlowStateStore(now);
}

test('YouTube OAuth state is single-use, expires, and preserves requested scopes with a PKCE verifier', () => {
  let now = Date.parse('2026-10-13T12:00:00.000Z');
  const stateStore = createStateStore(() => now);
  const pending = stateStore.issue([readonlyScope]);

  assert.ok(pending.state.length >= 32);
  assert.ok(pending.codeVerifier.length >= 43);
  assert.deepEqual(stateStore.consume(pending.state), { codeVerifier: pending.codeVerifier, scopes: [readonlyScope] });
  assert.equal(stateStore.consume(pending.state), null);

  const expired = stateStore.issue([readonlyScope, replyScope]);
  now += 5 * 60 * 1000;
  assert.equal(stateStore.consume(expired.state), null);
});

test('BeginYouTubeOAuth defaults to read-only and requires an explicit reply opt-in for the broad write scope', async () => {
  const stateStore = createStateStore();
  const requests = [];
  const provider = {
    buildAuthorizationUrl: async (state, verifier, scopes) => {
      requests.push({ state, verifier, scopes });
      return 'https://accounts.google.test/authorize';
    },
  };
  const begin = new BeginYouTubeOAuth(stateStore, provider);

  assert.deepEqual(await begin.execute(), { authorizationUrl: 'https://accounts.google.test/authorize' });
  assert.deepEqual(requests[0].scopes, [readonlyScope]);
  assert.deepEqual(await begin.execute({ enableReplies: true }), { authorizationUrl: 'https://accounts.google.test/authorize' });
  assert.deepEqual(requests[1].scopes, [replyScope]);
});

function createCompleteUseCase({ stateStore, providerResult, existing = null, failConnect = false, failFind = false, failDeleteReference = null }) {
  const events = [];
  const provider = {
    completeAuthorization: async (input) => {
      events.push({ type: 'complete-provider', input });
      return providerResult;
    },
  };
  const tenantContext = { resolveTenantId: async () => tenantId };
  const accounts = {
    findByProviderIdentity: async (scope, platform, externalId) => {
      events.push({ type: 'find-account', scope, platform, externalId });
      if (failFind) {
        throw new Error('account lookup failed');
      }
      return existing;
    },
  };
  const vault = {
    deleteCredentials: async (scope, reference, platform) => {
      events.push({ type: 'delete-credential', scope, reference, platform });
      if (reference === failDeleteReference) {
        throw new Error('credential cleanup failed');
      }
    },
  };
  const connect = {
    execute: async (input) => {
      events.push({ type: 'connect-account', input });
      if (failConnect) {
        throw new Error('account persistence failed');
      }
      return { id: 'account-id', platform: 'youtube', externalAccountId: input.externalAccountId, displayName: input.displayName };
    },
  };
  return { useCase: new CompleteYouTubeOAuth(stateStore, provider, tenantContext, accounts, connect, vault), events };
}

test('CompleteYouTubeOAuth validates state, persists only normalized account data, and deletes replaced credentials', async () => {
  const stateStore = createStateStore();
  const pending = stateStore.issue([readonlyScope]);
  const existing = { id: 'old-account', tenantId, credentialReference: 'old-reference' };
  const { useCase, events } = createCompleteUseCase({
    stateStore,
    existing,
    providerResult: { externalAccountId: 'UC-channel-1', displayName: 'Creator channel', credentialReference: 'new-reference' },
  });

  const result = await useCase.execute({ state: pending.state, code: 'authorization-code' });

  assert.deepEqual(result, { id: 'account-id', platform: 'youtube', externalAccountId: 'UC-channel-1', displayName: 'Creator channel' });
  assert.equal(events[0].type, 'complete-provider');
  assert.deepEqual(events.find((event) => event.type === 'connect-account').input, {
    platform: 'youtube', externalAccountId: 'UC-channel-1', displayName: 'Creator channel', credentialReference: 'new-reference',
  });
  assert.equal(events.at(-1).type, 'delete-credential');
  assert.equal(events.at(-1).reference, 'old-reference');
});

test('CompleteYouTubeOAuth does not delete the new credential if cleanup of a replaced credential fails', async () => {
  const stateStore = createStateStore();
  const pending = stateStore.issue([readonlyScope]);
  const existing = { id: 'old-account', tenantId, credentialReference: 'old-reference' };
  const { useCase, events } = createCompleteUseCase({
    stateStore,
    existing,
    failDeleteReference: 'old-reference',
    providerResult: { externalAccountId: 'UC-channel-1', displayName: 'Creator channel', credentialReference: 'new-reference' },
  });

  await assert.rejects(useCase.execute({ state: pending.state, code: 'authorization-code' }), (error) => error instanceof YouTubeOAuthError && error.code === 'YOUTUBE_OAUTH_CREDENTIAL_CLEANUP_FAILED');
  assert.equal(events.filter((event) => event.type === 'delete-credential').length, 1);
  assert.equal(events.at(-1).reference, 'old-reference');
});

test('CompleteYouTubeOAuth refuses missing, expired, or replayed state without invoking Google', async () => {
  const stateStore = createStateStore(() => Date.parse('2026-10-13T12:00:00.000Z'));
  const pending = stateStore.issue([readonlyScope]);
  const { useCase, events } = createCompleteUseCase({ stateStore, providerResult: {} });

  await assert.rejects(useCase.execute({ state: 'invalid', code: 'authorization-code' }), (error) => error instanceof YouTubeOAuthError && error.code === 'YOUTUBE_OAUTH_STATE_INVALID');
  await useCase.execute({ state: pending.state, code: 'authorization-code' });
  await assert.rejects(useCase.execute({ state: pending.state, code: 'authorization-code' }), (error) => error instanceof YouTubeOAuthError && error.code === 'YOUTUBE_OAUTH_STATE_INVALID');
  assert.equal(events.filter((event) => event.type === 'complete-provider').length, 1);
});

test('CompleteYouTubeOAuth compensates encrypted credentials if account lookup fails', async () => {
  const stateStore = createStateStore();
  const pending = stateStore.issue([readonlyScope]);
  const { useCase, events } = createCompleteUseCase({
    stateStore,
    failFind: true,
    providerResult: { externalAccountId: 'UC-channel-1', displayName: 'Creator channel', credentialReference: 'new-reference' },
  });

  await assert.rejects(useCase.execute({ state: pending.state, code: 'authorization-code' }), /account lookup failed/);
  assert.equal(events.at(-1).reference, 'new-reference');
});

test('CompleteYouTubeOAuth compensates encrypted credentials if account persistence fails', async () => {
  const stateStore = createStateStore();
  const pending = stateStore.issue([readonlyScope]);
  const { useCase, events } = createCompleteUseCase({
    stateStore,
    failConnect: true,
    providerResult: { externalAccountId: 'UC-channel-1', displayName: 'Creator channel', credentialReference: 'new-reference' },
  });

  await assert.rejects(useCase.execute({ state: pending.state, code: 'authorization-code' }), /account persistence failed/);
  assert.equal(events.at(-1).type, 'delete-credential');
  assert.equal(events.at(-1).reference, 'new-reference');
});
