import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { InMemoryTikTokBusinessOAuthFlowStateStore } = require('../../dist/infrastructure/social/in-memory-tiktok-business-oauth-flow-state-store.js');
const { BeginTikTokBusinessOAuth } = require('../../dist/application/social/begin-tiktok-business-oauth.js');
const { CompleteTikTokBusinessOAuth } = require('../../dist/application/social/complete-tiktok-business-oauth.js');
const { TikTokBusinessOAuthError } = require('../../dist/application/social/tiktok-business-oauth-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';

function createStateStore(now = () => Date.parse('2026-10-14T12:00:00.000Z')) {
  return new InMemoryTikTokBusinessOAuthFlowStateStore(now);
}

test('TikTok Business OAuth state is single-use and expires', () => {
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

test('BeginTikTokBusinessOAuth binds random state into the configured authorization URL', async () => {
  const states = createStateStore();
  const seen = [];
  const provider = { buildAuthorizationUrl: async (state) => { seen.push(state); return `https://www.tiktok.com/business-authorize?state=${state}`; } };
  const result = await new BeginTikTokBusinessOAuth(states, provider).execute();

  assert.equal(new URL(result.authorizationUrl).searchParams.get('state'), seen[0]);
  assert.equal(states.consume(seen[0]), true);
});

function createCompleteUseCase({ states, providerResult, existing = null, failConnect = false, failFind = false, failDelete = false }) {
  const events = [];
  const provider = { completeAuthorization: async (code, tenant) => {
    events.push({ type: 'provider', code, tenant });
    return providerResult;
  } };
  const tenant = { resolveTenantId: async () => tenantId };
  const accounts = { findByProviderIdentity: async (scope, platform, externalId) => {
    events.push({ type: 'find', scope, platform, externalId });
    if (failFind) throw new Error('account lookup failed');
    return existing;
  } };
  const connect = { execute: async (input) => {
    events.push({ type: 'connect', input });
    if (failConnect) throw new Error('account persistence failed');
    return { id: 'tiktok-account', platform: 'tiktok', externalAccountId: input.externalAccountId, displayName: input.displayName };
  } };
  const credentials = { deleteCredentials: async (scope, reference, platform) => {
    events.push({ type: 'delete', scope, reference, platform });
    if (failDelete) throw new Error('cleanup failed');
  } };
  return { useCase: new CompleteTikTokBusinessOAuth(states, provider, tenant, accounts, connect, credentials), events };
}

test('CompleteTikTokBusinessOAuth validates callback state and denies invalid, replayed, and incomplete callbacks', async () => {
  const states = createStateStore();
  const valid = states.issue();
  const { useCase, events } = createCompleteUseCase({ states, providerResult: {} });

  await assert.rejects(useCase.execute({ state: 'invalid', authCode: 'code' }), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_STATE_INVALID');
  await assert.rejects(useCase.execute({ state: valid.state, providerError: 'access_denied' }), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_DENIED');
  await assert.rejects(useCase.execute({ state: valid.state, authCode: 'code' }), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_STATE_INVALID');
  const missingCode = states.issue();
  await assert.rejects(useCase.execute({ state: missingCode.state }), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_CODE_REQUIRED');
  assert.equal(events.length, 0);
});

test('CompleteTikTokBusinessOAuth connects the server-scoped open_id and never returns a credential reference', async () => {
  const states = createStateStore();
  const pending = states.issue();
  const { useCase, events } = createCompleteUseCase({
    states,
    providerResult: { externalAccountId: 'business-open-id-1', displayName: null, credentialReference: 'encrypted-reference' },
  });

  const result = await useCase.execute({ state: pending.state, authCode: 'one-time-auth-code' });

  assert.deepEqual(result, { id: 'tiktok-account', platform: 'tiktok', externalAccountId: 'business-open-id-1', displayName: null });
  assert.deepEqual(events[0], { type: 'provider', code: 'one-time-auth-code', tenant: tenantId });
  assert.equal(events.find((event) => event.type === 'connect').input.credentialReference, 'encrypted-reference');
  assert.equal(JSON.stringify(result).includes('credentialReference'), false);
});

test('CompleteTikTokBusinessOAuth compensates credentials after account lookup or persistence failure', async () => {
  for (const failure of ['find', 'connect']) {
    const states = createStateStore();
    const pending = states.issue();
    const { useCase, events } = createCompleteUseCase({
      states,
      failFind: failure === 'find',
      failConnect: failure === 'connect',
      providerResult: { externalAccountId: 'business-open-id-1', displayName: null, credentialReference: 'encrypted-reference' },
    });

    await assert.rejects(useCase.execute({ state: pending.state, authCode: 'one-time-auth-code' }), /failed/);
    assert.deepEqual(events.at(-1), { type: 'delete', scope: tenantId, reference: 'encrypted-reference', platform: 'tiktok' });
  }
});

test('CompleteTikTokBusinessOAuth reports credential cleanup failure with a stable code', async () => {
  const states = createStateStore();
  const pending = states.issue();
  const { useCase } = createCompleteUseCase({
    states,
    failConnect: true,
    failDelete: true,
    providerResult: { externalAccountId: 'business-open-id-1', displayName: null, credentialReference: 'encrypted-reference' },
  });

  await assert.rejects(useCase.execute({ state: pending.state, authCode: 'one-time-auth-code' }), (error) => error instanceof TikTokBusinessOAuthError && error.code === 'TIKTOK_BUSINESS_OAUTH_CREDENTIAL_CLEANUP_FAILED');
});
