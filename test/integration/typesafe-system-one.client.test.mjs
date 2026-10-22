import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { TypeSafeSystemOneClient } = require('../../dist/infrastructure/intelligence/typesafe-system-one.client.js');
const { IntelligenceProviderError } = require('../../dist/application/social/intelligence-provider-error.js');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createSettings(key) {
  return {
    get: async () => ({ jevApiKey: key }),
  };
}

const state = { comment: { text: 'Great episode!' } };
const questions = {
  sentiment: {
    type: 'choice',
    instructions: 'Classify the comment sentiment.',
    criteria: { POSITIVE: 'Positive', NEUTRAL: 'Neutral', NEGATIVE: 'Negative' },
  },
};
const validResponse = {
  model: 'jev-1.14.0',
  answers: {
    sentiment: {
      type: 'choice',
      choice: 'POSITIVE',
      confidence: 0.93,
      probabilities: { POSITIVE: 0.93, NEUTRAL: 0.05, NEGATIVE: 0.02 },
    },
  },
  usage: { input_tokens: 120, output_tokens: 24 },
};

test('TypeSafe client sends System One state/questions with Bearer auth and normalizes usage', async () => {
  const requests = [];
  const client = new TypeSafeSystemOneClient(
    { TYPESAFE_API_KEY: 'environment-key' },
    async (url, init) => {
      requests.push({ url, init });
      return jsonResponse(validResponse);
    },
    createSettings('saved-key'),
  );

  const result = await client.evaluate({ state, questions });

  assert.equal(requests[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'Bearer saved-key');
  assert.equal(new Headers(requests[0].init.headers).get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(requests[0].init.body), { model: 'jev-latest', state, questions });
  assert.deepEqual(result, {
    model: 'jev-1.14.0',
    answers: validResponse.answers,
    usage: { inputTokens: 120, outputTokens: 24 },
  });
  assert.equal(requests[0].init.body.includes('saved-key'), false);
});

test('TypeSafe client falls back to TYPESAFE_API_KEY then the legacy JEV_API_KEY', async (t) => {
  for (const [label, environment, expectedKey] of [
    ['TypeSafe environment key', { TYPESAFE_API_KEY: 'typesafe-key' }, 'typesafe-key'],
    ['legacy JEV environment key', { JEV_API_KEY: 'legacy-key' }, 'legacy-key'],
  ]) {
    await t.test(label, async () => {
      const requests = [];
      const client = new TypeSafeSystemOneClient(environment, async (url, init) => {
        requests.push({ url, init });
        return jsonResponse(validResponse);
      });

      await client.evaluate({ state, questions });

      assert.equal(new Headers(requests[0].init.headers).get('authorization'), `Bearer ${expectedKey}`);
    });
  }
});

test('TypeSafe client fails before network access when no API key is configured', async () => {
  let called = false;
  const client = new TypeSafeSystemOneClient({}, async () => {
    called = true;
    return jsonResponse(validResponse);
  });

  await assert.rejects(
    client.evaluate({ state, questions }),
    (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_CONFIGURATION_REQUIRED',
  );
  assert.equal(called, false);
});

test('TypeSafe client maps authentication, rate-limit, overload, and request errors', async (t) => {
  for (const [status, code] of [
    [401, 'INTELLIGENCE_PROVIDER_AUTHORIZATION_FAILED'],
    [429, 'INTELLIGENCE_PROVIDER_RATE_LIMITED'],
    [529, 'INTELLIGENCE_PROVIDER_UNAVAILABLE'],
    [422, 'INTELLIGENCE_PROVIDER_REQUEST_FAILED'],
  ]) {
    await t.test(`${status} maps to ${code}`, async () => {
      const client = new TypeSafeSystemOneClient(
        { TYPESAFE_API_KEY: 'test-key' },
        async () => jsonResponse({ detail: 'private provider message' }, status),
      );

      await assert.rejects(
        client.evaluate({ state, questions }),
        (error) => error instanceof IntelligenceProviderError
          && error.code === code
          && !error.message.includes('private provider message'),
      );
    });
  }
});

test('TypeSafe client rejects invalid JSON and malformed response envelopes', async (t) => {
  const invalidResponses = [
    { ok: true, status: 200, json: async () => { throw new Error('raw provider detail'); } },
    jsonResponse({ model: 'jev-1.14.0', answers: [] }),
    jsonResponse({ model: '', answers: {} }),
    jsonResponse({ model: 'jev-1.14.0', answers: {}, usage: { input_tokens: -1, output_tokens: 2 } }),
  ];

  for (const [index, response] of invalidResponses.entries()) {
    await t.test(`invalid response ${index + 1}`, async () => {
      const client = new TypeSafeSystemOneClient(
        { TYPESAFE_API_KEY: 'test-key' },
        async () => response,
      );
      await assert.rejects(
        client.evaluate({ state, questions }),
        (error) => error instanceof IntelligenceProviderError
          && error.code === 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID',
      );
    });
  }
});
