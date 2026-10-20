import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { GeminiFlashLiteResponseSuggestionGenerator } = require('../../dist/infrastructure/intelligence/gemini-flash-lite-response-suggestion-generator.js');
const { IntelligenceProviderError } = require('../../dist/application/social/intelligence-provider-error.js');

const input = {
  comment: {
    platform: 'youtube',
    socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
    externalCommentId: 'comment-123',
    externalThreadId: 'thread-123',
    externalPublicationId: 'video-123',
    authorDisplayName: 'Viewer name',
    text: 'Qual é o nome da música?',
    createdAt: '2026-10-13T12:00:00.000Z',
    canReply: true,
    lastSyncedAt: '2026-10-13T12:00:00.000Z',
    expiresAt: '2026-11-12T12:00:00.000Z',
  },
  analysis: {
    sentiment: 'NEUTRAL', emotion: 'CURIOSITY', intent: 'QUESTION', topic: 'MUSIC', entity: null,
    spamScore: 0, toxicityScore: 0, engagementValue: 0.5, confidence: 0.92,
    rationale: 'The viewer asks a direct question.', provider: 'JEV', model: 'jev-model', schemaVersion: '1',
  },
  language: 'pt-BR',
  toneProfile: { primaryTone: 'EMPATHETIC', modifiers: ['CONCISE'], customNote: 'Use gentle wording.' },
};

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createGenerator(responses, environment = {
  GEMINI_API_KEY: 'gemini-test-secret',
  GEMINI_DATA_USE_POLICY: 'free-tier-acknowledged',
}) {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url: new URL(url), init });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { generator: new GeminiFlashLiteResponseSuggestionGenerator(environment, fetcher), requests };
}

const generated = {
  text: 'A música é "Tema do Episódio". Obrigado por perguntar!',
  intendedTone: 'FRIENDLY',
  confidence: 0.83,
  rationale: 'Responde diretamente à pergunta sem acrescentar contexto não confirmado.',
};

function modelResponse(value, finishReason = 'STOP') {
  return jsonResponse({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }] });
}

test('Gemini Flash-Lite sends one bounded structured request and returns provider provenance', async () => {
  const { generator, requests } = createGenerator([modelResponse(generated)]);

  const result = await generator.generate(input);

  assert.deepEqual(result, { ...generated, language: 'pt-BR', provider: 'GEMINI', model: 'gemini-3.5-flash-lite' });
  assert.equal(requests[0].url.toString(), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(requests[0].init.headers['x-goog-api-key'], 'gemini-test-secret');
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.maxOutputTokens, 256);
  assert.ok(body.generationConfig.responseSchema.properties.text);
  const context = JSON.parse(body.contents[0].parts[0].text);
  assert.equal(context.commentText, 'Qual é o nome da música?');
  assert.deepEqual(context.responseToneProfile, input.toneProfile);
  assert.equal(body.contents[0].parts[0].text.includes('Viewer name'), false);
  assert.equal(requests[0].url.searchParams.has('key'), false);
  assert.equal(JSON.stringify(result).includes('gemini-test-secret'), false);
});

test('Gemini credentials, model and free-tier data-use acknowledgement remain lazy', async () => {
  const missingKey = createGenerator([], { GEMINI_DATA_USE_POLICY: 'free-tier-acknowledged' });
  await assert.rejects(missingKey.generator.generate(input), (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_CONFIGURATION_REQUIRED');
  assert.deepEqual(missingKey.requests, []);

  const noDataPolicy = createGenerator([], { GEMINI_API_KEY: 'gemini-test-secret' });
  await assert.rejects(noDataPolicy.generator.generate(input), (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_DATA_POLICY_REQUIRED');
  assert.deepEqual(noDataPolicy.requests, []);
});

test('Gemini maps rate limits, provider errors, safety blocks and malformed structured output', async (t) => {
  const cases = [
    ['rate limited', jsonResponse({ error: { message: 'private body' } }, 429), 'INTELLIGENCE_PROVIDER_RATE_LIMITED'],
    ['provider unavailable', jsonResponse({ error: { message: 'private body' } }, 503), 'INTELLIGENCE_PROVIDER_UNAVAILABLE'],
    ['invalid response', modelResponse({ ...generated, confidence: 2 }), 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID'],
    ['safety blocked', modelResponse(generated, 'SAFETY'), 'INTELLIGENCE_PROVIDER_RESPONSE_BLOCKED'],
    ['malformed JSON', jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{bad json' }] } }] }), 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID'],
  ];
  for (const [name, response, code] of cases) {
    await t.test(name, async () => {
      const { generator } = createGenerator([response]);
      await assert.rejects(generator.generate(input), (error) => error instanceof IntelligenceProviderError && error.code === code && !error.message.includes('private body'));
    });
  }
});
