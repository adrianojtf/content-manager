import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PostgresConnection } = require('../../dist/infrastructure/persistence/postgres-persistence.module.js');

function createPool(failure) {
  const calls = [];
  return {
    calls,
    query: async (statement) => {
      calls.push(statement);
      if (failure) throw failure;
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    },
    connect: async () => { throw new Error('unused'); },
    end: async () => { calls.push('END'); },
  };
}

test('PostgreSQL connection verifies startup connectivity and closes its pool on shutdown', async () => {
  const pool = createPool();
  const connection = new PostgresConnection(pool);

  await connection.onModuleInit();
  await connection.onModuleDestroy();

  assert.deepEqual(pool.calls, ['SELECT 1', 'END']);
});

test('PostgreSQL connection closes its pool when startup verification fails', async () => {
  const failure = new Error('connection refused');
  const pool = createPool(failure);
  const connection = new PostgresConnection(pool);

  await assert.rejects(connection.onModuleInit(), failure);
  assert.deepEqual(pool.calls, ['SELECT 1', 'END']);
});
