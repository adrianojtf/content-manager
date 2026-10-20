import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { InMemoryInstagramOAuthFlowStateStore } = require('../../dist/infrastructure/social/in-memory-instagram-oauth-flow-state-store.js');
const { BeginInstagramOAuth } = require('../../dist/application/social/begin-instagram-oauth.js');
const { CompleteInstagramOAuth } = require('../../dist/application/social/complete-instagram-oauth.js');
const { InstagramOAuthError } = require('../../dist/application/social/instagram-oauth-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';

function createStateStore(now = () => Date.parse('2026-10-14T12:00:00.000Z')) {
  return new InMemoryInstagramOAuthFlowStateStore(now);
}

test('Instagram OAuth state is single-use and expires', () => {
  let now = Date.parse('2026-10-14T12:00:00.000Z');
  const states = createStateStore(() => now);
  const pending = states.issue();

  assert.ok(pending.state.length >= 32);
  assert.equal(states.consume(pending.state), true);
  assert.equal(states.consume(pending.state), false);

  const expired = states.issue();
  now += 5 * 60 * 1000;
  assert.equal(states.consume(expired.state), false);
});

test('BeginInstagramOAuth requests only professional-account read and comment scopes', async () => {
  const states = createStateStore();
  const requests = [];
  const provider = { buildAuthorizationUrl: async (state) => { requests.push(state); return 'https://www.instagram.com/oauth/authorize'; } };
  const result = await new BeginInstagramOAuth(states, provider).execute();

  assert.deepEqual(result, { authorizationUrl: 'https://www.instagram.com/oauth/authorize' });
  assert.equal(requests.length, 1);
  assert.ok(states.consume(requests[0]));
});

function createCompleteUseCase({ states, providerResult, existing = null, failConnect = false, failFind = false, failDelete = false }) {
  const events = [];
  const provider = {
    completeAuthorization: async (code, tenant) => { events.push({ type: 'provider', code, tenant }); return providerResult; },
  };
  const tenant = { resolveTenantId: async () => tenantId };
  const accounts = {
    findByProviderIdentity: async (scope, platform, externalId) => {
      events.push({ type: 'find', scope, platform, externalId });
      if (failFind) throw new Error('account lookup failed');
      return existing;
    },
  };
  const connect = { execute: async (input) => {
    events.push({ type: 'connect', input });
    if (failConnect) throw new Error('account persistence failed');
    return { id: 'instagram-account', platform: 'instagram', externalAccountId: input.externalAccountId, displayName: input.displayName };
  } };
  const credentials = { deleteCredentials: async (scope, reference, platform) => {
    events.push({ type: 'delete', scope, reference, platform });
    if (failDelete) throw new Error('cleanup failed');
  } };
  return { useCase: new CompleteInstagramOAuth(states, provider, tenant, accounts, connect, credentials), events };
}

test('CompleteInstagramOAuth consumes state, connects only the returned professional identity, and replaces old credentials', async () => {
  const states = createStateStore();
  const pending = states.issue();
  const { useCase, events } = createCompleteUseCase({
    states,
    existing: { id: 'old-account', credentialReference: 'old-reference' },
    providerResult: { externalAccountId: '17841400000000001', displayName: 'creator', credentialReference: 'new-reference' },
  });

  const result = await useCase.execute({ state: pending.state, code: 'authorization-code' });

  assert.deepEqual(result, { id: 'instagram-account', platform: 'instagram', externalAccountId: '17841400000000001', displayName: 'creator' });
  assert.deepEqual(events[0], { type: 'provider', code: 'authorization-code', tenant: tenantId });
  assert.equal(events.find((event) => event.type === 'connect').input.credentialReference, 'new-reference');
  assert.deepEqual(events.at(-1), { type: 'delete', scope: tenantId, reference: 'old-reference', platform: 'instagram' });
  assert.equal(JSON.stringify(result).includes('credentialReference'), false);
});

test('CompleteInstagramOAuth rejects invalid, replayed, denied, and incomplete callbacks before provider access', async () => {
  const states = createStateStore();
  const valid = states.issue();
  const { useCase, events } = createCompleteUseCase({ states, providerResult: {} });

  await assert.rejects(useCase.execute({ state: 'invalid', code: 'code' }), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_STATE_INVALID');
  await assert.rejects(useCase.execute({ state: valid.state, providerError: 'access_denied' }), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_DENIED');
  await assert.rejects(useCase.execute({ state: valid.state, code: 'code' }), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_STATE_INVALID');
  const missingCodeState = states.issue();
  await assert.rejects(useCase.execute({ state: missingCodeState.state }), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_CODE_REQUIRED');
  assert.equal(events.length, 0);
});

test('CompleteInstagramOAuth compensates new credentials after persistence failure', async () => {
  const states = createStateStore();
  const pending = states.issue();
  const { useCase, events } = createCompleteUseCase({
    states,
    failConnect: true,
    providerResult: { externalAccountId: '17841400000000001', displayName: 'creator', credentialReference: 'new-reference' },
  });

  await assert.rejects(useCase.execute({ state: pending.state, code: 'code' }), /account persistence failed/);
  assert.deepEqual(events.at(-1), { type: 'delete', scope: tenantId, reference: 'new-reference', platform: 'instagram' });
});

test('CompleteInstagramOAuth reports credential cleanup failure with a stable code', async () => {
  const states = createStateStore();
  const pending = states.issue();
  const { useCase } = createCompleteUseCase({
    states,
    failConnect: true,
    failDelete: true,
    providerResult: { externalAccountId: '17841400000000001', displayName: 'creator', credentialReference: 'new-reference' },
  });

  await assert.rejects(useCase.execute({ state: pending.state, code: 'code' }), (error) => error instanceof InstagramOAuthError && error.code === 'INSTAGRAM_OAUTH_CREDENTIAL_CLEANUP_FAILED');
});
