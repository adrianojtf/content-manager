import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { InMemoryFacebookOAuthFlowStateStore } = require('../../dist/infrastructure/social/in-memory-facebook-oauth-flow-state-store.js');
const { BeginFacebookOAuth } = require('../../dist/application/social/begin-facebook-oauth.js');
const { CompleteFacebookOAuth } = require('../../dist/application/social/complete-facebook-oauth.js');
const { SelectFacebookPage } = require('../../dist/application/social/select-facebook-page.js');
const { FacebookOAuthError } = require('../../dist/application/social/facebook-oauth-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const pageSelection = { selectionId: 'one-time-page-selection', pages: [{ externalAccountId: 'page-1', displayName: 'Creator Page' }, { externalAccountId: 'page-2', displayName: 'Studio Page' }] };

function createStateStore(now = () => Date.parse('2026-10-14T12:00:00.000Z')) {
  return new InMemoryFacebookOAuthFlowStateStore(now);
}

test('Facebook OAuth state is single-use and expires', () => {
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

test('BeginFacebookOAuth builds a state-bound authorization flow', async () => {
  const states = createStateStore();
  const requested = [];
  const provider = { buildAuthorizationUrl: async (state) => { requested.push(state); return 'https://www.facebook.com/dialog/oauth'; } };

  assert.deepEqual(await new BeginFacebookOAuth(states, provider).execute(), { authorizationUrl: 'https://www.facebook.com/dialog/oauth' });
  assert.equal(requested.length, 1);
  assert.equal(states.consume(requested[0]), true);
});

test('CompleteFacebookOAuth validates state and returns candidates without connecting every Page', async () => {
  const states = createStateStore();
  const pending = states.issue();
  const calls = [];
  const provider = { beginPageSelection: async (code, tenant) => { calls.push({ code, tenant }); return pageSelection; } };
  const complete = new CompleteFacebookOAuth(states, provider, { resolveTenantId: async () => tenantId });

  assert.deepEqual(await complete.execute({ state: pending.state, code: 'authorization-code' }), pageSelection);
  assert.deepEqual(calls, [{ code: 'authorization-code', tenant: tenantId }]);
  await assert.rejects(complete.execute({ state: pending.state, code: 'authorization-code' }), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_STATE_INVALID');
});

test('CompleteFacebookOAuth rejects denied, missing-code, and invalid-state callbacks before provider access', async () => {
  const states = createStateStore();
  const pending = states.issue();
  let providerCalls = 0;
  const complete = new CompleteFacebookOAuth(states, { beginPageSelection: async () => { providerCalls += 1; return pageSelection; } }, { resolveTenantId: async () => tenantId });

  await assert.rejects(complete.execute({ state: 'invalid', code: 'code' }), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_STATE_INVALID');
  await assert.rejects(complete.execute({ state: pending.state, providerError: 'access_denied' }), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_DENIED');
  const missingCode = states.issue();
  await assert.rejects(complete.execute({ state: missingCode.state }), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_CODE_REQUIRED');
  assert.equal(providerCalls, 0);
});

function createSelectUseCase({ authorizedPage, failConnect = false, failFind = false, failDelete = false }) {
  const events = [];
  const provider = { selectPage: async (selectionId, pageId, tenant) => {
    events.push({ type: 'select', selectionId, pageId, tenant });
    if (authorizedPage instanceof Error) throw authorizedPage;
    return authorizedPage;
  } };
  const tenant = { resolveTenantId: async () => tenantId };
  const accounts = { findByProviderIdentity: async (scope, platform, externalId) => {
    events.push({ type: 'find', scope, platform, externalId });
    if (failFind) throw new Error('account lookup failed');
    return null;
  } };
  const connect = { execute: async (input) => {
    events.push({ type: 'connect', input });
    if (failConnect) throw new Error('account persistence failed');
    return { id: 'connected-page', platform: 'facebook', externalAccountId: input.externalAccountId, displayName: input.displayName };
  } };
  const credentials = { deleteCredentials: async (scope, reference, platform) => {
    events.push({ type: 'delete', scope, reference, platform });
    if (failDelete) throw new Error('credential cleanup failed');
  } };
  return { useCase: new SelectFacebookPage(provider, tenant, accounts, connect, credentials), events };
}

test('SelectFacebookPage connects only the explicitly selected Page and does not disclose its credential reference', async () => {
  const { useCase, events } = createSelectUseCase({ authorizedPage: { externalAccountId: 'page-2', displayName: 'Studio Page', credentialReference: 'page-credential' } });
  const result = await useCase.execute({ selectionId: pageSelection.selectionId, pageId: 'page-2' });

  assert.deepEqual(result, { id: 'connected-page', platform: 'facebook', externalAccountId: 'page-2', displayName: 'Studio Page' });
  assert.deepEqual(events[0], { type: 'select', selectionId: pageSelection.selectionId, pageId: 'page-2', tenant: tenantId });
  assert.equal(events.find((event) => event.type === 'connect').input.credentialReference, 'page-credential');
  assert.equal(JSON.stringify(result).includes('credentialReference'), false);
});

test('SelectFacebookPage compensates the selected Page credential when account persistence fails', async () => {
  const { useCase, events } = createSelectUseCase({
    authorizedPage: { externalAccountId: 'page-1', displayName: 'Creator Page', credentialReference: 'page-credential' },
    failConnect: true,
  });

  await assert.rejects(useCase.execute({ selectionId: pageSelection.selectionId, pageId: 'page-1' }), /account persistence failed/);
  assert.deepEqual(events.at(-1), { type: 'delete', scope: tenantId, reference: 'page-credential', platform: 'facebook' });
});

test('SelectFacebookPage maps credential cleanup failure without leaking provider data', async () => {
  const { useCase } = createSelectUseCase({
    authorizedPage: { externalAccountId: 'page-1', displayName: 'Creator Page', credentialReference: 'page-credential' },
    failConnect: true,
    failDelete: true,
  });
  await assert.rejects(useCase.execute({ selectionId: pageSelection.selectionId, pageId: 'page-1' }), (error) => error instanceof FacebookOAuthError && error.code === 'FACEBOOK_OAUTH_CREDENTIAL_CLEANUP_FAILED');
});
