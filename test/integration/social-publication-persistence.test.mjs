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
const { PostgresSocialPublicationRepository } = require('../../dist/infrastructure/persistence/postgres-social-publication.repository.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantOne = '30000000-0000-4000-8000-000000000001';
const tenantTwo = '10000000-0000-4000-8000-000000000001';
const syncedAt = '2026-10-13T12:00:00.000Z';

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
    '017_create_social_publications_and_comment_replies.sql',
  ]) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantTwo, 'Other tenant', 'USD']);
  for (const socialAccount of [firstAccount, secondAccount]) {
    await pool.query(
      `INSERT INTO social_accounts (id, tenant_id, platform, external_account_id, display_name, credential_reference)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [socialAccount.id, socialAccount.tenantId, socialAccount.platform, socialAccount.externalAccountId, socialAccount.displayName, socialAccount.credentialReference],
    );
  }
  const database = new PostgresPersistenceAdapter(pool);
  return { pool, database, repository: new PostgresSocialPublicationRepository(database) };
}

function account({ id, tenantId }) {
  return SocialAccount.create({
    id: parseSocialAccountId(id),
    tenantId,
    platform: 'youtube',
    externalAccountId: `channel-${id}`,
    displayName: 'Creator channel',
    credentialReference: `vault/social/youtube/${id}`,
  });
}

const firstAccount = account({ id: '5b7f1f84-25a8-4bd8-a7df-680dc4400001', tenantId: tenantOne });
const secondAccount = account({ id: '5b7f1f84-25a8-4bd8-a7df-680dc4400002', tenantId: tenantTwo });

function publication(overrides = {}) {
  return {
    platform: 'youtube',
    externalPublicationId: 'video-1',
    title: 'Episode 1',
    description: 'First episode',
    permalink: 'https://youtube.example/video-1',
    thumbnailUrl: 'https://youtube.example/thumbnail-1',
    publishedAt: '2026-10-12T10:00:00.000Z',
    ...overrides,
  };
}

test('social publication repository upserts normalized pages and scopes identical provider IDs by tenant/account', async () => {
  const { pool, repository } = await createRepository();
  try {
    await repository.upsertPage(firstAccount, [publication()], syncedAt);
    await repository.upsertPage(secondAccount, [publication({ title: 'Other tenant video' })], syncedAt);

    const firstPage = await repository.listByAccount(tenantOne, firstAccount.id);
    const otherTenantPage = await repository.listByAccount(tenantTwo, secondAccount.id);

    assert.deepEqual(firstPage, [{
      tenantId: tenantOne,
      socialAccountId: firstAccount.id,
      ...publication(),
      lastSyncedAt: syncedAt,
    }]);
    assert.equal(otherTenantPage.length, 1);
    assert.equal(otherTenantPage[0].title, 'Other tenant video');
    assert.deepEqual(await repository.listByAccount(tenantTwo, firstAccount.id), []);

    await repository.upsertPage(firstAccount, [publication({ title: 'Updated episode' })], '2026-10-20T12:00:00.000Z');
    const updated = await repository.listByAccount(tenantOne, firstAccount.id);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].title, 'Updated episode');
    assert.equal(updated[0].lastSyncedAt, '2026-10-20T12:00:00.000Z');
  } finally {
    await pool.end();
  }
});

test('social publication repository rejects cross-account or invalid publication data without partial writes', async () => {
  const { pool, repository } = await createRepository();
  try {
    await assert.rejects(repository.upsertPage(firstAccount, [
      publication(),
      publication({ externalPublicationId: '  ' }),
    ], syncedAt));
    await assert.rejects(repository.upsertPage(firstAccount, [
      publication({ platform: 'instagram' }),
    ], syncedAt));
    await assert.rejects(repository.upsertPage(firstAccount, [
      publication(),
      publication({ title: 'Duplicate provider ID in one page' }),
    ], syncedAt));
    assert.deepEqual(await repository.listByAccount(tenantOne, firstAccount.id), []);
  } finally {
    await pool.end();
  }
});

test('social publication repository preserves previously committed metadata when a page write fails', async () => {
  const { pool, database, repository } = await createRepository();
  try {
    await repository.upsertPage(firstAccount, [publication()], syncedAt);
    const failingDatabase = {
      query: (...args) => database.query(...args),
      transaction: (operation) => database.transaction((executor) => operation({
        query: async (statement, parameters) => {
          if (statement.includes('INSERT INTO social_publications')) throw new Error('simulated write failure');
          return executor.query(statement, parameters);
        },
      })),
    };
    const failingRepository = new PostgresSocialPublicationRepository(failingDatabase);

    await assert.rejects(failingRepository.upsertPage(
      firstAccount,
      [publication({ title: 'Uncommitted title' })],
      '2026-10-20T12:00:00.000Z',
    ));

    const [stored] = await repository.listByAccount(tenantOne, firstAccount.id);
    assert.equal(stored.title, 'Episode 1');
    assert.equal(stored.lastSyncedAt, syncedAt);
  } finally {
    await pool.end();
  }
});
