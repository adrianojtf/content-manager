import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createSentRepliesReportE2eModule } = require('../../dist-e2e/test/e2e/support/sent-replies-report-e2e.module.js');
const { SentRepliesReportError } = require('../../dist/application/social/sent-replies-report-error.js');
const { ListSentRepliesReport } = require('../../dist-e2e/src/application/social/list-sent-replies-report.js');

async function runWithUseCase(useCase, request) {
  const app = await NestFactory.create(createSentRepliesReportE2eModule(useCase), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await request(await app.getUrl());
  } finally {
    await app.close();
  }
}

test('sent-replies report route forwards filters and returns the read model', async () => {
  const calls = [];
  const result = { items: [{ id: 'send-1', sentResponse: 'Thanks' }], total: 1, nextCursor: null };
  const response = await runWithUseCase({
    execute: async (filters) => { calls.push(filters); return result; },
    exportCsv: async () => '',
  }, async (baseUrl) => fetch(`${baseUrl}/social/replies/report?platform=youtube&search=great&pageSize=10`));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual({ ...calls[0] }, { platform: 'youtube', search: 'great', pageSize: '10' });
});

test('sent-replies HTTP flow runs the application query with tenant scope and returns report data', async () => {
  const calls = [];
  const tenant = { resolveTenantId: async () => '30000000-0000-4000-8000-000000000001' };
  const repository = {
    query: async (tenantId, filters) => {
      calls.push({ tenantId, filters });
      return {
        items: [{
          id: '5b7f1f84-25a8-4bd8-a7df-680dc4400010',
          sentAt: '2026-10-27T15:30:00.000Z',
          platform: 'youtube',
          socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
          accountDisplayName: 'Creator channel',
          externalAccountId: 'UC-channel-1',
          externalPublicationId: 'video-1',
          commentText: 'Great episode',
          commentAuthorDisplayName: 'Viewer',
          commentCreatedAt: '2026-10-27T14:00:00.000Z',
          sentResponse: 'Thank you!',
          jevCommentAnalysis: null,
          analysisCorrection: null,
        }],
        total: 1,
        hasMore: false,
      };
    },
  };
  const useCase = new ListSentRepliesReport(repository, tenant, () => Date.parse('2026-10-28T12:00:00.000Z'));
  const response = await runWithUseCase(useCase, async (baseUrl) => fetch(
    `${baseUrl}/social/replies/report?from=2026-10-27T00%3A00%3A00.000Z&to=2026-10-28T00%3A00%3A00.000Z`,
  ));

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.total, 1);
  assert.equal(result.items[0].sentResponse, 'Thank you!');
  assert.equal(result.items[0].jevCommentAnalysis, null);
  assert.equal(calls[0].tenantId, '30000000-0000-4000-8000-000000000001');
  assert.equal(calls[0].filters.limit, 25);
});

test('sent-replies CSV route returns a downloadable CSV with matching filters', async () => {
  const calls = [];
  const response = await runWithUseCase({
    execute: async () => ({ items: [], total: 0, nextCursor: null }),
    exportCsv: async (filters) => { calls.push(filters); return 'sent_at,comment\r\n"2026-10-27","Great"\r\n'; },
  }, async (baseUrl) => fetch(`${baseUrl}/social/replies/report.csv?platform=instagram&search=great`));

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv; charset=utf-8/i);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="sent-replies\.csv"/i);
  assert.match(await response.text(), /sent_at,comment/);
  assert.deepEqual({ ...calls[0] }, { platform: 'instagram', search: 'great' });
});

test('sent-replies report route maps invalid filters and unexpected errors', async () => {
  const invalid = await runWithUseCase({
    execute: async () => { throw new SentRepliesReportError('SENT_REPLIES_REPORT_FILTER_INVALID'); },
    exportCsv: async () => '',
  }, async (baseUrl) => fetch(`${baseUrl}/social/replies/report`));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { code: 'SENT_REPLIES_REPORT_FILTER_INVALID' });

  const unexpected = await runWithUseCase({
    execute: async () => { throw new Error('sensitive details'); },
    exportCsv: async () => '',
  }, async (baseUrl) => fetch(`${baseUrl}/social/replies/report`));
  assert.equal(unexpected.status, 500);
  assert.deepEqual(await unexpected.json(), { code: 'SENT_REPLIES_REPORT_FAILED' });
});
