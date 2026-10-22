import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresVerifiedReleaseScheduleRepository } = require('../../dist/infrastructure/persistence/postgres-verified-release-schedule.repository.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantId = '40000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400201';
const secondAccountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400202';

async function createRepository() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of [
    '002_create_tenant_identity.sql',
    '003_add_localization_preferences.sql',
    '005_create_social_accounts.sql',
    '007_create_social_comments.sql',
    '018_create_social_account_verified_release_schedules.sql',
  ]) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantId, 'Schedule tenant', 'USD']);
  for (const [id, externalId] of [[accountId, 'channel-1'], [secondAccountId, 'channel-2']]) {
    await pool.query(
      'INSERT INTO social_accounts (id, tenant_id, platform, external_account_id, display_name, credential_reference) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, tenantId, 'youtube', externalId, externalId, 'credential-reference'],
    );
  }
  return {
    pool,
    repository: new PostgresVerifiedReleaseScheduleRepository(new PostgresPersistenceAdapter(pool)),
  };
}

test('verified release schedules persist local time with its IANA zone and isolate account rows', async () => {
  const { pool, repository } = await createRepository();
  try {
    assert.equal(await repository.get(tenantId, accountId), null);
    const config = {
      enabled: true,
      daysOfWeek: ['MONDAY', 'WEDNESDAY'],
      localTime: '20:30',
      timeZone: 'America/Sao_Paulo',
    };

    const first = await repository.save(tenantId, accountId, config);
    const reread = await repository.get(tenantId, accountId);
    const otherAccount = await repository.get(tenantId, secondAccountId);
    const changed = await repository.save(tenantId, accountId, { ...config, localTime: '21:15' });

    assert.equal(first.version, 1);
    assert.equal(first.localTime, '20:30');
    assert.equal(first.timeZone, 'America/Sao_Paulo');
    assert.ok(Number.isFinite(Date.parse(first.updatedAt)));
    assert.ok(Number.isFinite(Date.parse(first.confirmedAt)));
    assert.deepEqual(reread, first);
    assert.equal(otherAccount, null);
    assert.equal(changed.version, 2);
    assert.equal(changed.localTime, '21:15');
    assert.equal(changed.timeZone, 'America/Sao_Paulo');
    const { rows } = await pool.query('SELECT local_time::text AS local_time, time_zone FROM social_account_verified_release_schedules WHERE social_account_id = $1', [accountId]);
    assert.equal(rows[0].local_time.slice(0, 5), '21:15');
    assert.equal(rows[0].time_zone, 'America/Sao_Paulo');
  } finally {
    await pool.end();
  }
});

test('verified release schedule repository does not return data for a different tenant', async () => {
  const { pool, repository } = await createRepository();
  try {
    await repository.save(tenantId, accountId, {
      enabled: true,
      daysOfWeek: ['FRIDAY'],
      localTime: '18:00',
      timeZone: 'America/Sao_Paulo',
    });

    assert.equal(await repository.get('40000000-0000-4000-8000-000000000002', accountId), null);
  } finally {
    await pool.end();
  }
});
