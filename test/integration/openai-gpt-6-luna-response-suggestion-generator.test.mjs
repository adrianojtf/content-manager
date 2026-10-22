import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { OpenAIGpt6LunaResponseSuggestionGenerator } = require('../../dist/infrastructure/intelligence/openai-gpt-6-luna-response-suggestion-generator.js');
const { IntelligenceProviderError } = require('../../dist/application/social/intelligence-provider-error.js');

const input = {
  comment: { platform: 'youtube', text: 'What is the song name?', externalPublicationId: 'video-1' },
  analysis: {
    sentiment: 'NEUTRAL',
    topic: 'CONTENT',
    spamScore: 0,
    toxicityScore: 0,
    engagementValue: 0.5,
    continuationRequestProbability: 0.4,
    confidence: 0.84,
    rationale: null,
    provider: 'JEV',
    model: 'jev-1.14.0',
    schemaVersion: 'typesafe-systemone-v1',
    signals: {
      sentiment: { confidence: 0.84, probabilities: { NEUTRAL: 0.84, POSITIVE: 0.12, NEGATIVE: 0.04 } },
      needsExternalFacts: { probability: 0.7 },
      requestsContinuation: { probability: 0.4 },
    },
    usage: { inputTokens: 100, outputTokens: 20 },
  },
  language: 'en',
  model: 'gpt-6-luna',
  toneProfile: { primaryTone: 'PROFESSIONAL', modifiers: ['CONCISE', 'WARM'], customNote: 'Avoid slang.' },
  verifiedReleaseSchedule: {
    status: 'ACTIVE',
    daysOfWeek: ['MONDAY', 'WEDNESDAY'],
    localTime: '20:30',
    timeZone: 'America/Sao_Paulo',
  },
};

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function responseWithOutput(output) {
  return jsonResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] });
}

function createGenerator(responses, environment = { OPENAI_API_KEY: 'openai-test-secret' }) {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url: new URL(url), init });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { generator: new OpenAIGpt6LunaResponseSuggestionGenerator(environment, fetcher), requests };
}

const output = { text: 'The song is "Episode Theme".', intendedTone: 'FRIENDLY', confidence: 0.84, rationale: 'Answers directly without adding unsupported details.' };

test('OpenAI GPT-6 Luna uses Responses API structured output and returns model provenance', async () => {
  const { generator, requests } = createGenerator([responseWithOutput(output)]);

  const result = await generator.generate(input);

  assert.deepEqual(result, { ...output, language: 'en', provider: 'OPENAI', model: 'gpt-6-luna' });
  assert.equal(requests[0].url.toString(), 'https://api.openai.com/v1/responses');
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'Bearer openai-test-secret');
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, 'gpt-6-luna');
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, 'none');
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.additionalProperties, false);
  const context = JSON.parse(body.input[1].content);
  assert.deepEqual(context.responseToneProfile, input.toneProfile);
  assert.deepEqual(context.verifiedReleaseSchedule, input.verifiedReleaseSchedule);
  assert.deepEqual(context.commentAnalysis.signals, input.analysis.signals);
  assert.equal(context.commentAnalysis.continuationRequestProbability, 0.4);
  assert.equal('usage' in context.commentAnalysis, false);
  assert.equal('provider' in context.commentAnalysis, false);
  assert.equal('model' in context.commentAnalysis, false);
  assert.match(body.input[0].content, /only when the comment concerns release timing/i);
  assert.match(body.input[0].content, /never infer a schedule from a continuation request/i);
  assert.equal(JSON.stringify(result).includes('openai-test-secret'), false);
});

test('OpenAI receives no inactive schedule day/time facts', async () => {
  const { generator, requests } = createGenerator([responseWithOutput(output)]);

  await generator.generate({ ...input, verifiedReleaseSchedule: { status: 'UNCONFIGURED' } });

  const body = JSON.parse(requests[0].init.body);
  const context = JSON.parse(body.input[1].content);
  assert.deepEqual(context.verifiedReleaseSchedule, { status: 'UNCONFIGURED' });
});

test('OpenAI generator uses encrypted runtime credentials instead of requiring an environment key', async () => {
  const settings = {
    get: async () => ({
      jevApiKey: null,
      geminiApiKey: null,
      geminiDataUsePolicy: null,
      openaiApiKey: 'saved-openai-secret',
    }),
  };
  const requests = [];
  const generator = new OpenAIGpt6LunaResponseSuggestionGenerator(
    {},
    async (url, init) => {
      requests.push({ url, init });
      return responseWithOutput(output);
    },
    settings,
  );

  await generator.generate(input);

  assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'Bearer saved-openai-secret');
});

test('OpenAI API key is lazy and a missing key causes no outbound request', async () => {
  const { generator, requests } = createGenerator([], {});

  await assert.rejects(generator.generate(input), (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_CONFIGURATION_REQUIRED');
  assert.deepEqual(requests, []);
});

test('OpenAI maps rate limits, service errors, refusal and malformed output to stable errors', async (t) => {
  const cases = [
    ['rate limited', jsonResponse({ error: { message: 'private' } }, 429), 'INTELLIGENCE_PROVIDER_RATE_LIMITED'],
    ['service unavailable', jsonResponse({ error: { message: 'private' } }, 503), 'INTELLIGENCE_PROVIDER_UNAVAILABLE'],
    ['refusal', jsonResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private refusal' }] }] }), 'INTELLIGENCE_PROVIDER_RESPONSE_BLOCKED'],
    ['malformed structured response', responseWithOutput({ ...output, confidence: 2 }), 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID'],
  ];
  for (const [name, response, code] of cases) {
    await t.test(name, async () => {
      const { generator } = createGenerator([response]);
      await assert.rejects(generator.generate(input), (error) => error instanceof IntelligenceProviderError && error.code === code && !error.message.includes('private'));
    });
  }
});
