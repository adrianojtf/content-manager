import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createAnalyticsEntryE2eModule } = require('../../dist-e2e/test/e2e/support/analytics-entry-e2e.module.js');
const { AnalyticsEntryError } = require('../../dist/application/analytics/analytics-entry-error.js');

async function requestWithUseCases(useCases, operation) {
  const app = await NestFactory.create(createAnalyticsEntryE2eModule(useCases), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await operation(await app.getUrl());
  } finally {
    await app.close();
  }
}

function useCases(overrides = {}) {
  const calls = [];
  const record = (name, result) => ({
    execute: async (input) => { calls.push([name, input]); return result; },
  });
  return {
    calls,
    createSeries: record('createSeries', { id: 'series-1' }),
    createEpisode: record('createEpisode', { id: 'episode-1' }),
    createManualEpisode: record('createManualEpisode', { episode: { id: 'episode-1' }, linkedPublicationCount: 2 }),
    listSeriesEpisodes: record('listSeriesEpisodes', [{
      id: 'episode-1',
      seriesId: 'series-1',
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      publications: [{
        platform: 'youtube',
        socialAccountName: 'FQA Oficial',
        externalPublicationId: 'video-8',
        title: 'FQA capítulo 8',
        description: 'A equipe encontra uma pista.',
        permalink: 'https://video.example/fqa-8',
        thumbnailUrl: 'https://media.example/fqa-8.jpg',
        publishedAt: '2026-10-10T12:00:00.000Z',
      }],
    }]),
    listAvailableEpisodePublications: record('listAvailableEpisodePublications', [{
      platform: 'instagram',
      socialAccountId: 'account-1',
      externalPublicationId: 'post-1',
      title: 'FQA-E08',
      thumbnailUrl: 'https://media.example/post-1.jpg',
    }]),
    updateEpisode: record('updateEpisode', { id: 'episode-1', episodeCode: 'FQA-S03-E12' }),
    updateEpisodePublication: record('updateEpisodePublication', { replaced: true }),
    updateEconomics: record('updateEconomics', { id: 'episode-1', productionCost: null, productionTimeSeconds: null }),
    upsertObservation: record('upsertObservation', { id: 'observation-1' }),
    upsertSnapshot: record('upsertSnapshot', { totalFollowers: 15000 }),
    upsertRevenue: record('upsertRevenue', { month: '2026-10-01' }),
    dashboard: record('dashboard', {
      generatedAt: '2026-10-15T12:00:00.000Z',
      reportingTimezone: 'UTC',
      seriesCount: 1,
      episodeCount: 2,
    }),
    ...overrides,
  };
}

test('dashboard endpoint returns the reporting use case result without accepting tenant input', async () => {
  const fixture = useCases();
  const response = await requestWithUseCases(fixture, (baseUrl) => (
    send(baseUrl, 'GET', '/analytics/dashboard?tenantId=another-tenant')
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    generatedAt: '2026-10-15T12:00:00.000Z',
    reportingTimezone: 'UTC',
    seriesCount: 1,
    episodeCount: 2,
  });
  assert.deepEqual(fixture.calls, [['dashboard', undefined]]);
});

