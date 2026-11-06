import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { RunCommentWorkflowBatch, ListCommentWorkflowBatchEvents } = require('../../dist/application/social/run-comment-workflow-batch.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');
const { IntelligenceProviderError } = require('../../dist/application/social/intelligence-provider-error.js');
const { CommentWorkflowAuditError } = require('../../dist/application/social/comment-workflow-audit-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const secondAccountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400002';
const account = SocialAccount.create({ id: parseSocialAccountId(accountId), tenantId, platform: 'youtube', externalAccountId: 'UC-one', displayName: 'One', credentialReference: 'ref-one' });
const secondAccount = SocialAccount.create({ id: parseSocialAccountId(secondAccountId), tenantId, platform: 'youtube', externalAccountId: 'UC-two', displayName: 'Two', credentialReference: 'ref-two' });
const facebookAccount = SocialAccount.create({ id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400003'), tenantId, platform: 'facebook', externalAccountId: 'page-three', displayName: 'Three', credentialReference: 'ref-three' });
const tiktokAccount = SocialAccount.create({ id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400004'), tenantId, platform: 'tiktok', externalAccountId: 'tt-four', displayName: 'Four', credentialReference: 'ref-four' });
const now = () => Date.parse('2026-10-14T12:00:00.000Z');

function storedComment(externalCommentId, publicationId, socialAccountId = account.id) {
  return {
    platform: 'youtube', socialAccountId, externalPublicationId: publicationId,
    externalCommentId, externalThreadId: `thread-${externalCommentId}`, authorDisplayName: 'Viewer',
    text: `Comment ${externalCommentId}`, createdAt: '2026-10-13T12:00:00.000Z', canReply: true,
    lastSyncedAt: '2026-10-13T12:00:00.000Z', expiresAt: '2026-11-12T12:00:00.000Z',
  };
}

function createBatch({ comments = [], accounts = [account], publicationPage = null, syncResults = [], classifyFailureFor = null, generateFailureFor = null, partialGenerateFor = null, concurrency = 8, classifyRateLimitedFor = null, rateLimitFailures = 1, evaluateHook = null, generateHook = null } = {}) {
  const calls = [];
  const accountsRepository = {
    listByTenant: async (scope) => { calls.push(['listAccounts', scope]); return accounts; },
    findById: async (scope, id) => { calls.push(['findAccount', scope, id]); return accounts.find((item) => item.id === id) ?? null; },
  };
  const commentRepository = {
    listByPublication: async (...args) => { calls.push(['listPublicationComments', ...args]); return comments.filter((item) => item.externalPublicationId === args[2]); },
    listByAccount: async (...args) => { calls.push(['listAccountComments', ...args]); return comments.filter((item) => item.socialAccountId === args[1]); },
    listByTenant: async (...args) => { calls.push(['listTenantComments', ...args]); return comments; },
    findByExternalCommentId: async (...args) => { calls.push(['findComment', ...args]); return comments.find((item) => item.externalCommentId === args[2]) ?? null; },
  };
  const publications = {
    execute: async ({ accountId: requestedAccountId, cursors }) => {
      calls.push(['listPublications', requestedAccountId, cursors]);
      const cursor = cursors?.[requestedAccountId] ?? null;
      const output = publicationPage?.(requestedAccountId, cursor) ?? { status: 'available', items: [{ externalPublicationId: 'video-1' }], nextCursor: null };
      return [{ account: { id: requestedAccountId, platform: 'youtube' }, ...output }];
    },
  };
  let syncIndex = 0;
  const sync = {
    execute: async (input) => {
      calls.push(['sync', input]);
      const result = syncResults[syncIndex++] ?? { items: [storedComment(`sync-${syncIndex}`, input.publicationId)], nextCursor: null };
      if (result instanceof Error) throw result;
      return result;
    },
  };
  const rateLimitAttempts = new Map();
  const evaluate = {
    execute: async (input) => {
      calls.push(['classify', input]);
      if (input.externalCommentId === classifyRateLimitedFor) {
        const attempts = (rateLimitAttempts.get(input.externalCommentId) ?? 0) + 1;
        rateLimitAttempts.set(input.externalCommentId, attempts);
        if (attempts <= rateLimitFailures) throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RATE_LIMITED');
      }
      if (input.externalCommentId === classifyFailureFor) throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_UNAVAILABLE');
      if (evaluateHook) await evaluateHook(input);
      return { id: `analysis-${input.externalCommentId}` };
    },
  };
  const generate = {
    execute: async (input) => {
      calls.push(['generate', input]);
      if (generateHook) await generateHook(input);
      if (input.externalCommentId === generateFailureFor) throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_UNAVAILABLE');
      const failures = input.externalCommentId === partialGenerateFor
        ? [{ language: 'en-US', errorCode: 'INTELLIGENCE_PROVIDER_RATE_LIMITED' }]
        : [];
      return {
        variants: ['pt-BR', 'en-US', 'es-ES']
          .filter((language) => !failures.some((failure) => failure.language === language))
          .map((language) => ({ id: `suggestion-${input.externalCommentId}-${language}`, payload: { language } })),
        failures,
      };
    },
  };
  const tenant = { resolveTenantId: async () => tenantId };
  const batchIds = { generate: () => '60000000-0000-4000-8000-000000000001' };
  const sleepCalls = [];
  const sleep = async (milliseconds) => { sleepCalls.push(milliseconds); };
  return {
    calls,
    sleepCalls,
    batch: new RunCommentWorkflowBatch(accountsRepository, commentRepository, publications, sync, evaluate, generate, tenant, batchIds, now, concurrency, sleep),
  };
}

test('batch classification fans out per comment and preserves a partial provider failure', async () => {
  const { batch, calls } = createBatch({ comments: [storedComment('comment-1', 'video-1'), storedComment('comment-2', 'video-1')], classifyFailureFor: 'comment-2' });

  const result = await batch.execute({ operation: 'classify', scope: 'publication', accountId, publicationId: 'video-1' });

  assert.match(result.batchOperationId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(result.results.map(({ externalCommentId, status }) => [externalCommentId, status]), [['comment-1', 'SUCCEEDED'], ['comment-2', 'FAILED']]);
  assert.equal(result.results[1].errorCode, 'INTELLIGENCE_PROVIDER_UNAVAILABLE');
  const callsToEvaluator = calls.filter(([operation]) => operation === 'classify');
  assert.equal(callsToEvaluator.length, 2);
  assert.ok(callsToEvaluator.every(([, input]) => input.batchOperationId === result.batchOperationId));
});

test('batch generation reports partial language failures without discarding successful variants', async () => {
  const comments = [storedComment('comment-1', 'video-1')];
  const { batch } = createBatch({ comments, partialGenerateFor: 'comment-1' });

  const result = await batch.execute({ operation: 'generate', scope: 'publication', accountId, publicationId: 'video-1' });

  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.results[0].status, 'PARTIAL');
  assert.deepEqual(result.results[0].failedLanguages, ['en-US']);
  assert.equal(result.results[0].artifactIds.length, 2);
});

test('batch response generation supports all synchronized comments on one platform and preserves per-comment outcomes', async () => {
  const comments = [storedComment('comment-1', 'video-1'), storedComment('comment-2', 'video-2', secondAccount.id)];
  const { batch, calls } = createBatch({ accounts: [account, secondAccount], comments, generateFailureFor: 'comment-2' });

  const result = await batch.execute({ operation: 'generate', scope: 'platform', platform: 'youtube' });

  assert.deepEqual(result.results.map(({ externalCommentId, accountId: resultAccountId, status }) => [externalCommentId, resultAccountId, status]), [
    ['comment-1', accountId, 'SUCCEEDED'], ['comment-2', secondAccountId, 'FAILED'],
  ]);
  assert.equal(result.results[1].errorCode, 'INTELLIGENCE_PROVIDER_UNAVAILABLE');
  const callsToGenerator = calls.filter(([operation]) => operation === 'generate');
  assert.equal(callsToGenerator.length, 2);
  assert.ok(callsToGenerator.every(([, input]) => !Object.hasOwn(input, 'language') && input.batchOperationId === result.batchOperationId));
  assert.deepEqual(result.results[0].artifactIds, ['suggestion-comment-1-pt-BR', 'suggestion-comment-1-en-US', 'suggestion-comment-1-es-ES']);
});

test('batch classification covers all synchronized comments on one platform', async () => {
  const comments = [storedComment('comment-1', 'video-1'), storedComment('comment-2', 'video-2', secondAccount.id)];
  const { batch, calls } = createBatch({ accounts: [account, secondAccount], comments });

  const result = await batch.execute({ operation: 'classify', scope: 'platform', platform: 'youtube' });

  assert.equal(result.results.length, 2);
  assert.ok(result.results.every((item) => item.status === 'SUCCEEDED' && item.artifactId));
  assert.deepEqual(calls.filter(([operation]) => operation === 'classify').map(([, input]) => input.externalCommentId), ['comment-1', 'comment-2']);
  assert.equal(calls.filter(([operation]) => operation === 'generate').length, 0);
});

test('batch classification accepts TikTok as the selected platform', async () => {
  const comments = [{ ...storedComment('tiktok-comment-1', 'tiktok-video-1', tiktokAccount.id), platform: 'tiktok' }];
  const { batch, calls } = createBatch({ accounts: [tiktokAccount], comments });

  const result = await batch.execute({ operation: 'classify', scope: 'platform', platform: 'tiktok' });

  assert.deepEqual(result.results.map(({ platform, externalCommentId, status }) => [platform, externalCommentId, status]), [
    ['tiktok', 'tiktok-comment-1', 'SUCCEEDED'],
  ]);
  assert.deepEqual(calls.filter(([operation]) => operation === 'classify').map(([, input]) => input.externalCommentId), ['tiktok-comment-1']);
});

test('batch generation for one video returns three language variants for each comment', async () => {
  const comments = [storedComment('comment-1', 'video-1'), storedComment('comment-2', 'video-1')];
  const { batch, calls } = createBatch({ comments });

  const result = await batch.execute({ operation: 'generate', scope: 'publication', accountId, publicationId: 'video-1' });

  assert.deepEqual(result.results.map((item) => item.artifactIds), [
    ['suggestion-comment-1-pt-BR', 'suggestion-comment-1-en-US', 'suggestion-comment-1-es-ES'],
    ['suggestion-comment-2-pt-BR', 'suggestion-comment-2-en-US', 'suggestion-comment-2-es-ES'],
  ]);
  assert.equal(calls.filter(([operation]) => operation === 'generate').length, 2);
});

test('batch sync walks all comment pages for a video and groups per-comment outcomes', async () => {
  const syncResults = [
    { items: [storedComment('comment-1', 'video-1')], nextCursor: 'comments-next' },
    { items: [storedComment('comment-2', 'video-1')], nextCursor: null },
  ];
  const { batch, calls } = createBatch({ syncResults });

  const result = await batch.execute({ operation: 'sync', scope: 'publication', accountId, publicationId: 'video-1' });

  assert.deepEqual(result.results.map(({ externalCommentId, status }) => [externalCommentId, status]), [['comment-1', 'SUCCEEDED'], ['comment-2', 'SUCCEEDED']]);
  assert.deepEqual(calls.filter(([operation]) => operation === 'sync').map(([, input]) => input.cursor), [undefined, 'comments-next']);
  assert.ok(calls.filter(([operation]) => operation === 'sync').every(([, input]) => input.batchOperationId === result.batchOperationId));
});

test('batch sync enumerates all publication pages and continues after a video-level failure', async () => {
  const publicationPage = (requestedAccountId, cursor) => requestedAccountId === accountId
    ? cursor === null
      ? { status: 'available', items: [{ externalPublicationId: 'video-1' }], nextCursor: 'videos-next' }
      : { status: 'available', items: [{ externalPublicationId: 'video-2' }], nextCursor: null }
    : { status: 'failed', errorCode: 'SOCIAL_PROVIDER_RATE_LIMITED' };
  const syncResults = [
    { items: [storedComment('comment-1', 'video-1')], nextCursor: null },
    new SocialProviderError('SOCIAL_COMMENTS_DISABLED'),
  ];
  const { batch, calls } = createBatch({ accounts: [account, secondAccount], publicationPage, syncResults });

  const result = await batch.execute({ operation: 'sync', scope: 'platform', platform: 'youtube' });

  assert.ok(calls.some(([operation, requestedAccountId, cursors]) => operation === 'listPublications' && requestedAccountId === accountId && cursors?.[accountId] === 'videos-next'));
  assert.deepEqual(result.results.map(({ publicationId, accountId: resultAccountId, status, errorCode }) => [publicationId, resultAccountId, status, errorCode]), [
    ['video-1', accountId, 'SUCCEEDED', undefined],
    ['video-2', accountId, 'UNSUPPORTED', 'SOCIAL_COMMENTS_DISABLED'],
    [undefined, secondAccountId, 'FAILED', 'SOCIAL_PROVIDER_RATE_LIMITED'],
  ]);
});

test('network-level comment sync includes all publications on the selected platform and excludes other networks', async () => {
  const { batch, calls } = createBatch({ accounts: [account, secondAccount, facebookAccount] });

  const result = await batch.execute({ operation: 'sync', scope: 'platform', platform: 'youtube' });

  assert.deepEqual([...new Set(result.results.map((item) => item.accountId))], [accountId, secondAccountId]);
  assert.equal(result.results.some((item) => item.accountId === facebookAccount.id), false);
  assert.ok(calls.some(([operation, scope]) => operation === 'listAccounts' && scope === tenantId));
});

test('batch workflow history queries all per-comment events by server-owned tenant and batch ID', async () => {
  const calls = [];
  const history = [{ id: 'event-1', batchOperationId: '60000000-0000-4000-8000-000000000001' }];
  const repository = { listByBatchOperationId: async (...args) => { calls.push(args); return history; } };
  const tenant = { resolveTenantId: async () => tenantId };
  const query = new ListCommentWorkflowBatchEvents(repository, tenant, now);

  assert.deepEqual(await query.execute({ batchOperationId: '60000000-0000-4000-8000-000000000001' }), history);
  assert.deepEqual(calls, [[tenantId, '60000000-0000-4000-8000-000000000001', '2026-10-14T12:00:00.000Z']]);
  await assert.rejects(query.execute({ batchOperationId: 'not-a-uuid' }), (error) => error instanceof CommentWorkflowAuditError && error.code === 'COMMENT_WORKFLOW_BATCH_INPUT_INVALID');
});

test('batch classification never exceeds the configured concurrency limit', async () => {
  const comments = Array.from({ length: 12 }, (_, index) => storedComment(`comment-${index}`, 'video-1'));
  let inFlight = 0;
  let peak = 0;
  const evaluateHook = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
  };
  const { batch } = createBatch({ comments, concurrency: 4, evaluateHook });

  const result = await batch.execute({ operation: 'classify', scope: 'publication', accountId, publicationId: 'video-1' });

  assert.equal(result.results.length, 12);
  assert.ok(result.results.every((item) => item.status === 'SUCCEEDED'));
  assert.equal(peak, 4);
});

test('batch classification returns results in comment order even when items finish out of order', async () => {
  const comments = [storedComment('comment-1', 'video-1'), storedComment('comment-2', 'video-1'), storedComment('comment-3', 'video-1')];
  const evaluateHook = async (input) => {
    if (input.externalCommentId === 'comment-1') await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const { batch } = createBatch({ comments, concurrency: 3, evaluateHook });

  const result = await batch.execute({ operation: 'classify', scope: 'publication', accountId, publicationId: 'video-1' });

  assert.deepEqual(result.results.map((item) => item.externalCommentId), ['comment-1', 'comment-2', 'comment-3']);
});

test('batch classification retries a rate-limited item with backoff and then succeeds', async () => {
  const comments = [storedComment('comment-1', 'video-1')];
  const { batch, calls, sleepCalls } = createBatch({ comments, classifyRateLimitedFor: 'comment-1', rateLimitFailures: 2 });

  const result = await batch.execute({ operation: 'classify', scope: 'publication', accountId, publicationId: 'video-1' });

  assert.equal(result.results[0].status, 'SUCCEEDED');
  assert.equal(result.results[0].artifactId, 'analysis-comment-1');
  assert.deepEqual(sleepCalls, [1000, 2000]);
  assert.equal(calls.filter(([operation]) => operation === 'classify').length, 3);
});

test('batch classification reports the item failed after exhausting rate-limit retries', async () => {
  const comments = [storedComment('comment-1', 'video-1')];
  const { batch, calls, sleepCalls } = createBatch({ comments, classifyRateLimitedFor: 'comment-1', rateLimitFailures: 10 });

  const result = await batch.execute({ operation: 'classify', scope: 'publication', accountId, publicationId: 'video-1' });

  assert.equal(result.results[0].status, 'FAILED');
  assert.equal(result.results[0].errorCode, 'INTELLIGENCE_PROVIDER_RATE_LIMITED');
  assert.deepEqual(sleepCalls, [1000, 2000, 4000]);
  assert.equal(calls.filter(([operation]) => operation === 'classify').length, 4);
});

test('batch generation runs comments concurrently under the same limit', async () => {
  const comments = Array.from({ length: 6 }, (_, index) => storedComment(`comment-${index}`, 'video-1'));
  let inFlight = 0;
  let peak = 0;
  const generateHook = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
  };
  const { batch } = createBatch({ comments, concurrency: 2, generateHook });

  const result = await batch.execute({ operation: 'generate', scope: 'publication', accountId, publicationId: 'video-1' });

  assert.equal(result.results.length, 6);
  assert.equal(peak, 2);
});

test('batch operation rejects unsupported send operations and invalid scope combinations', async () => {
  const { batch, calls } = createBatch();

  await assert.rejects(batch.execute({ operation: 'send', scope: 'all' }), (error) => error instanceof CommentWorkflowAuditError && error.code === 'COMMENT_WORKFLOW_BATCH_INPUT_INVALID');
  await assert.rejects(batch.execute({ operation: 'sync', scope: 'comment', accountId, externalCommentId: 'comment-1' }), (error) => error instanceof CommentWorkflowAuditError && error.code === 'COMMENT_WORKFLOW_BATCH_INPUT_INVALID');
  await assert.rejects(batch.execute({ operation: 'sync', scope: 'all' }), (error) => error instanceof CommentWorkflowAuditError && error.code === 'COMMENT_WORKFLOW_BATCH_INPUT_INVALID');
  assert.equal(calls.length, 0);
});
