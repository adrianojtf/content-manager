import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createEpisodeReviewE2eModule } = require('../../dist-e2e/test/e2e/support/episode-review-e2e.module.js');
const { EpisodeReviewError } = require('../../dist/application/analytics/episode-review-error.js');

async function requestWithUseCases(useCases, operation) {
  const app = await NestFactory.create(createEpisodeReviewE2eModule(useCases), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await operation(await app.getUrl());
  } finally {
    await app.close();
  }
}

function useCases(overrides = {}) {
  const calls = [];
  return {
    calls,
    refresh: { execute: async () => ({ scanned: 2, classified: 1, skipped: 1, failures: [] }), ...overrides.refresh },
    getReview: { execute: async () => ({ series: [], groups: [], unmatched: [] }), ...overrides.getReview },
    confirmSeries: { execute: async (input) => { calls.push(['confirmSeries', input]); return { id: 'series-1' }; }, ...overrides.confirmSeries },
    confirmSeasons: { execute: async (input) => { calls.push(['confirmSeasons', input]); return input.suggestionIds.length; }, ...overrides.confirmSeasons },
    approve: { execute: async (input) => { calls.push(['approve', input]); return { series: { id: 'series-1' }, episode: { id: 'episode-1' }, linkedPublicationCount: 1 }; }, ...overrides.approve },
    decide: { execute: async (input) => { calls.push(['decide', input]); return { updated: input.suggestionIds.length }; }, ...overrides.decide },
  };
}

test('episode review endpoints list pending candidates and refresh only already-imported publications', async () => {
  const fixture = useCases({
    getReview: { execute: async () => ({ series: [{ id: 'series-1' }], groups: [{ episodeNumber: 8 }], unmatched: [] }) },
  });
  const result = await requestWithUseCases(fixture, async (baseUrl) => {
    const review = await fetch(`${baseUrl}/analytics/episodes/review`);
    const refresh = await fetch(`${baseUrl}/analytics/episodes/review/refresh`, { method: 'POST' });
    return { review, refresh };
  });

  assert.equal(result.review.status, 200);
  assert.deepEqual(await result.review.json(), { series: [{ id: 'series-1' }], groups: [{ episodeNumber: 8 }], unmatched: [] });
  assert.equal(result.refresh.status, 200);
  assert.deepEqual(await result.refresh.json(), { scanned: 2, classified: 1, skipped: 1, failures: [] });
});

test('episode approval whitelists review fields and never trusts a tenant or actor from the request', async () => {
  const fixture = useCases();
  const response = await requestWithUseCases(fixture, async (baseUrl) => fetch(`${baseUrl}/analytics/episodes/review/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      suggestionIds: ['suggestion-1'],
      newSeries: { name: 'FQA', aliases: [], seasonMode: 'SEASONAL' },
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      tenantId: '10000000-0000-4000-8000-000000000001',
      actorId: 'forged-actor',
    }),
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: 'ANALYTICS_EPISODE_INPUT_INVALID' });
  assert.equal(fixture.calls.length, 0);
});

test('episode approval and decisions map domain outcomes to stable HTTP results', async () => {
  const fixture = useCases();
  const response = await requestWithUseCases(fixture, async (baseUrl) => {
    const approved = await fetch(`${baseUrl}/analytics/episodes/review/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        suggestionIds: ['suggestion-1'],
        seriesId: 'series-1',
        seasonNumber: null,
        episodeNumber: 8,
      }),
    });
    const decision = await fetch(`${baseUrl}/analytics/episodes/review/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ suggestionIds: ['suggestion-2'], decision: 'DEFERRED' }),
    });
    return { approved, decision };
  });

  assert.equal(response.approved.status, 200);
  assert.equal((await response.approved.json()).linkedPublicationCount, 1);
  assert.equal(response.decision.status, 200);
  assert.deepEqual(await response.decision.json(), { updated: 1 });
  assert.deepEqual(fixture.calls.map(([action, input]) => [action, input.suggestionIds]), [
    ['approve', ['suggestion-1']],
    ['decide', ['suggestion-2']],
  ]);
});

test('series and season setup endpoints accept only creator decision fields', async () => {
  const fixture = useCases();
  const result = await requestWithUseCases(fixture, async (baseUrl) => {
    const series = await fetch(`${baseUrl}/analytics/episodes/setup/series/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        suggestionIds: ['suggestion-1', 'suggestion-2'],
        newSeries: { name: 'FQA', aliases: ['Fiction Quest'], seasonMode: 'SEASONAL' },
      }),
    });
    const season = await fetch(`${baseUrl}/analytics/episodes/setup/seasons/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ suggestionIds: ['suggestion-1', 'suggestion-2'], seasonNumber: 2 }),
    });
    const forged = await fetch(`${baseUrl}/analytics/episodes/setup/seasons/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ suggestionIds: ['suggestion-1'], seasonNumber: 2, tenantId: 'forged' }),
    });
    return { series, season, forged };
  });

  assert.equal(result.series.status, 200);
  assert.equal(result.season.status, 200);
  assert.deepEqual(await result.season.json(), 2);
  assert.equal(result.forged.status, 400);
  assert.deepEqual(await result.forged.json(), { code: 'ANALYTICS_EPISODE_INPUT_INVALID' });
  assert.deepEqual(fixture.calls.map(([action]) => action), ['confirmSeries', 'confirmSeasons']);
});

test('episode review endpoint hides unexpected provider errors and maps stable review errors', async () => {
  const unavailable = await requestWithUseCases(useCases({
    refresh: { execute: async () => { throw new Error('secret provider details'); } },
  }), async (baseUrl) => fetch(`${baseUrl}/analytics/episodes/review/refresh`, { method: 'POST' }));
  assert.equal(unavailable.status, 500);
  assert.deepEqual(await unavailable.json(), { code: 'ANALYTICS_EPISODE_REVIEW_FAILED' });

  const conflict = await requestWithUseCases(useCases({
    approve: { execute: async () => { throw new EpisodeReviewError('ANALYTICS_EPISODE_IDENTITY_CONFLICT'); } },
  }), async (baseUrl) => fetch(`${baseUrl}/analytics/episodes/review/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
        suggestionIds: ['suggestion-1'],
        seriesId: 'series-1',
        seasonNumber: null,
        episodeNumber: 8,
      }),
  }));
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { code: 'ANALYTICS_EPISODE_IDENTITY_CONFLICT' });
});
