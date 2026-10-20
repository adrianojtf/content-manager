import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createResponseGenerationSettingsE2eModule } = require('../../dist-e2e/test/e2e/support/response-generation-settings-e2e.module.js');
const activeSettings = { provider: 'google', model: 'gemini-3.5-flash-lite', updatedAt: null, updatedByAdminUserId: null };
const modelOptions = [
  { provider: 'google', model: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' },
  { provider: 'openai', model: 'gpt-6-luna', displayName: 'GPT-6 Luna' },
];

async function withApp(useCases, run) {
  const app = await NestFactory.create(createResponseGenerationSettingsE2eModule(useCases), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await run(await app.getUrl());
  } finally {
    await app.close();
  }
}

test('response-generation settings endpoint exposes model choices without provider secrets', async () => {
  const calls = [];
  const useCases = {
    get: { execute: async () => { calls.push('get'); return { active: activeSettings, models: modelOptions }; } },
    update: { execute: async (input) => { calls.push(input); return { ...activeSettings, ...input, updatedAt: '2026-10-14T12:00:00.000Z' }; } },
  };

  await withApp(useCases, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ai/response-generation/settings`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.active, activeSettings);
    assert.deepEqual(body.models, modelOptions);
    assert.equal(JSON.stringify(body).includes('API_KEY'), false);
  });
  assert.deepEqual(calls, ['get']);
});

test('response-generation selector updates only provider and model; key/admin fields are rejected', async () => {
  const calls = [];
  const useCases = {
    get: { execute: async () => ({ active: activeSettings, models: modelOptions }) },
    update: { execute: async (input) => { calls.push(input); return { ...activeSettings, ...input }; } },
  };

  await withApp(useCases, async (baseUrl) => {
    const selected = await fetch(`${baseUrl}/ai/response-generation/settings`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'openai', model: 'gpt-6-luna' }),
    });
    assert.equal(selected.status, 200);
    assert.deepEqual(await selected.json(), { ...activeSettings, provider: 'openai', model: 'gpt-6-luna' });

    const secretAttempt = await fetch(`${baseUrl}/ai/response-generation/settings`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'must-not-accept' }),
    });
    assert.equal(secretAttempt.status, 400);
  });
  assert.deepEqual(calls, [{ provider: 'openai', model: 'gpt-6-luna' }]);
});
