import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresAnalyticsEntryRepository } = require('../../dist/infrastructure/persistence/postgres-analytics-entry.repository.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantOne = '30000000-0000-4000-8000-000000000001';
const tenantTwo = '10000000-0000-4000-8000-000000000001';
const accountOne = parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001');
const accountTwo = parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400002');
const accountThree = parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400003');

async function createRepository() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of [
    '002_create_tenant_identity.sql',
    '003_add_localization_preferences.sql',
    '005_create_social_accounts.sql',
    '007_create_social_comments.sql',
    '017_create_social_publications_and_comment_replies.sql',
    '023_create_episode_review.sql',
    '024_create_analytics_entries.sql',
  ]) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantTwo, 'Other tenant', 'USD']);
  await pool.query(
    `INSERT INTO social_accounts (id, tenant_id, platform, external_account_id, display_name, credential_reference)
     VALUES ($1, $2, 'instagram', 'ig-creator', 'Creator', 'vault/ig'), ($3, $4, 'youtube', 'yt-creator', 'Creator', 'vault/yt'), ($5, $6, 'tiktok', 'tt-creator', 'Creator', 'vault/tt')`,
    [accountOne, tenantOne, accountTwo, tenantOne, accountThree, tenantTwo],
  );
  for (const [accountId, tenantId, platform, externalId] of [
    [accountOne, tenantOne, 'instagram', 'external-1'],
    [accountOne, tenantOne, 'instagram', 'external-2'],
    [accountTwo, tenantOne, 'youtube', 'yt-1'],
  ]) {
    await pool.query(
      `INSERT INTO social_publications (
         tenant_id, social_account_id, platform, external_publication_id, title, description,
         permalink, thumbnail_url, published_at, last_synced_at
       ) VALUES ($1, $2, $3, $4, 'FQA-E08', 'Episode', NULL, NULL, '2026-10-10T12:00:00.000Z', '2026-10-15T12:00:00.000Z')`,
      [tenantId, accountId, platform, externalId],
    );
  }
  const database = new PostgresPersistenceAdapter(pool);
  return { pool, repository: new PostgresAnalyticsEntryRepository(database) };
}

async function linkPublication(pool, tenantId, episodeId, accountId, platform, externalPublicationId) {
  await pool.query(
    `INSERT INTO analytics_episode_publication_links (
       tenant_id, episode_id, social_account_id, external_publication_id, platform, linked_at, linked_by
     ) VALUES ($1, $2, $3, $4, $5, '2026-10-15T12:00:00.000Z', 'LOCAL_PILOT_CREATOR')`,
    [tenantId, episodeId, accountId, externalPublicationId, platform],
  );
}

function entryInput(overrides = {}) {
  return {
    actorId: 'LOCAL_PILOT_CREATOR',
    at: '2026-10-15T12:00:00.000Z',
    ...overrides,
  };
}

test('manual Series/Episode registration is tenant-scoped with alias, identity, and code conflicts', async () => {
  const { pool, repository } = await createRepository();
  try {
    const series = await repository.createSeries(tenantOne, entryInput({
      name: 'FQA',
      aliases: ['Fiction Quest'],
      seasonMode: 'SEASONAL',
    }));
    assert.equal(series.seasonMode, 'SEASONAL');
    await assert.rejects(
      repository.createSeries(tenantOne, entryInput({ name: 'fiction quest', aliases: [], seasonMode: 'SEASONAL' })),
      (error) => error.code === 'ANALYTICS_ENTRY_SERIES_CONFLICT',
    );
    await assert.rejects(
      repository.createSeries(tenantOne, entryInput({ name: 'Other', aliases: ['FQA'], seasonMode: 'SEASONAL' })),
      (error) => error.code === 'ANALYTICS_ENTRY_SERIES_CONFLICT',
    );

    const episode = await repository.createEpisode(tenantOne, entryInput({
      seriesId: series.id,
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      productionCost: { amount: '1200.50', currency: 'BRL' },
      productionTimeSeconds: 3600,
    }));
    assert.equal(episode.seasonNumber, 2);
    assert.deepEqual(episode.productionCost, { amount: '1200.50', currency: 'BRL' });
    assert.equal(episode.productionTimeSeconds, 3600);

    await assert.rejects(
      repository.createEpisode(tenantOne, entryInput({ seriesId: series.id, seasonNumber: null, episodeNumber: 9, episodeCode: 'FQA-E09', productionCost: null, productionTimeSeconds: null })),
      (error) => error.code === 'ANALYTICS_ENTRY_INPUT_INVALID',
    );
    await assert.rejects(
      repository.createEpisode(tenantOne, entryInput({ seriesId: series.id, seasonNumber: 2, episodeNumber: 8, episodeCode: 'FQA-S02-E08-B', productionCost: null, productionTimeSeconds: null })),
      (error) => error.code === 'ANALYTICS_ENTRY_EPISODE_CONFLICT',
    );
    await assert.rejects(
      repository.createEpisode(tenantOne, entryInput({ seriesId: series.id, seasonNumber: 3, episodeNumber: 8, episodeCode: 'FQA-S02-E08', productionCost: null, productionTimeSeconds: null })),
      (error) => error.code === 'ANALYTICS_ENTRY_CODE_CONFLICT',
    );
    await assert.rejects(
      repository.createEpisode(tenantOne, entryInput({ seriesId: '00000000-0000-4000-8000-000000000099', seasonNumber: 2, episodeNumber: 8, episodeCode: 'OTHER-E08', productionCost: null, productionTimeSeconds: null })),
      (error) => error.code === 'ANALYTICS_ENTRY_SERIES_NOT_FOUND',
    );

    assert.equal((await repository.findEpisodeById(tenantTwo, episode.id)), null);
    await assert.rejects(
      repository.updateEpisodeEconomics(tenantTwo, entryInput({ episodeId: episode.id, productionCost: null, productionTimeSeconds: null })),
      (error) => error.code === 'ANALYTICS_ENTRY_EPISODE_NOT_FOUND',
    );

    const updated = await repository.updateEpisodeEconomics(tenantOne, entryInput({
      episodeId: episode.id,
      productionCost: { amount: '950.00', currency: 'BRL' },
      productionTimeSeconds: null,
    }));
    assert.deepEqual(updated.productionCost, { amount: '950.00', currency: 'BRL' });
    assert.equal(updated.productionTimeSeconds, null);
  } finally {
    await pool.end();
  }
});

