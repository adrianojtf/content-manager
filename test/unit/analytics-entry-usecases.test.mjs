import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  CreateAnalyticsSeries,
  CreateAnalyticsEpisode,
  CreateManualAnalyticsEpisode,
  ListAvailableEpisodePublications,
  UpdateAnalyticsEpisodeEconomics,
  UpsertAnalyticsPerformanceObservation,
  UpsertAnalyticsFollowerSnapshot,
  UpsertAnalyticsMonthlyRevenue,
} = require('../../dist/application/analytics/analytics-entry.usecases.js');
const { AnalyticsEntryError } = require('../../dist/application/analytics/analytics-entry-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const youtubeAccountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400002';
const seriesId = '5b7f1f84-25a8-4bd8-a7df-680dc4400010';
const episodeId = '5b7f1f84-25a8-4bd8-a7df-680dc4400020';

function episodeRecord(overrides = {}) {
  return {
    id: episodeId,
    seriesId,
    seasonNumber: 2,
    episodeNumber: 8,
    episodeCode: 'FQA-S02-E08',
    productionCost: { amount: '1200.50', currency: 'BRL' },
    productionTimeSeconds: 3600,
    ...overrides,
  };
}

function makeHarness(repositoryOverrides = {}) {
  const calls = [];
  const repository = {
    createSeries: async (...args) => {
      calls.push(['createSeries', ...args]);
      return { id: seriesId, name: args[1].name, aliases: args[1].aliases, seasonMode: args[1].seasonMode };
    },
    createEpisode: async (...args) => { calls.push(['createEpisode', ...args]); return episodeRecord({ seriesId: args[1].seriesId }); },
    listUnlinkedPublications: async (...args) => {
      calls.push(['listUnlinkedPublications', ...args]);
      return [{
        platform: args[1],
        socialAccountId: accountId,
        socialAccountName: 'Creator',
        externalPublicationId: 'post-1',
      }];
    },
    createEpisodeWithPublications: async (...args) => {
      calls.push(['createEpisodeWithPublications', ...args]);
      return {
        episode: episodeRecord({ seriesId: args[1].seriesId }),
        linkedPublicationCount: args[1].publicationSelections.length,
      };
    },
    findEpisodeById: async (...args) => { calls.push(['findEpisodeById', ...args]); return episodeRecord(); },
    updateEpisodeEconomics: async (...args) => {
      calls.push(['updateEpisodeEconomics', ...args]);
      return episodeRecord({
        productionCost: args[1].productionCost,
        productionTimeSeconds: args[1].productionTimeSeconds,
      });
    },
    savePerformanceObservation: async (...args) => {
      calls.push(['savePerformanceObservation', ...args]);
      return { id: 'observation-1', ...args[1] };
    },
    saveAccountFollowerSnapshot: async (...args) => {
      calls.push(['saveAccountFollowerSnapshot', ...args]);
      return { ...args[1], createdAt: '2026-10-15T12:00:00.000Z', updatedAt: '2026-10-15T12:00:00.000Z' };
    },
    saveMonthlyPlatformRevenue: async (...args) => {
      calls.push(['saveMonthlyPlatformRevenue', ...args]);
      return { ...args[1], createdAt: '2026-10-15T12:00:00.000Z', updatedAt: '2026-10-15T12:00:00.000Z' };
    },
    ...repositoryOverrides,
  };
  const tenant = { resolveTenantId: async () => tenantId };
  const now = () => Date.parse('2026-10-15T12:00:00.000Z');
  return {
    calls,
    createSeries: new CreateAnalyticsSeries(repository, tenant, now),
    createEpisode: new CreateAnalyticsEpisode(repository, tenant, now),
    createManualEpisode: new CreateManualAnalyticsEpisode(repository, tenant, now),
    listAvailablePublications: new ListAvailableEpisodePublications(repository, tenant),
    updateEconomics: new UpdateAnalyticsEpisodeEconomics(repository, tenant, now),
    upsertObservation: new UpsertAnalyticsPerformanceObservation(repository, tenant, now),
    upsertSnapshot: new UpsertAnalyticsFollowerSnapshot(repository, tenant, now),
    upsertRevenue: new UpsertAnalyticsMonthlyRevenue(repository, tenant, now),
  };
}

function inputInvalid(execute) {
  return assert.rejects(execute, (error) => error instanceof AnalyticsEntryError && error.code === 'ANALYTICS_ENTRY_INPUT_INVALID');
}

test('CreateAnalyticsSeries normalizes aliases and derives tenant and actor server-side', async () => {
  const harness = makeHarness();

  const series = await harness.createSeries.execute({
    name: '  FQA  ',
    aliases: ['Fiction Quest', 'fqa', '', 'Fiction Quest'],
    seasonMode: 'SEASONAL',
  });

  assert.equal(series.id, seriesId);
  const [call] = harness.calls.filter(([name]) => name === 'createSeries');
  assert.equal(call[1], tenantId);
  assert.deepEqual(call[2].name, 'FQA');
  assert.deepEqual(call[2].aliases, ['Fiction Quest']);
  assert.equal(call[2].seasonMode, 'SEASONAL');
  assert.equal(call[2].actorId, 'LOCAL_PILOT_CREATOR');
  assert.equal(call[2].at, '2026-10-15T12:00:00.000Z');
});

test('CreateAnalyticsSeries rejects malformed names, aliases, and season modes', async () => {
  const harness = makeHarness();

  await inputInvalid(harness.createSeries.execute({ name: '   ', aliases: [], seasonMode: 'SEASONAL' }));
  await inputInvalid(harness.createSeries.execute({ name: 'FQA', aliases: [], seasonMode: 'WEEKLY' }));
  await inputInvalid(harness.createSeries.execute({ name: 'FQA', aliases: ['x'.repeat(201)], seasonMode: 'SEASONAL' }));
  await inputInvalid(harness.createSeries.execute({ name: 'FQA', aliases: ['ok', 42], seasonMode: 'SEASONAL' }));
  assert.equal(harness.calls.length, 0);
});

test('CreateAnalyticsEpisode validates identity, code, and economics before persistence', async () => {
  const harness = makeHarness();
  const valid = {
    seriesId,
    seasonNumber: 2,
    episodeNumber: 8,
    episodeCode: ' FQA-S02-E08 ',
    productionCost: { amount: '1200.50', currency: 'BRL' },
    productionTimeSeconds: 3600,
  };

  const episode = await harness.createEpisode.execute(valid);

  assert.equal(episode.id, episodeId);
  const [, tenant, input] = harness.calls.find(([name]) => name === 'createEpisode');
  assert.equal(tenant, tenantId);
  assert.equal(input.episodeCode, 'FQA-S02-E08');
  assert.deepEqual(input.productionCost, { amount: '1200.50', currency: 'BRL' });
  assert.equal(input.productionTimeSeconds, 3600);
  assert.equal(input.actorId, 'LOCAL_PILOT_CREATOR');
});

test('CreateAnalyticsEpisode rejects invalid numbers, codes, and malformed money without writes', async () => {
  const harness = makeHarness();
  const base = {
    seriesId,
    seasonNumber: 2,
    episodeNumber: 8,
    episodeCode: 'FQA-S02-E08',
    productionCost: null,
    productionTimeSeconds: null,
  };

  await inputInvalid(harness.createEpisode.execute({ ...base, seriesId: 'not-a-uuid' }));
  await inputInvalid(harness.createEpisode.execute({ ...base, episodeNumber: 0 }));
  await inputInvalid(harness.createEpisode.execute({ ...base, episodeNumber: 1.5 }));
  await inputInvalid(harness.createEpisode.execute({ ...base, seasonNumber: -1 }));
  await inputInvalid(harness.createEpisode.execute({ ...base, seasonNumber: Number.NaN }));
  await inputInvalid(harness.createEpisode.execute({ ...base, episodeCode: '  ' }));
  await inputInvalid(harness.createEpisode.execute({ ...base, episodeCode: 'x'.repeat(101) }));
  await inputInvalid(harness.createEpisode.execute({ ...base, productionCost: { amount: '1.234', currency: 'BRL' } }));
  await inputInvalid(harness.createEpisode.execute({ ...base, productionCost: { amount: '-5', currency: 'BRL' } }));
  await inputInvalid(harness.createEpisode.execute({ ...base, productionCost: { amount: 'abc', currency: 'BRL' } }));
  await inputInvalid(harness.createEpisode.execute({ ...base, productionCost: { amount: '99999999999999.99', currency: 'BRL' } }));
  await inputInvalid(harness.createEpisode.execute({ ...base, productionCost: { amount: '10.00', currency: 'USD' } }));
  await inputInvalid(harness.createEpisode.execute({ ...base, productionTimeSeconds: -1 }));
  await inputInvalid(harness.createEpisode.execute({ ...base, productionTimeSeconds: 1.5 }));
  assert.equal(harness.calls.length, 0);
});

test('manual episode creation validates source selections and persists with server-owned tenant and actor', async () => {
  const harness = makeHarness();
  const result = await harness.createManualEpisode.execute({
    seriesId,
    seasonNumber: 2,
    episodeNumber: 8,
    episodeCode: ' FQA-S02-E08 ',
    productionCost: null,
    productionTimeSeconds: null,
    publicationSelections: [
      { socialAccountId: accountId, externalPublicationId: 'ig-8' },
      { socialAccountId: youtubeAccountId, externalPublicationId: 'yt-8' },
    ],
  });

  assert.equal(result.episode.id, episodeId);
  assert.equal(result.linkedPublicationCount, 2);
  const [, tenant, input] = harness.calls.find(([name]) => name === 'createEpisodeWithPublications');
  assert.equal(tenant, tenantId);
  assert.equal(input.episodeCode, 'FQA-S02-E08');
  assert.deepEqual(input.publicationSelections, [
    { socialAccountId: accountId, externalPublicationId: 'ig-8' },
    { socialAccountId: youtubeAccountId, externalPublicationId: 'yt-8' },
  ]);
  assert.equal(input.actorId, 'LOCAL_PILOT_CREATOR');
});

test('manual episode creation rejects malformed, duplicate, and excessive source selections without writes', async () => {
  const harness = makeHarness();
  const base = {
    seriesId,
    seasonNumber: null,
    episodeNumber: 8,
    episodeCode: 'FQA-E08',
    productionCost: null,
    productionTimeSeconds: null,
    publicationSelections: [],
  };
  await inputInvalid(harness.createManualEpisode.execute({
    ...base,
    publicationSelections: [{ socialAccountId: 'invalid', externalPublicationId: 'post-1' }],
  }));
  await inputInvalid(harness.createManualEpisode.execute({
    ...base,
    publicationSelections: [
      { socialAccountId: accountId, externalPublicationId: 'post-1' },
      { socialAccountId: accountId, externalPublicationId: 'post-1' },
    ],
  }));
  await inputInvalid(harness.createManualEpisode.execute({
    ...base,
    publicationSelections: Array.from({ length: 5 }, (_, index) => ({
      socialAccountId: accountId,
      externalPublicationId: `post-${index}`,
    })),
  }));
  assert.equal(harness.calls.some(([name]) => name === 'createEpisodeWithPublications'), false);
});

test('manual publication picker lists imported available posts for one supported network', async () => {
  const harness = makeHarness();
  const publications = await harness.listAvailablePublications.execute({ platform: 'youtube' });

  assert.deepEqual(publications, [{
    platform: 'youtube',
    socialAccountId: accountId,
    socialAccountName: 'Creator',
    externalPublicationId: 'post-1',
  }]);
  const [, tenant, platform] = harness.calls.find(([name]) => name === 'listUnlinkedPublications');
  assert.equal(tenant, tenantId);
  assert.equal(platform, 'youtube');
  await assert.rejects(
    harness.listAvailablePublications.execute({ platform: 'unsupported' }),
    (error) => error.code === 'ANALYTICS_ENTRY_PLATFORM_UNSUPPORTED',
  );
});

test('UpdateAnalyticsEpisodeEconomics updates only existing tenant episodes and keeps null as unavailable', async () => {
  const harness = makeHarness();

  const cleared = await harness.updateEconomics.execute({
    episodeId,
    productionCost: null,
    productionTimeSeconds: null,
  });
  assert.equal(cleared.productionCost, null);
  const [, tenant, input] = harness.calls.find(([name]) => name === 'updateEpisodeEconomics');
  assert.equal(tenant, tenantId);
  assert.equal(input.episodeId, episodeId);
  assert.equal(input.actorId, 'LOCAL_PILOT_CREATOR');

  const missing = makeHarness({ findEpisodeById: async () => null });
  await assert.rejects(
    missing.updateEconomics.execute({ episodeId, productionCost: null, productionTimeSeconds: null }),
    (error) => error.code === 'ANALYTICS_ENTRY_EPISODE_NOT_FOUND',
  );
  assert.equal(missing.calls.some(([name]) => name === 'updateEpisodeEconomics'), false);
});

test('UpsertAnalyticsPerformanceObservation normalizes missing metrics to null and validates every field', async () => {
  const harness = makeHarness();
  const input = {
    episodeId,
    socialAccountId: accountId,
    externalPublicationId: 'external-1',
    observedAt: '2026-10-14T10:00:00.000Z',
    publishedAt: '2026-10-10T12:00:00.000Z',
    durationSeconds: 62,
    metrics: { views: 1000, likes: 80, averageWatchTimeSeconds: 41.5 },
    metricDefinitions: { reach: 'accounts reached' },
  };

  const saved = await harness.upsertObservation.execute(input);

  assert.equal(saved.id, 'observation-1');
  const [, tenant, persisted] = harness.calls.find(([name]) => name === 'savePerformanceObservation');
  assert.equal(tenant, tenantId);
  assert.deepEqual(persisted.metrics, {
    views: 1000,
    likes: 80,
    comments: null,
    shares: null,
    saves: null,
    reach: null,
    followersGained: null,
    profileVisits: null,
    averageWatchTimeSeconds: 41.5,
    retentionPercent: null,
  });
  assert.deepEqual(persisted.metricDefinitions, { reach: 'accounts reached' });
  assert.equal(persisted.actorId, 'LOCAL_PILOT_CREATOR');
});

test('UpsertAnalyticsPerformanceObservation rejects invalid identities, dates, durations, and metrics', async () => {
  const harness = makeHarness();
  const base = {
    episodeId,
    socialAccountId: accountId,
    externalPublicationId: 'external-1',
    observedAt: '2026-10-14T10:00:00.000Z',
    publishedAt: '2026-10-10T12:00:00.000Z',
    durationSeconds: 62,
    metrics: { views: 10 },
    metricDefinitions: null,
  };

  await inputInvalid(harness.upsertObservation.execute({ ...base, episodeId: 'bad' }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, socialAccountId: 'bad' }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, externalPublicationId: '  ' }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, observedAt: 'not-a-date' }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, publishedAt: '2026-13-01T00:00:00Z' }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, durationSeconds: -1 }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, durationSeconds: 1.5 }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, metrics: null }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, metrics: { impressions: 10 } }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, metrics: { views: -1 } }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, metrics: { views: 1.5 } }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, metrics: { likes: '10' } }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, metrics: { averageWatchTimeSeconds: -0.5 } }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, metricDefinitions: { impressions: 'x' } }));
  await inputInvalid(harness.upsertObservation.execute({ ...base, metricDefinitions: { views: 42 } }));
  assert.equal(harness.calls.length, 0);
});

