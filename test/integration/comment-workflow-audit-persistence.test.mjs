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
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantId = '30000000-0000-4000-8000-000000000001';
const otherTenantId = '10000000-0000-4000-8000-000000000001';
const syncedAt = '2026-10-13T12:00:00.000Z';
const expiresAt = '2026-11-12T12:00:00.000Z';
const account = SocialAccount.create({
  id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001'),
  tenantId,
  platform: 'youtube',
  externalAccountId: 'UC-channel-1',
  displayName: 'Creator channel',
  credentialReference: 'credential-reference',
});

async function createAuditRepository() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of [
    '002_create_tenant_identity.sql',
    '003_add_localization_preferences.sql',
    '005_create_social_accounts.sql',
    '006_create_social_credentials.sql',
    '007_create_social_comments.sql',
    '008_create_comment_workflow_events.sql',
    '009_order_comment_workflow_events.sql',
    '011_unique_manual_reply_attempt_per_revision.sql',
    '012_add_creator_authored_responses.sql',
    '013_persist_comment_reply_status.sql',
    '014_add_tiktok_business_platform.sql',
    '017_create_social_publications_and_comment_replies.sql',
    '019_add_app_comment_like_state.sql',
  ]) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [otherTenantId, 'Other tenant', 'USD']);
  const database = new PostgresPersistenceAdapter(pool);
  const accounts = new PostgresSocialAccountRepository(database);
  await accounts.save(tenantId, account);
  const comments = new PostgresSocialCommentRepository(database);
  await comments.upsertPage(account, 'video-1', [{
    platform: 'youtube', externalCommentId: 'comment-1', externalThreadId: 'thread-1', externalPublicationId: 'video-1',
    authorDisplayName: 'Viewer', text: 'Question', createdAt: syncedAt, canReply: true, canLike: false,
  }], syncedAt, expiresAt);
  return { pool, events: new PostgresCommentWorkflowEventRepository(database) };
}

function event({ eventType, source, status = 'SUCCEEDED', parentEventId = null, batchOperationId = null, payload }) {
  return {
    tenantId,
    socialAccountId: account.id,
    externalCommentId: 'comment-1',
    eventType,
    actorSource: source,
    status,
    parentEventId,
    batchOperationId,
    payload,
    recordedAt: syncedAt,
  };
}

test('comment workflow audit appends immutable JEV output and human correction as linked events', async () => {
  const { pool, events } = await createAuditRepository();
  try {
    const ai = await events.append(event({ eventType: 'COMMENT_ANALYSIS_CREATED', source: 'AI', payload: { spamScore: 0.1, confidence: 0.9, rationale: 'Low spam' } }));
    const corrected = await events.append(event({ eventType: 'COMMENT_ANALYSIS_CORRECTED', source: 'CREATOR_LOCAL', parentEventId: ai.id, payload: { correctedFields: { spamScore: 0.8 }, reason: 'Creator disagrees' } }));

    const timeline = await events.listByComment(tenantId, account.id, 'comment-1', syncedAt);

    assert.equal(timeline.length, 2);
    assert.deepEqual(timeline.map((entry) => entry.id), [ai.id, corrected.id]);
    const originalAnalysis = timeline.find((entry) => entry.eventType === 'COMMENT_ANALYSIS_CREATED');
    const correction = timeline.find((entry) => entry.eventType === 'COMMENT_ANALYSIS_CORRECTED');
    assert.deepEqual(originalAnalysis.payload, { spamScore: 0.1, confidence: 0.9, rationale: 'Low spam' });
    assert.equal(originalAnalysis.expiresAt, expiresAt);
    assert.deepEqual(correction.payload, { correctedFields: { spamScore: 0.8 }, reason: 'Creator disagrees' });
    assert.equal(correction.parentEventId, ai.id);
    assert.equal(await events.listByComment(otherTenantId, account.id, 'comment-1', syncedAt).then((rows) => rows.length), 0);
  } finally {
    await pool.end();
  }
});

test('comment workflow audit appends generated and manually edited response artifacts by revision', async () => {
  const { pool, events } = await createAuditRepository();
  try {
    const generated = await events.append(event({ eventType: 'RESPONSE_SUGGESTION_GENERATED', source: 'AI', payload: { text: 'Generated reply', provider: 'test-provider', model: 'test-model' } }));
    const edited = await events.append(event({ eventType: 'RESPONSE_SUGGESTION_EDITED', source: 'CREATOR_LOCAL', parentEventId: generated.id, payload: { text: 'Creator edited reply', originalSuggestionId: generated.id } }));
    const timeline = await events.listByComment(tenantId, account.id, 'comment-1', syncedAt);

    const generatedEvent = timeline.find((entry) => entry.eventType === 'RESPONSE_SUGGESTION_GENERATED');
    const editedEvent = timeline.find((entry) => entry.eventType === 'RESPONSE_SUGGESTION_EDITED');
    assert.equal(generatedEvent.payload.text, 'Generated reply');
    assert.equal(editedEvent.payload.text, 'Creator edited reply');
    assert.equal(editedEvent.parentEventId, generated.id);
    assert.equal(editedEvent.actorSource, 'CREATOR_LOCAL');
    assert.equal(edited.actorSource, 'CREATOR_LOCAL');
  } finally {
    await pool.end();
  }
});

