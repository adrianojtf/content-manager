import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  ApproveEpisodeSuggestionGroup,
  ConfirmEpisodeSetupSeasons,
  ConfirmEpisodeSetupSeries,
  DecideEpisodeSuggestions,
  GetEpisodeReview,
  RefreshEpisodeSuggestions,
  episodePublicationFingerprint,
} = require('../../dist/application/analytics/episode-review.usecases.js');
const { IntelligenceProviderError } = require('../../dist/application/social/intelligence-provider-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const publication = (externalPublicationId, overrides = {}) => ({
  tenantId,
  socialAccountId: accountId,
  platform: 'instagram',
  externalPublicationId,
  title: 'FQA-E08',
  description: 'A new episode',
  permalink: `https://social.example/${externalPublicationId}`,
  thumbnailUrl: null,
  publishedAt: '2026-10-10T12:00:00.000Z',
  lastSyncedAt: '2026-10-12T12:00:00.000Z',
  ...overrides,
});

function classifierResult() {
  return {
    classification: 'EPISODE',
    confidence: 0.92,
    probabilities: { EPISODE: 0.92, NOT_EPISODE: 0.02, UNCERTAIN: 0.06 },
    evidence: null,
    provider: 'JEV',
    model: 'jev-test-model',
    schemaVersion: 'test-schema-v1',
    usage: { inputTokens: 12, outputTokens: 4 },
  };
}

function makeHarness({
  publications = [],
  sourceStates = [],
  pendingSuggestions = [],
  series = [],
  classify = async () => classifierResult(),
  approveGroup = async (tenant, input) => ({ tenantId: tenant, ...input }),
  confirmSeries = async (tenant, ids, series) => ({ tenantId: tenant, ids, series }),
  confirmSeasons = async (tenant, ids, seasonNumber) => ids.length,
  decideSuggestions = async () => 1,
} = {}) {
  const calls = [];
  const accounts = { listByTenant: async (tenant) => { calls.push(['listAccounts', tenant]); return [{ id: accountId, platform: 'instagram' }]; } };
  const socialPublications = { listByAccount: async (tenant, id) => { calls.push(['listPublications', tenant, id]); return publications; } };
  const repository = {
    listSourceStates: async (tenant) => { calls.push(['listSourceStates', tenant]); return sourceStates; },
    saveSuggestion: async (...args) => { calls.push(['saveSuggestion', ...args]); },
    listPendingSuggestions: async (tenant) => { calls.push(['listPendingSuggestions', tenant]); return pendingSuggestions; },
    listSeries: async (tenant) => { calls.push(['listSeries', tenant]); return series; },
    findSeriesById: async (tenant, id) => { calls.push(['findSeriesById', tenant, id]); return series.find((item) => item.id === id) ?? null; },
    approveGroup: async (...args) => { calls.push(['approveGroup', ...args]); return approveGroup(...args); },
    confirmSetupSeries: async (...args) => { calls.push(['confirmSeries', ...args]); return confirmSeries(...args); },
    confirmSetupSeason: async (...args) => { calls.push(['confirmSeasons', ...args]); return confirmSeasons(...args); },
    decideSuggestions: async (...args) => { calls.push(['decideSuggestions', ...args]); return decideSuggestions(...args); },
  };
  const classifier = { classify: async (...args) => { calls.push(['classify', ...args]); return classify(...args); } };
  const localization = {
    getSupportedLocales: () => ['pt-BR', 'en-US', 'es-ES'],
    translate: (key, locale) => `${locale}:${key}`,
    formatDate: () => '',
    formatNumber: () => '',
    formatCurrency: () => '',
  };
  const tenant = { resolveTenantId: async () => tenantId };
  const now = () => Date.parse('2026-10-15T12:00:00.000Z');
  return {
    calls,
    repository,
    refresh: new RefreshEpisodeSuggestions(accounts, socialPublications, repository, classifier, localization, tenant, now),
    list: new GetEpisodeReview(repository, tenant),
    confirmSeries: new ConfirmEpisodeSetupSeries(repository, tenant, now),
    confirmSeasons: new ConfirmEpisodeSetupSeasons(repository, tenant, now),
    approve: new ApproveEpisodeSuggestionGroup(repository, tenant, now),
    decide: new DecideEpisodeSuggestions(repository, tenant, now),
  };
}

