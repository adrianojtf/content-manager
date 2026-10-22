import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresTenantResponseToneSettingsRepository } = require('../../dist/infrastructure/persistence/postgres-tenant-response-tone-settings.repository.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantId = '40000000-0000-4000-8000-000000000001';
const otherTenantId = '40000000-0000-4000-8000-000000000002';

async function createRepository() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of ['002_create_tenant_identity.sql', '003_add_localization_preferences.sql', '020_create_tenant_response_tone_settings.sql']) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3), ($4, $5, $6)', [tenantId, 'Tone tenant', 'USD', otherTenantId, 'Other tenant', 'USD']);
  const database = new PostgresPersistenceAdapter(pool);
  return { pool, repository: new PostgresTenantResponseToneSettingsRepository(database) };
}

test('tenant response tone settings persist one global profile per tenant without leaking across tenants', async () => {
  const { pool, repository } = await createRepository();
  try {
    assert.equal(await repository.get(tenantId), null);
    const profile = { primaryTone: 'EMPATHETIC', modifiers: ['CONCISE', 'WARM'], customNote: 'Avoid slang.' };

    const saved = await repository.save(tenantId, profile);
    const reread = await repository.get(tenantId);
    const otherTenant = await repository.get(otherTenantId);

    assert.deepEqual(saved, { ...profile, updatedAt: saved.updatedAt });
    assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
    assert.deepEqual(reread, saved);
    assert.equal(otherTenant, null);

    const updated = await repository.save(tenantId, { primaryTone: 'CASUAL', modifiers: [], customNote: null });
    assert.equal(updated.primaryTone, 'CASUAL');
    const { rows } = await pool.query('SELECT primary_tone, modifiers_json, custom_note FROM tenant_response_tone_settings');
    assert.deepEqual(rows, [{ primary_tone: 'CASUAL', modifiers_json: '[]', custom_note: null }]);
  } finally {
    await pool.end();
  }
});
