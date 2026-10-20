import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { RabbitMqJobQueueAdapter } = require('../../dist/infrastructure/messaging/rabbitmq-job-queue.adapter.js');
const { S3MediaStorageAdapter } = require('../../dist/infrastructure/storage/s3-media-storage.adapter.js');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

function createPostgresAdapter(query) {
  const operations = [];
  const calls = [];
  const client = {
    query: async (statement, parameters) => {
      operations.push(statement);
      calls.push({ statement, parameters });
      return query(statement, parameters);
    },
    release: () => operations.push('RELEASE'),
  };
  const pool = {
    query: client.query,
    connect: async () => client,
  };

  return { adapter: new PostgresPersistenceAdapter(pool), calls, operations };
}

test('PostgreSQL adapter executes parameterized queries and returns rows', async () => {
  const { adapter, calls } = createPostgresAdapter(async () => ({ rows: [{ id: 'content-1' }], rowCount: 1 }));
  const result = await adapter.query('SELECT id FROM content WHERE id = $1', ['content-1']);

  assert.deepEqual(result, { rows: [{ id: 'content-1' }], rowCount: 1 });
  assert.deepEqual(calls, [{ statement: 'SELECT id FROM content WHERE id = $1', parameters: ['content-1'] }]);
});

test('PostgreSQL adapter propagates query failures', async () => {
  const { adapter } = createPostgresAdapter(async () => {
    throw new Error('database unavailable');
  });

  await assert.rejects(adapter.query('SELECT 1'), /database unavailable/);
});

test('PostgreSQL adapter commits successful transactions', async () => {
  const { adapter, operations } = createPostgresAdapter(async () => ({ rows: [], rowCount: 0 }));
  const result = await adapter.transaction(async (transaction) => {
    await transaction.query('UPDATE content SET title = $1', ['title']);
    return 'saved';
  });

  assert.equal(result, 'saved');
  assert.deepEqual(operations, ['BEGIN', 'UPDATE content SET title = $1', 'COMMIT', 'RELEASE']);
});

test('PostgreSQL adapter rolls back and releases failed transactions', async () => {
  const { adapter, operations } = createPostgresAdapter(async (statement) => {
    if (statement === 'UPDATE content SET title = $1') {
      throw new Error('write failed');
    }
    return { rows: [], rowCount: 0 };
  });

  await assert.rejects(adapter.transaction(async (transaction) => {
    await transaction.query('UPDATE content SET title = $1', ['title']);
  }), /write failed/);
  assert.deepEqual(operations, ['BEGIN', 'UPDATE content SET title = $1', 'ROLLBACK', 'RELEASE']);
});

test('RabbitMQ adapter publishes JSON job messages', async () => {
  const published = [];
  const channel = {
    sendToQueue: (queue, body) => {
      published.push({ queue, body: body.toString() });
      return true;
    },
  };
  const adapter = new RabbitMqJobQueueAdapter(channel);
  const message = { jobId: 'job-1', payload: { contentId: 'content-1' } };

  await adapter.dispatch('publication', message);

  assert.deepEqual(published, [{ queue: 'publication', body: JSON.stringify(message) }]);
});

test('RabbitMQ adapter acknowledges successful jobs and supports cancellation', async () => {
  let deliveryHandler;
  const acknowledged = [];
  const canceled = [];
  const channel = {
    consume: async (queue, handler) => {
      deliveryHandler = handler;
      return { consumerTag: 'consumer-1' };
    },
    ack: (message) => acknowledged.push(message),
    cancel: async (tag) => canceled.push(tag),
  };
  const adapter = new RabbitMqJobQueueAdapter(channel);
  const subscription = await adapter.consume('publication', async (message) => {
    assert.deepEqual(message, { jobId: 'job-1' });
  }, 'reject');
  const delivery = { content: Buffer.from('{"jobId":"job-1"}') };

  await deliveryHandler(delivery);
  await subscription.cancel();

  assert.deepEqual(acknowledged, [delivery]);
  assert.deepEqual(canceled, ['consumer-1']);
});

test('RabbitMQ adapter applies the explicit failure disposition to failed jobs', async () => {
  let deliveryHandler;
  const rejected = [];
  const channel = {
    consume: async (_queue, handler) => {
      deliveryHandler = handler;
      return { consumerTag: 'consumer-1' };
    },
    nack: (message, allUpTo, requeue) => rejected.push({ message, allUpTo, requeue }),
  };
  const adapter = new RabbitMqJobQueueAdapter(channel);
  await adapter.consume('publication', async () => {
    throw new Error('handler failed');
  }, 'requeue');
  const delivery = { content: Buffer.from('{"jobId":"job-1"}') };

  await deliveryHandler(delivery);

  assert.deepEqual(rejected, [{ message: delivery, allUpTo: false, requeue: true }]);
});

test('RabbitMQ adapter rejects a failed job when requested by the consumer', async () => {
  let deliveryHandler;
  const rejected = [];
  const channel = {
    consume: async (_queue, handler) => {
      deliveryHandler = handler;
      return { consumerTag: 'consumer-1' };
    },
    nack: (message, allUpTo, requeue) => rejected.push({ message, allUpTo, requeue }),
  };
  const adapter = new RabbitMqJobQueueAdapter(channel);
  await adapter.consume('publication', async () => {
    throw new Error('handler failed');
  }, 'reject');
  const delivery = { content: Buffer.from('{"jobId":"job-1"}') };

  await deliveryHandler(delivery);

  assert.deepEqual(rejected, [{ message: delivery, allUpTo: false, requeue: false }]);
});

test('S3 adapter stores media and returns a provider-neutral key reference', async () => {
  const commands = [];
  const client = { send: async (command) => commands.push(command) };
  const adapter = new S3MediaStorageAdapter(client, 'media');
  const input = { key: 'content/content-1/video', body: Buffer.from('video'), contentType: 'video/mp4' };

  const reference = await adapter.store(input);

  assert.deepEqual(reference, { key: input.key });
  assert.ok(commands[0] instanceof PutObjectCommand);
  assert.equal(commands[0].input.Bucket, 'media');
  assert.equal(commands[0].input.Key, input.key);
  assert.equal(commands[0].input.Body, input.body);
  assert.equal(commands[0].input.ContentType, input.contentType);
});

test('S3 adapter converts asynchronous byte sources into a streaming body', async () => {
  let command;
  const client = { send: async (request) => { command = request; } };
  const adapter = new S3MediaStorageAdapter(client, 'media');
  const body = async function* () {
    yield Buffer.from('first');
    yield Buffer.from('second');
  };

  await adapter.store({ key: 'content/content-1/video', body: body() });

  assert.ok(command.input.Body instanceof Readable);
  const chunks = [];
  for await (const chunk of command.input.Body) {
    chunks.push(Buffer.from(chunk));
  }
  assert.equal(Buffer.concat(chunks).toString(), 'firstsecond');
});

test('S3 adapter propagates storage failures', async () => {
  const client = { send: async () => { throw new Error('storage unavailable'); } };
  const adapter = new S3MediaStorageAdapter(client, 'media');

  await assert.rejects(adapter.store({ key: 'content/content-1/video', body: Buffer.from('video') }), /storage unavailable/);
});
