import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresSocialAccountRepository } = require('../../dist/infrastructure/persistence/postgres-social-account.repository.js');
const { PostgresSocialCommentRepository } = require('../../dist/infrastructure/persistence/postgres-social-comment.repository.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantOne = '30000000-0000-4000-8000-000000000001';
const tenantTwo = '10000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const syncedAt = '2026-10-13T12:00:00.000Z';
const expiresAt = '2026-11-12T12:00:00.000Z';

async function createRepositories() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of ['002_create_tenant_identity.sql', '003_add_localization_preferences.sql', '005_create_social_accounts.sql', '006_create_social_credentials.sql', '007_create_social_comments.sql', '013_persist_comment_reply_status.sql', '014_add_tiktok_business_platform.sql']) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantTwo, 'Tenant Two', 'USD']);
  const database = new PostgresPersistenceAdapter(pool);
  const accounts = new PostgresSocialAccountRepository(database);
  const account = SocialAccount.create({
    id: parseSocialAccountId(accountId),
    tenantId: tenantOne,
    platform: 'youtube',
    externalAccountId: 'UC-channel-1',
    displayName: 'Creator channel',
    credentialReference: 'credential-reference',
  });
  await accounts.save(tenantOne, account);
  return { pool, account, comments: new PostgresSocialCommentRepository(database) };
}

function comment({ externalCommentId = 'comment-1', text = 'Great episode', publicationId = 'video-1', externalReplyStatus = 'UNKNOWN' } = {}) {
  return {
    platform: 'youtube',
    externalCommentId,
    externalThreadId: `thread-${externalCommentId}`,
    externalPublicationId: publicationId,
    authorDisplayName: 'Viewer',
    text,
    createdAt: '2026-10-12T14:00:00.000Z',
    canReply: true,
    externalReplyStatus,
  };
}

test('comment repository persists normalized comments tenant-scoped with a 30-day expiry', async () => {
  const { pool, account, comments } = await createRepositories();
  try {
    await comments.upsertPage(account, 'video-1', [comment()], syncedAt, expiresAt);

    const rows = await comments.listByPublication(tenantOne, account.id, 'video-1', syncedAt);

    assert.deepEqual(rows, [{ ...comment(), socialAccountId: account.id, appReplied: false, lastSyncedAt: syncedAt, expiresAt }]);
    assert.deepEqual(await comments.listByPublication(tenantTwo, account.id, 'video-1', syncedAt), []);
  } finally {
    await pool.end();
  }
});

test('comment repository finds a single comment only within tenant/account scope and retention', async () => {
  const { pool, account, comments } = await createRepositories();
  try {
    await comments.upsertPage(account, 'video-1', [comment()], syncedAt, expiresAt);

    assert.equal((await comments.findByExternalCommentId(tenantOne, account.id, 'comment-1', syncedAt)).text, 'Great episode');
    assert.equal(await comments.findByExternalCommentId(tenantTwo, account.id, 'comment-1', syncedAt), null);
    assert.equal(await comments.findByExternalCommentId(tenantOne, account.id, 'comment-1', '2026-11-13T12:00:00.000Z'), null);
  } finally {
    await pool.end();
  }
});

test('comment repository enumerates unexpired comments by account and whole tenant for batch actions', async () => {
  const { pool, account, comments } = await createRepositories();
  try {
    await comments.upsertPage(account, 'video-1', [comment()], syncedAt, expiresAt);
    await comments.upsertPage(account, 'video-2', [comment({ externalCommentId: 'comment-2', publicationId: 'video-2' })], syncedAt, expiresAt);

    const byAccount = await comments.listByAccount(tenantOne, account.id, syncedAt);
    const byTenant = await comments.listByTenant(tenantOne, syncedAt);
    const otherTenant = await comments.listByTenant(tenantTwo, syncedAt);

    assert.deepEqual(byAccount.map((item) => item.externalCommentId), ['comment-1', 'comment-2']);
    assert.deepEqual(byTenant.map((item) => item.externalCommentId), ['comment-1', 'comment-2']);
    assert.deepEqual(otherTenant, []);
  } finally {
    await pool.end();
  }
});

test('comment repository upserts duplicate external IDs and refreshes retention without duplicating rows', async () => {
  const { pool, account, comments } = await createRepositories();
  try {
    await comments.upsertPage(account, 'video-1', [comment()], syncedAt, expiresAt);
    const nextSyncAt = '2026-10-20T12:00:00.000Z';
    const nextExpiry = '2026-11-19T12:00:00.000Z';
    await comments.upsertPage(account, 'video-1', [comment({ text: 'Updated display text' })], nextSyncAt, nextExpiry);

    const rows = await comments.listByPublication(tenantOne, account.id, 'video-1', nextSyncAt);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, 'Updated display text');
    assert.equal(rows[0].lastSyncedAt, nextSyncAt);
    assert.equal(rows[0].expiresAt, nextExpiry);
  } finally {
    await pool.end();
  }
});

test('comment repository preserves app reply state and refreshes external reply state during sync', async () => {
  const { pool, account, comments } = await createRepositories();
  try {
    await comments.upsertPage(account, 'video-1', [comment()], syncedAt, expiresAt);
    await comments.markRepliedByApp(tenantOne, account.id, 'comment-1', '2026-10-14T12:00:00.000Z');
    await comments.upsertPage(account, 'video-1', [comment({ externalReplyStatus: 'REPLIED' })], '2026-10-14T12:00:00.000Z', '2026-11-13T12:00:00.000Z');

    const [stored] = await comments.listByPublication(tenantOne, account.id, 'video-1', '2026-10-14T12:00:00.000Z');
    assert.equal(stored.appReplied, true);
    assert.equal(stored.externalReplyStatus, 'REPLIED');
  } finally {
    await pool.end();
  }
});

test('comment repository physically removes expired rows on the next sync or read', async () => {
  const { pool, account, comments } = await createRepositories();
  try {
    await comments.upsertPage(account, 'video-1', [comment()], syncedAt, expiresAt);
    await comments.upsertPage(account, 'video-2', [comment({ externalCommentId: 'comment-2', publicationId: 'video-2' })], syncedAt, '2026-10-14T12:00:00.000Z');

    const rows = await comments.listByPublication(tenantOne, account.id, 'video-1', '2026-11-13T12:00:00.000Z');
    const { rows: stored } = await pool.query('SELECT external_comment_id FROM social_comments WHERE tenant_id = $1', [tenantOne]);

    assert.deepEqual(rows, []);
    assert.deepEqual(stored, []);
  } finally {
    await pool.end();
  }
});

test('comment repository rejects writes with mismatched account/platform/publication context', async () => {
  const { pool, account, comments } = await createRepositories();
  try {
    await assert.rejects(comments.upsertPage({ ...account, tenantId: tenantTwo }, 'video-1', [comment()], syncedAt, expiresAt));
    await assert.rejects(comments.upsertPage(account, 'video-2', [comment({ publicationId: 'video-1' })], syncedAt, expiresAt));
    assert.deepEqual(await comments.listByPublication(tenantOne, account.id, 'video-1', syncedAt), []);
  } finally {
    await pool.end();
  }
});
