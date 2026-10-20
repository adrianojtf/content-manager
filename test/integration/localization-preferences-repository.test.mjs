import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresTenantLocalizationPreferencesRepository } = require('../../dist/infrastructure/persistence/postgres-tenant-localization-preferences.repository.js');
const { PostgresUserLocalizationPreferencesRepository } = require('../../dist/infrastructure/persistence/postgres-user-localization-preferences.repository.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');

async function createRepositories() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await pool.query(await readFile(path.join(migrationDirectory, '002_create_tenant_identity.sql'), 'utf8'));
  await pool.query(await readFile(path.join(migrationDirectory, '003_add_localization_preferences.sql'), 'utf8'));
  await pool.query("INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)", ['10000000-0000-4000-8000-000000000001', 'Tenant One', 'USD']);
  await pool.query("INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)", ['10000000-0000-4000-8000-000000000002', 'Tenant Two', 'EUR']);
  await pool.query("INSERT INTO users (id, oidc_issuer, oidc_subject) VALUES ($1, $2, $3)", ['20000000-0000-4000-8000-000000000001', 'https://issuer.example', 'owner-sub']);
  await pool.query("INSERT INTO tenant_memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)", ['20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'OWNER']);

  const database = new PostgresPersistenceAdapter(pool);
  return {
    pool,
    tenants: new PostgresTenantLocalizationPreferencesRepository(database),
    users: new PostgresUserLocalizationPreferencesRepository(database),
  };
}

test('PostgreSQL tenant preference repository persists locale, timezone, and required currency', async () => {
  const { pool, tenants } = await createRepositories();
  try {
    const preferences = { defaultLocale: 'pt-BR', timezone: null, currency: 'BRL' };
    assert.equal(await tenants.saveForTenant('10000000-0000-4000-8000-000000000001', preferences), true);
    assert.deepEqual(await tenants.findByTenantId('10000000-0000-4000-8000-000000000001'), preferences);
    assert.equal(await tenants.saveForTenant('10000000-0000-4000-8000-000000000099', preferences), false);
  } finally {
    await pool.end();
  }
});

test('PostgreSQL user preference repository scopes reads and writes to the membership tenant', async () => {
  const { pool, users } = await createRepositories();
  try {
    const preferences = { locale: null, timezone: 'America/Sao_Paulo' };
    assert.equal(await users.saveForUser('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', preferences), true);
    assert.deepEqual(await users.findByUserId('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'), preferences);
    assert.equal(await users.findByUserId('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001'), null);
    assert.equal(await users.saveForUser('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', { locale: 'en-US', timezone: null }), false);
    assert.deepEqual(await users.findByUserId('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'), preferences);
  } finally {
    await pool.end();
  }
});