test('GetEpisodeReview starts at series confirmation and groups equivalent proposed names', async () => {
  const pending = ['FQA', 'fqa'].map((seriesName, index) => ({
    id: `series-suggestion-${index}`,
    socialAccountId: accountId,
    classification: 'EPISODE',
    confidence: 0.9,
    publication: { platform: index ? 'youtube' : 'instagram', externalPublicationId: `post-${index}`, title: seriesName, description: null },
    identity: { seriesName, seasonNumber: 2, seasonStatus: 'NUMBERED', episodeNumber: 8, episodeCode: 'FQA-S02-E08' },
    setupSeriesId: null,
    setupSeriesConfirmedAt: null,
    setupSeasonNumber: null,
    setupSeasonConfirmedAt: null,
    rationaleVariants: {},
    rationaleFailures: {},
  }));
  const harness = makeHarness({
    pendingSuggestions: pending,
    series: [{ id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'SEASONAL' }],
  });

  const result = await harness.list.execute();

  assert.equal(result.stage, 'SERIES');
  assert.equal(result.seriesProposals.length, 1);
  assert.equal(result.seriesProposals[0].suggestedName, 'FQA');
  assert.deepEqual(result.seriesProposals[0].suggestions.map((item) => item.id), ['series-suggestion-0', 'series-suggestion-1']);
  assert.equal(result.groups.length, 0);
});

test('GetEpisodeReview reparses existing imported descriptions with the current identity extractor', async () => {
  const pending = [
    {
      id: 'stale-suggestion',
      socialAccountId: accountId,
      classification: 'EPISODE',
      confidence: 0.9,
      publication: {
        platform: 'facebook',
        externalPublicationId: 'post-stale-identity',
        title: null,
        description: 'No episódio 5 de Finge que Não Me Quer, Isadora enfrenta um problema.',
      },
      identity: {
        seriesName: 'No',
        seasonNumber: null,
        seasonStatus: 'UNKNOWN',
        episodeNumber: 5,
        episodeCode: null,
      },
      setupSeriesId: null,
      setupSeriesConfirmedAt: null,
      setupSeasonNumber: null,
      setupSeasonConfirmedAt: null,
      rationaleVariants: {},
      rationaleFailures: {},
    },
  ];
  const result = await makeHarness({ pendingSuggestions: pending }).list.execute();

  assert.equal(result.stage, 'SERIES');
  assert.ok(result.seriesProposals.some((proposal) => proposal.suggestedName === 'Finge que Não Me Quer'));
});

test('GetEpisodeReview can extract a series name from a description without an episode number', async () => {
  const pending = [{
    id: 'series-only-suggestion',
    socialAccountId: accountId,
    classification: 'EPISODE',
    confidence: 0.9,
    publication: {
      platform: 'facebook',
      externalPublicationId: 'series-only-post',
      title: null,
      description: '🎬 Bastidores de Finge que me Ama 💘\nMaya e Theo interromperam as gravações.',
    },
    identity: {
      seriesName: null,
      seasonNumber: null,
      seasonStatus: 'UNKNOWN',
      episodeNumber: null,
      episodeCode: null,
    },
    setupSeriesId: null,
    setupSeriesConfirmedAt: null,
    setupSeasonNumber: null,
    setupSeasonConfirmedAt: null,
    rationaleVariants: {},
    rationaleFailures: {},
  }];

  const result = await makeHarness({ pendingSuggestions: pending }).list.execute();

  assert.equal(result.stage, 'SERIES');
  assert.equal(result.seriesProposals[0].suggestedName, 'Finge que me Ama');
});

