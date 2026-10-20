import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresSocialAccountResponseToneSettingsRepository } = require('../../dist/infrastructure/persistence/postgres-social-account-response-tone-settings.repository.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantId = '40000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400201';

async function createRepository() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of ['002_create_tenant_identity.sql', '003_add_localization_preferences.sql', '005_create_social_accounts.sql', '006_create_social_credentials.sql', '007_create_social_comments.sql', '015_create_social_account_response_tone_settings.sql']) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantId, 'Tone tenant', 'USD']);
  await pool.query('INSERT INTO social_accounts (id, tenant_id, platform, external_account_id, display_name, credential_reference) VALUES ($1, $2, $3, $4, $5, $6)', [accountId, tenantId, 'instagram', 'ig-account-1', 'Instagram', 'credential-reference']);
  const database = new PostgresPersistenceAdapter(pool);
  return { pool, repository: new PostgresSocialAccountResponseToneSettingsRepository(database) };
}

test('account response tone settings persist tenant-scoped profile values and do not leak across accounts', async () => {
  const { pool, repository } = await createRepository();
  try {
    assert.equal(await repository.get(tenantId, accountId), null);
    const profile = { primaryTone: 'EMPATHETIC', modifiers: ['CONCISE', 'WARM'], customNote: 'Avoid slang.' };

    const saved = await repository.save(tenantId, accountId, profile);
    const reread = await repository.get(tenantId, accountId);
    const otherAccount = await repository.get(tenantId, '5b7f1f84-25a8-4bd8-a7df-680dc4400202');

    assert.deepEqual(saved, { ...profile, updatedAt: saved.updatedAt });
    assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
    assert.deepEqual(reread, saved);
    assert.equal(otherAccount, null);
    const { rows } = await pool.query('SELECT primary_tone, modifiers_json, custom_note FROM social_account_response_tone_settings');
    assert.deepEqual(rows, [{ primary_tone: 'EMPATHETIC', modifiers_json: '["CONCISE","WARM"]', custom_note: 'Avoid slang.' }]);
  } finally {
    await pool.end();
  }
});
