import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildAnalyticsDashboardReport } = require('../../dist/domain/analytics/dashboard-report.js');
const now = '2026-10-15T12:00:00.000Z';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';

function publication(externalPublicationId, platform = 'instagram') {
  return { socialAccountId: accountId, externalPublicationId, platform, publishedAt: '2026-10-01T12:00:00.000Z' };
}

function observation(externalPublicationId, observedAt, metrics, platform = 'instagram') {
  return {
    episodeId: 'episode-1',
    socialAccountId: accountId,
    externalPublicationId,
    platform,
    observedAt,
    metrics: {
      views: null,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      followersGained: null,
      ...metrics,
    },
  };
}

function reportData(overrides = {}) {
  return {
    series: [{ id: 'series-1', name: 'FQA' }],
    episodes: [{
      id: 'episode-1',
      seriesId: 'series-1',
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      productionCost: { amount: '1200.00', currency: 'BRL' },
      productionTimeSeconds: 3600,
      publications: [publication('post-1')],
    }],
    socialAccountIds: [accountId],
    observations: [
      observation('post-1', '2026-07-01T12:00:00.000Z', { views: 40, likes: 4, comments: 1, shares: 0, saves: 0, followersGained: 1 }),
      observation('post-1', '2026-09-15T12:00:00.000Z', { views: 70, likes: 7, comments: 2, shares: 1, saves: 0, followersGained: 2 }),
      observation('post-1', '2026-10-07T12:00:00.000Z', { views: 100, likes: 10, comments: 2, shares: 1, saves: 1, followersGained: 4 }),
      observation('post-1', '2026-10-10T12:00:00.000Z', { views: 160, likes: 18, comments: 3, shares: 2, saves: 1, followersGained: 6 }),
    ],
    followerSnapshots: [
      { socialAccountId: accountId, observedAt: '2026-09-30T12:00:00.000Z', totalFollowers: 1000 },
      { socialAccountId: accountId, observedAt: '2026-10-15T10:00:00.000Z', totalFollowers: 1100 },
    ],
    revenue: [{ platform: 'instagram', month: '2026-10-01', amount: { amount: '1500.00', currency: 'BRL' } }],
    ...overrides,
  };
}

test('dashboard report calculates cumulative-counter deltas and identifies their time window', () => {
  const report = buildAnalyticsDashboardReport(reportData(), Date.parse(now));

  assert.equal(report.generatedAt, now);
  assert.equal(report.reportingTimezone, 'UTC');
  assert.deepEqual(report.views.last7Days, {
    value: 60,
    status: 'COMPLETE',
    start: '2026-10-08T12:00:00.000Z',
    end: now,
  });
  assert.equal(report.views.last30Days.value, 90);
  assert.equal(report.views.last90Days.value, 120);
  assert.equal(report.rankings.last30Days.episodes[0].episodeCode, 'FQA-S02-E08');
  assert.equal(report.rankings.last30Days.episodes[0].value, 90);
  assert.equal(report.conversion.value, (4 / 90) * 100);
});

test('dashboard report never treats missing history as zero or presents partial totals as complete', () => {
  const data = reportData({
    episodes: [{
      ...reportData().episodes[0],
      publications: [publication('post-1'), publication('post-2', 'tiktok')],
    }],
  });

  const report = buildAnalyticsDashboardReport(data, Date.parse(now));

  assert.deepEqual(report.views.last30Days, {
    value: null,
    status: 'INCOMPLETE',
    start: '2026-09-15T12:00:00.000Z',
    end: now,
  });
  assert.equal(report.rankings.last30Days.episodes.length, 0);
});

test('dashboard report distinguishes zero views from unavailable growth and reports monthly goals', () => {
  const data = reportData({
    observations: [
      observation('post-1', '2026-09-14T12:00:00.000Z', { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, followersGained: 0 }),
      observation('post-1', '2026-10-10T12:00:00.000Z', { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, followersGained: 0 }),
    ],
    revenue: [{ platform: 'instagram', month: '2026-10-01', amount: { amount: '1000.00', currency: 'BRL' } }],
  });

  const report = buildAnalyticsDashboardReport(data, Date.parse(now));

  assert.equal(report.views.last30Days.value, 0);
  assert.equal(report.month.growthPercent, null);
  assert.equal(report.goals.views.achieved.length, 0);
  assert.equal(report.goals.views.next, 1_000_000);
  assert.equal(report.goals.revenue.achieved[0], 1_000);
  assert.equal(report.goals.revenue.next, 3_000);
});