test('Obsidiana: O Legado resolves to the Obsidiana series and proposes season 2', async () => {
  const source = {
    id: 'obsidiana-legacy-suggestion',
    socialAccountId: accountId,
    classification: 'EPISODE',
    confidence: 0.9,
    publication: {
      platform: 'facebook',
      externalPublicationId: 'obsidiana-legacy-20',
      title: null,
      description: '🐺 OBSIDIANA: O LEGADO | Ep. 20 — A Escolha',
    },
    identity: {
      seriesName: 'Obsidiana O Legado',
      seasonNumber: null,
      seasonStatus: 'UNKNOWN',
      episodeNumber: 20,
      episodeCode: null,
    },
    setupSeriesId: null,
    setupSeriesConfirmedAt: null,
    setupSeasonNumber: null,
    setupSeasonConfirmedAt: null,
    rationaleVariants: {},
    rationaleFailures: {},
  };
  const seriesStage = await makeHarness({ pendingSuggestions: [source] }).list.execute();
  const seasonStage = await makeHarness({
    pendingSuggestions: [{
      ...source,
      setupSeriesId: 'series-obsidiana',
      setupSeriesConfirmedAt: '2026-10-15T12:00:00.000Z',
    }],
    series: [{ id: 'series-obsidiana', name: 'Obsidiana', aliases: [], seasonMode: 'SEASONAL' }],
  }).list.execute();

  assert.equal(seriesStage.stage, 'SERIES');
  assert.equal(seriesStage.seriesProposals[0].suggestedName, 'Obsidiana');
  assert.equal(seasonStage.stage, 'SEASONS');
  assert.equal(seasonStage.seasonProposals[0].seriesName, 'Obsidiana');
  assert.equal(seasonStage.seasonProposals[0].proposedSeasonNumber, 2);
});

test('episode setup confirms series and seasons through tenant-scoped use cases', async () => {
  const harness = makeHarness({
    confirmSeries: async (tenant, ids, selection) => ({ tenantId: tenant, ids, series: selection }),
    confirmSeasons: async (_tenant, ids) => ids.length,
  });

  await assert.rejects(
    harness.confirmSeries.execute({
      suggestionIds: ['suggestion-1'],
      seriesId: 'series-1',
      newSeries: { name: 'FQA', aliases: [], seasonMode: 'SEASONAL' },
    }),
    (error) => error.code === 'ANALYTICS_EPISODE_INPUT_INVALID',
  );
  await assert.rejects(
    harness.confirmSeasons.execute({ suggestionIds: ['suggestion-1'], seasonNumber: 0 }),
    (error) => error.code === 'ANALYTICS_EPISODE_INPUT_INVALID',
  );

  await harness.confirmSeries.execute({
    suggestionIds: ['suggestion-1', 'suggestion-2'],
    newSeries: { name: 'FQA', aliases: ['Fiction Quest'], seasonMode: 'SEASONAL' },
  });
  await harness.confirmSeasons.execute({ suggestionIds: ['suggestion-1', 'suggestion-2'], seasonNumber: 2 });

  const seriesCall = harness.calls.find(([name]) => name === 'confirmSeries');
  assert.equal(seriesCall[1], tenantId);
  assert.deepEqual(seriesCall[2], ['suggestion-1', 'suggestion-2']);
  assert.deepEqual(seriesCall[3], {
    name: 'FQA',
    aliases: ['Fiction Quest'],
    seasonMode: 'SEASONAL',
  });
  assert.equal(seriesCall[4], 'LOCAL_PILOT_CREATOR');
  assert.equal(seriesCall[5], '2026-10-15T12:00:00.000Z');
  const seasonCall = harness.calls.find(([name]) => name === 'confirmSeasons');
  assert.equal(seasonCall[1], tenantId);
  assert.deepEqual(seasonCall[2], ['suggestion-1', 'suggestion-2']);
  assert.equal(seasonCall[3], 2);
});

