import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  LocalizationPreferenceError,
  LocalizationPreferencesService,
  validateTenantLocalizationPreferences,
  validateUserLocalizationPreferences,
} = require('../../dist/application/localization/localization-preferences.service.js');
const supportedLocales = ['pt-BR', 'en-US', 'es-ES'];
const localization = { getSupportedLocales: () => supportedLocales };

const owner = { kind: 'tenant-user', userId: 'owner-1', tenantId: 'tenant-1', tenantRole: 'OWNER' };
const member = { kind: 'tenant-user', userId: 'member-1', tenantId: 'tenant-1', tenantRole: 'MEMBER' };
const platformAdmin = { kind: 'platform-admin', userId: 'admin-1' };

test('tenant preferences canonicalize supported locale and currency while allowing locale/timezone fallback', () => {
  assert.deepEqual(validateTenantLocalizationPreferences({ defaultLocale: 'en-us', timezone: null, currency: 'usd' }, localization), {
    defaultLocale: 'en-US',
    timezone: null,
    currency: 'USD',
  });
  assert.deepEqual(validateTenantLocalizationPreferences({ defaultLocale: null, timezone: 'UTC', currency: 'BRL' }, localization), {
    defaultLocale: null,
    timezone: 'UTC',
    currency: 'BRL',
  });
});

test('tenant and user preferences reject unsupported locales, invalid timezones and currencies', () => {
  assert.throws(() => validateTenantLocalizationPreferences({ defaultLocale: 'fr-FR', timezone: null, currency: 'USD' }, localization), (error) => error.code === 'LOCALE_UNSUPPORTED');
  assert.throws(() => validateTenantLocalizationPreferences({ defaultLocale: null, timezone: 'Mars/Olympus', currency: 'USD' }, localization), (error) => error.code === 'TIMEZONE_INVALID');
  assert.throws(() => validateTenantLocalizationPreferences({ defaultLocale: null, timezone: null, currency: 'ZZZ' }, localization), (error) => error.code === 'CURRENCY_INVALID');
  assert.throws(() => validateTenantLocalizationPreferences({ defaultLocale: null, timezone: null, currency: null }, localization), (error) => error.code === 'CURRENCY_REQUIRED');
  assert.throws(() => validateTenantLocalizationPreferences({ defaultLocale: null, currency: 'USD' }, localization), (error) => error.code === 'TIMEZONE_INVALID');
  assert.deepEqual(validateUserLocalizationPreferences({ locale: null, timezone: null }, localization), { locale: null, timezone: null });
  assert.throws(() => validateUserLocalizationPreferences({ locale: 'fr-FR', timezone: null }, localization), (error) => error.code === 'LOCALE_UNSUPPORTED');
  assert.throws(() => validateUserLocalizationPreferences({ locale: 42, timezone: null }, localization), (error) => error.code === 'LOCALE_UNSUPPORTED');
  assert.throws(() => validateUserLocalizationPreferences({ locale: null }, localization), (error) => error.code === 'TIMEZONE_INVALID');
  assert.throws(() => validateTenantLocalizationPreferences({ defaultLocale: null, timezone: null, currency: 42 }, localization), (error) => error.code === 'CURRENCY_INVALID');
});

test('preferences service derives tenant and user scope from the authenticated principal', async () => {
  const tenantSaves = [];
  const userSaves = [];
  const repositories = {
    tenants: {
      saveForTenant: async (tenantId, preferences) => { tenantSaves.push({ tenantId, preferences }); return true; },
      findByTenantId: async (tenantId) => ({ tenantId }),
    },
    users: {
      saveForUser: async (tenantId, userId, preferences) => { userSaves.push({ tenantId, userId, preferences }); return true; },
      findByUserId: async (tenantId, userId) => ({ tenantId, userId }),
    },
  };
  const service = new LocalizationPreferencesService(repositories.tenants, repositories.users, localization);

  await service.updateTenantPreferences(owner, { defaultLocale: 'pt-br', timezone: null, currency: 'usd' });
  await service.updateUserPreferences(member, { locale: 'es-es', timezone: 'UTC' });

  assert.deepEqual(tenantSaves, [{
    tenantId: 'tenant-1',
    preferences: { defaultLocale: 'pt-BR', timezone: null, currency: 'USD' },
  }]);
  assert.deepEqual(userSaves, [{
    tenantId: 'tenant-1',
    userId: 'member-1',
    preferences: { locale: 'es-ES', timezone: 'UTC' },
  }]);
  await assert.rejects(service.updateTenantPreferences(member, { defaultLocale: null, timezone: null, currency: 'USD' }), (error) => error.code === 'TENANT_OWNER_REQUIRED');
  await assert.rejects(service.updateUserPreferences(platformAdmin, { locale: null, timezone: null }), (error) => error instanceof LocalizationPreferenceError && error.code === 'TENANT_CONTEXT_REQUIRED');
  assert.equal(tenantSaves.length, 1);
});

test('preferences service reads persisted settings and fails when a scoped record is absent', async () => {
  const tenant = { defaultLocale: null, timezone: 'UTC', currency: 'USD' };
  const user = { locale: 'en-US', timezone: null };
  const service = new LocalizationPreferencesService(
    {
      findByTenantId: async (tenantId) => tenantId === 'tenant-1' ? tenant : null,
      saveForTenant: async () => false,
    },
    {
      findByUserId: async (tenantId, userId) => tenantId === 'tenant-1' && userId === 'member-1' ? user : null,
      saveForUser: async () => false,
    },
    localization,
  );

  assert.deepEqual(await service.findTenantPreferences(member), tenant);
  assert.deepEqual(await service.findUserPreferences(member), user);
  await assert.rejects(service.findTenantPreferences(platformAdmin), (error) => error.code === 'TENANT_CONTEXT_REQUIRED');
  await assert.rejects(service.findTenantPreferences({ ...member, tenantId: 'missing-tenant' }), (error) => error.code === 'TENANT_NOT_FOUND');
  await assert.rejects(service.findUserPreferences({ ...member, userId: 'unknown-user' }), (error) => error.code === 'USER_NOT_IN_TENANT');
  await assert.rejects(service.updateTenantPreferences(owner, { defaultLocale: null, timezone: null, currency: 'USD' }), (error) => error.code === 'TENANT_NOT_FOUND');
  await assert.rejects(service.updateUserPreferences(member, { locale: null, timezone: null }), (error) => error.code === 'USER_NOT_IN_TENANT');
});
