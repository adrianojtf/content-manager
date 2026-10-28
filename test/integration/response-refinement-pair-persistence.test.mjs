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
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantId = '30000000-0000-4000-8000-000000000001';
const syncedAt = '2026-10-13T12:00:00.000Z';
const expiresAt = '2026-11-12T12:00:00.000Z';
const recordedAt = '2026-10-22T12:00:00.000Z';
const account = SocialAccount.create({
  id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001'),
  tenantId,
  platform: 'youtube',
  externalAccountId: 'UC-channel-1',
  displayName: 'Creator channel',
  credentialReference: 'credential-reference',
});

async function createRepository({ withComment = true } = {}) {
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
    '017_create_social_publications_and_comment_replies.sql',
    '019_add_app_comment_like_state.sql',
    '022_create_ai_response_edit_pairs.sql',
  ]) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  const database = new PostgresPersistenceAdapter(pool);
  const accounts = new PostgresSocialAccountRepository(database);
  await accounts.save(tenantId, account);
  if (withComment) {
    const comments = new PostgresSocialCommentRepository(database);
    await comments.upsertPage(account, 'video-1', [{
      platform: 'youtube', externalCommentId: 'comment-1', externalThreadId: 'thread-1', externalPublicationId: 'video-1',
      authorDisplayName: 'Viewer', text: 'Question', createdAt: syncedAt, canReply: true, canLike: false,
    }], syncedAt, expiresAt);
  }
  return { pool, pairs: new PostgresResponseRefinementPairRepository(database), events: new PostgresCommentWorkflowEventRepository(database) };
}

function pair(overrides = {}) {
  return {
    tenantId,
    socialAccountId: account.id,
    platform: 'youtube',
    language: 'pt-BR',
    aiText: 'Texto gerado pela IA.',
    finalText: 'Texto final editado.',
    aiProvider: 'GEMINI',
    aiModel: 'gemini-3.5-flash-lite',
    aiConfidence: 0.82,
    aiRationale: 'Responde a pergunta.',
    intendedTone: 'FRIENDLY',
    toneProfile: { toneProfile: { primaryTone: 'FRIENDLY', modifiers: ['WARM'], customNote: null }, toneProfileSource: 'ACCOUNT' },
    revisionCount: 2,
    lastEditReason: 'ajuste final',
    evaluation: { publishRecommendation: 'APPROVE', confidence: 0.94 },
    analysisLabels: { sentiment: 'POSITIVE', emotion: 'CURIOSITY', intent: 'QUESTION', topic: 'SONG_RELEASE', entity: 'Song' },
    manualReplyAttemptId: '60000000-0000-4000-8000-000000000009',
    recordedAt,
    ...overrides,
  };
}

test('migration 022 creates the anonymized append-only ai_response_edit_pairs table', async () => {
  const { pool } = await createRepository();
  try {
    const { rows: columns } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ai_response_edit_pairs' ORDER BY column_name`,
    );
    const names = columns.map((row) => row.column_name).sort();
    assert.deepEqual(names, [
      'ai_confidence', 'ai_model', 'ai_provider', 'ai_rationale', 'ai_text', 'analysis_labels_json',
      'evaluation_json', 'final_text', 'id', 'intended_tone', 'language', 'last_edit_reason',
      'manual_reply_attempt_id', 'platform', 'recorded_at', 'revision_count', 'social_account_id',
      'tenant_id', 'tone_profile_json',
    ]);
    assert.equal(names.some((name) => /external_|author|comment|reply_id|event_id|expires_at/.test(name)), false);
  } finally {
    await pool.end();
  }
});

test('migration 022 declares no foreign keys into comment-scoped tables', async () => {
  const migration = await readFile(path.join(migrationDirectory, '022_create_ai_response_edit_pairs.sql'), 'utf8');
  assert.equal(/social_comments|comment_workflow_events/.test(migration), false);
  assert.equal(/external_comment_id|external_reply_id|external_publication_id|author|comment_text/.test(migration), false);
});

