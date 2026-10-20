import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { JevCommentEvaluator } = require('../../dist/infrastructure/intelligence/jev-comment-evaluator.js');
const { JevResponseEvaluator } = require('../../dist/infrastructure/intelligence/jev-response-evaluator.js');
const { IntelligenceProviderError } = require('../../dist/application/social/intelligence-provider-error.js');

const comment = {
  platform: 'youtube',
  socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
  externalCommentId: 'comment-123',
  externalThreadId: 'thread-123',
  externalPublicationId: 'video-123',
  authorDisplayName: 'Viewer name',
  text: 'Great episode!',
  createdAt: '2026-10-13T12:00:00.000Z',
  canReply: true,
  lastSyncedAt: '2026-10-13T12:00:00.000Z',
  expiresAt: '2026-11-12T12:00:00.000Z',
};

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createEvaluator(responses, environment = { JEV_COMMENT_EVALUATION_URL: 'https://jev.invalid/v1/evaluate-comment', JEV_API_KEY: 'jev-test-secret' }) {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url: new URL(url), init });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { evaluator: new JevCommentEvaluator(environment, fetcher), requests };
}

const validOutput = {
  sentiment: 'POSITIVE',
  emotion: 'JOY',
  intent: 'REACTION',
  topic: 'CHARACTER',
  entity: 'JOAO',
  spamScore: 0.01,
  toxicityScore: 0.02,
  engagementValue: 0.82,
  confidence: 0.94,
  rationale: 'Positive reaction.',
};
const commentAnalysis = { ...validOutput, provider: 'JEV', model: 'test-model', schemaVersion: '1' };

test('JEV comment evaluator posts a minimal normalized request and returns a validated analysis', async () => {
  const { evaluator, requests } = createEvaluator([jsonResponse(validOutput)]);

  const result = await evaluator.evaluate({ comment });

  assert.deepEqual(result, { ...validOutput, provider: 'JEV', model: 'provider-managed', schemaVersion: '1' });
  assert.equal(requests[0].url.toString(), 'https://jev.invalid/v1/evaluate-comment');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'Bearer jev-test-secret');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    comment: { text: 'Great episode!' },
    publication: { platform: 'youtube', externalPublicationId: 'video-123' },
  });
  assert.equal(requests[0].init.body.includes('Viewer name'), false);
  assert.equal(JSON.stringify(result).includes('jev-test-secret'), false);
});

test('JEV configuration is lazy and rejects non-HTTPS remote endpoints before sending a request', async () => {
  const missing = createEvaluator([], {});
  await assert.rejects(missing.evaluator.evaluate({ comment }), (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_CONFIGURATION_REQUIRED');
  assert.deepEqual(missing.requests, []);

  const insecure = createEvaluator([], { JEV_COMMENT_EVALUATION_URL: 'http://jev.example/evaluate' });
  await assert.rejects(insecure.evaluator.evaluate({ comment }), (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_CONFIGURATION_INVALID');
  assert.deepEqual(insecure.requests, []);
});

test('JEV comment evaluator maps auth, rate-limit and server failures to stable errors without provider bodies', async (t) => {
  for (const [status, code] of [[401, 'INTELLIGENCE_PROVIDER_AUTHORIZATION_FAILED'], [429, 'INTELLIGENCE_PROVIDER_RATE_LIMITED'], [503, 'INTELLIGENCE_PROVIDER_UNAVAILABLE']]) {
    await t.test(`${status} maps to ${code}`, async () => {
      const { evaluator } = createEvaluator([jsonResponse({ secret: 'provider-private-detail' }, status)]);
      await assert.rejects(evaluator.evaluate({ comment }), (error) => error instanceof IntelligenceProviderError && error.code === code && !error.message.includes('provider-private-detail'));
    });
  }
});

test('JEV response evaluator uses an isolated contract and validates structured risk output', async () => {
  const requests = [];
  const payload = { relevance: 0.97, tone: 0.94, helpfulness: 0.81, factualRisk: 0.1, toxicityRisk: 0, hallucinationRisk: 0.05, publishRecommendation: 'APPROVE', confidence: 0.91, rationale: 'Direct and relevant.' };
  const evaluator = new JevResponseEvaluator({ JEV_RESPONSE_EVALUATION_URL: 'https://jev.invalid/v1/evaluate-response', JEV_API_KEY: 'jev-test-secret' }, async (url, init) => {
    requests.push({ url, init });
    return jsonResponse(payload);
  });

  const result = await evaluator.evaluate({ comment, analysis: commentAnalysis, responseText: 'Thank you for watching.' });

  assert.deepEqual(result, { ...payload, provider: 'JEV', model: 'provider-managed', schemaVersion: '1' });
  assert.equal(requests[0].url, 'https://jev.invalid/v1/evaluate-response');
  assert.deepEqual(JSON.parse(requests[0].init.body), { comment: { text: 'Great episode!' }, commentAnalysis, response: { text: 'Thank you for watching.' } });
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'Bearer jev-test-secret');
  assert.equal(JSON.stringify(result).includes('jev-test-secret'), false);

  const invalid = new JevResponseEvaluator({ JEV_RESPONSE_EVALUATION_URL: 'https://jev.invalid/evaluate' }, async () => jsonResponse({ ...payload, toxicityRisk: 2 }));
  await assert.rejects(invalid.evaluate({ comment, analysis: commentAnalysis, responseText: 'Reply' }), (error) => error.code === 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
});

test('JEV comment evaluator rejects malformed score ranges and provider response bodies', async () => {
  const { evaluator: invalidScore } = createEvaluator([jsonResponse({ ...validOutput, spamScore: 1.1 })]);
  await assert.rejects(invalidScore.evaluate({ comment }), (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID');

  const { evaluator: malformed } = createEvaluator([{ ok: true, status: 200, json: async () => { throw new Error('raw parse detail'); } }]);
  await assert.rejects(malformed.evaluate({ comment }), (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID' && !error.message.includes('raw parse detail'));
});
