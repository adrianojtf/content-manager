import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresEpisodeReviewRepository } = require('../../dist/infrastructure/persistence/postgres-episode-review.repository.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantOne = '30000000-0000-4000-8000-000000000001';
const tenantTwo = '10000000-0000-4000-8000-000000000001';
const accountOne = parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001');
const accountTwo = parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400002');
const youtubeAccountOne = parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400003');
const suggestionIds = [
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000003',
];

function accountInsert(id, tenantId, platform) {
  return [
    id,
    tenantId,
    platform,
    `${platform}-creator-${id}`,
    'Creator',
    `vault/social/${platform}/${id}`,
  ];
}

function publication(accountId, platform, externalPublicationId, overrides = {}) {
  return {
    platform,
    externalPublicationId,
    title: 'FQA-S02-E08',
    description: 'FQA season 2 episode 8',
    permalink: `https://social.example/${externalPublicationId}`,
    thumbnailUrl: null,
    publishedAt: '2026-10-10T12:00:00.000Z',
    accountId,
    ...overrides,
  };
}

function suggestion(index, overrides = {}) {
  const source = publication(accountOne, 'instagram', `external-${index}`);
  return {
    id: suggestionIds[index - 1],
    socialAccountId: source.accountId,
    sourceFingerprint: `fingerprint-${index}`,
    classification: 'EPISODE',
    confidence: 0.93,
    probabilities: { EPISODE: 0.93, NOT_EPISODE: 0.02, UNCERTAIN: 0.05 },
    evidence: {
      platform: source.platform,
      externalPublicationId: source.externalPublicationId,
      title: source.title,
      description: source.description,
    },
    provider: 'JEV',
    model: 'jev-test',
    schemaVersion: 'episode-schema-v1',
    usage: { inputTokens: 10, outputTokens: 4 },
    identity: {
      seriesName: 'FQA',
      seasonNumber: 2,
      seasonStatus: 'NUMBERED',
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
    },
    rationaleVariants: {
      'pt-BR': 'Possível episódio.',
      'en-US': 'Possible episode.',
      'es-ES': 'Posible episodio.',
    },
    rationaleFailures: {},
    publication: source,
    createdAt: '2026-10-15T12:00:00.000Z',
    ...overrides,
  };
}

async function confirmSetup(repository, tenantId, suggestionIds, seasonMode = 'SEASONAL') {
  const series = await repository.confirmSetupSeries(
    tenantId,
    suggestionIds,
    { name: 'FQA', aliases: ['Fiction Quest'], seasonMode },
    'LOCAL_PILOT_CREATOR',
    '2026-10-15T12:30:00.000Z',
  );
  if (seasonMode === 'SEASONAL') {
    await repository.confirmSetupSeason(
      tenantId,
      suggestionIds,
      2,
      'LOCAL_PILOT_CREATOR',
      '2026-10-15T12:35:00.000Z',
    );
  }
  return series;
}

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
    '025_create_episode_setup_decisions.sql',
  ]) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [tenantTwo, 'Other tenant', 'USD']);
  await pool.query(
    `INSERT INTO social_accounts (id, tenant_id, platform, external_account_id, display_name, credential_reference)
     VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)`,
    [
      ...accountInsert(accountOne, tenantOne, 'instagram'),
      ...accountInsert(accountTwo, tenantTwo, 'youtube'),
    ],
  );
  for (const [id, accountId, tenantId, platform, externalId] of [
    ['external-1', accountOne, tenantOne, 'instagram', 'external-1'],
    ['external-2-local', accountOne, tenantOne, 'instagram', 'external-2'],
    ['external-2', accountTwo, tenantTwo, 'youtube', 'external-2'],
    ['external-3', accountOne, tenantOne, 'instagram', 'external-3'],
  ]) {
    await pool.query(
      `INSERT INTO social_publications (
         tenant_id, social_account_id, platform, external_publication_id, title, description,
         permalink, thumbnail_url, published_at, last_synced_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9)`,
      [
        tenantId,
        accountId,
        platform,
        externalId,
        'FQA-S02-E08',
        'FQA season 2 episode 8',
        `https://social.example/${id}`,
        '2026-10-10T12:00:00.000Z',
        '2026-10-15T12:00:00.000Z',
      ],
    );
  }
  const database = new PostgresPersistenceAdapter(pool);
  return { pool, database, repository: new PostgresEpisodeReviewRepository(database) };
}

