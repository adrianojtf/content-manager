import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresSocialAccountDisconnector } = require('../../dist/infrastructure/persistence/postgres-social-account-disconnector.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantId = '30000000-0000-4000-8000-000000000001';
const otherTenantId = '10000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400101';
const commentId = 'youtube-comment-1';
const credentialReference = 'youtube-credential-1';

async function createDisconnector() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of [
    '002_create_tenant_identity.sql',
    '003_add_localization_preferences.sql',
    '005_create_social_accounts.sql',
    '006_create_social_credentials.sql',
    '007_create_social_comments.sql',
    '008_create_comment_workflow_events.sql',
    '015_create_social_account_response_tone_settings.sql',
    '017_create_social_publications_and_comment_replies.sql',
  ]) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [otherTenantId, 'Other tenant', 'USD']);
  const database = new PostgresPersistenceAdapter(pool);
  return { pool, disconnector: new PostgresSocialAccountDisconnector(database) };
}

test('PostgreSQL disconnection atomically deletes account credentials and account-scoped cached data', async () => {
  const { pool, disconnector } = await createDisconnector();
  try {
    await pool.query(
      `INSERT INTO social_accounts (id, tenant_id, platform, external_account_id, display_name, credential_reference)
       VALUES ($1, $2, 'youtube', 'UC-channel-1', 'Creator channel', $3)`,
      [accountId, tenantId, credentialReference],
    );
    await pool.query(
      `INSERT INTO social_credentials (tenant_id, credential_reference, platform, ciphertext, nonce, auth_tag, expires_at)
       VALUES ($1, $2, 'youtube', 'encrypted', 'nonce', 'tag', NULL)`,
      [tenantId, credentialReference],
    );
    await pool.query(
      `INSERT INTO social_comments (
         tenant_id, social_account_id, platform, external_publication_id, external_comment_id,
         external_thread_id, author_display_name, comment_text, provider_created_at, can_reply,
         last_synced_at, retention_expires_at
       ) VALUES ($1, $2, 'youtube', 'video-1', $3, 'thread-1', 'Viewer', 'Comment', NOW(), TRUE, NOW(), NOW() + INTERVAL '30 days')`,
      [tenantId, accountId, commentId],
    );
    await pool.query(
      `INSERT INTO social_publications (
         tenant_id, social_account_id, platform, external_publication_id, title, last_synced_at
       ) VALUES ($1, $2, 'youtube', 'video-1', 'Episode 1', NOW())`,
      [tenantId, accountId],
    );
    await pool.query(
      `INSERT INTO social_comment_replies (
         tenant_id, social_account_id, platform, external_comment_id, external_reply_id, reply_text, last_synced_at
       ) VALUES ($1, $2, 'youtube', $3, 'creator-reply-1', 'Thanks!', NOW())`,
      [tenantId, accountId, commentId],
    );
    await pool.query(
      `INSERT INTO comment_workflow_events (
         id, tenant_id, social_account_id, external_comment_id, event_type, actor_source, status,
         payload_json, recorded_at, expires_at
       ) VALUES ('6a7f1f84-25a8-4bd8-a7df-680dc4400101', $1, $2, $3, 'COMMENT_SYNCED', 'APPLICATION', 'SUCCEEDED', '{}', NOW(), NOW() + INTERVAL '30 days')`,
      [tenantId, accountId, commentId],
    );
    await pool.query(
      `INSERT INTO social_account_response_tone_settings (tenant_id, social_account_id, primary_tone)
       VALUES ($1, $2, 'FRIENDLY')`,
      [tenantId, accountId],
    );

    assert.equal(await disconnector.disconnect(otherTenantId, accountId), false);
    assert.equal((await pool.query('SELECT id FROM social_accounts WHERE id = $1', [accountId])).rows.length, 1);
    assert.equal((await pool.query('SELECT credential_reference FROM social_credentials WHERE credential_reference = $1', [credentialReference])).rows.length, 1);

    assert.equal(await disconnector.disconnect(tenantId, accountId), true);
    assert.equal(await disconnector.disconnect(tenantId, accountId), false);
    for (const table of ['social_accounts', 'social_credentials', 'social_publications', 'social_comments', 'social_comment_replies', 'comment_workflow_events', 'social_account_response_tone_settings']) {
      assert.equal((await pool.query(`SELECT * FROM ${table}`)).rows.length, 0, `${table} should be cleared`);
    }
  } finally {
    await pool.end();
  }
});
