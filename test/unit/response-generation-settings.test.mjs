import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  GetResponseGenerationSettings,
  UpdateResponseGenerationSettings,
  ConfiguredResponseSuggestionGenerator,
} = require('../../dist/application/social/response-generation-settings.js');
const { ResponseGenerationSettingsError } = require('../../dist/application/social/response-generation-settings-error.js');
const { IntelligenceProviderError } = require('../../dist/application/social/intelligence-provider-error.js');

function createSettings(initial = { provider: 'google', model: 'gemini-3.5-flash-lite', updatedAt: null, updatedByAdminUserId: null }) {
  let current = initial;
  const repository = {
    get: async () => current,
    save: async (provider, model) => {
      current = { provider, model, updatedAt: '2026-10-14T12:00:00.000Z', updatedByAdminUserId: null };
      return current;
    },
  };
  return { repository, current: () => current };
}

test('GetResponseGenerationSettings exposes active provider and supported model catalog without secrets', async () => {
  const { repository } = createSettings();
  const service = new GetResponseGenerationSettings(repository);

  const settings = await service.execute();

  assert.deepEqual(settings.active, { provider: 'google', model: 'gemini-3.5-flash-lite', updatedAt: null, updatedByAdminUserId: null });
  assert.deepEqual(settings.models, [
    { provider: 'google', model: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' },
    { provider: 'openai', model: 'gpt-6-luna', displayName: 'GPT-6 Luna' },
  ]);
  assert.equal(JSON.stringify(settings).includes('API_KEY'), false);
});

test('UpdateResponseGenerationSettings validates provider/model pairs and persists only non-secret selectors', async () => {
  const { repository, current } = createSettings();
  const update = new UpdateResponseGenerationSettings(repository);

  const selected = await update.execute({ provider: 'openai', model: 'gpt-6-luna' });

  assert.deepEqual(selected, { provider: 'openai', model: 'gpt-6-luna', updatedAt: '2026-10-14T12:00:00.000Z', updatedByAdminUserId: null });
  assert.deepEqual(current(), selected);
  await assert.rejects(update.execute({ provider: 'google', model: 'gpt-6-luna' }), (error) => error instanceof ResponseGenerationSettingsError && error.code === 'RESPONSE_GENERATION_SETTINGS_INVALID');
  await assert.rejects(update.execute({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'must-not-persist' }), (error) => error instanceof ResponseGenerationSettingsError && error.code === 'RESPONSE_GENERATION_SETTINGS_INVALID');
  assert.deepEqual(current(), selected);
});

test('ConfiguredResponseSuggestionGenerator routes to the selected provider/model and keeps provider secrets out of settings', async () => {
  const settings = createSettings({ provider: 'openai', model: 'gpt-6-luna', updatedAt: null, updatedByAdminUserId: null });
  const calls = [];
  const providers = {
    google: { generate: async (input) => { calls.push(['google', input]); return {}; } },
    openai: { generate: async (input) => { calls.push(['openai', input]); return { text: 'Suggestion' }; } },
  };
  const generator = new ConfiguredResponseSuggestionGenerator(settings.repository, providers);
  const input = { comment: { text: 'Question?' }, analysis: { sentiment: 'NEUTRAL' }, language: 'en' };

  const result = await generator.generate(input);

  assert.deepEqual(result, { text: 'Suggestion' });
  assert.deepEqual(calls, [['openai', { ...input, model: 'gpt-6-luna' }]]);
});

test('ConfiguredResponseSuggestionGenerator does not fall back to a different provider on failure', async () => {
  const settings = createSettings({ provider: 'google', model: 'gemini-3.5-flash-lite', updatedAt: null, updatedByAdminUserId: null });
  const calls = [];
  const providers = {
    google: { generate: async () => { calls.push('google'); throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RATE_LIMITED'); } },
    openai: { generate: async () => { calls.push('openai'); return {}; } },
  };
  const generator = new ConfiguredResponseSuggestionGenerator(settings.repository, providers);

  await assert.rejects(generator.generate({ comment: {}, analysis: {}, language: 'pt-BR' }), (error) => error.code === 'INTELLIGENCE_PROVIDER_RATE_LIMITED');
  assert.deepEqual(calls, ['google']);
});