test('manual episode links one selected imported source per network atomically and removes links from picker results', async () => {
  const { pool, repository } = await createRepository();
  try {
    const series = await repository.createSeries(tenantOne, entryInput({
      name: 'FQA',
      aliases: [],
      seasonMode: 'SEASONAL',
    }));
    const availableInstagram = await repository.listUnlinkedPublications(tenantOne, 'instagram');
    assert.deepEqual(availableInstagram.map(({ externalPublicationId }) => externalPublicationId), ['external-1', 'external-2']);

    const created = await repository.createEpisodeWithPublications(tenantOne, entryInput({
      seriesId: series.id,
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      productionCost: null,
      productionTimeSeconds: null,
      publicationSelections: [
        { socialAccountId: accountOne, externalPublicationId: 'external-1' },
        { socialAccountId: accountTwo, externalPublicationId: 'yt-1' },
      ],
    }));

    assert.equal(created.episode.episodeNumber, 8);
    assert.equal(created.linkedPublicationCount, 2);
    assert.deepEqual(
      (await repository.listUnlinkedPublications(tenantOne, 'instagram')).map(({ externalPublicationId }) => externalPublicationId),
      ['external-2'],
    );
    const links = await pool.query(
      'SELECT platform, external_publication_id FROM analytics_episode_publication_links WHERE tenant_id = $1 ORDER BY platform',
      [tenantOne],
    );
    assert.deepEqual(links.rows.map(({ platform, external_publication_id }) => [platform, external_publication_id]), [
      ['instagram', 'external-1'],
      ['youtube', 'yt-1'],
    ]);
  } finally {
    await pool.end();
  }
});

test('manual episode link failures roll back episode creation and reject duplicate platform/source selection', async () => {
  const { pool, repository } = await createRepository();
  try {
    const series = await repository.createSeries(tenantOne, entryInput({
      name: 'FQA',
      aliases: [],
      seasonMode: 'SEASONAL',
    }));
    const input = {
      ...entryInput({
        seriesId: series.id,
        seasonNumber: 2,
        episodeNumber: 8,
        episodeCode: 'FQA-S02-E08',
        productionCost: null,
        productionTimeSeconds: null,
      }),
      publicationSelections: [
        { socialAccountId: accountOne, externalPublicationId: 'external-1' },
        { socialAccountId: accountOne, externalPublicationId: 'missing' },
      ],
    };
    await assert.rejects(repository.createEpisodeWithPublications(tenantOne, input));
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_episodes WHERE tenant_id = $1', [tenantOne])).rows[0].count, 0);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_episode_publication_links WHERE tenant_id = $1', [tenantOne])).rows[0].count, 0);

    await assert.rejects(repository.createEpisodeWithPublications(tenantOne, {
      ...input,
      episodeCode: 'FQA-S02-E09',
      episodeNumber: 9,
      publicationSelections: [
        { socialAccountId: accountOne, externalPublicationId: 'external-1' },
        { socialAccountId: accountOne, externalPublicationId: 'external-2' },
      ],
    }), (error) => error.code === 'ANALYTICS_ENTRY_INPUT_INVALID');
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_episodes WHERE tenant_id = $1', [tenantOne])).rows[0].count, 0);
  } finally {
    await pool.end();
  }
});

