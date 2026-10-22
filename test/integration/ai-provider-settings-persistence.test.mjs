import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresAIProviderSettingsRepository } = require('../../dist/infrastructure/persistence/postgres-ai-provider-settings.repository.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const encryptionKey = Buffer.alloc(32, 7).toString('base64');

async function createRepository(environment = { SOCIAL_CREDENTIAL_ENCRYPTION_KEY: encryptionKey }) {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await pool.query(await readFile(path.join(migrationDirectory, '016_create_ai_provider_settings.sql'), 'utf8'));
  return {
    pool,
    repository: new PostgresAIProviderSettingsRepository(new PostgresPersistenceAdapter(pool), environment),
  };
}

test('AI provider settings are encrypted at rest and runtime values prefer saved overrides to environment', async () => {
  const environment = {
    SOCIAL_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
    TYPESAFE_API_KEY: 'typesafe-environment-secret',
    JEV_API_KEY: 'environment-secret',
  };
  const { pool, repository } = await createRepository(environment);
  try {
    await repository.save({
      jevApiKey: 'saved-jev-secret',
      geminiApiKey: 'saved-gemini-secret',
      geminiDataUsePolicy: 'paid-tier',
    });

    const values = await repository.get();
    const { rows } = await pool.query('SELECT ciphertext, nonce, auth_tag FROM ai_provider_settings WHERE id = 1');

    assert.equal(values.jevApiKey, 'saved-jev-secret');
    assert.equal(values.geminiApiKey, 'saved-gemini-secret');
    assert.equal(values.openaiApiKey, null);
    assert.equal(JSON.stringify(rows).includes('saved-gemini-secret'), false);
    assert.equal(JSON.stringify(rows).includes('saved-jev-secret'), false);
    assert.equal(rows[0].nonce.length > 0, true);
    assert.equal(rows[0].auth_tag.length > 0, true);
  } finally {
    await pool.end();
  }
});

test('clearing a saved provider override falls back to environment settings', async () => {
  const environment = {
    SOCIAL_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
    TYPESAFE_API_KEY: 'typesafe-environment-secret',
  };
  const { pool, repository } = await createRepository(environment);
  try {
    await repository.save({ jevApiKey: 'saved-secret' });
    await repository.save({ jevApiKey: null });
    assert.equal((await repository.get()).jevApiKey, 'typesafe-environment-secret');
  } finally {
    await pool.end();
  }
});

test('legacy encrypted endpoint/auth fields are ignored while preserving the saved API key', async () => {
  const { pool, repository } = await createRepository();
  try {
    const legacy = {
      jevCommentEvaluationUrl: 'https://legacy.example/comment',
      jevResponseEvaluationUrl: 'https://legacy.example/response',
      jevApiKey: 'existing-typesafe-key',
      jevApiKeyHeader: 'x-legacy-key',
      jevApiKeyPrefix: '',
      geminiApiKey: null,
      geminiDataUsePolicy: null,
      openaiApiKey: null,
    };
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'base64'), nonce);
    cipher.setAAD(Buffer.from('creator-desk-ai-provider-settings-v1'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(legacy), 'utf8'), cipher.final()]);
    await pool.query(
      `INSERT INTO ai_provider_settings (id, ciphertext, nonce, auth_tag)
       VALUES (1, $1, $2, $3)`,
      [ciphertext.toString('base64'), nonce.toString('base64'), cipher.getAuthTag().toString('base64')],
    );

    const settings = await repository.get();
    assert.equal(settings.jevApiKey, 'existing-typesafe-key');
    assert.equal('jevCommentEvaluationUrl' in settings, false);
    assert.equal('jevApiKeyHeader' in settings, false);

    await repository.save({ geminiDataUsePolicy: 'paid-tier' });
    assert.equal((await repository.get()).jevApiKey, 'existing-typesafe-key');
  } finally {
    await pool.end();
  }
});

test('saving provider settings requires a valid encryption key', async () => {
  const { pool, repository } = await createRepository({});
  try {
    await assert.rejects(
      repository.save({ openaiApiKey: 'openai-secret' }),
      (error) => error.code === 'AI_PROVIDER_SETTINGS_ENCRYPTION_KEY_REQUIRED',
    );
  } finally {
    await pool.end();
  }
});
