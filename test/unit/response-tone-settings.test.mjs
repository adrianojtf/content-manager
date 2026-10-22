import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { GetAccountResponseToneSettings, UpdateAccountResponseToneSettings, GetTenantResponseToneSettings, UpdateTenantResponseToneSettings, defaultResponseToneProfile } = require('../../dist/application/social/response-tone-settings.js');
const { ResponseToneSettingsError } = require('../../dist/application/social/response-tone-settings-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountOne = '5b7f1f84-25a8-4bd8-a7df-680dc4400201';
const accountTwo = '5b7f1f84-25a8-4bd8-a7df-680dc4400202';
const updatedAt = '2026-10-14T12:00:00.000Z';
const tenantUpdatedAt = '2026-10-14T11:00:00.000Z';

function createSettings() {
  const rows = new Map();
  let tenantRow = null;
  const accounts = { findById: async (scope, accountId) => scope === tenantId && [accountOne, accountTwo].includes(accountId) ? { id: accountId, tenantId } : null };
  const repository = {
    get: async (scope, accountId) => rows.get(`${scope}:${accountId}`) ?? null,
    save: async (scope, accountId, profile) => {
      const row = { ...profile, updatedAt };
      rows.set(`${scope}:${accountId}`, row);
      return row;
    },
  };
  const tenantRepository = {
    get: async (scope) => scope === tenantId ? tenantRow : null,
    save: async (scope, profile) => {
      tenantRow = { ...profile, updatedAt: tenantUpdatedAt };
      return tenantRow;
    },
  };
  const tenant = { resolveTenantId: async () => tenantId };
  return {
    rows,
    getTenantRow: () => tenantRow,
    get: new GetAccountResponseToneSettings(accounts, repository, tenantRepository, tenant),
    update: new UpdateAccountResponseToneSettings(accounts, repository, tenant),
    getTenantSettings: new GetTenantResponseToneSettings(tenantRepository, tenant),
    updateTenantSettings: new UpdateTenantResponseToneSettings(tenantRepository, tenant),
  };
}

test('tone settings are per connected social account and unset accounts fall back to the Friendly default', async () => {
  const settings = createSettings();
  const firstDefault = await settings.get.execute({ accountId: accountOne });
  const secondDefault = await settings.get.execute({ accountId: accountTwo });

  assert.deepEqual(firstDefault, { profile: defaultResponseToneProfile, updatedAt: null, customized: false, source: 'DEFAULT' });
  assert.deepEqual(secondDefault, firstDefault);

  const updated = await settings.update.execute({
    accountId: accountOne,
    profile: { primaryTone: 'PROFESSIONAL', modifiers: ['CONCISE', 'WARM'], customNote: 'Avoid slang.' },
  });

  assert.deepEqual(updated, { profile: { primaryTone: 'PROFESSIONAL', modifiers: ['CONCISE', 'WARM'], customNote: 'Avoid slang.' }, updatedAt, customized: true, source: 'ACCOUNT' });
  assert.deepEqual((await settings.get.execute({ accountId: accountTwo })).profile, defaultResponseToneProfile);
});

test('an account without its own profile inherits the tenant-level default profile', async () => {
  const settings = createSettings();
  await settings.updateTenantSettings.execute({
    profile: { primaryTone: 'EMPATHETIC', modifiers: ['WARM'], customNote: 'Global guidance' },
  });

  const inherited = await settings.get.execute({ accountId: accountOne });
  assert.deepEqual(inherited, {
    profile: { primaryTone: 'EMPATHETIC', modifiers: ['WARM'], customNote: 'Global guidance' },
    updatedAt: tenantUpdatedAt,
    customized: true,
    source: 'TENANT',
  });

  await settings.update.execute({
    accountId: accountOne,
    profile: { primaryTone: 'CASUAL', modifiers: [], customNote: null },
  });
  const overridden = await settings.get.execute({ accountId: accountOne });
  assert.equal(overridden.source, 'ACCOUNT');
  assert.equal(overridden.profile.primaryTone, 'CASUAL');
  assert.deepEqual((await settings.get.execute({ accountId: accountTwo })).source, 'TENANT');
});

test('tenant tone settings read and write the global default profile', async () => {
  const settings = createSettings();

  assert.deepEqual(await settings.getTenantSettings.execute(), {
    profile: defaultResponseToneProfile,
    updatedAt: null,
    customized: false,
    source: 'DEFAULT',
  });

  const saved = await settings.updateTenantSettings.execute({
    profile: { primaryTone: 'PROFESSIONAL', modifiers: ['CONCISE'], customNote: 'Brand voice' },
  });
  assert.deepEqual(saved, {
    profile: { primaryTone: 'PROFESSIONAL', modifiers: ['CONCISE'], customNote: 'Brand voice' },
    updatedAt: tenantUpdatedAt,
    customized: true,
    source: 'TENANT',
  });
  assert.deepEqual(await settings.getTenantSettings.execute(), saved);
});

test('tone settings reject unknown presets, more than two modifiers, duplicates, and long notes without saving', async () => {
  const settings = createSettings();
  const invalidProfiles = [
    { primaryTone: 'SARCASTIC', modifiers: [], customNote: null },
    { primaryTone: 'FRIENDLY', modifiers: ['CONCISE', 'WARM', 'ENTHUSIASTIC'], customNote: null },
    { primaryTone: 'FRIENDLY', modifiers: ['CONCISE', 'CONCISE'], customNote: null },
    { primaryTone: 'FRIENDLY', modifiers: [], customNote: 'x'.repeat(501) },
  ];

  for (const profile of invalidProfiles) {
    await assert.rejects(settings.update.execute({ accountId: accountOne, profile }), (error) => error instanceof ResponseToneSettingsError && error.code === 'RESPONSE_TONE_SETTINGS_INVALID');
    await assert.rejects(settings.updateTenantSettings.execute({ profile }), (error) => error instanceof ResponseToneSettingsError && error.code === 'RESPONSE_TONE_SETTINGS_INVALID');
  }
  assert.equal(settings.rows.size, 0);
  assert.equal(settings.getTenantRow(), null);
});

test('tone settings cannot be read or changed for an account outside the fixed pilot tenant', async () => {
  const settings = createSettings();

  await assert.rejects(settings.get.execute({ accountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400299' }), /SOCIAL_ACCOUNT_NOT_FOUND/);
  await assert.rejects(settings.update.execute({ accountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400299', profile: defaultResponseToneProfile }), /SOCIAL_ACCOUNT_NOT_FOUND/);
  assert.equal(settings.rows.size, 0);
});
