import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { Content } = require('../../dist/domain/content/content.js');
const { parseContentId } = require('../../dist/domain/content/content-id.js');
const { ContentInvariantError } = require('../../dist/domain/content/content-invariant-error.js');
const { PostgresContentRepository } = require('../../dist/infrastructure/persistence/postgres-content.repository.js');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantOne = '10000000-0000-4000-8000-000000000001';
const tenantTwo = '10000000-0000-4000-8000-000000000002';

async function createRepository() {
  const database = newDb();
  database.public.registerFunction({
    name: 'btrim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value) => value.trim(),
  });
  database.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (value) => value.length,
  });
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();
  for (const migration of [
    '001_create_contents.sql',
    '002_create_tenant_identity.sql',
    '003_add_localization_preferences.sql',
    '004_scope_contents_to_tenant.sql',
  ]) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantOne, 'Tenant One', 'USD']);
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantTwo, 'Tenant Two', 'EUR']);

  const adapter = new PostgresPersistenceAdapter(pool);
  return {
    database: adapter,
    pool,
    repository: new PostgresContentRepository(adapter),
  };
}

function createContent(status = 'draft', tenantId = tenantOne) {
  const content = Content.create({
    id: parseContentId('5b7f1f84-25a8-4bd8-a7df-680dc4400001'),
    tenantId,
    title: 'Library title',
    description: 'Editorial description',
    mediaReference: 'media/content-1/video',
  });
  if (status === 'ready') {
    content.markReady();
  }
  return content;
}

test('PostgreSQL repository saves and retrieves Content inside the owning tenant', async () => {
  const { pool, repository } = await createRepository();
  try {
    const content = createContent();
    await repository.save(tenantOne, content);

    const retrieved = await repository.findById(tenantOne, content.id);

    assert.ok(retrieved instanceof Content);
    assert.equal(retrieved.id, content.id);
    assert.equal(retrieved.tenantId, tenantOne);
    assert.equal(retrieved.title, content.title);
    assert.equal(retrieved.description, content.description);
    assert.equal(retrieved.mediaReference, content.mediaReference);
    assert.equal(retrieved.status, 'draft');
  } finally {
    await pool.end();
  }
});

test('PostgreSQL repository persists readiness changes and returns null outside the tenant scope', async () => {
  const { pool, repository } = await createRepository();
  try {
    const content = createContent('ready');
    await repository.save(tenantOne, content);

    const retrieved = await repository.findById(tenantOne, content.id);

    assert.equal(retrieved.status, 'ready');
    assert.equal(retrieved.isPublishable, true);
    assert.equal(await repository.findById(tenantOne, parseContentId('5b7f1f84-25a8-4bd8-a7df-680dc4400002')), null);
    assert.equal(await repository.findById(tenantTwo, content.id), null);
  } finally {
    await pool.end();
  }
});

test('PostgreSQL repository persists editorial updates without resetting readiness', async () => {
  const { pool, repository } = await createRepository();
  try {
    const content = createContent('ready');
    await repository.save(tenantOne, content);
    content.updateEditorialMetadata('Revised title', 'Revised description');
    await repository.save(tenantOne, content);

    const retrieved = await repository.findById(tenantOne, content.id);

    assert.equal(retrieved.title, 'Revised title');
    assert.equal(retrieved.description, 'Revised description');
    assert.equal(retrieved.status, 'ready');
  } finally {
    await pool.end();
  }
});

test('PostgreSQL repository rejects cross-tenant mutations, including a colliding Content ID', async () => {
  const { pool, repository } = await createRepository();
  try {
    const content = createContent();
    await repository.save(tenantOne, content);
    await assert.rejects(repository.save(tenantTwo, content), (error) => error instanceof ContentInvariantError && error.code === 'CONTENT_TENANT_MISMATCH');

    const collidingContent = createContent('draft', tenantTwo);
    await assert.rejects(repository.save(tenantTwo, collidingContent), (error) => error instanceof ContentInvariantError && error.code === 'CONTENT_TENANT_MISMATCH');
    assert.equal((await repository.findById(tenantOne, content.id)).title, content.title);
  } finally {
    await pool.end();
  }
});

test('concurrent saves of the same Content ID in one tenant remain safe', async () => {
  const { pool, repository } = await createRepository();
  try {
    const content = createContent();
    await Promise.all([repository.save(tenantOne, content), repository.save(tenantOne, content)]);
    assert.equal((await repository.findById(tenantOne, content.id)).tenantId, tenantOne);
  } finally {
    await pool.end();
  }
});

test('PostgreSQL constraints require tenant ownership and reject blank fields or unknown states', async () => {
  const { database, pool } = await createRepository();
  try {
    await assert.rejects(database.query(
      'INSERT INTO contents (id, title, description, media_key, status) VALUES ($1, $2, $3, $4, $5)',
      ['5b7f1f84-25a8-4bd8-a7df-680dc4400003', 'title', 'description', 'media/key', 'draft'],
    ));
    await assert.rejects(database.query(
      'INSERT INTO contents (id, tenant_id, title, description, media_key, status) VALUES ($1, $2, $3, $4, $5, $6)',
      ['5b7f1f84-25a8-4bd8-a7df-680dc4400004', '10000000-0000-4000-8000-000000000099', 'title', 'description', 'media/key', 'draft'],
    ));
    await assert.rejects(database.query(
      'INSERT INTO contents (id, tenant_id, title, description, media_key, status) VALUES ($1, $2, $3, $4, $5, $6)',
      ['5b7f1f84-25a8-4bd8-a7df-680dc4400005', tenantOne, '  ', 'description', 'media/key', 'draft'],
    ));
    await assert.rejects(database.query(
      'INSERT INTO contents (id, tenant_id, title, description, media_key, status) VALUES ($1, $2, $3, $4, $5, $6)',
      ['5b7f1f84-25a8-4bd8-a7df-680dc4400006', tenantOne, 'title', 'description', 'media/key', 'published'],
    ));
  } finally {
    await pool.end();
  }
});
