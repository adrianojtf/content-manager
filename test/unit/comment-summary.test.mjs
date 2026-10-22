import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { GetCommentSummary } = require('../../dist/application/social/comment-summary.js');

const tenantId = '30000000-0000-4000-8000-000000000001';

function createUseCase({ platforms = [], now = '2026-10-13T15:30:00.000Z' } = {}) {
  const calls = [];
  const comments = {
    summarizeByTenant: async (resolvedTenantId, asOf, sentSince) => {
      calls.push({ resolvedTenantId, asOf, sentSince });
      return platforms;
    },
  };
  const tenant = { resolveTenantId: async () => tenantId };
  return { useCase: new GetCommentSummary(comments, tenant, () => new Date(now).getTime()), calls };
}

test('comment summary aggregates per-platform persisted counts into tenant totals', async () => {
  const platforms = [
    { platform: 'youtube', totalComments: 5, unansweredComments: 3, unevaluatedComments: 2, sentRepliesToday: 1 },
    { platform: 'instagram', totalComments: 4, unansweredComments: 1, unevaluatedComments: 4, sentRepliesToday: 2 },
  ];
  const { useCase } = createUseCase({ platforms });

  const summary = await useCase.execute();

  assert.deepEqual(summary.platforms, platforms);
  assert.deepEqual(summary.totals, { totalComments: 9, unansweredComments: 4, unevaluatedComments: 6, sentRepliesToday: 3 });
});

test('comment summary resolves the tenant through the pilot context and scopes sent counts to the current UTC day', async () => {
  const { useCase, calls } = createUseCase({ now: '2026-10-13T23:59:00.000Z' });

  await useCase.execute();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].resolvedTenantId, tenantId);
  assert.equal(calls[0].asOf, '2026-10-13T23:59:00.000Z');
  assert.equal(calls[0].sentSince, '2026-10-13T00:00:00.000Z');
});

test('comment summary returns zeroed totals when no platform has comments', async () => {
  const { useCase } = createUseCase({ platforms: [] });

  const summary = await useCase.execute();

  assert.deepEqual(summary, {
    platforms: [],
    totals: { totalComments: 0, unansweredComments: 0, unevaluatedComments: 0, sentRepliesToday: 0 },
  });
});