test('RefreshEpisodeSuggestions classifies only changed, unlinked imported publications and saves stable evidence', async () => {
  const samePublication = publication('same');
  const linkedPublication = publication('linked');
  const newPublication = publication('new');
  const changedPublication = publication('changed', { description: 'Updated caption' });
  const harness = makeHarness({
    publications: [samePublication, linkedPublication, newPublication, changedPublication],
    sourceStates: [
      {
        socialAccountId: accountId,
        externalPublicationId: 'same',
        sourceFingerprint: episodePublicationFingerprint(samePublication),
        linkedEpisodeId: null,
      },
      {
        socialAccountId: accountId,
        externalPublicationId: 'linked',
        sourceFingerprint: 'old-metadata',
        linkedEpisodeId: 'episode-already-linked',
      },
      {
        socialAccountId: accountId,
        externalPublicationId: 'changed',
        sourceFingerprint: 'old-metadata',
        linkedEpisodeId: null,
      },
    ],
  });

  const result = await harness.refresh.execute();

  assert.deepEqual(result, { scanned: 4, classified: 2, skipped: 2, failures: [] });
  const classified = harness.calls.filter(([name]) => name === 'classify');
  assert.deepEqual(classified.map(([, input]) => input.publication.externalPublicationId), ['new', 'changed']);
  const saved = harness.calls.filter(([name]) => name === 'saveSuggestion');
  assert.deepEqual(saved.map(([, tenant, suggestion]) => [tenant, suggestion.publication.externalPublicationId]), [
    [tenantId, 'new'],
    [tenantId, 'changed'],
  ]);
  assert.equal(saved[0][2].rationaleVariants['pt-BR'], 'pt-BR:analytics.episodeSuggestion.rationale.episode');
  assert.ok(saved.every(([, , suggestion]) => suggestion.sourceFingerprint));
});

test('RefreshEpisodeSuggestions preserves per-publication provider failures and does not persist fabricated candidates', async () => {
  const failed = publication('failed');
  const successful = publication('successful');
  const harness = makeHarness({
    publications: [failed, successful],
    classify: async ({ publication: source }) => {
      if (source.externalPublicationId === 'failed') {
        throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RATE_LIMITED');
      }
      return classifierResult();
    },
  });

  const result = await harness.refresh.execute();

  assert.equal(result.classified, 1);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.failures[0], {
    socialAccountId: accountId,
    externalPublicationId: 'failed',
    code: 'INTELLIGENCE_PROVIDER_RATE_LIMITED',
  });
  assert.deepEqual(harness.calls.filter(([name]) => name === 'saveSuggestion').map(([, , suggestion]) => (
    suggestion.publication.externalPublicationId
  )), ['successful']);
});

test('GetEpisodeReview resolves unknown season only from a creator-confirmed non-seasonal series', async () => {
  const pending = ['ig-1', 'yt-1'].map((externalPublicationId, index) => ({
    id: `suggestion-${index}`,
    socialAccountId: accountId,
    sourceFingerprint: `fingerprint-${index}`,
    classification: 'EPISODE',
    confidence: 0.9,
    publication: {
      platform: index ? 'youtube' : 'instagram',
      externalPublicationId,
      title: 'FQA-E08',
      description: 'FQA Episode 8',
      permalink: null,
    },
    identity: {
      seriesName: 'FQA',
      seasonNumber: null,
      seasonStatus: 'UNKNOWN',
      episodeNumber: 8,
      episodeCode: 'FQA-E08',
    },
    setupSeriesId: 'series-1',
    setupSeriesConfirmedAt: '2026-10-15T12:00:00.000Z',
    setupSeasonNumber: null,
    setupSeasonConfirmedAt: '2026-10-15T12:00:00.000Z',
    rationaleVariants: { 'pt-BR': 'Possível episódio.' },
    rationaleFailures: {},
  }));
  const harness = makeHarness({
    pendingSuggestions: pending,
    series: [{ id: 'series-1', name: 'FQA', aliases: ['Fiction Quest'], seasonMode: 'NON_SEASONAL' }],
  });

  const result = await harness.list.execute();

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].seasonStatus, 'NON_SEASONAL');
  assert.equal(result.groups[0].episodeNumber, 8);
  assert.deepEqual(result.groups[0].publications.map((item) => item.id), ['suggestion-0', 'suggestion-1']);
  assert.deepEqual(result.series.map((item) => item.id), ['series-1']);
});

