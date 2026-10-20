import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresOidcIdentityRepository } = require('../../dist/infrastructure/identity/postgres-oidc-identity.repository.js');
const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations/002_create_tenant_identity.sql');

async function createRepository() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await pool.query(await readFile(migrationPath, 'utf8'));
  await pool.query("INSERT INTO tenants (id, name) VALUES ($1, $2)", ['10000000-0000-4000-8000-000000000001', 'Tenant One']);
  await pool.query("INSERT INTO tenants (id, name) VALUES ($1, $2)", ['10000000-0000-4000-8000-000000000002', 'Tenant Two']);
  await pool.query("INSERT INTO users (id, oidc_issuer, oidc_subject) VALUES ($1, $2, $3)", ['20000000-0000-4000-8000-000000000001', 'https://issuer.example', 'owner-sub']);
  await pool.query("INSERT INTO tenant_memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)", ['20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'OWNER']);
  await pool.query("INSERT INTO users (id, oidc_issuer, oidc_subject) VALUES ($1, $2, $3)", ['20000000-0000-4000-8000-000000000002', 'https://issuer.example', 'admin-sub']);
  await pool.query('INSERT INTO platform_admins (user_id) VALUES ($1)', ['20000000-0000-4000-8000-000000000002']);

  return { pool, repository: new PostgresOidcIdentityRepository(new PostgresPersistenceAdapter(pool)) };
}

test('PostgreSQL OIDC repository resolves users only from the verified issuer and subject pair', async () => {
  const { pool, repository } = await createRepository();
  try {
    assert.deepEqual(await repository.findByIssuerAndSubject('https://issuer.example', 'owner-sub'), {
      userId: '20000000-0000-4000-8000-000000000001',
      isActive: true,
      tenantId: '10000000-0000-4000-8000-000000000001',
      tenantRole: 'OWNER',
      tenantIsActive: true,
      isPlatformAdmin: false,
    });
    assert.equal(await repository.findByIssuerAndSubject('https://issuer.example', 'unknown'), null);
    assert.equal(await repository.findByIssuerAndSubject('https://other.example', 'owner-sub'), null);
  } finally {
    await pool.end();
  }
});

test('identity schema enforces one tenant membership per user and one Owner per tenant', async () => {
  const { pool } = await createRepository();
  try {
    await assert.rejects(pool.query(
      'INSERT INTO tenant_memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)',
      ['20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'MEMBER'],
    ));
    await pool.query(
      'INSERT INTO users (id, oidc_issuer, oidc_subject) VALUES ($1, $2, $3)',
      ['20000000-0000-4000-8000-000000000003', 'https://issuer.example', 'second-owner-sub'],
    );
    await assert.rejects(pool.query(
      'INSERT INTO tenant_memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)',
      ['20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'OWNER'],
    ));
  } finally {
    await pool.end();
  }
});

test('PostgreSQL OIDC repository resolves platform administrators separately from tenant roles', async () => {
  const { pool, repository } = await createRepository();
  try {
    assert.deepEqual(await repository.findByIssuerAndSubject('https://issuer.example', 'admin-sub'), {
      userId: '20000000-0000-4000-8000-000000000002',
      isActive: true,
      tenantId: null,
      tenantRole: null,
      tenantIsActive: null,
      isPlatformAdmin: true,
    });
  } finally {
    await pool.end();
  }
});
