import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createResponseToneSettingsE2eModule } = require('../../dist-e2e/test/e2e/support/response-tone-settings-e2e.module.js');
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400201';
const profile = { primaryTone: 'PROFESSIONAL', modifiers: ['CONCISE', 'WARM'], customNote: 'Avoid slang.' };

async function withApp(useCases, run) {
  const app = await NestFactory.create(createResponseToneSettingsE2eModule(useCases), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await run(await app.getUrl());
  } finally {
    await app.close();
  }
}

test('tone settings endpoint reads the profile for the selected social account', async () => {
  const calls = [];
  const view = { profile, updatedAt: '2026-10-14T12:00:00.000Z', customized: true };
  const useCases = {
    get: { execute: async (input) => { calls.push(['get', input]); return view; } },
    update: { execute: async () => view },
  };

  await withApp(useCases, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/response-tone`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), view);
  });
  assert.deepEqual(calls, [['get', { accountId }]]);
});

test('tone settings endpoint accepts only primary tone, modifiers, and custom note', async () => {
  const calls = [];
  const view = { profile, updatedAt: '2026-10-14T12:00:00.000Z', customized: true };
  const useCases = {
    get: { execute: async () => view },
    update: { execute: async (input) => { calls.push(input); return view; } },
  };

  await withApp(useCases, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/response-tone`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), view);

    const extra = await fetch(`${baseUrl}/social/accounts/${accountId}/response-tone`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...profile, provider: 'openai' }),
    });
    assert.equal(extra.status, 400);
  });
  assert.deepEqual(calls, [{ accountId, profile }]);
});
