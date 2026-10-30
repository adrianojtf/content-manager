import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresSocialAccountRepository } = require('../../dist/infrastructure/persistence/postgres-social-account.repository.js');
const { PostgresSocialCommentRepository } = require('../../dist/infrastructure/persistence/postgres-social-comment.repository.js');
const { PostgresCommentWorkflowEventRepository } = require('../../dist/infrastructure/persistence/postgres-comment-workflow-event.repository.js');
const { PostgresSentReplyReportRepository } = require('../../dist/infrastructure/persistence/postgres-sent-reply-report.repository.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');

const tenantOne = '30000000-0000-4000-8000-000000000001';
const tenantTwo = '10000000-0000-4000-8000-000000000001';
const accountOneId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const accountTwoId = '5b7f1f84-25a8-4bd8-a7df-680dc4400002';
const accountOtherTenantId = '5b7f1f84-25a8-4bd8-a7df-680dc4400003';
const asOf = '2026-10-28T12:00:00.000Z';
const expiresAt = '2026-11-12T12:00:00.000Z';

const accounts = [
  SocialAccount.create({
    id: parseSocialAccountId(accountOneId),
    tenantId: tenantOne,
    platform: 'youtube',
    externalAccountId: 'UC-channel-1',
    displayName: 'Creator channel',
    credentialReference: 'credential-reference',
  }),
  SocialAccount.create({
    id: parseSocialAccountId(accountTwoId),
    tenantId: tenantOne,
    platform: 'instagram',
    externalAccountId: 'ig-account-1',
    displayName: 'Creator profile',
    credentialReference: 'credential-reference',
  }),
  SocialAccount.create({
    id: parseSocialAccountId(accountOtherTenantId),
    tenantId: tenantTwo,
    platform: 'youtube',
    externalAccountId: 'UC-other',
    displayName: 'Other creator',
    credentialReference: 'credential-reference',
  }),
];

async function createRepositories() {
  const memory = newDb();
  memory.public.registerFunction({
    name: 'btrim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value) => value.trim(),
  });
  memory.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (value) => value.length,
  });
  memory.public.registerFunction({
    name: 'strpos',
    args: [DataType.text, DataType.text],
    returns: DataType.integer,
    implementation: (value, search) => value.indexOf(search) + 1,
  });
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
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantTwo, 'Tenant Two', 'USD']);
  const database = new PostgresPersistenceAdapter(pool);
  const accountRepository = new PostgresSocialAccountRepository(database);
  for (const account of accounts) {
    await accountRepository.save(account.tenantId, account);
  }
  return {
    pool,
    comments: new PostgresSocialCommentRepository(database),
    events: new PostgresCommentWorkflowEventRepository(database),
    report: new PostgresSentReplyReportRepository(database),
  };
}

function platformComment(account, externalCommentId, publicationId = 'video-1') {
  return {
    platform: account.platform,
    externalCommentId,
    externalThreadId: `thread-${externalCommentId}`,
    externalPublicationId: publicationId,
    authorDisplayName: 'Viewer',
    text: `Comment ${externalCommentId}`,
    createdAt: '2026-10-26T10:00:00.000Z',
    canReply: true,
    canLike: false,
  };
}

function event(account, externalCommentId, eventType, {
  status = 'SUCCEEDED',
  actorSource = 'APPLICATION',
  parentEventId = null,
  operationId = null,
  payload = { outcome: 'ok' },
  recordedAt = '2026-10-27T12:00:00.000Z',
} = {}) {
  return {
    tenantId: account.tenantId,
    socialAccountId: account.id,
    externalCommentId,
    eventType,
    actorSource,
    status,
    operationId,
    batchOperationId: null,
    parentEventId,
    payload,
    recordedAt,
  };
}

async function appendSentReply(events, account, externalCommentId, {
  sentAt = '2026-10-27T15:30:00.000Z',
  attemptAt = '2026-10-27T15:29:00.000Z',
  status = 'SUCCEEDED',
  responseText = 'Thank you!',
} = {}) {
  const version = await events.append(event(account, externalCommentId, 'MANUAL_RESPONSE_CREATED', {
    actorSource: 'CREATOR_LOCAL',
    payload: { text: responseText },
  }));
  const attemptId = '5b7f1f84-25a8-4bd8-a7df-680dc4400099';
  const attempt = await events.append(event(account, externalCommentId, 'MANUAL_REPLY_ATTEMPTED', {
    status: 'IN_PROGRESS',
    actorSource: 'CREATOR_LOCAL',
    parentEventId: version.id,
    operationId: attemptId,
    payload: { attemptId, revisionEventId: version.id, responseVersionEventId: version.id, text: responseText },
    recordedAt: attemptAt,
  }));
  return events.append(event(account, externalCommentId, 'MANUAL_REPLY_RESULT', {
    status,
    parentEventId: attempt.id,
    operationId: attemptId,
    payload: { attemptId, externalReplyId: `reply-${externalCommentId}` },
    recordedAt: sentAt,
  }));
}