test('response refinement pair repository round-trips every field and generated id', async () => {
  const { pool, pairs } = await createRepository();
  try {
    const stored = await pairs.append(pair());

    assert.match(stored.id, /^[0-9a-f-]{36}$/i);
    const { rows } = await pool.query('SELECT * FROM ai_response_edit_pairs WHERE id = $1', [stored.id]);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.tenant_id, tenantId);
    assert.equal(row.social_account_id, account.id);
    assert.equal(row.platform, 'youtube');
    assert.equal(row.language, 'pt-BR');
    assert.equal(row.ai_text, 'Texto gerado pela IA.');
    assert.equal(row.final_text, 'Texto final editado.');
    assert.equal(row.ai_provider, 'GEMINI');
    assert.equal(row.ai_model, 'gemini-3.5-flash-lite');
    assert.equal(row.ai_confidence, 0.82);
    assert.equal(row.ai_rationale, 'Responde a pergunta.');
    assert.equal(row.intended_tone, 'FRIENDLY');
    assert.deepEqual(JSON.parse(row.tone_profile_json), pair().toneProfile);
    assert.equal(row.revision_count, 2);
    assert.equal(row.last_edit_reason, 'ajuste final');
    assert.deepEqual(JSON.parse(row.evaluation_json), pair().evaluation);
    assert.deepEqual(JSON.parse(row.analysis_labels_json), pair().analysisLabels);
    assert.equal(row.manual_reply_attempt_id, '60000000-0000-4000-8000-000000000009');
    assert.equal(new Date(row.recorded_at).toISOString(), recordedAt);
  } finally {
    await pool.end();
  }
});

test('response refinement pair repository stores null refinement context fields', async () => {
  const { pool, pairs } = await createRepository();
  try {
    const stored = await pairs.append(pair({
      aiRationale: null,
      lastEditReason: null,
      evaluation: null,
      analysisLabels: null,
    }));
    const { rows } = await pool.query('SELECT * FROM ai_response_edit_pairs WHERE id = $1', [stored.id]);
    assert.equal(rows[0].ai_rationale, null);
    assert.equal(rows[0].last_edit_reason, null);
    assert.equal(rows[0].evaluation_json, null);
    assert.equal(rows[0].analysis_labels_json, null);
  } finally {
    await pool.end();
  }
});

test('response refinement pair append is idempotent per manual reply attempt', async () => {
  const { pool, pairs } = await createRepository();
  try {
    const first = await pairs.append(pair());
    const replayed = await pairs.append(pair({ finalText: 'Texto diferente ignorado.' }));
    await pairs.append(pair({ manualReplyAttemptId: '60000000-0000-4000-8000-000000000010' }));

    assert.equal(replayed.id, first.id);
    const { rows } = await pool.query('SELECT manual_reply_attempt_id, final_text FROM ai_response_edit_pairs ORDER BY manual_reply_attempt_id');
    assert.equal(rows.length, 2);
    assert.equal(rows.some((row) => row.final_text === 'Texto diferente ignorado.'), false);
    assert.equal(rows.find((row) => row.manual_reply_attempt_id === '60000000-0000-4000-8000-000000000009').final_text, 'Texto final editado.');
  } finally {
    await pool.end();
  }
});

test('response refinement pairs survive the 30-day comment retention purge', async () => {
  const { pool, pairs, events } = await createRepository();
  try {
    await events.append({
      tenantId,
      socialAccountId: account.id,
      externalCommentId: 'comment-1',
      eventType: 'RESPONSE_SUGGESTION_GENERATED',
      actorSource: 'GENERATOR',
      status: 'SUCCEEDED',
      operationId: null,
      batchOperationId: null,
      parentEventId: null,
      payload: { text: 'Texto gerado pela IA.', language: 'pt-BR' },
      recordedAt: syncedAt,
    });
    await pairs.append(pair());

    const purgeAt = '2026-11-13T12:00:00.000Z';
    await pool.query('DELETE FROM social_comments WHERE tenant_id = $1 AND retention_expires_at <= $2', [tenantId, purgeAt]);
    await pool.query('DELETE FROM comment_workflow_events WHERE tenant_id = $1 AND expires_at <= $2', [tenantId, purgeAt]);

    const { rows: commentRows } = await pool.query('SELECT external_comment_id FROM social_comments WHERE tenant_id = $1', [tenantId]);
    const { rows: eventRows } = await pool.query('SELECT id FROM comment_workflow_events WHERE tenant_id = $1', [tenantId]);
    const { rows: pairRows } = await pool.query('SELECT ai_text, final_text FROM ai_response_edit_pairs WHERE tenant_id = $1', [tenantId]);
    assert.deepEqual(commentRows, []);
    assert.deepEqual(eventRows, []);
    assert.equal(pairRows.length, 1);
    assert.equal(pairRows[0].ai_text, 'Texto gerado pela IA.');
    assert.equal(pairRows[0].final_text, 'Texto final editado.');
  } finally {
    await pool.end();
  }
});
