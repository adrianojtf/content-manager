import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresTenantVerifiedReleaseScheduleRepository } = require('../../dist/infrastructure/persistence/postgres-tenant-verified-release-schedule.repository.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantId = '40000000-0000-4000-8000-000000000001';
const otherTenantId = '40000000-0000-4000-8000-000000000002';

async function createRepository() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of ['002_create_tenant_identity.sql', '003_add_localization_preferences.sql', '021_create_tenant_verified_release_schedules.sql']) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3), ($4, $5, $6)', [tenantId, 'Schedule tenant', 'USD', otherTenantId, 'Other tenant', 'USD']);
  return {
    pool,
    repository: new PostgresTenantVerifiedReleaseScheduleRepository(new PostgresPersistenceAdapter(pool)),
  };
}

test('tenant verified release schedules persist the global default with version increments and tenant isolation', async () => {
  const { pool, repository } = await createRepository();
  try {
    assert.equal(await repository.get(tenantId), null);
    const config = {
      enabled: true,
      daysOfWeek: ['MONDAY', 'WEDNESDAY'],
      localTime: '20:30',
      timeZone: 'America/Sao_Paulo',
    };

    const saved = await repository.save(tenantId, config);
    assert.equal(saved.version, 1);
    assert.deepEqual(saved.daysOfWeek, ['MONDAY', 'WEDNESDAY']);
    assert.equal(saved.localTime, '20:30');
    assert.equal(saved.timeZone, 'America/Sao_Paulo');
    assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
    assert.ok(Number.isFinite(Date.parse(saved.confirmedAt)));
    assert.deepEqual(await repository.get(tenantId), saved);
    assert.equal(await repository.get(otherTenantId), null);

    const updated = await repository.save(tenantId, { ...config, enabled: false, daysOfWeek: [] });
    assert.equal(updated.version, 2);
    assert.equal(updated.enabled, false);
    assert.deepEqual((await repository.get(tenantId)).daysOfWeek, []);

    const { rows } = await pool.query('SELECT tenant_id FROM tenant_verified_release_schedules');
    assert.equal(rows.length, 1);
  } finally {
    await pool.end();
  }
});
