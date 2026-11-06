import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresSocialAccountRepository } = require('../../dist/infrastructure/persistence/postgres-social-account.repository.js');
const { PostgresSocialCommentRepository } = require('../../dist/infrastructure/persistence/postgres-social-comment.repository.js');
const { PostgresCommentWorkflowEventRepository } = require('../../dist/infrastructure/persistence/postgres-comment-workflow-event.repository.js');
const { PostgresResponseRefinementPairRepository } = require('../../dist/infrastructure/persistence/postgres-response-refinement-pair.repository.js');
const { PostgresResponseRefinementAnalysisRepository } = require('../../dist/infrastructure/persistence/postgres-response-refinement-analysis.repository.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const attemptId = '60000000-0000-4000-8000-000000000009';
const recordedAt = '2026-11-04T12:00:00.000Z';
const asOf = '2026-11-05T12:00:00.000Z';
const account = SocialAccount.create({
  id: parseSocialAccountId(accountId),
  tenantId,
  platform: 'instagram',
  externalAccountId: 'ig-account',
  displayName: 'Creator',
  credentialReference: 'credential-reference',
});
const analysis = {
  sentiment: 'NEUTRAL', emotion: 'CURIOSITY', intent: 'QUESTION', topic: 'GENERAL', entity: null,
  spamScore: 0, toxicityScore: 0, engagementValue: 0.5, confidence: 0.9,
  rationale: null, provider: 'JEV', model: 'test-model', schemaVersion: 'typesafe-systemone-v2',
};
const suggestion = {
  language: 'pt-BR', text: 'Atendemos até 18h.', provider: 'OPENAI', model: 'gpt-6-luna',
  promptVersion: 'openai-response-v1', confidence: 0.8, rationale: null, intendedTone: 'FRIENDLY',
  toneProfile: { primaryTone: 'FRIENDLY', modifiers: [], customNote: null },
};

async function setup({ retained = true, successfulResult = true } = {}) {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of [
    '002_create_tenant_identity.sql', '003_add_localization_preferences.sql', '005_create_social_accounts.sql',
    '006_create_social_credentials.sql', '007_create_social_comments.sql', '008_create_comment_workflow_events.sql',
    '009_order_comment_workflow_events.sql', '011_unique_manual_reply_attempt_per_revision.sql',
    '012_add_creator_authored_responses.sql', '013_persist_comment_reply_status.sql',
    '017_create_social_publications_and_comment_replies.sql', '019_add_app_comment_like_state.sql',
    '022_create_ai_response_edit_pairs.sql', '027_add_response_prompt_version_to_ai_response_edit_pairs.sql',
    '028_create_response_refinement_analyses.sql', '029_add_response_refinement_analysis_retry_provenance.sql',
  ]) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  const database = new PostgresPersistenceAdapter(pool);
  await new PostgresSocialAccountRepository(database).save(tenantId, account);
  const comments = new PostgresSocialCommentRepository(database);
  await comments.upsertPage(account, 'publication-1', [{
    platform: 'instagram', externalCommentId: 'comment-1', externalThreadId: 'thread-1',
    externalPublicationId: 'publication-1', authorDisplayName: 'Private viewer',
    text: 'Qual é o horário de atendimento?', createdAt: recordedAt, canReply: true, canLike: false,
  }], recordedAt, retained ? '2026-12-04T12:00:00.000Z' : '2026-11-06T12:00:00.000Z');
  const events = new PostgresCommentWorkflowEventRepository(database);
  const commentEvent = async (eventType, status, payload, parentEventId = null, operationId = null) => events.append({
    tenantId, socialAccountId: accountId, externalCommentId: 'comment-1', eventType,
    actorSource: eventType === 'RESPONSE_SUGGESTION_GENERATED' ? 'GENERATOR' : 'APPLICATION',
    status, operationId, batchOperationId: null, parentEventId, payload, recordedAt,
  });
  const commentAnalysis = await commentEvent('COMMENT_ANALYSIS_CREATED', 'SUCCEEDED', analysis);
  const suggestionEvent = await commentEvent('RESPONSE_SUGGESTION_GENERATED', 'SUCCEEDED', suggestion, commentAnalysis.id);
  const revision = await commentEvent('RESPONSE_SUGGESTION_EDITED', 'SUCCEEDED', {
    originalSuggestionEventId: suggestionEvent.id, revision: 1, text: 'Atendemos até 18h, de segunda a sexta.',
    reason: 'Informar os dias.',
  }, suggestionEvent.id);
  const attemptEvent = await commentEvent('MANUAL_REPLY_ATTEMPTED', 'IN_PROGRESS', {
    attemptId, responseRootEventId: suggestionEvent.id, responseVersionEventId: revision.id,
    revisionEventId: revision.id, text: 'Atendemos até 18h, de segunda a sexta.',
  }, revision.id, attemptId);
  if (successfulResult) {
    await commentEvent('MANUAL_REPLY_RESULT', 'SUCCEEDED', {
      attemptId, responseVersionEventId: revision.id, revisionEventId: revision.id,
    }, attemptEvent.id, attemptId);
  }
  const pairs = new PostgresResponseRefinementPairRepository(database);
  const pair = await pairs.append({
    tenantId, socialAccountId: accountId, platform: 'instagram', language: 'pt-BR',
    aiText: suggestion.text, finalText: 'Atendemos até 18h, de segunda a sexta.',
    aiProvider: suggestion.provider, aiModel: suggestion.model, promptVersion: suggestion.promptVersion,
    aiConfidence: suggestion.confidence, aiRationale: null, intendedTone: 'FRIENDLY',
    toneProfile: { toneProfile: suggestion.toneProfile, toneProfileSource: 'ACCOUNT' },
    revisionCount: 1, lastEditReason: 'Informar os dias.', evaluation: null, analysisLabels: null,
    manualReplyAttemptId: attemptId, recordedAt,
  });
  return { pool, database, pair, events, analyses: new PostgresResponseRefinementAnalysisRepository(database) };
}