test('non-seasonal series store one null-season episode identity', async () => {
  const { pool, repository } = await createRepository();
  try {
    const series = await repository.createSeries(tenantOne, entryInput({ name: 'Daily Vlog', aliases: [], seasonMode: 'NON_SEASONAL' }));
    const episode = await repository.createEpisode(tenantOne, entryInput({
      seriesId: series.id,
      seasonNumber: null,
      episodeNumber: 12,
      episodeCode: 'DV-E12',
      productionCost: null,
      productionTimeSeconds: null,
    }));
    assert.equal(episode.seasonNumber, null);
    await assert.rejects(
      repository.createEpisode(tenantOne, entryInput({ seriesId: series.id, seasonNumber: 1, episodeNumber: 13, episodeCode: 'DV-S01-E13', productionCost: null, productionTimeSeconds: null })),
      (error) => error.code === 'ANALYTICS_ENTRY_INPUT_INVALID',
    );
    await assert.rejects(
      repository.createEpisode(tenantOne, entryInput({ seriesId: series.id, seasonNumber: null, episodeNumber: 12, episodeCode: 'DV-E12-B', productionCost: null, productionTimeSeconds: null })),
      (error) => error.code === 'ANALYTICS_ENTRY_EPISODE_CONFLICT',
    );
  } finally {
    await pool.end();
  }
});

test('performance observations require an approved TikTok/Instagram/Facebook publication link and preserve history on correction', async () => {
  const { pool, repository } = await createRepository();
  try {
    const series = await repository.createSeries(tenantOne, entryInput({ name: 'FQA', aliases: [], seasonMode: 'NON_SEASONAL' }));
    const episode = await repository.createEpisode(tenantOne, entryInput({
      seriesId: series.id, seasonNumber: null, episodeNumber: 8, episodeCode: 'FQA-E08',
      productionCost: null, productionTimeSeconds: null,
    }));
    const otherEpisode = await repository.createEpisode(tenantOne, entryInput({
      seriesId: series.id, seasonNumber: null, episodeNumber: 9, episodeCode: 'FQA-E09',
      productionCost: null, productionTimeSeconds: null,
    }));
    await linkPublication(pool, tenantOne, episode.id, accountOne, 'instagram', 'external-1');
    await linkPublication(pool, tenantOne, otherEpisode.id, accountOne, 'instagram', 'external-2');
    await linkPublication(pool, tenantOne, episode.id, accountTwo, 'youtube', 'yt-1');

    const observation = {
      episodeId: episode.id,
      socialAccountId: accountOne,
      externalPublicationId: 'external-1',
      observedAt: '2026-10-14T10:00:00.000Z',
      publishedAt: '2026-10-10T12:00:00.000Z',
      durationSeconds: 62,
      metrics: {
        views: 1000, likes: 80, comments: 12, shares: 30, saves: 5,
        reach: 800, followersGained: 40, profileVisits: 120,
        averageWatchTimeSeconds: 41.5, retentionPercent: 67.2,
      },
      metricDefinitions: { reach: 'accounts reached' },
    };
    const saved = await repository.savePerformanceObservation(tenantOne, entryInput(observation));
    assert.equal(saved.platform, 'instagram');
    assert.equal(saved.metrics.views, 1000);
    assert.equal(saved.metrics.averageWatchTimeSeconds, 41.5);
    assert.deepEqual(saved.metricDefinitions, { reach: 'accounts reached' });

    const corrected = await repository.savePerformanceObservation(tenantOne, entryInput({
      ...observation,
      at: '2026-10-16T09:00:00.000Z',
      metrics: { ...observation.metrics, views: 1500 },
    }));
    assert.equal(corrected.id, saved.id);
    assert.equal(corrected.metrics.views, 1500);
    assert.ok(corrected.updatedAt > saved.createdAt);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_performance_observations')).rows[0].count, 1);

    const second = await repository.savePerformanceObservation(tenantOne, entryInput({
      ...observation,
      observedAt: '2026-10-15T10:00:00.000Z',
      metrics: { views: null, likes: null, comments: null, shares: null, saves: null, reach: null, followersGained: null, profileVisits: null, averageWatchTimeSeconds: null, retentionPercent: null },
      metricDefinitions: null,
    }));
    assert.notEqual(second.id, saved.id);
    assert.equal(second.metrics.views, null);

    await assert.rejects(
      repository.savePerformanceObservation(tenantOne, entryInput({ ...observation, episodeId: otherEpisode.id })),
      (error) => error.code === 'ANALYTICS_ENTRY_PUBLICATION_NOT_LINKED',
    );
    await assert.rejects(
      repository.savePerformanceObservation(tenantOne, entryInput({ ...observation, externalPublicationId: 'missing' })),
      (error) => error.code === 'ANALYTICS_ENTRY_PUBLICATION_NOT_LINKED',
    );
    await assert.rejects(
      repository.savePerformanceObservation(tenantOne, entryInput({
        ...observation,
        socialAccountId: accountTwo,
        externalPublicationId: 'yt-1',
      })),
      (error) => error.code === 'ANALYTICS_ENTRY_PLATFORM_UNSUPPORTED',
    );
    await assert.rejects(
      repository.savePerformanceObservation(tenantTwo, entryInput(observation)),
      (error) => error.code === 'ANALYTICS_ENTRY_PUBLICATION_NOT_LINKED',
    );
  } finally {
    await pool.end();
  }
});