test('comment workflow persists creator-authored response roots and edits independently of AI suggestions', async () => {
  const { pool, events } = await createAuditRepository();
  try {
    const manual = await events.append(event({ eventType: 'MANUAL_RESPONSE_CREATED', source: 'CREATOR_LOCAL', payload: { text: 'Creator-authored reply' } }));
    const edited = await events.append(event({ eventType: 'MANUAL_RESPONSE_EDITED', source: 'CREATOR_LOCAL', parentEventId: manual.id, payload: { originalManualResponseEventId: manual.id, text: 'Edited creator reply' } }));
    const timeline = await events.listByComment(tenantId, account.id, 'comment-1', syncedAt);

    assert.deepEqual(timeline.map((entry) => entry.eventType), ['MANUAL_RESPONSE_CREATED', 'MANUAL_RESPONSE_EDITED']);
    assert.equal(timeline[0].payload.text, 'Creator-authored reply');
    assert.equal(timeline[1].payload.text, 'Edited creator reply');
    assert.equal(timeline[1].parentEventId, manual.id);
    assert.equal(edited.actorSource, 'CREATOR_LOCAL');
  } finally {
    await pool.end();
  }
});

test('comment workflow persists a revision-linked evaluation and manual attempt/result as append-only history', async () => {
  const { pool, events } = await createAuditRepository();
  try {
    const suggestion = await events.append(event({ eventType: 'RESPONSE_SUGGESTION_GENERATED', source: 'GENERATOR', payload: { text: 'Initial reply' } }));
    const revision = await events.append(event({ eventType: 'RESPONSE_SUGGESTION_EDITED', source: 'CREATOR_LOCAL', parentEventId: suggestion.id, payload: { originalSuggestionEventId: suggestion.id, text: 'Final evaluated text' } }));
    const evaluation = await events.append(event({ eventType: 'RESPONSE_EVALUATED', source: 'AI', parentEventId: revision.id, payload: { revisionEventId: revision.id, evaluation: { publishRecommendation: 'APPROVE', confidence: 0.9 } } }));
    const attempt = await events.append(event({ eventType: 'MANUAL_REPLY_ATTEMPTED', source: 'CREATOR_LOCAL', status: 'IN_PROGRESS', parentEventId: revision.id, payload: { attemptId: 'attempt-1', revisionEventId: revision.id, text: 'Final evaluated text', evaluationEventId: evaluation.id } }));
    await assert.rejects(events.append(event({ eventType: 'MANUAL_REPLY_ATTEMPTED', source: 'CREATOR_LOCAL', status: 'IN_PROGRESS', parentEventId: revision.id, payload: { attemptId: 'attempt-2', revisionEventId: revision.id, text: 'Final evaluated text', evaluationEventId: evaluation.id } })), /MANUAL_REPLY_ATTEMPT_ALREADY_EXISTS/);
    await events.append(event({ eventType: 'MANUAL_REPLY_RESULT', source: 'SOCIAL_PLATFORM', parentEventId: attempt.id, payload: { attemptId: 'attempt-1', revisionEventId: revision.id, externalReplyId: 'external-reply-1' } }));

    const timeline = await events.listByComment(tenantId, account.id, 'comment-1', syncedAt);
    assert.deepEqual(timeline.map((entry) => entry.eventType), ['RESPONSE_SUGGESTION_GENERATED', 'RESPONSE_SUGGESTION_EDITED', 'RESPONSE_EVALUATED', 'MANUAL_REPLY_ATTEMPTED', 'MANUAL_REPLY_RESULT']);
    assert.equal(timeline[2].parentEventId, revision.id);
    assert.equal(timeline[3].payload.text, 'Final evaluated text');
    assert.equal(timeline[4].payload.externalReplyId, 'external-reply-1');
  } finally {
    await pool.end();
  }
});

test('comment workflow audit expires with the associated comment and stores batch correlation per comment event', async () => {
  const { pool, events } = await createAuditRepository();
  try {
    await events.append(event({ eventType: 'COMMENT_CLASSIFIED', source: 'AI', batchOperationId: '60000000-0000-4000-8000-000000000001', payload: { sentiment: 'POSITIVE' } }));
    const current = await events.listByComment(tenantId, account.id, 'comment-1', syncedAt);
    const batchEvents = await events.listByBatchOperationId(tenantId, '60000000-0000-4000-8000-000000000001', syncedAt);
    const expired = await events.listByComment(tenantId, account.id, 'comment-1', '2026-11-13T12:00:00.000Z');

    assert.equal(current.length, 1);
    assert.equal(current[0].batchOperationId, '60000000-0000-4000-8000-000000000001');
    assert.deepEqual(batchEvents.map((event) => event.id), [current[0].id]);
    assert.deepEqual(expired, []);
    const { rows: eventRows } = await pool.query('SELECT id FROM comment_workflow_events WHERE tenant_id = $1', [tenantId]);
    const { rows: commentRows } = await pool.query('SELECT external_comment_id FROM social_comments WHERE tenant_id = $1', [tenantId]);
    assert.deepEqual(eventRows, []);
    assert.deepEqual(commentRows, []);
  } finally {
    await pool.end();
  }
});