test('sent reply report joins exact sent text with comment, account, and send-time JEV analysis', async () => {
  const { pool, comments, events, report } = await createRepositories();
  try {
    const account = accounts[0];
    await comments.upsertPage(account, 'video-1', [platformComment(account, 'comment-1')], asOf, expiresAt);
    await pool.query(
      `INSERT INTO social_publications (
         tenant_id, social_account_id, platform, external_publication_id, title, description,
         permalink, thumbnail_url, published_at, last_synced_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [tenantOne, account.id, 'youtube', 'video-1', 'A better publication title', null,
        'https://youtube.com/watch?v=video-1', null, '2026-10-20T10:00:00.000Z', asOf],
    );
    const analysis = await events.append(event(account, 'comment-1', 'COMMENT_ANALYSIS_CREATED', {
      actorSource: 'AI',
      payload: {
        sentiment: 'POSITIVE',
        emotion: 'JOY',
        intent: 'PRAISE',
        topic: 'CONTENT',
        spamScore: 0.01,
        toxicityScore: 0.02,
        engagementValue: 0.8,
        confidence: 0.93,
        provider: 'JEV',
        model: 'jev-1.14.0',
        evaluatedAt: '2026-10-27T14:00:00.000Z',
        signals: { sentiment: { confidence: 0.93, probabilities: { POSITIVE: 0.93, NEUTRAL: 0.05, NEGATIVE: 0.02 } } },
      },
      recordedAt: '2026-10-27T14:00:00.000Z',
    }));
    await events.append(event(account, 'comment-1', 'COMMENT_ANALYSIS_CORRECTED', {
      actorSource: 'CREATOR_LOCAL',
      parentEventId: analysis.id,
      payload: { correctedFields: { sentiment: 'NEUTRAL' }, reason: 'Manual correction' },
      recordedAt: '2026-10-27T14:30:00.000Z',
    }));
    await appendSentReply(events, account, 'comment-1', { responseText: 'Exact sent response' });
    await events.append(event(account, 'comment-1', 'COMMENT_ANALYSIS_CREATED', {
      actorSource: 'AI',
      payload: { sentiment: 'NEGATIVE', provider: 'JEV', model: 'later-model', evaluatedAt: '2026-10-27T16:00:00.000Z' },
      recordedAt: '2026-10-27T16:00:00.000Z',
    }));
    await appendSentReply(events, account, 'comment-1', {
      sentAt: '2026-10-27T17:00:00.000Z',
      attemptAt: '2026-10-27T16:59:00.000Z',
      responseText: 'A later response',
    });
    await appendSentReply(events, account, 'comment-1', {
      sentAt: '2026-10-27T18:00:00.000Z',
      status: 'FAILED',
      responseText: 'Failed response',
    });

    const result = await report.query(tenantOne, {
      asOf,
      from: '2026-10-27T00:00:00.000Z',
      to: '2026-10-28T00:00:00.000Z',
      platform: 'youtube',
      accountId: account.id,
      search: null,
      after: null,
      limit: 25,
    });

    assert.equal(result.total, 2);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].sentResponse, 'A later response');
    assert.equal(result.items[0].jevCommentAnalysis.model, 'later-model');
    assert.equal(result.items[1].sentResponse, 'Exact sent response');
    assert.equal(result.items[1].jevCommentAnalysis.model, 'jev-1.14.0');
    assert.deepEqual(result.items[1].analysisCorrection.correctedFields, { sentiment: 'NEUTRAL' });
    assert.equal(result.items[1].analysisCorrection.actorSource, 'CREATOR_LOCAL');
    assert.equal(result.items[1].commentText, 'Comment comment-1');
    assert.equal(result.items[1].commentAuthorDisplayName, 'Viewer');
    assert.equal(result.items[1].accountDisplayName, 'Creator channel');
    assert.equal(result.items[1].publicationTitle, 'A better publication title');
    assert.equal(result.items[1].publicationPermalink, 'https://youtube.com/watch?v=video-1');
    assert.equal(result.hasMore, false);
  } finally {
    await pool.end();
  }
});

test('report applies tenant, search, account, and pagination filters and leaves missing analysis null', async () => {
  const { pool, comments, events, report } = await createRepositories();
  try {
    const account = accounts[0];
    const otherAccount = accounts[2];
    await comments.upsertPage(account, 'video-1', [
      platformComment(account, 'comment-1'),
      platformComment(account, 'comment-2'),
    ], asOf, expiresAt);
    await comments.upsertPage(otherAccount, 'video-9', [platformComment(otherAccount, 'comment-other', 'video-9')], asOf, expiresAt);
    await appendSentReply(events, account, 'comment-1', { responseText: 'Needle result' });
    await appendSentReply(events, account, 'comment-2', { sentAt: '2026-10-27T16:00:00.000Z', responseText: 'Other result' });
    await appendSentReply(events, otherAccount, 'comment-other', { responseText: 'Needle other tenant' });

    const first = await report.query(tenantOne, {
      asOf,
      from: '2026-10-27T00:00:00.000Z',
      to: '2026-10-28T00:00:00.000Z',
      platform: 'youtube',
      accountId: account.id,
      search: 'needle',
      after: null,
      limit: 1,
    });

    assert.equal(first.total, 1);
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].sentResponse, 'Needle result');
    assert.equal(first.items[0].jevCommentAnalysis, null);
    assert.equal(first.items[0].analysisCorrection, null);
    assert.equal(first.items[0].publicationTitle, null);
    assert.equal(first.items[0].publicationPermalink, null);
    assert.equal(first.hasMore, false);
  } finally {
    await pool.end();
  }
});
