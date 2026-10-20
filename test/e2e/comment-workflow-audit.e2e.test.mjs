import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createCommentWorkflowAuditE2eModule } = require('../../dist-e2e/test/e2e/support/comment-workflow-audit-e2e.module.js');
const { ReviseResponseSuggestion, RecordResponseEvaluation, RecordManualResponse, ReviseManualResponse, ListCommentWorkflow } = require('../../dist/application/social/comment-workflow-audit.js');
const { EvaluateResponseSuggestion } = require('../../dist/application/social/comment-intelligence.usecases.js');
const { SendManualCommentReply } = require('../../dist/application/social/send-manual-comment-reply.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const commentId = 'comment-1';

async function withApp(options, run) {
  const app = await NestFactory.create(createCommentWorkflowAuditE2eModule(options), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await run(await app.getUrl());
  } finally {
    await app.close();
  }
}

test('comment workflow HTTP history returns ordered AI and human audit events', async () => {
  const events = [{ id: 'ai-1', eventType: 'COMMENT_ANALYSIS_CREATED', actorSource: 'AI' }, { id: 'human-1', eventType: 'COMMENT_ANALYSIS_CORRECTED', actorSource: 'CREATOR_LOCAL', parentEventId: 'ai-1' }];
  const calls = [];
  const options = {
    corrections: { execute: async () => ({}) },
    revisions: { execute: async () => ({}) },
    history: { execute: async (input) => { calls.push(input); return events; } },
  };

  await withApp(options, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/workflow`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), events);
  });
  assert.deepEqual(calls, [{ accountId, externalCommentId: commentId }]);
});

test('comment workflow HTTP correction route accepts only corrected fields/reason and does not accept actor or confidence overrides', async () => {
  const calls = [];
  const options = {
    corrections: { execute: async (input) => { calls.push(input); return { id: 'correction-1', actorSource: 'CREATOR_LOCAL' }; } },
    revisions: { execute: async () => ({}) },
    history: { execute: async () => [] },
  };

  await withApp(options, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/analysis/analysis-1/corrections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ correctedFields: { spamScore: 0.7 }, reason: 'Manual review', actorSource: 'AI', confidence: 0.99 }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 'correction-1', actorSource: 'CREATOR_LOCAL' });
  });

  assert.deepEqual(calls, [{ accountId, externalCommentId: commentId, analysisEventId: 'analysis-1', correctedFields: { spamScore: 0.7 }, reason: 'Manual review' }]);
});

test('comment workflow HTTP edit route records the exact revision without a send action', async () => {
  const calls = [];
  const options = {
    corrections: { execute: async () => ({}) },
    revisions: { execute: async (input) => { calls.push(input); return { id: 'revision-1', actorSource: 'CREATOR_LOCAL', payload: { text: input.text } }; } },
    history: { execute: async () => [] },
  };

  await withApp(options, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/suggestions/suggestion-1/revisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Creator version', reason: 'Tone edit', actorSource: 'AI' }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 'revision-1', actorSource: 'CREATOR_LOCAL', payload: { text: 'Creator version' } });
  });
  assert.deepEqual(calls, [{ accountId, externalCommentId: commentId, suggestionEventId: 'suggestion-1', previousRevisionId: undefined, text: 'Creator version', reason: 'Tone edit' }]);
});

test('comment workflow HTTP evaluates and manually sends only the selected saved revision', async () => {
  const calls = [];
  const options = {
    corrections: { execute: async () => ({}) },
    revisions: { execute: async () => ({}) },
    evaluateResponse: { execute: async (input) => { calls.push(['evaluate', input]); return { id: 'evaluation-1', parentEventId: input.revisionEventId }; } },
    sendReply: { execute: async (input) => { calls.push(['send', input]); return { id: 'result-1', status: 'SUCCEEDED' }; } },
    history: { execute: async () => [] },
  };

  await withApp(options, async (baseUrl) => {
    const evaluation = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/revisions/revision-1/evaluation`, { method: 'POST' });
    assert.equal(evaluation.status, 201);
    assert.deepEqual(await evaluation.json(), { id: 'evaluation-1', parentEventId: 'revision-1' });
    const send = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/revisions/revision-1/send`, { method: 'POST' });
    assert.equal(send.status, 201);
    assert.deepEqual(await send.json(), { id: 'result-1', status: 'SUCCEEDED' });
  });

  assert.deepEqual(calls, [
    ['evaluate', { accountId, externalCommentId: commentId, revisionEventId: 'revision-1' }],
    ['send', { accountId, externalCommentId: commentId, revisionEventId: 'revision-1' }],
  ]);
});

test('comment workflow runs edit, response evaluation, and one manual send through actual use cases', async () => {
  const tenantId = '30000000-0000-4000-8000-000000000001';
  const createdAt = '2026-10-14T12:00:00.000Z';
  const account = SocialAccount.create({ id: accountId, tenantId, platform: 'youtube', externalAccountId: 'UC-test', displayName: 'Test creator', credentialReference: 'test-reference' });
  const comment = {
    platform: 'youtube', socialAccountId: accountId, externalCommentId: commentId, externalThreadId: 'thread-1',
    externalPublicationId: 'video-1', authorDisplayName: 'Viewer', text: 'Qual é o nome da música?',
    createdAt, canReply: true, lastSyncedAt: createdAt, expiresAt: '2026-11-13T12:00:00.000Z',
  };
  const analysis = {
    sentiment: 'NEUTRAL', emotion: 'CURIOSITY', intent: 'QUESTION', topic: 'MUSIC', entity: null,
    spamScore: 0, toxicityScore: 0, engagementValue: 0.5, confidence: 0.92, rationale: 'Direct question.',
    provider: 'JEV', model: 'deterministic-test', schemaVersion: '1',
  };
  const events = [
    { id: 'analysis-1', tenantId, socialAccountId: accountId, externalCommentId: commentId, eventType: 'COMMENT_ANALYSIS_CREATED', actorSource: 'AI', status: 'SUCCEEDED', operationId: null, batchOperationId: null, parentEventId: null, payload: analysis, recordedAt: createdAt, expiresAt: comment.expiresAt },
    { id: 'suggestion-1', tenantId, socialAccountId: accountId, externalCommentId: commentId, eventType: 'RESPONSE_SUGGESTION_GENERATED', actorSource: 'GENERATOR', status: 'SUCCEEDED', operationId: null, batchOperationId: null, parentEventId: 'analysis-1', payload: { text: 'A música é X.' }, recordedAt: createdAt, expiresAt: comment.expiresAt },
  ];
  const eventRepository = {
    append: async (input) => {
      const event = { ...input, id: `workflow-${events.length + 1}`, expiresAt: comment.expiresAt };
      events.push(event);
      return event;
    },
    listByComment: async (scope, socialId, externalId) => {
      assert.equal(scope, tenantId);
      assert.equal(socialId, accountId);
      assert.equal(externalId, commentId);
      return [...events];
    },
  };
  const tenant = { resolveTenantId: async () => tenantId };
  const accounts = { findById: async (scope, id) => scope === tenantId && id === accountId ? account : null };
  const comments = { findByExternalCommentId: async (scope, id, externalId) => scope === tenantId && id === accountId && externalId === commentId ? comment : null, markRepliedByApp: async () => {} };
  const now = () => Date.parse(createdAt);
  const revisions = new ReviseResponseSuggestion(eventRepository, tenant, now);
  const recordEvaluation = new RecordResponseEvaluation(eventRepository, tenant, now);
  const evaluatedInputs = [];
  const evaluateResponse = new EvaluateResponseSuggestion(accounts, comments, {
    evaluate: async (input) => {
      evaluatedInputs.push(input);
      return { relevance: 0.96, tone: 0.93, helpfulness: 0.89, factualRisk: 0.02, toxicityRisk: 0, hallucinationRisk: 0.01, publishRecommendation: 'APPROVE', confidence: 0.94, rationale: 'Direct answer.', provider: 'JEV', model: 'deterministic-test', schemaVersion: '1' };
    },
  }, recordEvaluation, eventRepository, tenant, now);
  const sentTexts = [];
  const sendReply = new SendManualCommentReply(accounts, comments, {
    reply: async (_account, _comment, text) => {
      sentTexts.push(text);
      return { platform: 'youtube', externalReplyId: 'external-reply-1' };
    },
  }, eventRepository, tenant, { generate: () => '60000000-0000-4000-8000-000000000001' }, now);
  const history = new ListCommentWorkflow(eventRepository, accounts, tenant, now);

  await withApp({ corrections: { execute: async () => ({}) }, revisions, evaluateResponse, sendReply, history }, async (baseUrl) => {
    const edit = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/suggestions/suggestion-1/revisions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'A trilha é X.', reason: 'Resposta revisada.' }),
    });
    assert.equal(edit.status, 201);
    const revision = await edit.json();

    const evaluation = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/revisions/${revision.id}/evaluation`, { method: 'POST' });
    assert.equal(evaluation.status, 201);
    const evaluationEvent = await evaluation.json();
    assert.equal(evaluationEvent.parentEventId, revision.id);

    const laterEdit = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/suggestions/suggestion-1/revisions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'A trilha sonora é X.', previousRevisionId: revision.id }),
    });
    assert.equal(laterEdit.status, 201);
    const latestRevision = await laterEdit.json();
    const staleSend = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/revisions/${revision.id}/send`, { method: 'POST' });
    assert.equal(staleSend.status, 409);
    assert.deepEqual(await staleSend.json(), { code: 'MANUAL_REPLY_REVISION_STALE' });

    const finalEvaluation = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/revisions/${latestRevision.id}/evaluation`, { method: 'POST' });
    assert.equal(finalEvaluation.status, 201);
    const finalEvaluationEvent = await finalEvaluation.json();
    assert.equal(finalEvaluationEvent.parentEventId, latestRevision.id);

    const send = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/revisions/${latestRevision.id}/send`, { method: 'POST' });
    assert.equal(send.status, 201);
    const result = await send.json();
    assert.equal(result.eventType, 'MANUAL_REPLY_RESULT');
    assert.equal(result.payload.externalReplyId, 'external-reply-1');

    const repeatedSend = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/revisions/${latestRevision.id}/send`, { method: 'POST' });
    assert.equal(repeatedSend.status, 409);
    assert.deepEqual(await repeatedSend.json(), { code: 'MANUAL_REPLY_ATTEMPT_ALREADY_EXISTS' });

    const workflow = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/workflow`);
    assert.equal(workflow.status, 200);
    const timeline = await workflow.json();
    assert.deepEqual(timeline.slice(-5).map((event) => event.eventType), ['RESPONSE_EVALUATED', 'RESPONSE_SUGGESTION_EDITED', 'RESPONSE_EVALUATED', 'MANUAL_REPLY_ATTEMPTED', 'MANUAL_REPLY_RESULT']);
    assert.equal(timeline.at(-4).payload.text, 'A trilha sonora é X.');
    assert.equal(timeline.at(-4).id, latestRevision.id);
  });

  assert.equal(evaluatedInputs.length, 2);
  assert.deepEqual(evaluatedInputs.map(({ responseText }) => responseText), ['A trilha é X.', 'A trilha sonora é X.']);
  assert.deepEqual(sentTexts, ['A trilha sonora é X.']);
});

test('creator can author, edit, and manually send a response without comment analysis or response evaluation', async () => {
  const tenantId = '30000000-0000-4000-8000-000000000001';
  const createdAt = '2026-10-14T12:00:00.000Z';
  const account = SocialAccount.create({ id: accountId, tenantId, platform: 'youtube', externalAccountId: 'UC-test', displayName: 'Test creator', credentialReference: 'test-reference' });
  const comment = {
    platform: 'youtube', socialAccountId: accountId, externalCommentId: commentId, externalThreadId: 'thread-1',
    externalPublicationId: 'video-1', authorDisplayName: 'Viewer', text: 'Obrigado pelo vídeo.',
    createdAt, canReply: true, lastSyncedAt: createdAt, expiresAt: '2026-11-13T12:00:00.000Z',
  };
  const events = [];
  const eventRepository = {
    append: async (input) => {
      const event = { ...input, id: `manual-${events.length + 1}`, expiresAt: comment.expiresAt };
      events.push(event);
      return event;
    },
    listByComment: async () => [...events],
  };
  const tenant = { resolveTenantId: async () => tenantId };
  const accounts = { findById: async () => account };
  const comments = { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} };
  const now = () => Date.parse(createdAt);
  const manualResponses = new RecordManualResponse(eventRepository, tenant, now);
  const manualResponseRevisions = new ReviseManualResponse(eventRepository, tenant, now);
  let evaluationCalls = 0;
  const evaluateResponse = { execute: async () => { evaluationCalls += 1; return {}; } };
  const sentTexts = [];
  const sendReply = new SendManualCommentReply(accounts, comments, {
    reply: async (_account, _comment, text) => { sentTexts.push(text); return { platform: 'youtube', externalReplyId: 'manual-reply-1' }; },
  }, eventRepository, tenant, { generate: () => '60000000-0000-4000-8000-000000000005' }, now);
  const history = new ListCommentWorkflow(eventRepository, accounts, tenant, now);

  await withApp({
    corrections: { execute: async () => ({}) },
    revisions: { execute: async () => ({}) },
    manualResponses,
    manualResponseRevisions,
    evaluateResponse,
    sendReply,
    history,
  }, async (baseUrl) => {
    const authored = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/responses/manual`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Resposta inicial.' }),
    });
    assert.equal(authored.status, 201);
    const manualRoot = await authored.json();

    const edited = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/responses/manual/${manualRoot.id}/revisions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Resposta final.' }),
    });
    assert.equal(edited.status, 201);
    const finalVersion = await edited.json();

    const send = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/revisions/${finalVersion.id}/send`, { method: 'POST' });
    assert.equal(send.status, 201);
    assert.equal((await send.json()).payload.externalReplyId, 'manual-reply-1');

    const workflow = await fetch(`${baseUrl}/social/accounts/${accountId}/comments/${commentId}/workflow`);
    const timeline = await workflow.json();
    assert.deepEqual(timeline.map((event) => event.eventType), ['MANUAL_RESPONSE_CREATED', 'MANUAL_RESPONSE_EDITED', 'MANUAL_REPLY_ATTEMPTED', 'MANUAL_REPLY_RESULT']);
  });

  assert.equal(evaluationCalls, 0);
  assert.deepEqual(sentTexts, ['Resposta final.']);
});