test('UpsertAnalyticsFollowerSnapshot validates identity and counters and resolves the tenant account', async () => {
  const harness = makeHarness();

  const snapshot = await harness.upsertSnapshot.execute({
    socialAccountId: accountId,
    observedAt: '2026-10-14T00:00:00.000Z',
    totalFollowers: 15234,
  });
  assert.equal(snapshot.totalFollowers, 15234);
  const [, tenant, input] = harness.calls.find(([name]) => name === 'saveAccountFollowerSnapshot');
  assert.equal(tenant, tenantId);
  assert.equal(input.socialAccountId, accountId);
  assert.equal(input.actorId, 'LOCAL_PILOT_CREATOR');

  await inputInvalid(harness.upsertSnapshot.execute({ socialAccountId: 'bad', observedAt: '2026-10-14T00:00:00.000Z', totalFollowers: 10 }));
  await inputInvalid(harness.upsertSnapshot.execute({ socialAccountId: accountId, observedAt: 'invalid', totalFollowers: 10 }));
  await inputInvalid(harness.upsertSnapshot.execute({ socialAccountId: accountId, observedAt: '2026-10-14T00:00:00.000Z', totalFollowers: -1 }));
  await inputInvalid(harness.upsertSnapshot.execute({ socialAccountId: accountId, observedAt: '2026-10-14T00:00:00.000Z', totalFollowers: 1.5 }));

  const unknown = makeHarness({
    saveAccountFollowerSnapshot: async () => { throw new AnalyticsEntryError('ANALYTICS_ENTRY_ACCOUNT_NOT_FOUND'); },
  });
  await assert.rejects(
    unknown.upsertSnapshot.execute({ socialAccountId: accountId, observedAt: '2026-10-14T00:00:00.000Z', totalFollowers: 10 }),
    (error) => error.code === 'ANALYTICS_ENTRY_ACCOUNT_NOT_FOUND',
  );
});