test('GetEpisodeReview groups cross-network publications that use aliases for the same confirmed series', async () => {
  const pending = ['FQA', 'Fiction Quest'].map((seriesName, index) => ({
    id: `suggestion-alias-${index}`,
    socialAccountId: accountId,
    sourceFingerprint: `fingerprint-alias-${index}`,
    classification: 'EPISODE',
    confidence: 0.9,
    publication: {
      platform: index ? 'youtube' : 'instagram',
      externalPublicationId: `post-alias-${index}`,
      title: `${seriesName} - Episode 8`,
      description: null,
      permalink: null,
    },
    identity: {
      seriesName,
      seasonNumber: null,
      seasonStatus: 'UNKNOWN',
      episodeNumber: 8,
      episodeCode: null,
    },
    setupSeriesId: 'series-1',
    setupSeriesConfirmedAt: '2026-10-15T12:00:00.000Z',
    setupSeasonNumber: null,
    setupSeasonConfirmedAt: '2026-10-15T12:00:00.000Z',
    rationaleVariants: {},
    rationaleFailures: {},
  }));
  const harness = makeHarness({
    pendingSuggestions: pending,
    series: [{ id: 'series-1', name: 'FQA', aliases: ['Fiction Quest'], seasonMode: 'NON_SEASONAL' }],
  });

  const result = await harness.list.execute();

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].seriesName, 'FQA');
  assert.deepEqual(result.groups[0].publications.map((item) => item.id), ['suggestion-alias-0', 'suggestion-alias-1']);
});

test('GetEpisodeReview can return completed series or season steps for correction', async () => {
  const pending = [{
    id: 'suggestion-correction',
    socialAccountId: accountId,
    classification: 'EPISODE',
    confidence: 0.9,
    publication: { platform: 'instagram', externalPublicationId: 'post-correction', title: 'FQA-S02-E08', description: null },
    identity: { seriesName: 'FQA', seasonNumber: 2, seasonStatus: 'NUMBERED', episodeNumber: 8, episodeCode: 'FQA-S02-E08' },
    setupSeriesId: 'series-1',
    setupSeriesConfirmedAt: '2026-10-15T12:00:00.000Z',
    setupSeasonNumber: 2,
    setupSeasonConfirmedAt: '2026-10-15T12:05:00.000Z',
    rationaleVariants: {},
    rationaleFailures: {},
  }];
  const harness = makeHarness({
    pendingSuggestions: pending,
    series: [{ id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'SEASONAL' }],
  });

  const seriesStep = await harness.list.execute('SERIES');
  const seasonStep = await harness.list.execute('SEASONS');

  assert.equal(seriesStep.stage, 'SERIES');
  assert.equal(seriesStep.seriesProposals[0].suggestions[0].setupSeriesId, 'series-1');
  assert.equal(seasonStep.stage, 'SEASONS');
  assert.equal(seasonStep.seasonProposals[0].proposedSeasonNumber, 2);
});

test('GetEpisodeReview requires season confirmation before the episode step for seasonal series', async () => {
  const pending = [{
    id: 'suggestion-1',
    socialAccountId: accountId,
    sourceFingerprint: 'fingerprint-1',
    classification: 'EPISODE',
    confidence: 0.9,
    publication: { platform: 'instagram', externalPublicationId: 'ig-1', title: 'FQA-E08', description: null },
    identity: { seriesName: 'FQA', seasonNumber: null, seasonStatus: 'UNKNOWN', episodeNumber: 8, episodeCode: 'FQA-E08' },
    setupSeriesId: 'series-1',
    setupSeriesConfirmedAt: '2026-10-15T12:00:00.000Z',
    setupSeasonNumber: null,
    setupSeasonConfirmedAt: null,
    rationaleVariants: {},
    rationaleFailures: {},
  }];
  const harness = makeHarness({
    pendingSuggestions: pending,
    series: [{ id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'SEASONAL' }],
  });

  const result = await harness.list.execute();

  assert.equal(result.stage, 'SEASONS');
  assert.equal(result.seasonProposals.length, 1);
  assert.equal(result.seasonProposals[0].proposedSeasonNumber, null);
  assert.equal(result.groups.length, 0);
});

