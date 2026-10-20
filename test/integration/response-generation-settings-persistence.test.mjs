import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresResponseGenerationSettingsRepository } = require('../../dist/infrastructure/persistence/postgres-response-generation-settings.repository.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');

async function createRepository() {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await pool.query(await readFile(path.join(migrationDirectory, '010_create_response_generation_settings.sql'), 'utf8'));
  return { pool, repository: new PostgresResponseGenerationSettingsRepository(new PostgresPersistenceAdapter(pool)) };
}

test('response-generation settings are stored as one provider/model selection with no API secrets', async () => {
  const { pool, repository } = await createRepository();
  try {
    assert.deepEqual(await repository.get(), {
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      updatedAt: null,
      updatedByAdminUserId: null,
    });

    const saved = await repository.save('openai', 'gpt-6-luna');
    const reread = await repository.get();
    const { rows } = await pool.query('SELECT provider, model, updated_by_admin_user_id FROM ai_response_generation_settings');

    assert.equal(saved.provider, 'openai');
    assert.equal(saved.model, 'gpt-6-luna');
    assert.deepEqual(reread, saved);
    assert.deepEqual(rows, [{ provider: 'openai', model: 'gpt-6-luna', updated_by_admin_user_id: null }]);
  } finally {
    await pool.end();
  }
});
