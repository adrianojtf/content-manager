import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { LOCAL_PILOT_TENANT_ID } = require('../../dist/infrastructure/persistence/local-pilot-tenant-context.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');

test('social account migration provisions the fixed local pilot tenant without an OIDC user', async () => {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  try {
    for (const migration of ['002_create_tenant_identity.sql', '003_add_localization_preferences.sql', '005_create_social_accounts.sql']) {
      await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
    }

    const { rows } = await pool.query('SELECT id, name, currency FROM tenants WHERE id = $1', [LOCAL_PILOT_TENANT_ID]);
    const { rows: memberships } = await pool.query('SELECT user_id FROM tenant_memberships WHERE tenant_id = $1', [LOCAL_PILOT_TENANT_ID]);

    assert.deepEqual(rows, [{ id: LOCAL_PILOT_TENANT_ID, name: 'Local creator pilot', currency: 'BRL' }]);
    assert.deepEqual(memberships, []);
  } finally {
    await pool.end();
  }
});
