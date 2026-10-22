import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  GetAIProviderAccessStatus,
  UpdateAIProviderAccessSettings,
  AIProviderSettingsError,
} = require('../../dist/application/social/ai-provider-access-settings.js');

function createRepository(initial = {}, encryptionAvailable = true) {
  let current = { ...initial };
  return {
    repository: {
      get: async () => ({ ...current }),
      save: async (settings) => { current = { ...current, ...settings }; },
      encryptionAvailable: () => encryptionAvailable,
    },
    current: () => current,
  };
}

test('provider access status returns only provider configuration flags and non-secret policy', async () => {
  const { repository } = createRepository({
    jevApiKey: 'jev-secret',
    geminiApiKey: 'gemini-secret',
    geminiDataUsePolicy: 'free-tier-acknowledged',
    openaiApiKey: null,
  });
  const service = new GetAIProviderAccessStatus(repository);

  const status = await service.execute();

  assert.deepEqual(status, {
    storageReady: true,
    jev: { apiKeyConfigured: true },
    textGeneration: {
      google: { credentialsConfigured: true, dataUsePolicy: 'free-tier-acknowledged', dataUsePolicyConfigured: true },
      openai: { credentialsConfigured: false },
    },
  });
  assert.equal(JSON.stringify(status).includes('jev-secret'), false);
  assert.equal(JSON.stringify(status).includes('gemini-secret'), false);
});

test('provider access updates save supported values and never return submitted keys', async () => {
  const { repository, current } = createRepository();
  const update = new UpdateAIProviderAccessSettings(repository);

  const result = await update.execute({
    jevApiKey: 'jev-secret',
    geminiApiKey: 'gemini-secret',
    geminiDataUsePolicy: 'paid-tier',
  });

  assert.equal(result, undefined);
  assert.deepEqual(current(), {
    jevApiKey: 'jev-secret',
    geminiApiKey: 'gemini-secret',
    geminiDataUsePolicy: 'paid-tier',
  });
});

test('provider access updates reject removed JEV endpoint/auth fields and invalid data policies', async () => {
  const { repository, current } = createRepository();
  const update = new UpdateAIProviderAccessSettings(repository);
  const errorCode = 'AI_PROVIDER_SETTINGS_INVALID';

  for (const input of [
    { apiKey: 'secret' },
    { jevCommentEvaluationUrl: 'https://api.typesafe.ai/v1/systemone' },
    { jevResponseEvaluationUrl: 'https://api.typesafe.ai/v1/systemone' },
    { jevApiKeyHeader: 'x-api-key' },
    { jevApiKeyPrefix: '' },
    { geminiDataUsePolicy: 'unknown' },
    { openaiApiKey: 'secret\nInjected: true' },
    { openaiApiKey: 42 },
  ]) {
    await assert.rejects(update.execute(input), (error) => error instanceof AIProviderSettingsError && error.code === errorCode);
  }
  assert.deepEqual(current(), {});
});

test('provider access updates require encrypted-settings key availability', async () => {
  const { repository, current } = createRepository({}, false);
  const update = new UpdateAIProviderAccessSettings(repository);

  await assert.rejects(
    update.execute({ openaiApiKey: 'openai-secret' }),
    (error) => error instanceof AIProviderSettingsError && error.code === 'AI_PROVIDER_SETTINGS_ENCRYPTION_KEY_REQUIRED',
  );
  assert.deepEqual(current(), {});
});

test('blank secret fields preserve saved values and null explicitly clears the saved override', async () => {
  const { repository, current } = createRepository({ jevApiKey: 'existing-secret' });
  const update = new UpdateAIProviderAccessSettings(repository);

  await update.execute({ jevApiKey: '' });
  assert.equal(current().jevApiKey, 'existing-secret');
  await update.execute({ jevApiKey: null });
  assert.equal(current().jevApiKey, null);
});