test('analysis query resolves only a successful same-tenant pair with retained comment and effective analysis', async () => {
  const { pool, pair, analyses } = await setup();
  try {
    const page = await analyses.listCandidates(tenantId, {
      accountId, platform: 'instagram', language: 'pt-BR',
      from: '2026-11-01T00:00:00.000Z', to: '2026-11-05T00:00:00.000Z', limit: 10, after: null,
    }, asOf);

    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].pair.id, pair.id);
    assert.equal(page.items[0].context.status, 'AVAILABLE');
    assert.equal(page.items[0].context.comment.text, 'Qual é o horário de atendimento?');
    assert.equal(page.items[0].context.comment.authorDisplayName, 'Private viewer');
    assert.equal(page.items[0].context.analysis.intent, 'QUESTION');
  } finally {
    await pool.end();
  }
});

test('analysis query excludes expired context and never deletes source records', async () => {
  const { pool, pair, analyses } = await setup({ retained: false });
  try {
    const page = await analyses.listCandidates(tenantId, {
      accountId: null, platform: null, language: null,
      from: '2026-11-01T00:00:00.000Z', to: '2026-11-05T00:00:00.000Z', limit: 10, after: null,
    }, '2026-11-07T12:00:00.000Z');

    assert.equal(page.items[0].context.status, 'SOURCE_CONTEXT_EXPIRED');
    const { rows } = await pool.query('SELECT id FROM ai_response_edit_pairs WHERE id = $1', [pair.id]);
    assert.equal(rows.length, 1);
  } finally {
    await pool.end();
  }
});

test('analysis query skips pairs without a successful result event', async () => {
  const { pool, analyses } = await setup({ successfulResult: false });
  try {
    const page = await analyses.listCandidates(tenantId, {
      accountId: null, platform: null, language: null,
      from: '2026-11-01T00:00:00.000Z', to: '2026-11-05T00:00:00.000Z', limit: 10, after: null,
    }, asOf);

    assert.equal(page.items[0].context.status, 'SOURCE_RESULT_NOT_SUCCEEDED');
  } finally {
    await pool.end();
  }
});

test('analysis persistence appends structured outputs without source text', async () => {
  const { pool, pair, analyses } = await setup();
  try {
    const saved = await analyses.append({
      analysisRequestId: '70000000-0000-4000-8000-000000000001',
      sourceAnalysisId: null,
      tenantId,
      pairId: pair.id,
      promptVersion: 'openai-response-v1',
      sourceContextUpdatedAt: asOf,
      status: 'SUCCEEDED',
      skipReason: null,
      aiEvaluation: { relevance: 0.7 },
      finalEvaluation: { relevance: 0.9 },
      editClassification: { editCategory: 'CLARITY', confidence: 0.9 },
      scoreDeltas: { relevance: 0.2 },
      capabilityErrors: {},
      recordedAt: asOf,
    });
    const { rows } = await pool.query('SELECT * FROM response_refinement_analyses WHERE id = $1', [saved.id]);
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0].edit_classification_json), { editCategory: 'CLARITY', confidence: 0.9 });
    assert.equal(JSON.stringify(rows[0]).includes('Qual é o horário'), false);
    assert.equal(JSON.stringify(rows[0]).includes(suggestion.text), false);
  } finally {
    await pool.end();
  }
});

test('retry query returns partial analyses with both evaluations and current retained context', async () => {
  const { pool, pair, analyses } = await setup();
  try {
    await analyses.append({
      analysisRequestId: '70000000-0000-4000-8000-000000000010',
      sourceAnalysisId: null,
      tenantId,
      pairId: pair.id,
      promptVersion: 'openai-response-v1',
      sourceContextUpdatedAt: asOf,
      status: 'PARTIAL',
      skipReason: null,
      aiEvaluation: { relevance: 0.7 },
      finalEvaluation: { relevance: 0.9 },
      editClassification: null,
      scoreDeltas: { relevance: 0.2 },
      capabilityErrors: { editClassification: 'INTELLIGENCE_PROVIDER_REQUEST_FAILED' },
      recordedAt: asOf,
    });

    const page = await analyses.listRetryCandidates(tenantId, '70000000-0000-4000-8000-000000000010', asOf);

    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].previousAnalysis.status, 'PARTIAL');
    assert.deepEqual(page.items[0].previousAnalysis.aiEvaluation, { relevance: 0.7 });
    assert.equal(page.items[0].context.status, 'AVAILABLE');
    assert.equal(page.items[0].context.comment.text, 'Qual é o horário de atendimento?');
  } finally {
    await pool.end();
  }
});
