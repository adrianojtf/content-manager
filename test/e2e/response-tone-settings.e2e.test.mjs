import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createResponseToneSettingsE2eModule } = require('../../dist-e2e/test/e2e/support/response-tone-settings-e2e.module.js');
const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400201';
const profile = { primaryTone: 'PROFESSIONAL', modifiers: ['CONCISE', 'WARM'], customNote: 'Avoid slang.' };

async function withApp(useCases, run) {
  const app = await NestFactory.create(createResponseToneSettingsE2eModule(useCases), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await run(await app.getUrl());
  } finally {
    await app.close();
  }
}

function createToneUseCases() {
  const rows = new Map();
  let tenantRow = null;
  const accounts = { findById: async (scope, id) => scope === tenantId && id === accountId ? { id, tenantId: scope } : null };
  const repository = {
    get: async (scope, id) => rows.get(id) ?? null,
    save: async (scope, id, value) => {
      const row = { ...value, updatedAt: '2026-10-14T12:00:00.000Z' };
      rows.set(id, row);
      return row;
    },
  };
  const tenantRepository = {
    get: async () => tenantRow,
    save: async (scope, value) => {
      tenantRow = { ...value, updatedAt: '2026-10-14T11:00:00.000Z' };
      return tenantRow;
    },
  };
  const tenant = { resolveTenantId: async () => tenantId };
  const {
    GetAccountResponseToneSettings,
    UpdateAccountResponseToneSettings,
    GetTenantResponseToneSettings,
    UpdateTenantResponseToneSettings,
  } = require('../../dist/application/social/response-tone-settings.js');
  return {
    get: new GetAccountResponseToneSettings(accounts, repository, tenantRepository, tenant),
    update: new UpdateAccountResponseToneSettings(accounts, repository, tenant),
    getTenant: new GetTenantResponseToneSettings(tenantRepository, tenant),
    updateTenant: new UpdateTenantResponseToneSettings(tenantRepository, tenant),
  };
}

test('tone settings endpoint reads the profile for the selected social account', async () => {
  const calls = [];
  const view = { profile, updatedAt: '2026-10-14T12:00:00.000Z', customized: true, source: 'ACCOUNT' };
  const useCases = {
    get: { execute: async (input) => { calls.push(['get', input]); return view; } },
    update: { execute: async () => view },
    getTenant: { execute: async () => view },
    updateTenant: { execute: async () => view },
  };

  await withApp(useCases, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/response-tone`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), view);
  });
  assert.deepEqual(calls, [['get', { accountId }]]);
});

test('tone settings endpoint accepts only primary tone, modifiers, and custom note', async () => {
  const calls = [];
  const view = { profile, updatedAt: '2026-10-14T12:00:00.000Z', customized: true, source: 'ACCOUNT' };
  const useCases = {
    get: { execute: async () => view },
    update: { execute: async (input) => { calls.push(input); return view; } },
    getTenant: { execute: async () => view },
    updateTenant: { execute: async () => view },
  };

  await withApp(useCases, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/response-tone`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), view);

    const extra = await fetch(`${baseUrl}/social/accounts/${accountId}/response-tone`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...profile, provider: 'openai' }),
    });
    assert.equal(extra.status, 400);
  });
  assert.deepEqual(calls, [{ accountId, profile }]);
});

test('tenant tone settings endpoint reads and updates the global default profile', async () => {
  const useCases = createToneUseCases();

  await withApp(useCases, async (baseUrl) => {
    const empty = await fetch(`${baseUrl}/social/settings/response-tone`);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), {
      profile: { primaryTone: 'FRIENDLY', modifiers: [], customNote: null },
      updatedAt: null,
      customized: false,
      source: 'DEFAULT',
    });

    const saved = await fetch(`${baseUrl}/social/settings/response-tone`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), {
      profile,
      updatedAt: '2026-10-14T11:00:00.000Z',
      customized: true,
      source: 'TENANT',
    });

    const inherited = await fetch(`${baseUrl}/social/accounts/${accountId}/response-tone`);
    assert.deepEqual(await inherited.json(), {
      profile,
      updatedAt: '2026-10-14T11:00:00.000Z',
      customized: true,
      source: 'TENANT',
    });

    const extra = await fetch(`${baseUrl}/social/settings/response-tone`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...profile, tenantId: 'caller-controlled' }),
    });
    assert.equal(extra.status, 400);
    assert.deepEqual(await extra.json(), { code: 'RESPONSE_TONE_SETTINGS_INVALID' });
  });
});
