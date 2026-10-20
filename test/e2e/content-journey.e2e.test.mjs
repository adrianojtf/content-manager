import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createContentE2eModule } = require('../../dist-e2e/test/e2e/support/content-e2e.module.js');
const { createDeterministicBoundaryDoubles } = require('../../dist-e2e/test/e2e/support/controlled-doubles.js');

test('E2E harness exercises HTTP, application, storage, and persistence with controlled boundaries', async () => {
  const boundaries = createDeterministicBoundaryDoubles();
  boundaries.storage.resolveWith({ key: 'media/content-1/video' });
  const records = new Map();
  const repository = {
    save: async (tenantId, content) => records.set(`${tenantId}:${content.id}`, structuredClone(content)),
    findById: async (tenantId, id) => records.get(`${tenantId}:${id}`) ?? null,
  };
  const storage = { store: (input) => boundaries.storage.invoke(input) };
  const app = await NestFactory.create(createContentE2eModule(storage, repository), { logger: false });

  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/_test/content`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'content-1', title: 'Test video', mediaKey: 'media/content-1/video' }),
    });
    const content = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(content, {
      id: 'content-1',
      tenantId: '10000000-0000-4000-8000-000000000001',
      title: 'Test video',
      mediaReference: 'media/content-1/video',
    });
    assert.deepEqual(await repository.findById('10000000-0000-4000-8000-000000000001', 'content-1'), content);
    assert.equal(boundaries.storage.calls.length, 1);
    assert.deepEqual(boundaries.storage.calls[0][0], {
      key: 'media/content-1/video',
      body: Buffer.from('deterministic-media'),
      contentType: 'video/mp4',
    });

    boundaries.social.resolveWith({ publicationId: 'external-1' });
    boundaries.queue.resolveWith({ dispatched: true });
    boundaries.jev.resolveWith({ confidence: 0.9 });
    assert.deepEqual(await boundaries.social.invoke({ contentId: 'content-1' }), { publicationId: 'external-1' });
    assert.deepEqual(await boundaries.queue.invoke({ contentId: 'content-1' }), { dispatched: true });
    assert.deepEqual(await boundaries.jev.invoke({ contentId: 'content-1' }), { confidence: 0.9 });
    boundaries.social.rejectWith(new Error('deterministic provider failure'));
    await assert.rejects(boundaries.social.invoke({ contentId: 'content-1' }), /deterministic provider failure/);
  } finally {
    await app.close();
  }
});