test('episode review persistence is tenant-scoped and changed metadata supersedes only prior pending suggestions', async () => {
  const { pool, repository } = await createRepository();
  try {
    await repository.saveSuggestion(tenantOne, suggestion(1));
    await repository.saveSuggestion(tenantOne, suggestion(1, {
      sourceFingerprint: 'fingerprint-1-changed',
      createdAt: '2026-10-15T13:00:00.000Z',
      publication: publication(accountOne, 'instagram', 'external-1', { description: 'Corrected source text' }),
    }));
    await repository.saveSuggestion(tenantOne, suggestion(2, { createdAt: '2026-10-15T13:00:00.000Z' }));

    const pending = await repository.listPendingSuggestions(tenantOne);
    assert.equal(pending.length, 2);
    assert.ok(pending.some((item) => item.sourceFingerprint === 'fingerprint-1-changed'));
    assert.equal((await repository.listPendingSuggestions(tenantTwo)).length, 0);
    assert.equal((await repository.listSeries(tenantTwo)).length, 0);

    const states = await repository.listSourceStates(tenantOne);
    assert.deepEqual(states.map(({ externalPublicationId, sourceFingerprint, linkedEpisodeId }) => ({
      externalPublicationId,
      sourceFingerprint,
      linkedEpisodeId,
    })).sort((left, right) => left.externalPublicationId.localeCompare(right.externalPublicationId)), [{
      externalPublicationId: 'external-1',
      sourceFingerprint: 'fingerprint-1-changed',
      linkedEpisodeId: null,
    }, {
      externalPublicationId: 'external-2',
      sourceFingerprint: 'fingerprint-2',
      linkedEpisodeId: null,
    }]);
    const statuses = await pool.query(
      `SELECT status, source_fingerprint FROM analytics_episode_suggestions
       WHERE tenant_id = $1 AND social_account_id = $2 AND external_publication_id = $3
       ORDER BY created_at`,
      [tenantOne, accountOne, 'external-1'],
    );
    assert.deepEqual(statuses.rows.map(({ status, source_fingerprint }) => [status, source_fingerprint]), [
      ['SUPERSEDED', 'fingerprint-1'],
      ['PENDING', 'fingerprint-1-changed'],
    ]);
  } finally {
    await pool.end();
  }
});

test('episode setup persists series and season confirmations independently of episode approval', async () => {
  const { pool, repository } = await createRepository();
  try {
    await repository.saveSuggestion(tenantOne, suggestion(1));
    await repository.saveSuggestion(tenantOne, suggestion(3));
    const pending = await repository.listPendingSuggestions(tenantOne);
    const suggestionIds = pending.map((item) => item.id);

    const series = await repository.confirmSetupSeries(
      tenantOne,
      suggestionIds,
      { name: 'FQA', aliases: ['Fiction Quest'], seasonMode: 'SEASONAL' },
      'LOCAL_PILOT_CREATOR',
      '2026-10-15T13:00:00.000Z',
    );
    const awaitingSeason = await repository.listPendingSuggestions(tenantOne);
    assert.ok(awaitingSeason.every((item) => item.setupSeriesId === series.id));
    assert.ok(awaitingSeason.every((item) => item.setupSeriesConfirmedAt === '2026-10-15T13:00:00.000Z'));
    assert.ok(awaitingSeason.every((item) => item.setupSeasonConfirmedAt === null));

    assert.equal(await repository.confirmSetupSeason(
      tenantOne,
      suggestionIds,
      2,
      'LOCAL_PILOT_CREATOR',
      '2026-10-15T13:05:00.000Z',
    ), 2);
    const readyForEpisodes = await repository.listPendingSuggestions(tenantOne);
    assert.ok(readyForEpisodes.every((item) => item.setupSeasonNumber === 2));
    assert.ok(readyForEpisodes.every((item) => item.setupSeasonConfirmedAt === '2026-10-15T13:05:00.000Z'));
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_episodes WHERE tenant_id = $1', [tenantOne])).rows[0].count, 0);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_episode_publication_links WHERE tenant_id = $1', [tenantOne])).rows[0].count, 0);
  } finally {
    await pool.end();
  }
});

