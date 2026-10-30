import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ListSentRepliesReport } = require('../../dist/application/social/list-sent-replies-report.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const now = '2026-10-28T12:00:00.000Z';

function reportRow(overrides = {}) {
  return {
    id: '5b7f1f84-25a8-4bd8-a7df-680dc4400010',
    sentAt: '2026-10-27T15:30:00.000Z',
    platform: 'youtube',
    socialAccountId: accountId,
    accountDisplayName: 'Creator channel',
    externalAccountId: 'UC-channel-1',
    externalPublicationId: 'video-1',
    publicationTitle: 'A useful episode',
    publicationPermalink: 'https://youtube.com/watch?v=video-1',
    commentText: 'Great episode',
    commentAuthorDisplayName: 'Viewer',
    commentCreatedAt: '2026-10-26T10:00:00.000Z',
    sentResponse: 'Thank you!',
    jevCommentAnalysis: {
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
      schemaVersion: 'typesafe-systemone-v1',
      evaluatedAt: '2026-10-27T14:00:00.000Z',
      signals: { sentiment: { confidence: 0.93, probabilities: { POSITIVE: 0.93, NEUTRAL: 0.05, NEGATIVE: 0.02 } } },
    },
    analysisCorrection: null,
    ...overrides,
  };
}

function createUseCase({ rows = [reportRow()], total = rows.length, hasMore = false, nowValue = now } = {}) {
  const calls = [];
  const repository = {
    query: async (resolvedTenantId, filters) => {
      calls.push({ resolvedTenantId, filters });
      return { items: rows, total, hasMore };
    },
  };
  const tenant = { resolveTenantId: async () => tenantId };
  return { useCase: new ListSentRepliesReport(repository, tenant, () => Date.parse(nowValue)), calls };
}

test('report query defaults to the rolling 30-day range and tenant scope', async () => {
  const { useCase, calls } = createUseCase();

  const result = await useCase.execute();

  assert.deepEqual(calls[0], {
    resolvedTenantId: tenantId,
    filters: {
      asOf: now,
      from: '2026-09-28T12:00:00.000Z',
      to: now,
      platform: null,
      accountId: null,
      search: null,
      after: null,
      limit: 25,
    },
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].commentAuthorDisplayName, 'Viewer');
  assert.equal(result.items[0].sentResponse, 'Thank you!');
  assert.equal(result.nextCursor, null);
});

test('report query normalizes filters and returns an opaque cursor bound to the query', async () => {
  const { useCase, calls } = createUseCase({ total: 2, hasMore: true });
  const filters = {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-28T00:00:00.000Z',
    platform: 'youtube',
    accountId: accountId.toUpperCase(),
    search: '  viewer  ',
    pageSize: '1',
  };

  const first = await useCase.execute(filters);

  assert.equal(calls[0].filters.from, filters.from);
  assert.equal(calls[0].filters.to, filters.to);
  assert.equal(calls[0].filters.accountId, accountId);
  assert.equal(calls[0].filters.search, 'viewer');
  assert.equal(calls[0].filters.limit, 1);
  assert.match(first.nextCursor, /^[A-Za-z0-9_-]+$/);

  await useCase.execute({ ...filters, cursor: first.nextCursor });
  assert.deepEqual(calls[1].filters.after, {
    sentAt: reportRow().sentAt,
    id: reportRow().id,
  });

  await assert.rejects(
    useCase.execute({ ...filters, search: 'another', cursor: first.nextCursor }),
    { code: 'SENT_REPLIES_REPORT_CURSOR_INVALID' },
  );
});

test('default rolling range stays stable when a cursor is requested later', async () => {
  const calls = [];
  const repository = {
    query: async (_tenantId, filters) => {
      calls.push(filters);
      return { items: [reportRow()], total: 2, hasMore: calls.length === 1 };
    },
  };
  const times = [Date.parse(now), Date.parse(now) + 5_000];
  const tenant = { resolveTenantId: async () => tenantId };
  const useCase = new ListSentRepliesReport(repository, tenant, () => times.shift());

  const first = await useCase.execute({ pageSize: 1 });
  await useCase.execute({ cursor: first.nextCursor });

  assert.equal(calls[0].from, calls[1].from);
  assert.equal(calls[0].to, calls[1].to);
  assert.equal(calls[1].limit, 1);
});

test('report query rejects invalid, future, excessive, and malformed filters', async () => {
  const { useCase, calls } = createUseCase();

  await assert.rejects(useCase.execute({ from: 'not-a-date' }), { code: 'SENT_REPLIES_REPORT_FILTER_INVALID' });
  await assert.rejects(useCase.execute({ to: '2026-10-29T00:00:00.000Z' }), { code: 'SENT_REPLIES_REPORT_FILTER_INVALID' });
  await assert.rejects(useCase.execute({ from: '2026-09-27T11:59:59.999Z' }), { code: 'SENT_REPLIES_REPORT_FILTER_INVALID' });
  await assert.rejects(useCase.execute({ platform: 'myspace' }), { code: 'SENT_REPLIES_REPORT_FILTER_INVALID' });
  await assert.rejects(useCase.execute({ accountId: 'not-a-uuid' }), { code: 'SENT_REPLIES_REPORT_FILTER_INVALID' });
  await assert.rejects(useCase.execute({ pageSize: '101' }), { code: 'SENT_REPLIES_REPORT_FILTER_INVALID' });
  await assert.rejects(useCase.execute({ search: 'x'.repeat(201) }), { code: 'SENT_REPLIES_REPORT_FILTER_INVALID' });

  assert.equal(calls.length, 0);
});

test('CSV exports all filtered rows and keeps JEV evidence and human corrections in separate columns', async () => {
  const row = reportRow({
    commentText: '=HYPERLINK("https://example.test")',
    sentResponse: 'Resposta, com vírgula\nsegunda linha',
    analysisCorrection: {
      recordedAt: '2026-10-27T14:30:00.000Z',
      correctedFields: { sentiment: 'NEUTRAL' },
      reason: 'Creator correction',
    },
  });
  const { useCase, calls } = createUseCase({ rows: [row] });

  const csv = await useCase.exportCsv({ platform: 'youtube', search: 'episode' });

  assert.equal(calls[0].filters.limit, null);
  assert.equal(calls[0].filters.after, null);
  assert.match(csv, /sent_at,platform,account_name/);
  assert.match(csv, /publication_title,publication_permalink/);
  assert.match(csv, /A useful episode/);
  assert.match(csv, /jev_analysis_status/);
  assert.match(csv, /'=HYPERLINK\(""https:\/\/example\.test""\)/);
  assert.match(csv, /"Resposta, com vírgula\nsegunda linha"/);
  assert.match(csv, /POSITIVE/);
  assert.match(csv, /NEUTRAL/);
  assert.match(csv, /Creator correction/);
});
