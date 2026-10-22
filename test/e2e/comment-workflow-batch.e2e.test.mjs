import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createCommentWorkflowBatchE2eModule } = require('../../dist-e2e/test/e2e/support/comment-workflow-batch-e2e.module.js');
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';

async function withApp(options, run) {
  const app = await NestFactory.create(createCommentWorkflowBatchE2eModule(options), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await run(await app.getUrl());
  } finally {
    await app.close();
  }
}

test('comment workflow batch API returns independent per-comment outcomes and preserves batch correlation', async () => {
  const calls = [];
  const result = {
    batchOperationId: '60000000-0000-4000-8000-000000000001',
    operation: 'classify',
    scope: 'publication',
    status: 'PARTIAL',
    startedAt: '2026-10-14T12:00:00.000Z',
    completedAt: '2026-10-14T12:00:03.000Z',
    results: [
      { accountId, platform: 'youtube', publicationId: 'video-1', externalCommentId: 'comment-1', status: 'SUCCEEDED', artifactId: 'analysis-1' },
      { accountId, platform: 'youtube', publicationId: 'video-1', externalCommentId: 'comment-2', status: 'FAILED', errorCode: 'INTELLIGENCE_PROVIDER_RATE_LIMITED' },
    ],
  };
  await withApp({
    batch: { execute: async (input) => { calls.push(input); return result; } },
    events: { execute: async () => [] },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/workflow-batches`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'classify', scope: 'publication', accountId, publicationId: 'video-1' }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), result);
  });
  assert.deepEqual(calls, [{ operation: 'classify', scope: 'publication', accountId, publicationId: 'video-1', externalCommentId: undefined, platform: undefined }]);
});

test('comment workflow batch API accepts an explicitly selected network scope', async () => {
  const calls = [];
  const result = { batchOperationId: '60000000-0000-4000-8000-000000000003', operation: 'sync', scope: 'platform', status: 'SUCCEEDED', startedAt: '2026-10-14T12:00:00.000Z', completedAt: '2026-10-14T12:00:01.000Z', results: [] };
  await withApp({ batch: { execute: async (input) => { calls.push(input); return result; } }, events: { execute: async () => [] } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/workflow-batches`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'sync', scope: 'platform', platform: 'youtube' }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), result);
  });
  assert.deepEqual(calls, [{ operation: 'sync', scope: 'platform', accountId: undefined, publicationId: undefined, externalCommentId: undefined, platform: 'youtube' }]);
});

test('comment workflow batch API rejects client-selected tenants and send operations', async () => {
  const calls = [];
  await withApp({
    batch: { execute: async (input) => { calls.push(input); return {}; } },
    events: { execute: async () => [] },
  }, async (baseUrl) => {
    const tenantOverride = await fetch(`${baseUrl}/social/workflow-batches`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'classify', scope: 'all', tenantId: 'attacker-selected' }),
    });
    assert.equal(tenantOverride.status, 400);
    const send = await fetch(`${baseUrl}/social/workflow-batches`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'send', scope: 'all' }),
    });
    assert.equal(send.status, 400);
  });
  assert.deepEqual(calls, []);
});

test('comment workflow batch history reads the per-comment timeline by batch ID', async () => {
  const batchId = '60000000-0000-4000-8000-000000000001';
  const event = { id: 'event-1', batchOperationId: batchId, eventType: 'COMMENT_ANALYSIS_CREATED', actorSource: 'AI' };
  const calls = [];
  await withApp({
    batch: { execute: async () => ({}) },
    events: { execute: async (input) => { calls.push(input); return [event]; } },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/workflow-batches/${batchId}/events`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [event]);
  });
  assert.deepEqual(calls, [{ batchOperationId: batchId }]);
});
