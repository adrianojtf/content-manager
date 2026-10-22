import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AIProviderAccessSettingsE2eModule } = require('../../dist-e2e/test/e2e/support/ai-provider-access-settings-e2e.module.js');

test('provider access settings accept secrets as write-only values and never return them', async () => {
  AIProviderAccessSettingsE2eModule.reset();
  const app = await NestFactory.create(AIProviderAccessSettingsE2eModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await app.getUrl();
    const response = await fetch(`${baseUrl}/ai/provider-access`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jevApiKey: 'jev-secret',
        geminiApiKey: 'gemini-secret',
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.jev.apiKeyConfigured, true);
    assert.equal(payload.textGeneration.google.credentialsConfigured, true);
    assert.equal(JSON.stringify(payload).includes('jev-secret'), false);
    assert.equal(JSON.stringify(payload).includes('gemini-secret'), false);

    const reloaded = await fetch(`${baseUrl}/ai/provider-access`);
    assert.equal(reloaded.status, 200);
    assert.equal(JSON.stringify(await reloaded.json()).includes('secret'), false);
  } finally {
    await app.close();
  }
});
