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
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantOne = '30000000-0000-4000-8000-000000000001';
const tenantTwo = '10000000-0000-4000-8000-000000000001';
const syncedAt = '2026-10-13T12:00:00.000Z';
const expiresAt = '2026-11-12T12:00:00.000Z';
const sentSince = '2026-10-13T00:00:00.000Z';

const youtubeAccount = SocialAccount.create({
  id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001'),
  tenantId: tenantOne,
  platform: 'youtube',
  externalAccountId: 'UC-channel-1',
  displayName: 'Creator channel',
  credentialReference: 'credential-reference',
});
const instagramAccount = SocialAccount.create({
  id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400002'),
  tenantId: tenantOne,
  platform: 'instagram',
  externalAccountId: 'ig-user-1',
  displayName: 'Creator profile',
  credentialReference: 'credential-reference',
});
const otherTenantAccount = SocialAccount.create({
  id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400003'),
  tenantId: tenantTwo,
  platform: 'youtube',
  externalAccountId: 'UC-channel-2',
  displayName: 'Other channel',
  credentialReference: 'credential-reference',
});

async function createRepositories() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of ['002_create_tenant_identity.sql', '003_add_localization_preferences.sql', '005_create_social_accounts.sql', '006_create_social_credentials.sql', '007_create_social_comments.sql', '008_create_comment_workflow_events.sql', '009_order_comment_workflow_events.sql', '011_unique_manual_reply_attempt_per_revision.sql', '012_add_creator_authored_responses.sql', '013_persist_comment_reply_status.sql', '014_add_tiktok_business_platform.sql', '017_create_social_publications_and_comment_replies.sql', '019_add_app_comment_like_state.sql']) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantTwo, 'Tenant Two', 'USD']);
  const database = new PostgresPersistenceAdapter(pool);
  const accounts = new PostgresSocialAccountRepository(database);
  await accounts.save(tenantOne, youtubeAccount);
  await accounts.save(tenantOne, instagramAccount);
  await accounts.save(tenantTwo, otherTenantAccount);
  return { pool, comments: new PostgresSocialCommentRepository(database), events: new PostgresCommentWorkflowEventRepository(database) };
}

function comment(account, { externalCommentId, platform = account.platform, externalReplyStatus = 'NOT_REPLIED', publicationId = 'video-1' } = {}) {
  return {
    platform,
    externalCommentId,
    externalThreadId: `thread-${externalCommentId}`,
    externalPublicationId: publicationId,
    authorDisplayName: 'Viewer',
    text: 'Great episode',
    createdAt: '2026-10-12T14:00:00.000Z',
    canReply: true,
    canLike: true,
    externalReplyStatus,
  };
}

function workflowEvent(account, { externalCommentId, eventType, status = 'SUCCEEDED', recordedAt = syncedAt }) {
  return {
    tenantId: tenantOne,
    socialAccountId: account.id,
    externalCommentId,
    eventType,
    actorSource: 'AI',
    status,
    parentEventId: null,
    batchOperationId: null,
    payload: { outcome: 'ok' },
    recordedAt,
  };
}

test('comment summary counts persisted unanswered comments per platform for the tenant only', async () => {
  const { pool, comments } = await createRepositories();
  try {
    await comments.upsertPage(youtubeAccount, 'video-1', [
      comment(youtubeAccount, { externalCommentId: 'yt-1' }),
      comment(youtubeAccount, { externalCommentId: 'yt-2', externalReplyStatus: 'REPLIED' }),
      comment(youtubeAccount, { externalCommentId: 'yt-3', externalReplyStatus: 'UNKNOWN' }),
    ], syncedAt, expiresAt);
    await comments.upsertPage(instagramAccount, 'media-1', [
      comment(instagramAccount, { externalCommentId: 'ig-1', publicationId: 'media-1' }),
      comment(instagramAccount, { externalCommentId: 'ig-2', publicationId: 'media-1' }),
    ], syncedAt, expiresAt);
    await comments.upsertPage(otherTenantAccount, 'video-9', [
      comment(otherTenantAccount, { externalCommentId: 'yt-other', publicationId: 'video-9' }),
    ], syncedAt, expiresAt);
    await comments.markRepliedByApp(tenantOne, youtubeAccount.id, 'yt-1', syncedAt);

    const summary = await comments.summarizeByTenant(tenantOne, syncedAt, sentSince);

    assert.deepEqual(summary, [
      { platform: 'instagram', totalComments: 2, unansweredComments: 2, unevaluatedComments: 2, sentRepliesToday: 0 },
      { platform: 'youtube', totalComments: 3, unansweredComments: 0, unevaluatedComments: 3, sentRepliesToday: 0 },
    ]);
  } finally {
    await pool.end();
  }
});

test('comment summary marks comments evaluated only by non-failed analysis events and counts same-day successful sends', async () => {
  const { pool, comments, events } = await createRepositories();
  try {
    await comments.upsertPage(youtubeAccount, 'video-1', [
      comment(youtubeAccount, { externalCommentId: 'yt-1' }),
      comment(youtubeAccount, { externalCommentId: 'yt-2' }),
      comment(youtubeAccount, { externalCommentId: 'yt-3' }),
    ], syncedAt, expiresAt);
    await events.append(workflowEvent(youtubeAccount, { externalCommentId: 'yt-1', eventType: 'COMMENT_ANALYSIS_CREATED' }));
    await events.append(workflowEvent(youtubeAccount, { externalCommentId: 'yt-2', eventType: 'COMMENT_ANALYSIS_CREATED', status: 'FAILED' }));
    await events.append(workflowEvent(youtubeAccount, { externalCommentId: 'yt-1', eventType: 'MANUAL_REPLY_RESULT' }));
    await events.append(workflowEvent(youtubeAccount, { externalCommentId: 'yt-2', eventType: 'MANUAL_REPLY_RESULT', status: 'FAILED' }));
    await events.append(workflowEvent(youtubeAccount, { externalCommentId: 'yt-1', eventType: 'MANUAL_REPLY_RESULT', recordedAt: '2026-10-12T23:30:00.000Z' }));

    const [youtube] = await comments.summarizeByTenant(tenantOne, syncedAt, sentSince);

    assert.deepEqual(youtube, { platform: 'youtube', totalComments: 3, unansweredComments: 3, unevaluatedComments: 2, sentRepliesToday: 1 });
  } finally {
    await pool.end();
  }
});

test('comment summary excludes expired comments and expired workflow events', async () => {
  const { pool, comments, events } = await createRepositories();
  try {
    const past = '2026-09-01T12:00:00.000Z';
    const expired = '2026-10-01T00:00:00.000Z';
    await comments.upsertPage(youtubeAccount, 'video-1', [
      comment(youtubeAccount, { externalCommentId: 'yt-expired' }),
      comment(youtubeAccount, { externalCommentId: 'yt-live' }),
    ], past, expired);
    await comments.upsertPage(youtubeAccount, 'video-1', [comment(youtubeAccount, { externalCommentId: 'yt-live' })], syncedAt, expiresAt);
    await events.append(workflowEvent(youtubeAccount, { externalCommentId: 'yt-live', eventType: 'COMMENT_ANALYSIS_CREATED' }));
    await pool.query('UPDATE comment_workflow_events SET expires_at = $1', ['2026-10-10T00:00:00.000Z']);

    const summary = await comments.summarizeByTenant(tenantOne, syncedAt, sentSince);

    assert.deepEqual(summary, [
      { platform: 'youtube', totalComments: 1, unansweredComments: 1, unevaluatedComments: 1, sentRepliesToday: 0 },
    ]);
  } finally {
    await pool.end();
  }
});
