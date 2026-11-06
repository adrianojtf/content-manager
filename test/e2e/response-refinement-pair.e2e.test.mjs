import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createCommentWorkflowAuditE2eModule } = require('../../dist-e2e/test/e2e/support/comment-workflow-audit-e2e.module.js');
const { ReviseResponseSuggestion, ListCommentWorkflow } = require('../../dist/application/social/comment-workflow-audit.js');
const { SendManualCommentReply } = require('../../dist/application/social/send-manual-comment-reply.js');
const { RecordResponseRefinementPair } = require('../../dist/application/social/record-response-refinement-pair.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const commentId = 'comment-1';
const createdAt = '2026-10-14T12:00:00.000Z';

async function withApp(options, run) {
  const app = await NestFactory.create(createCommentWorkflowAuditE2eModule(options), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await run(await app.getUrl());
  } finally {
    await app.close();
  }
}

function setup({ seedEvents = [], attemptId }) {
  const account = SocialAccount.create({ id: accountId, tenantId, platform: 'youtube', externalAccountId: 'UC-test', displayName: 'Test creator', credentialReference: 'test-reference' });
  const comment = {
    platform: 'youtube', socialAccountId: accountId, externalCommentId: commentId, externalThreadId: 'thread-1',
    externalPublicationId: 'video-1', authorDisplayName: 'Viewer', text: 'Qual é o nome da música?',
    createdAt, canReply: true, lastSyncedAt: createdAt, expiresAt: '2026-11-13T12:00:00.000Z',
  };
  const events = [...seedEvents];
  const eventRepository = {
    append: async (input) => {
      const event = { ...input, id: `workflow-${events.length + 1}`, expiresAt: comment.expiresAt };
      events.push(event);
      return event;
    },
    listByComment: async () => [...events],
  };
  const tenant = { resolveTenantId: async () => tenantId };
  const accounts = { findById: async () => account };
  const comments = { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} };
  const pairs = {
    appended: [],
    append: async (input) => {
      pairs.appended.push(input);
      return { ...input, id: `pair-${pairs.appended.length}` };
    },
  };
  const now = () => Date.parse(createdAt);
  const refinement = new RecordResponseRefinementPair(pairs);
  const revisions = new ReviseResponseSuggestion(eventRepository, tenant, now);
  const sendReply = new SendManualCommentReply(accounts, comments, {
    reply: async () => ({ platform: 'youtube', externalReplyId: 'external-reply-1' }),
  }, eventRepository, tenant, { generate: () => attemptId }, refinement, now);
  const history = new ListCommentWorkflow(eventRepository, accounts, tenant, now);
  return { events, pairs, revisions, sendReply, history };
}

const analysis = { sentiment: 'NEUTRAL', emotion: 'CURIOSITY', intent: 'QUESTION', topic: 'MUSIC', entity: null, spamScore: 0, toxicityScore: 0, engagementValue: 0.5, confidence: 0.92, provider: 'JEV', model: 'deterministic-test', schemaVersion: '1' };
const suggestionPayload = {
  language: 'pt-BR', text: 'A música é X.', provider: 'GEMINI', model: 'gemini-3.5-flash-lite',
  confidence: 0.8, rationale: 'Resposta direta.', intendedTone: 'FRIENDLY',
  toneProfile: { primaryTone: 'FRIENDLY', modifiers: [], customNote: null }, toneProfileSource: 'TENANT',
};

function seed({ editedText } = {}) {
  const expiresAt = '2026-11-13T12:00:00.000Z';
  const events = [
    { id: 'analysis-1', tenantId, socialAccountId: accountId, externalCommentId: commentId, eventType: 'COMMENT_ANALYSIS_CREATED', actorSource: 'AI', status: 'SUCCEEDED', operationId: null, batchOperationId: null, parentEventId: null, payload: analysis, recordedAt: createdAt, expiresAt },
    { id: 'suggestion-1', tenantId, socialAccountId: accountId, externalCommentId: commentId, eventType: 'RESPONSE_SUGGESTION_GENERATED', actorSource: 'GENERATOR', status: 'SUCCEEDED', operationId: null, batchOperationId: null, parentEventId: 'analysis-1', payload: suggestionPayload, recordedAt: createdAt, expiresAt },
  ];
  return events;
}

test('edit then save then send an AI suggestion records exactly one de-identified refinement pair', async () => {
  const { pairs, revisions, sendReply, history } = setup({ seedEvents: seed(), attemptId: '60000000-0000-4000-8000-000000000011' });

  await withApp({ corrections: { execute: async () => ({}) }, revisions, sendReply, history }, async (baseUrl) => {
    const edit = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/suggestions/suggestion-1/revisions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'A trilha sonora é X.', reason: 'Precisão' }),
    });
    assert.equal(edit.status, 201);
    const revision = await edit.json();

    const send = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/revisions/${revision.id}/send`, { method: 'POST' });
    assert.equal(send.status, 201);
    const result = await send.json();
    assert.equal(result.eventType, 'MANUAL_REPLY_RESULT');
    assert.equal(result.payload.refinementPairPersisted, true);

    const repeatedSend = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/revisions/${revision.id}/send`, { method: 'POST' });
    assert.equal(repeatedSend.status, 409);
  });

  assert.equal(pairs.appended.length, 1);
  const pair = pairs.appended[0];
  assert.equal(pair.aiText, 'A música é X.');
  assert.equal(pair.finalText, 'A trilha sonora é X.');
  assert.equal(pair.language, 'pt-BR');
  assert.equal(pair.platform, 'youtube');
  assert.equal(pair.revisionCount, 1);
  assert.equal(pair.lastEditReason, 'Precisão');
  assert.equal(pair.manualReplyAttemptId, '60000000-0000-4000-8000-000000000011');
  assert.deepEqual(pair.analysisLabels, { sentiment: 'NEUTRAL', emotion: 'CURIOSITY', intent: 'QUESTION', topic: 'MUSIC', entity: null });
  assert.deepEqual(pair.toneProfile, { toneProfile: suggestionPayload.toneProfile, toneProfileSource: 'TENANT' });
});

test('send of an unedited AI suggestion records no refinement pair', async () => {
  const { pairs, sendReply, history, revisions } = setup({ seedEvents: seed(), attemptId: '60000000-0000-4000-8000-000000000012' });

  await withApp({ corrections: { execute: async () => ({}) }, revisions, sendReply, history }, async (baseUrl) => {
    const send = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/revisions/suggestion-1/send`, { method: 'POST' });
    assert.equal(send.status, 201);
    const result = await send.json();
    assert.equal(result.payload.refinementPairPersisted, false);
  });

  assert.equal(pairs.appended.length, 0);
});