test('episode approval cannot bypass the persisted series and season confirmation steps', async () => {
  const { pool, repository } = await createRepository();
  try {
    await repository.saveSuggestion(tenantOne, suggestion(1));
    const [pending] = await repository.listPendingSuggestions(tenantOne);
    await assert.rejects(repository.approveGroup(tenantOne, {
      suggestionIds: [pending.id],
      series: { name: 'FQA', aliases: [], seasonMode: 'SEASONAL' },
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      actorId: 'LOCAL_PILOT_CREATOR',
      decidedAt: '2026-10-15T13:00:00.000Z',
    }));
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_series WHERE tenant_id = $1', [tenantOne])).rows[0].count, 0);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_episodes WHERE tenant_id = $1', [tenantOne])).rows[0].count, 0);
  } finally {
    await pool.end();
  }
});

test('episode approval rejects conflicting publication identities in one selected group', async () => {
  const { pool, repository } = await createRepository();
  try {
    await repository.saveSuggestion(tenantOne, suggestion(1));
    await repository.saveSuggestion(tenantOne, suggestion(2, {
      publication: publication(accountOne, 'instagram', 'external-2', { title: 'FQA-S02-E09' }),
    }));
    const pending = await repository.listPendingSuggestions(tenantOne);
    const series = await confirmSetup(repository, tenantOne, pending.map((item) => item.id));
    await assert.rejects(repository.approveGroup(tenantOne, {
      suggestionIds: pending.map((item) => item.id),
      series: { id: series.id },
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      actorId: 'LOCAL_PILOT_CREATOR',
      decidedAt: '2026-10-15T13:00:00.000Z',
    }));
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_episodes WHERE tenant_id = $1', [tenantOne])).rows[0].count, 0);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_episode_publication_links WHERE tenant_id = $1', [tenantOne])).rows[0].count, 0);
  } finally {
    await pool.end();
  }
});

test('episode approval atomically creates a tenant Series/Episode and links only selected publication identities', async () => {
  const { pool, repository } = await createRepository();
  try {
    await repository.saveSuggestion(tenantOne, suggestion(1));
    await repository.saveSuggestion(tenantOne, suggestion(3));
    const pending = await repository.listPendingSuggestions(tenantOne);
    const series = await confirmSetup(repository, tenantOne, pending.map((item) => item.id));

    const result = await repository.approveGroup(tenantOne, {
      suggestionIds: pending.map((item) => item.id),
      series: { id: series.id },
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      actorId: 'LOCAL_PILOT_CREATOR',
      decidedAt: '2026-10-15T13:00:00.000Z',
    });

    assert.equal(result.series.name, 'FQA');
    assert.equal(result.series.seasonMode, 'SEASONAL');
    assert.equal(result.episode.seasonNumber, 2);
    assert.equal(result.episode.episodeNumber, 8);
    assert.equal(result.linkedPublicationCount, 2);
    const links = await pool.query(
      'SELECT social_account_id, external_publication_id FROM analytics_episode_publication_links WHERE tenant_id = $1 ORDER BY external_publication_id',
      [tenantOne],
    );
    assert.deepEqual(links.rows.map(({ social_account_id, external_publication_id }) => [social_account_id, external_publication_id]), [
      [accountOne, 'external-1'],
      [accountOne, 'external-3'],
    ]);
    assert.equal((await repository.listPendingSuggestions(tenantOne)).length, 0);
    assert.equal((await repository.findSeriesById(tenantTwo, result.series.id)), null);
  } finally {
    await pool.end();
  }
});