test('GetEpisodeReview uses creator-confirmed non-seasonal mode instead of extracted season text', async () => {
  const pending = [{
    id: 'suggestion-1',
    socialAccountId: accountId,
    sourceFingerprint: 'fingerprint-1',
    classification: 'EPISODE',
    confidence: 0.9,
    publication: { platform: 'instagram', externalPublicationId: 'ig-1', title: 'FQA-S02-E08', description: null },
    identity: { seriesName: 'FQA', seasonNumber: 2, seasonStatus: 'NUMBERED', episodeNumber: 8, episodeCode: 'FQA-S02-E08' },
    setupSeriesId: 'series-1',
    setupSeriesConfirmedAt: '2026-10-15T12:00:00.000Z',
    setupSeasonNumber: null,
    setupSeasonConfirmedAt: '2026-10-15T12:00:00.000Z',
    rationaleVariants: {},
    rationaleFailures: {},
  }];
  const harness = makeHarness({
    pendingSuggestions: pending,
    series: [{ id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'NON_SEASONAL' }],
  });

  const result = await harness.list.execute();

  assert.equal(result.stage, 'EPISODES');
  assert.equal(result.unmatched[0].identity.seasonStatus, 'NON_SEASONAL');
  assert.equal(result.unmatched[0].identity.seasonNumber, null);
});

test('ApproveEpisodeSuggestionGroup validates season mode and derives tenant and actor server-side', async () => {
  const series = { id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'SEASONAL' };
  const harness = makeHarness({
    series: [series],
    approveGroup: async (tenant, input) => ({ tenantId: tenant, input }),
  });
  const invalidSeason = {
    suggestionIds: ['suggestion-1'],
    seriesId: series.id,
    episodeNumber: 8,
    seasonNumber: null,
    episodeCode: 'FQA-S02-E08',
  };

  await assert.rejects(harness.approve.execute(invalidSeason), (error) => error.code === 'ANALYTICS_EPISODE_INPUT_INVALID');
  assert.equal(harness.calls.some(([name]) => name === 'approveGroup'), false);

  const valid = await harness.approve.execute({ ...invalidSeason, seasonNumber: 2 });
  const [, savedTenant, command] = harness.calls.find(([name]) => name === 'approveGroup');
  assert.equal(savedTenant, tenantId);
  assert.equal(command.actorId, 'LOCAL_PILOT_CREATOR');
  assert.equal(command.seasonNumber, 2);
  assert.equal(valid.tenantId, tenantId);
});

test('ApproveEpisodeSuggestionGroup requires an explicit series and positive episode identity', async () => {
  const harness = makeHarness();

  await assert.rejects(
    harness.approve.execute({
      suggestionIds: ['suggestion-1'],
      newSeries: { name: 'FQA', aliases: [], seasonMode: 'NON_SEASONAL' },
      episodeNumber: 0,
      seasonNumber: null,
      episodeCode: 'FQA-E00',
    }),
    (error) => error.code === 'ANALYTICS_EPISODE_INPUT_INVALID',
  );
  await assert.rejects(
    harness.approve.execute({
      suggestionIds: ['suggestion-1'],
      seriesId: 'missing-series',
      episodeNumber: 8,
      seasonNumber: null,
      episodeCode: 'FQA-E08',
    }),
    (error) => error.code === 'ANALYTICS_EPISODE_SERIES_NOT_FOUND',
  );
  assert.equal(harness.calls.some(([name]) => name === 'approveGroup'), false);
});

test('DecideEpisodeSuggestions accepts only reject/defer decisions and scopes them to the pilot tenant', async () => {
  const harness = makeHarness({ decideSuggestions: async () => 2 });

  await assert.rejects(
    harness.decide.execute({ suggestionIds: ['suggestion-1'], decision: 'APPROVED' }),
    (error) => error.code === 'ANALYTICS_EPISODE_INPUT_INVALID',
  );
  const result = await harness.decide.execute({ suggestionIds: ['suggestion-1', 'suggestion-2'], decision: 'DEFERRED' });

  assert.equal(result.updated, 2);
  const [, tenant, ids, decision, actorId] = harness.calls.find(([name]) => name === 'decideSuggestions');
  assert.equal(tenant, tenantId);
  assert.deepEqual(ids, ['suggestion-1', 'suggestion-2']);
  assert.equal(decision, 'DEFERRED');
  assert.equal(actorId, 'LOCAL_PILOT_CREATOR');
});