async function send(baseUrl, method, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('Series detail endpoint returns tenant-scoped episodes through the application use case', async () => {
  const fixture = useCases();
  const response = await requestWithUseCases(fixture, (baseUrl) => (
    send(baseUrl, 'GET', '/analytics/series/5b7f1f84-25a8-4bd8-a7df-680dc4400010/episodes')
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{
    id: 'episode-1',
    seriesId: 'series-1',
    seasonNumber: 2,
    episodeNumber: 8,
    episodeCode: 'FQA-S02-E08',
    publications: [{
      platform: 'youtube',
      socialAccountName: 'FQA Oficial',
      externalPublicationId: 'video-8',
      title: 'FQA capítulo 8',
      description: 'A equipe encontra uma pista.',
      permalink: 'https://video.example/fqa-8',
      thumbnailUrl: 'https://media.example/fqa-8.jpg',
      publishedAt: '2026-10-10T12:00:00.000Z',
    }],
  }]);
  assert.deepEqual(fixture.calls, [['listSeriesEpisodes', '5b7f1f84-25a8-4bd8-a7df-680dc4400010']]);
});

test('manual analytics entry endpoints accept whitelisted bodies and never trust tenant or actor fields', async () => {
  const fixture = useCases();
  const result = await requestWithUseCases(fixture, async (baseUrl) => {
    const series = await send(baseUrl, 'POST', '/analytics/series', {
      name: 'FQA', aliases: ['Fiction Quest'], seasonMode: 'SEASONAL',
    });
    const episode = await send(baseUrl, 'POST', '/analytics/episodes', {
      seriesId: '5b7f1f84-25a8-4bd8-a7df-680dc4400010',
      seasonNumber: 2,
      episodeNumber: 8,
      productionCost: { amount: '1200.50', currency: 'BRL' },
      productionTimeSeconds: 3600,
    });
    const corrected = await send(baseUrl, 'PUT', '/analytics/episodes/5b7f1f84-25a8-4bd8-a7df-680dc4400020', {
      seriesId: '5b7f1f84-25a8-4bd8-a7df-680dc4400010',
      seasonNumber: 3,
      episodeNumber: 12,
      episodeCode: 'FQA-S03-E12',
      productionCost: { amount: '900.00', currency: 'BRL' },
      productionTimeSeconds: 1800,
    });
    const publication = await send(baseUrl, 'PUT', '/analytics/episodes/5b7f1f84-25a8-4bd8-a7df-680dc4400020/publications', {
      socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
      externalPublicationId: 'external-1',
      next: { socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001', externalPublicationId: 'external-2' },
    });
    const movedPublication = await send(baseUrl, 'PUT', '/analytics/episodes/5b7f1f84-25a8-4bd8-a7df-680dc4400020/publications', {
      socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
      externalPublicationId: 'external-1',
      moveTo: { seasonNumber: 1, episodeNumber: 7 },
    });
    const economics = await send(baseUrl, 'PUT', '/analytics/episodes/5b7f1f84-25a8-4bd8-a7df-680dc4400020/economics', {
      productionCost: null,
      productionTimeSeconds: 1200,
    });
    const observation = await send(baseUrl, 'PUT', '/analytics/observations/performance', {
      episodeId: '5b7f1f84-25a8-4bd8-a7df-680dc4400020',
      socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
      externalPublicationId: 'external-1',
      observedAt: '2026-10-14T10:00:00.000Z',
      publishedAt: '2026-10-10T12:00:00.000Z',
      durationSeconds: 62,
      metrics: { views: 1000, likes: 80 },
      metricDefinitions: null,
    });
    const snapshot = await send(baseUrl, 'PUT', '/analytics/audience/snapshots', {
      socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
      observedAt: '2026-10-14T00:00:00.000Z',
      totalFollowers: 15000,
    });
    const revenue = await send(baseUrl, 'PUT', '/analytics/revenue/monthly', {
      platform: 'tiktok',
      month: '2026-10',
      amount: { amount: '3050.75', currency: 'BRL' },
    });
    return { series, episode, corrected, publication, movedPublication, economics, observation, snapshot, revenue };
  });

  assert.equal(result.series.status, 201);
  assert.deepEqual(await result.series.json(), { id: 'series-1' });
  assert.equal(result.episode.status, 201);
  assert.equal(result.corrected.status, 200);
  assert.equal(result.publication.status, 200);
  assert.equal(result.movedPublication.status, 200);
  assert.equal(result.economics.status, 200);
  assert.equal(result.observation.status, 200);
  assert.equal(result.snapshot.status, 200);
  assert.equal(result.revenue.status, 200);
  assert.deepEqual(fixture.calls.map(([name]) => name), [
    'createSeries', 'createEpisode', 'updateEpisode', 'updateEpisodePublication', 'updateEpisodePublication', 'updateEconomics', 'upsertObservation', 'upsertSnapshot', 'upsertRevenue',
  ]);
  const [, correctionInput] = fixture.calls.find(([name]) => name === 'updateEpisode');
  assert.equal(correctionInput.episodeId, '5b7f1f84-25a8-4bd8-a7df-680dc4400020');
  assert.equal(correctionInput.episodeNumber, 12);
  const [, economicsInput] = fixture.calls.find(([name]) => name === 'updateEconomics');
  assert.equal(economicsInput.episodeId, '5b7f1f84-25a8-4bd8-a7df-680dc4400020');
});

test('analytics entry endpoints reject extra, tenant, or actor fields before reaching use cases', async () => {
  const fixture = useCases();
  const responses = await requestWithUseCases(fixture, async (baseUrl) => Promise.all([
    send(baseUrl, 'POST', '/analytics/series', { name: 'FQA', aliases: [], seasonMode: 'SEASONAL', tenantId: 'x' }),
    send(baseUrl, 'POST', '/analytics/episodes', {
      seriesId: '5b7f1f84-25a8-4bd8-a7df-680dc4400010', seasonNumber: null, episodeNumber: 1,
      episodeCode: 'FQA-E01', actorId: 'forged',
    }),
    send(baseUrl, 'PUT', '/analytics/observations/performance', {
      episodeId: '5b7f1f84-25a8-4bd8-a7df-680dc4400020',
      socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
      externalPublicationId: 'external-1',
      observedAt: '2026-10-14T10:00:00.000Z',
      publishedAt: '2026-10-10T12:00:00.000Z',
      durationSeconds: 62,
      metrics: {},
      platform: 'youtube',
    }),
    send(baseUrl, 'PUT', '/analytics/audience/snapshots', {
      socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
      observedAt: '2026-10-14T00:00:00.000Z',
      totalFollowers: 15000,
      tenant: 'forged',
    }),
    send(baseUrl, 'PUT', '/analytics/revenue/monthly', {
      platform: 'tiktok', month: '2026-10', amount: { amount: '10.00', currency: 'BRL' }, actor: 'forged',
    }),
    send(baseUrl, 'PUT', '/analytics/episodes/5b7f1f84-25a8-4bd8-a7df-680dc4400020/economics', { productionCost: '100' }),
    send(baseUrl, 'PUT', '/analytics/episodes/5b7f1f84-25a8-4bd8-a7df-680dc4400020', {
      seriesId: '5b7f1f84-25a8-4bd8-a7df-680dc4400010', seasonNumber: 1, episodeNumber: 1,
      episodeCode: 'FQA-S01-E01', tenantId: 'forged',
    }),
    send(baseUrl, 'PUT', '/analytics/episodes/5b7f1f84-25a8-4bd8-a7df-680dc4400020/publications', {
      socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
      externalPublicationId: 'external-1',
      next: { socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001', externalPublicationId: 'external-2', tenantId: 'forged' },
    }),
  ]));

  for (const response of responses) {
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { code: 'ANALYTICS_ENTRY_INPUT_INVALID' });
  }
  assert.equal(fixture.calls.length, 0);
});

test('manual episode endpoints list local publications and atomically accept selected source identities', async () => {
  const fixture = useCases();
  const result = await requestWithUseCases(fixture, async (baseUrl) => {
    const available = await send(baseUrl, 'GET', '/analytics/episodes/manual/publications?platform=instagram');
    const created = await send(baseUrl, 'POST', '/analytics/episodes/manual', {
      seriesId: 'series-1',
      seasonNumber: 2,
      episodeNumber: 8,
      productionCost: null,
      productionTimeSeconds: null,
      publicationSelections: [
        { socialAccountId: 'account-1', externalPublicationId: 'post-1' },
        { socialAccountId: 'account-2', externalPublicationId: 'youtube-1' },
      ],
    });
    const forged = await send(baseUrl, 'POST', '/analytics/episodes/manual', {
      seriesId: 'series-1',
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      productionCost: null,
      productionTimeSeconds: null,
      publicationSelections: [],
      tenantId: 'forged',
    });
    return { available, created, forged };
  });

  assert.equal(result.available.status, 200);
  assert.deepEqual(await result.available.json(), [{
    platform: 'instagram',
    socialAccountId: 'account-1',
    externalPublicationId: 'post-1',
    title: 'FQA-E08',
    thumbnailUrl: 'https://media.example/post-1.jpg',
  }]);
  assert.equal(result.created.status, 201);
  assert.equal((await result.created.json()).linkedPublicationCount, 2);
  assert.equal(result.forged.status, 400);
  assert.deepEqual(fixture.calls.map(([name]) => name), ['listAvailableEpisodePublications', 'createManualEpisode']);
});

test('analytics entry endpoints map stable domain errors and hide unexpected failures', async () => {
  const cases = [
    ['ANALYTICS_ENTRY_SERIES_NOT_FOUND', 404],
    ['ANALYTICS_ENTRY_EPISODE_NOT_FOUND', 404],
    ['ANALYTICS_ENTRY_ACCOUNT_NOT_FOUND', 404],
    ['ANALYTICS_ENTRY_PUBLICATION_NOT_LINKED', 404],
    ['ANALYTICS_ENTRY_PLATFORM_UNSUPPORTED', 400],
    ['ANALYTICS_ENTRY_SERIES_CONFLICT', 409],
    ['ANALYTICS_ENTRY_EPISODE_CONFLICT', 409],
    ['ANALYTICS_ENTRY_CODE_CONFLICT', 409],
  ];
  for (const [code, status] of cases) {
    const fixture = useCases({
      createSeries: { execute: async () => { throw new AnalyticsEntryError(code); } },
    });
    const response = await requestWithUseCases(fixture, async (baseUrl) => send(baseUrl, 'POST', '/analytics/series', {
      name: 'FQA', aliases: [], seasonMode: 'SEASONAL',
    }));
    assert.equal(response.status, status, code);
    assert.deepEqual(await response.json(), { code });
  }

  const unexpected = await requestWithUseCases(useCases({
    upsertRevenue: { execute: async () => { throw new Error('sensitive persistence details'); } },
  }), async (baseUrl) => send(baseUrl, 'PUT', '/analytics/revenue/monthly', {
    platform: 'tiktok', month: '2026-10', amount: { amount: '10.00', currency: 'BRL' },
  }));
  assert.equal(unexpected.status, 500);
  assert.deepEqual(await unexpected.json(), { code: 'ANALYTICS_ENTRY_SAVE_FAILED' });
});
