import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { ResponseRefinementAnalysisE2eModule } = require('../../dist-e2e/test/e2e/support/response-refinement-analysis-e2e.module.js');
const { AnalyzeResponseRefinementPairs } = require('../../dist/application/social/analyze-response-refinement-pairs.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const comment = {
  platform: 'instagram',
  socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
  externalCommentId: 'private-comment-id',
  externalThreadId: 'private-thread-id',
  externalPublicationId: 'private-publication-id',
  authorDisplayName: 'Private author',
  text: 'What time do you close?',
  createdAt: null,
  canReply: true,
  canLike: false,
  appReplied: true,
  appLiked: false,
  lastSyncedAt: '2026-11-05T11:00:00.000Z',
  expiresAt: '2026-12-01T12:00:00.000Z',
  creatorReplies: [],
};
const analysis = {
  sentiment: 'NEUTRAL', emotion: 'CURIOSITY', intent: 'QUESTION', topic: 'GENERAL', entity: null,
  spamScore: 0, toxicityScore: 0, engagementValue: 0.5, confidence: 0.9,
  rationale: null, provider: 'JEV', model: 'test-model', schemaVersion: 'typesafe-systemone-v2',
};
const pair = {
  id: 'private-pair-id', tenantId, socialAccountId: comment.socialAccountId, platform: 'instagram',
  language: 'en-US', aiText: 'We close at 6.', finalText: 'We close at 6 PM Monday through Friday.',
  aiProvider: 'OPENAI', aiModel: 'gpt-6-luna', promptVersion: 'openai-response-v1',
  aiConfidence: 0.9, aiRationale: null, intendedTone: 'FRIENDLY', toneProfile: {},
  revisionCount: 1, lastEditReason: null, evaluation: null, analysisLabels: {},
  manualReplyAttemptId: 'private-attempt-id', recordedAt: '2026-11-04T12:00:00.000Z',
};
const evaluation = {
  relevance: 0.9, tone: 0.9, helpfulness: 0.9, factualRisk: 0.1, toxicityRisk: 0,
  hallucinationRisk: 0.1, publishRecommendation: 'APPROVE', confidence: 0.9,
  rationale: null, provider: 'JEV', model: 'test-model', schemaVersion: 'typesafe-systemone-v2',
};
const classification = {
  editCategory: 'CLARITY', observedAiIssue: 'INCOMPLETE_ANSWER', confidence: 0.9,
  evidenceSource: 'FINAL_RESPONSE', provider: 'JEV',
  model: 'test-model', schemaVersion: 'response-edit-classification-v1', usage: null,
};

async function withApp(analyze, run) {
  const app = await NestFactory.create(ResponseRefinementAnalysisE2eModule.register(analyze), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    await run(await app.getUrl());
  } finally {
    await app.close();
  }
}

function useCase(calls) {
  return new AnalyzeResponseRefinementPairs(
    { listCandidates: async (resolvedTenantId) => {
      calls.push(['query', resolvedTenantId]);
      return { items: [{ pair, context: { status: 'AVAILABLE', comment, analysis } }], nextCursor: null };
    } },
    { append: async (input) => {
      calls.push(['persist', input]);
      return { id: 'analysis-row-id' };
    } },
    { evaluate: async (input) => {
      calls.push(['evaluate', input.responseText]);
      return evaluation;
    } },
    { classify: async (input) => {
      calls.push(['classify', input.aiText, input.finalText]);
      return classification;
    } },
    { resolveTenantId: async () => tenantId },
    { generate: () => '70000000-0000-4000-8000-000000000001' },
    () => Date.parse('2026-11-05T12:00:00.000Z'),
  );
}

test('contextual analysis route requires confirmation and makes no query without it', async () => {
  const calls = [];
  await withApp(useCase(calls), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/response-refinement/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmExternalProcessing: false }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'RESPONSE_REFINEMENT_CONSENT_REQUIRED');
  });
  assert.equal(calls.length, 0);
});

test('contextual analysis route rejects caller-supplied text or unknown fields', async () => {
  const calls = [];
  await withApp(useCase(calls), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/response-refinement/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmExternalProcessing: true, commentText: 'arbitrary text' }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID');
  });
  assert.equal(calls.length, 0);
});

test('contextual analysis route returns structured results without raw text or source identifiers', async () => {
  const calls = [];
  await withApp(useCase(calls), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/response-refinement/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmExternalProcessing: true, limit: 10 }),
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.selectedCount, 1);
    assert.equal(result.items[0].status, 'SUCCEEDED');
    const serialized = JSON.stringify(result);
    for (const privateValue of [comment.text, pair.aiText, pair.finalText, pair.id, pair.manualReplyAttemptId, comment.externalCommentId]) {
      assert.equal(serialized.includes(privateValue), false);
    }
  });
  assert.equal(calls.find(([name]) => name === 'query')[1], tenantId);
  assert.equal(calls.filter(([name]) => name === 'evaluate').length, 2);
  assert.equal(calls.filter(([name]) => name === 'classify').length, 1);
});