test('cross-network sources share one canonical episode and later sources link to it', async () => {
  const { pool, repository } = await createRepository();
  try {
    await pool.query(
      `INSERT INTO social_accounts (id, tenant_id, platform, external_account_id, display_name, credential_reference)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      accountInsert(youtubeAccountOne, tenantOne, 'youtube'),
    );
    await pool.query(
      `INSERT INTO social_publications (
         tenant_id, social_account_id, platform, external_publication_id, title, description,
         permalink, thumbnail_url, published_at, last_synced_at
       ) VALUES ($1, $2, 'youtube', $3, $4, $5, $6, NULL, $7, $8)`,
      [tenantOne, youtubeAccountOne, 'youtube-episode-8', 'FQA-S02-E08', 'FQA season 2 episode 8',
        'https://social.example/youtube-episode-8', '2026-10-10T12:00:00.000Z', '2026-10-15T12:00:00.000Z'],
    );
    await repository.saveSuggestion(tenantOne, suggestion(1));
    await repository.saveSuggestion(tenantOne, suggestion(2, {
      socialAccountId: youtubeAccountOne,
      publication: publication(youtubeAccountOne, 'youtube', 'youtube-episode-8'),
    }));
    let pending = await repository.listPendingSuggestions(tenantOne);
    const series = await confirmSetup(repository, tenantOne, pending.map((item) => item.id));
    const result = await repository.approveGroup(tenantOne, {
      suggestionIds: pending.map((item) => item.id),
      series: { id: series.id },
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      actorId: 'LOCAL_PILOT_CREATOR',
      decidedAt: '2026-10-15T13:00:00.000Z',
    });
    assert.equal(result.linkedPublicationCount, 2);

    await repository.saveSuggestion(tenantOne, suggestion(3));
    pending = await repository.listPendingSuggestions(tenantOne);
    await confirmSetup(repository, tenantOne, [pending[0].id]);
    const laterLink = await repository.approveGroup(tenantOne, {
      suggestionIds: [pending[0].id],
      series: { id: series.id },
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      actorId: 'LOCAL_PILOT_CREATOR',
      decidedAt: '2026-10-15T13:10:00.000Z',
    });

    assert.equal(laterLink.episode.id, result.episode.id);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_episodes WHERE tenant_id = $1', [tenantOne])).rows[0].count, 1);
    const links = await pool.query(
      `SELECT platform, external_publication_id
       FROM analytics_episode_publication_links
       WHERE tenant_id = $1 ORDER BY platform, external_publication_id`,
      [tenantOne],
    );
    assert.deepEqual(links.rows.map(({ platform, external_publication_id }) => [platform, external_publication_id]), [
      ['instagram', 'external-1'],
      ['instagram', 'external-3'],
      ['youtube', 'youtube-episode-8'],
    ]);
  } finally {
    await pool.end();
  }
});

test('non-seasonal episodes use one null-season identity and cannot be assigned a season', async () => {
  const { pool, repository } = await createRepository();
  try {
    await repository.saveSuggestion(tenantOne, suggestion(1));
    const [pending] = await repository.listPendingSuggestions(tenantOne);
    const series = await confirmSetup(repository, tenantOne, [pending.id], 'NON_SEASONAL');
    const result = await repository.approveGroup(tenantOne, {
      suggestionIds: [pending.id],
      series: { id: series.id },
      seasonNumber: null,
      episodeNumber: 8,
      episodeCode: 'FQA-E08',
      actorId: 'LOCAL_PILOT_CREATOR',
      decidedAt: '2026-10-15T13:00:00.000Z',
    });
    assert.equal(result.episode.seasonNumber, null);
    assert.equal(result.series.seasonMode, 'NON_SEASONAL');
    await repository.saveSuggestion(tenantOne, suggestion(3));
    const [anotherPending] = await repository.listPendingSuggestions(tenantOne);
    await assert.rejects(repository.approveGroup(tenantOne, {
      suggestionIds: [anotherPending.id],
      series: { id: result.series.id, seasonMode: 'NON_SEASONAL' },
      seasonNumber: 2,
      episodeNumber: 9,
      episodeCode: 'FQA-S02-E09',
      actorId: 'LOCAL_PILOT_CREATOR',
      decidedAt: '2026-10-15T14:00:00.000Z',
    }));
  } finally {
    await pool.end();
  }
});

test('episode approval rejects cross-tenant candidates and conflicting codes without partial writes', async () => {
  const { pool, repository } = await createRepository();
  try {
    await repository.saveSuggestion(tenantOne, suggestion(1));
    await repository.saveSuggestion(tenantTwo, suggestion(2, {
      id: '70000000-0000-4000-8000-000000000004',
      socialAccountId: accountTwo,
      publication: publication(accountTwo, 'youtube', 'external-2'),
    }));
    const [tenantOneSuggestion] = await repository.listPendingSuggestions(tenantOne);
    const [tenantTwoSuggestion] = await repository.listPendingSuggestions(tenantTwo);
    const command = {
      suggestionIds: [tenantOneSuggestion.id, tenantTwoSuggestion.id],
      series: { name: 'FQA', aliases: [], seasonMode: 'SEASONAL' },
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      actorId: 'LOCAL_PILOT_CREATOR',
      decidedAt: '2026-10-15T13:00:00.000Z',
    };

    await assert.rejects(repository.approveGroup(tenantOne, command));
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_series WHERE tenant_id = $1', [tenantOne])).rows[0].count, 0);
    assert.equal((await repository.listPendingSuggestions(tenantOne)).length, 1);

    const series = await confirmSetup(repository, tenantOne, [tenantOneSuggestion.id]);
    await repository.approveGroup(tenantOne, { ...command, suggestionIds: [tenantOneSuggestion.id], series: { id: series.id } });
    await repository.saveSuggestion(tenantOne, suggestion(3));
    const pending = await repository.listPendingSuggestions(tenantOne);
    await confirmSetup(repository, tenantOne, [pending[0].id], 'SEASONAL');
    await assert.rejects(repository.approveGroup(tenantOne, {
      ...command,
      suggestionIds: [pending[0].id],
      series: { id: series.id },
      episodeNumber: 9,
      episodeCode: 'FQA-S02-E08',
    }));
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_episodes WHERE tenant_id = $1', [tenantOne])).rows[0].count, 1);
    assert.equal((await repository.listPendingSuggestions(tenantOne)).length, 1);
  } finally {
    await pool.end();
  }
});

test('reject and defer decisions are auditable and never create canonical Series/Episodes', async () => {
  const { pool, repository } = await createRepository();
  try {
    await repository.saveSuggestion(tenantOne, suggestion(1));
    await repository.saveSuggestion(tenantOne, suggestion(3));
    const pending = await repository.listPendingSuggestions(tenantOne);
    const first = pending.find((item) => item.publication.externalPublicationId === 'external-1');
    const third = pending.find((item) => item.publication.externalPublicationId === 'external-3');
    assert.equal(await repository.decideSuggestions(tenantOne, [first.id], 'REJECTED', 'LOCAL_PILOT_CREATOR', '2026-10-15T13:00:00.000Z'), 1);
    assert.equal(await repository.decideSuggestions(tenantOne, [third.id], 'DEFERRED', 'LOCAL_PILOT_CREATOR', '2026-10-15T13:05:00.000Z'), 1);
    assert.equal((await repository.listPendingSuggestions(tenantOne)).length, 0);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM analytics_series WHERE tenant_id = $1', [tenantOne])).rows[0].count, 0);
    const decisions = await pool.query(
      'SELECT status, decision_actor_id, decided_at FROM analytics_episode_suggestions WHERE tenant_id = $1 ORDER BY external_publication_id',
      [tenantOne],
    );
    assert.deepEqual(decisions.rows.map(({ status, decision_actor_id }) => [status, decision_actor_id]), [
      ['REJECTED', 'LOCAL_PILOT_CREATOR'],
      ['DEFERRED', 'LOCAL_PILOT_CREATOR'],
    ]);
  } finally {
    await pool.end();
  }
});
