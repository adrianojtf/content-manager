import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createCommentIntelligenceE2eModule } = require('../../dist-e2e/test/e2e/support/comment-intelligence-e2e.module.js');
const { IntelligenceProviderError } = require('../../dist/application/social/intelligence-provider-error.js');
const { EvaluateComment, GenerateCommentResponseSuggestion } = require('../../dist/application/social/comment-intelligence.usecases.js');
const { RecordCommentAnalysis, RecordResponseSuggestion } = require('../../dist/application/social/comment-workflow-audit.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const externalCommentId = 'comment-1';
const tenantId = '30000000-0000-4000-8000-000000000001';

async function withApp(options, run) {
  const app = await NestFactory.create(createCommentIntelligenceE2eModule(options), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await run(await app.getUrl());
  } finally {
    await app.close();
  }
}

test('comment classification HTTP route invokes one comment evaluation and returns its immutable JEV artifact', async () => {
  const calls = [];
  const result = { id: 'analysis-event-1', eventType: 'COMMENT_ANALYSIS_CREATED', actorSource: 'AI' };
  const options = {
    evaluate: { execute: async (input) => { calls.push(input); return result; } },
    generate: { execute: async () => ({}) },
  };

  await withApp(options, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${externalCommentId}/classification`, { method: 'POST' });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), result);
  });
  assert.deepEqual(calls, [{ accountId, externalCommentId, batchOperationId: undefined }]);
});

test('response generation HTTP route returns all language variants and ignores client-supplied actor metadata', async () => {
  const calls = [];
  const result = {
    variants: ['pt-BR', 'en-US', 'es-ES'].map((language) => ({ id: `suggestion-${language}`, payload: { language } })),
    failures: [],
  };
  const toneOverride = 'CASUAL';
  const options = {
    evaluate: { execute: async () => ({}) },
    generate: { execute: async (input) => { calls.push(input); return result; } },
  };

  await withApp(options, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${externalCommentId}/responses/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analysisEventId: 'analysis-1', toneOverride, actorSource: 'CREATOR_LOCAL' }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), result);
  });
  assert.deepEqual(calls, [{ accountId, externalCommentId, analysisEventId: 'analysis-1', toneOverride, batchOperationId: undefined }]);
});

test('response generation HTTP route does not accept a caller-selected single language', async () => {
  const options = {
    evaluate: { execute: async () => ({}) },
    generate: { execute: async () => ({ variants: [], failures: [] }) },
  };

  await withApp(options, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${externalCommentId}/responses/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'pt-BR' }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { code: 'RESPONSE_SUGGESTION_INVALID' });
  });
});

test('response generation HTTP route rejects invalid one-time tone overrides', async () => {
  const calls = [];
  const options = {
    evaluate: { execute: async () => ({}) },
    generate: { execute: async (input) => { calls.push(input); return { variants: [], failures: [] }; } },
  };

  await withApp(options, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${externalCommentId}/responses/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toneOverride: 'LOUD' }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { code: 'RESPONSE_SUGGESTION_INVALID' });
  });
  assert.deepEqual(calls, []);
});

test('explicit high-risk suggestion journey preserves JEV advice and never auto-generates after classification', async () => {
  const createdAt = '2026-10-14T12:00:00.000Z';
  const socialAccountId = parseSocialAccountId(accountId);
  const account = SocialAccount.create({
    id: socialAccountId,
    tenantId,
    platform: 'youtube',
    externalAccountId: 'UC-test',
    displayName: 'Test creator',
    credentialReference: 'opaque-test-reference',
  });
  const comment = {
    platform: 'youtube',
    socialAccountId,
    externalCommentId,
    externalThreadId: 'thread-1',
    externalPublicationId: 'video-1',
    authorDisplayName: 'Viewer',
    text: 'Uma reclamação com linguagem hostil.',
    createdAt,
    canReply: true,
    lastSyncedAt: createdAt,
    expiresAt: '2026-11-13T12:00:00.000Z',
  };
  const highRiskAnalysis = {
    sentiment: 'NEGATIVE',
    emotion: 'ANGER',
    intent: 'COMPLAINT',
    topic: 'SERVICE',
    entity: null,
    spamScore: 0.9,
    toxicityScore: 0.95,
    engagementValue: 0.1,
    confidence: 0.91,
    rationale: 'Hostile complaint; review before responding.',
    provider: 'JEV',
    model: 'deterministic-test',
    schemaVersion: '1',
  };
  const events = [];
  const workflowEvents = {
    listByComment: async () => [...events],
    append: async (input) => {
      const event = { ...input, id: `event-${events.length + 1}`, expiresAt: comment.expiresAt };
      events.push(event);
      return event;
    },
  };
  const tenant = { resolveTenantId: async () => tenantId };
  const accounts = { findById: async (scope, id) => scope === tenantId && id === socialAccountId ? account : null };
  const comments = { findByExternalCommentId: async (scope, id, externalId) => scope === tenantId && id === socialAccountId && externalId === externalCommentId ? comment : null };
  const now = () => Date.parse(createdAt);
  const verifiedSchedule = {
    enabled: true,
    daysOfWeek: ['MONDAY', 'WEDNESDAY'],
    localTime: '20:30',
    timeZone: 'America/Sao_Paulo',
    version: 3,
    updatedAt: '2026-10-15T12:00:00.000Z',
    confirmedAt: '2026-10-15T12:00:00.000Z',
  };
  const recordAnalysis = new RecordCommentAnalysis(workflowEvents, tenant, now);
  const recordSuggestion = new RecordResponseSuggestion(workflowEvents, tenant, now);
  const generatorCalls = [];
  const evaluate = new EvaluateComment(accounts, comments, {
    evaluate: async () => highRiskAnalysis,
  }, recordAnalysis, workflowEvents, tenant, now);
  const generate = new GenerateCommentResponseSuggestion(accounts, comments, {
    generate: async (input) => {
      generatorCalls.push(input);
      return { text: `Reply ${input.language}`, language: input.language, intendedTone: 'EMPATHETIC', provider: 'TEST', model: 'deterministic', confidence: 0.8, rationale: 'Acknowledges the complaint.' };
    },
  }, recordSuggestion, workflowEvents, tenant, { get: async () => null }, { get: async () => null }, {
    get: async (scope, id) => {
      assert.equal(scope, tenantId);
      assert.equal(id, socialAccountId);
      return verifiedSchedule;
    },
  }, { get: async () => null }, now);

  await withApp({ evaluate, generate }, async (baseUrl) => {
    const classification = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${externalCommentId}/classification`, { method: 'POST' });
    assert.equal(classification.status, 201);
    const analysisEvent = await classification.json();
    assert.deepEqual(analysisEvent.payload, highRiskAnalysis);
    assert.equal(generatorCalls.length, 0);

    const suggestionResponse = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${externalCommentId}/responses/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analysisEventId: analysisEvent.id }),
    });
    assert.equal(suggestionResponse.status, 201);
    const suggestionEvent = await suggestionResponse.json();
    assert.deepEqual(suggestionEvent.variants.map((event) => event.payload.language), ['pt-BR', 'en-US', 'es-ES']);
    assert.equal(generatorCalls.length, 3);
    assert.ok(generatorCalls.every((call) => JSON.stringify(call.analysis) === JSON.stringify(highRiskAnalysis)));
    assert.ok(generatorCalls.every((call) => JSON.stringify(call.verifiedReleaseSchedule) === JSON.stringify({
      status: 'ACTIVE',
      daysOfWeek: verifiedSchedule.daysOfWeek,
      localTime: verifiedSchedule.localTime,
      timeZone: verifiedSchedule.timeZone,
    })));
    assert.ok(suggestionEvent.variants.every((event) => (
      event.payload.verifiedReleaseScheduleSnapshot.status === 'ACTIVE'
      && event.payload.verifiedReleaseScheduleSnapshot.schedule.version === 3
    )));
  });
});

test('comment intelligence HTTP routes map provider errors without exposing provider payloads', async () => {
  const options = {
    evaluate: { execute: async () => { throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RATE_LIMITED'); } },
    generate: { execute: async () => ({}) },
  };

  await withApp(options, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${externalCommentId}/classification`, { method: 'POST' });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { code: 'INTELLIGENCE_PROVIDER_RATE_LIMITED' });
  });
});