test('UpsertAnalyticsMonthlyRevenue validates platform, YYYY-MM month, and exact BRL amounts', async () => {
  const harness = makeHarness();

  const revenue = await harness.upsertRevenue.execute({
    platform: 'tiktok',
    month: '2026-10',
    amount: { amount: '3050.75', currency: 'BRL' },
  });
  assert.equal(revenue.month, '2026-10-01');
  const [, tenant, input] = harness.calls.find(([name]) => name === 'saveMonthlyPlatformRevenue');
  assert.equal(tenant, tenantId);
  assert.equal(input.platform, 'tiktok');
  assert.equal(input.month, '2026-10-01');
  assert.deepEqual(input.amount, { amount: '3050.75', currency: 'BRL' });
  assert.equal(input.actorId, 'LOCAL_PILOT_CREATOR');

  const base = { platform: 'tiktok', month: '2026-10', amount: { amount: '10', currency: 'BRL' } };
  await inputInvalid(harness.upsertRevenue.execute({ ...base, platform: 'youtube' }));
  await inputInvalid(harness.upsertRevenue.execute({ ...base, platform: 'TikTok' }));
  await inputInvalid(harness.upsertRevenue.execute({ ...base, month: '2026-13' }));
  await inputInvalid(harness.upsertRevenue.execute({ ...base, month: '2026-1' }));
  await inputInvalid(harness.upsertRevenue.execute({ ...base, month: '10/2026' }));
  await inputInvalid(harness.upsertRevenue.execute({ ...base, amount: { amount: '1.234', currency: 'BRL' } }));
  await inputInvalid(harness.upsertRevenue.execute({ ...base, amount: { amount: '-1', currency: 'BRL' } }));
  await inputInvalid(harness.upsertRevenue.execute({ ...base, amount: { amount: '10.00', currency: 'USD' } }));
});
