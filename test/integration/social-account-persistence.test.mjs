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
const { SocialAccountInvariantError } = require('../../dist/domain/social/social-account-invariant-error.js');
const { PostgresSocialAccountRepository } = require('../../dist/infrastructure/persistence/postgres-social-account.repository.js');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantOne = '10000000-0000-4000-8000-000000000001';
const tenantTwo = '10000000-0000-4000-8000-000000000002';

async function createRepository() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of ['002_create_tenant_identity.sql', '003_add_localization_preferences.sql', '005_create_social_accounts.sql']) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantOne, 'Tenant One', 'USD']);
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantTwo, 'Tenant Two', 'EUR']);
  const adapter = new PostgresPersistenceAdapter(pool);
  return { pool, repository: new PostgresSocialAccountRepository(adapter) };
}

function createAccount({ id = '5b7f1f84-25a8-4bd8-a7df-680dc4400001', tenantId = tenantOne, platform = 'youtube', externalAccountId = 'UC-channel-1', displayName = 'Creator channel', credentialReference = 'vault/social/youtube/account-1' } = {}) {
  return SocialAccount.create({ id: parseSocialAccountId(id), tenantId, platform, externalAccountId, displayName, credentialReference });
}

test('PostgreSQL social account repository persists a TikTok Business account with tenant/platform identity', async () => {
  const { pool, repository } = await createRepository();
  try {
    const account = createAccount({ platform: 'tiktok', externalAccountId: 'tiktok-business-1', credentialReference: 'vault/social/tiktok/account-1' });
    await repository.save(tenantOne, account);

    const stored = await repository.findById(tenantOne, account.id);
    assert.equal(stored.platform, 'tiktok');
    assert.equal(stored.externalAccountId, 'tiktok-business-1');
    assert.equal((await repository.findByProviderIdentity(tenantOne, 'tiktok', 'tiktok-business-1')).id, account.id);
  } finally {
    await pool.end();
  }
});

test('PostgreSQL social account repository persists and lists accounts only in the owning tenant', async () => {
  const { pool, repository } = await createRepository();
  try {
    const account = createAccount();
    await repository.save(tenantOne, account);

    const retrieved = await repository.findById(tenantOne, account.id);

    assert.ok(retrieved instanceof SocialAccount);
    assert.equal(retrieved.externalAccountId, account.externalAccountId);
    assert.equal(retrieved.credentialReference, account.credentialReference);
    assert.equal((await repository.findByProviderIdentity(tenantOne, account.platform, account.externalAccountId)).id, account.id);
    assert.equal(await repository.findByProviderIdentity(tenantTwo, account.platform, account.externalAccountId), null);
    assert.equal(await repository.findById(tenantTwo, account.id), null);
    assert.deepEqual(await repository.listByTenant(tenantOne), [retrieved]);
    assert.deepEqual(await repository.listByTenant(tenantTwo), []);
  } finally {
    await pool.end();
  }
});

test('PostgreSQL social account repository updates credentials and metadata by tenant-scoped account ID', async () => {
  const { pool, repository } = await createRepository();
  try {
    const account = createAccount();
    await repository.save(tenantOne, account);
    const updated = createAccount({ displayName: 'Renamed channel', credentialReference: 'vault/social/youtube/account-1/refresh-2' });
    await repository.save(tenantOne, updated);

    const retrieved = await repository.findById(tenantOne, account.id);

    assert.equal(retrieved.displayName, 'Renamed channel');
    assert.equal(retrieved.credentialReference, updated.credentialReference);
    const { rows } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'social_accounts'");
    assert.equal(rows.some((row) => row.column_name === 'access_token'), false);
    assert.equal(rows.some((row) => row.column_name === 'refresh_token'), false);
  } finally {
    await pool.end();
  }
});

test('PostgreSQL social account repository normalizes provider identity conflicts during reauthorization', async () => {
  const { pool, repository } = await createRepository();
  try {
    const first = createAccount();
    const second = createAccount({ id: '5b7f1f84-25a8-4bd8-a7df-680dc4400002', externalAccountId: 'UC-channel-2' });
    await repository.save(tenantOne, first);
    await repository.save(tenantOne, second);

    await assert.rejects(
      repository.save(tenantOne, createAccount({ id: second.id, externalAccountId: first.externalAccountId })),
      (error) => error instanceof SocialAccountInvariantError && error.code === 'SOCIAL_ACCOUNT_ALREADY_CONNECTED',
    );
    assert.equal((await repository.findById(tenantOne, second.id)).externalAccountId, second.externalAccountId);
  } finally {
    await pool.end();
  }
});

test('PostgreSQL social account repository rejects cross-tenant mutations and duplicate provider identities', async () => {
  const { pool, repository } = await createRepository();
  try {
    const account = createAccount();
    await repository.save(tenantOne, account);
    await assert.rejects(repository.save(tenantTwo, account), (error) => error instanceof SocialAccountInvariantError && error.code === 'SOCIAL_ACCOUNT_TENANT_MISMATCH');
    await assert.rejects(
      repository.save(tenantOne, createAccount({ id: '5b7f1f84-25a8-4bd8-a7df-680dc4400002' })),
      (error) => error instanceof SocialAccountInvariantError && error.code === 'SOCIAL_ACCOUNT_ALREADY_CONNECTED',
    );
    assert.equal((await repository.findById(tenantOne, account.id)).displayName, account.displayName);
  } finally {
    await pool.end();
  }
});