test('follower snapshots upsert per observation instant and stay tenant-scoped', async () => {
  const { pool, repository } = await createRepository();
  try {
    const snapshot = await repository.saveAccountFollowerSnapshot(tenantOne, entryInput({
      socialAccountId: accountOne,
      observedAt: '2026-10-14T00:00:00.000Z',
      totalFollowers: 15000,
    }));
    assert.equal(snapshot.totalFollowers, 15000);

    const corrected = await repository.saveAccountFollowerSnapshot(tenantOne, entryInput({
      socialAccountId: accountOne,
      observedAt: '2026-10-14T00:00:00.000Z',
      totalFollowers: 15234,
      at: '2026-10-16T09:00:00.000Z',
    }));
    assert.equal(corrected.totalFollowers, 15234);
    assert.equal(corrected.createdAt, snapshot.createdAt);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_account_follower_snapshots')).rows[0].count, 1);

    await repository.saveAccountFollowerSnapshot(tenantOne, entryInput({
      socialAccountId: accountOne,
      observedAt: '2026-10-21T00:00:00.000Z',
      totalFollowers: 15800,
    }));
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_account_follower_snapshots')).rows[0].count, 2);

    await assert.rejects(
      repository.saveAccountFollowerSnapshot(tenantTwo, entryInput({
        socialAccountId: accountOne,
        observedAt: '2026-10-14T00:00:00.000Z',
        totalFollowers: 1,
      })),
      (error) => error.code === 'ANALYTICS_ENTRY_ACCOUNT_NOT_FOUND',
    );
    await assert.rejects(
      repository.saveAccountFollowerSnapshot(tenantOne, entryInput({
        socialAccountId: accountThree,
        observedAt: '2026-10-14T00:00:00.000Z',
        totalFollowers: 1,
      })),
      (error) => error.code === 'ANALYTICS_ENTRY_ACCOUNT_NOT_FOUND',
    );
  } finally {
    await pool.end();
  }
});

test('monthly platform revenue upserts per platform/month and preserves exact BRL amounts', async () => {
  const { pool, repository } = await createRepository();
  try {
    const october = await repository.saveMonthlyPlatformRevenue(tenantOne, entryInput({
      platform: 'tiktok',
      month: '2026-10-01',
      amount: { amount: '3050.75', currency: 'BRL' },
    }));
    assert.equal(october.month, '2026-10-01');
    assert.deepEqual(october.amount, { amount: '3050.75', currency: 'BRL' });

    const corrected = await repository.saveMonthlyPlatformRevenue(tenantOne, entryInput({
      platform: 'tiktok',
      month: '2026-10-01',
      amount: { amount: '3100.00', currency: 'BRL' },
      at: '2026-10-16T09:00:00.000Z',
    }));
    assert.equal(corrected.amount.amount, '3100.00');
    assert.equal(corrected.createdAt, october.createdAt);
    assert.ok(corrected.updatedAt > october.updatedAt);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_platform_monthly_revenue')).rows[0].count, 1);

    await repository.saveMonthlyPlatformRevenue(tenantOne, entryInput({
      platform: 'instagram',
      month: '2026-10-01',
      amount: { amount: '800.10', currency: 'BRL' },
    }));
    await repository.saveMonthlyPlatformRevenue(tenantTwo, entryInput({
      platform: 'tiktok',
      month: '2026-10-01',
      amount: { amount: '10.00', currency: 'BRL' },
    }));
    const rows = await pool.query('SELECT tenant_id, platform, amount::text AS amount FROM analytics_platform_monthly_revenue ORDER BY tenant_id, platform');
    assert.equal(rows.rows.length, 3);
    assert.equal(rows.rows.filter((row) => row.tenant_id === tenantOne).length, 2);
  } finally {
    await pool.end();
  }
});
