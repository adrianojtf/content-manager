import { randomUUID } from 'node:crypto';
import type {
  AnalyticsEntryRepository,
  AnalyticsEpisodeRecord,
  AnalyticsMoneyAmount,
  AccountFollowerSnapshotRecord,
  MonthlyPlatformRevenueRecord,
  PerformanceMetricValues,
  PerformanceObservationRecord,
  AvailableEpisodePublication,
  CreateEpisodeWithPublicationsInput,
  ManualEpisodeCreationResult,
} from '../../application/ports/analytics-entry.repository.port';
import type {
  EpisodeReviewSeasonMode,
  EpisodeReviewSeries,
} from '../../application/ports/episode-review.repository.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';
import { parseSocialAccountId, type SocialAccountId } from '../../domain/social/social-account-id';
import type { SocialPlatform } from '../../domain/social/social-account';
import { AnalyticsEntryError } from '../../application/analytics/analytics-entry-error';
import { normalizeSeriesIdentity } from '../../domain/analytics/episode-identity';

interface SeriesRow extends Record<string, unknown> {
  id: string;
  name: string;
  aliases_json: string;
  season_mode: string;
}

interface EpisodeRow extends Record<string, unknown> {
  id: string;
  series_id: string;
  season_number: number | null;
  episode_number: number;
  episode_code: string;
  production_cost_amount: string | number | null;
  production_time_seconds: number | null;
}

interface ObservationRow extends Record<string, unknown> {
  id: string;
  episode_id: string;
  social_account_id: string;
  external_publication_id: string;
  platform: string;
  observed_at: Date | string;
  published_at: Date | string;
  duration_seconds: number;
  views: string | number | null;
  likes: string | number | null;
  comments: string | number | null;
  shares: string | number | null;
  saves: string | number | null;
  reach: string | number | null;
  followers_gained: string | number | null;
  profile_visits: string | number | null;
  average_watch_time_seconds: string | number | null;
  retention_percent: string | number | null;
  metric_definitions_json: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SnapshotRow extends Record<string, unknown> {
  social_account_id: string;
  observed_at: Date | string;
  total_followers: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RevenueRow extends Record<string, unknown> {
  platform: string;
  month: Date | string;
  amount: string | number;
  currency: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const performancePlatforms = ['tiktok', 'instagram', 'facebook'] as const;
const counterMetrics = [
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'reach',
  'followersGained',
  'profileVisits',
] as const;
const durationMetrics = ['averageWatchTimeSeconds', 'retentionPercent'] as const;
const moneyAmountPattern = /^\d{1,12}(\.\d{1,2})?$/;
const monthDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export class PostgresAnalyticsEntryRepository implements AnalyticsEntryRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async listUnlinkedPublications(
    tenantId: string,
    platform: SocialPlatform,
  ): Promise<readonly AvailableEpisodePublication[]> {
    const { rows } = await this.database.query<Record<string, unknown> & {
      social_account_id: string;
      social_account_name: string | null;
      platform: string;
      external_publication_id: string;
      title: string | null;
      description: string | null;
      thumbnail_url: string | null;
      permalink: string | null;
      published_at: Date | string | null;
    }>(
      `SELECT publication.social_account_id, account.display_name AS social_account_name,
              publication.platform, publication.external_publication_id, publication.title,
              publication.description, publication.thumbnail_url, publication.permalink,
              publication.published_at
       FROM social_publications AS publication
       JOIN social_accounts AS account
         ON account.tenant_id = publication.tenant_id AND account.id = publication.social_account_id
       LEFT JOIN analytics_episode_publication_links AS linked
         ON linked.tenant_id = publication.tenant_id
        AND linked.social_account_id = publication.social_account_id
        AND linked.external_publication_id = publication.external_publication_id
       WHERE publication.tenant_id = $1 AND publication.platform = $2
         AND linked.external_publication_id IS NULL
       ORDER BY publication.published_at DESC NULLS LAST,
                publication.social_account_id, publication.external_publication_id`,
      [tenantId, platform],
    );
    return rows.map((row) => ({
      platform: row.platform as SocialPlatform,
      socialAccountId: parseSocialAccountId(row.social_account_id),
      socialAccountName: row.social_account_name,
      externalPublicationId: row.external_publication_id,
      title: row.title,
      description: row.description,
      thumbnailUrl: row.thumbnail_url,
      permalink: row.permalink,
      publishedAt: this.toIsoString(row.published_at),
    }));
  }

  async createSeries(
    tenantId: string,
    input: Parameters<AnalyticsEntryRepository['createSeries']>[1],
  ): Promise<EpisodeReviewSeries> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const normalizedName = name ? normalizeSeriesIdentity(name) : '';
    if (!name || !normalizedName
      || (input.seasonMode !== 'SEASONAL' && input.seasonMode !== 'NON_SEASONAL')
      || !Array.isArray(input.aliases)
      || input.aliases.some((alias) => typeof alias !== 'string')
      || !Number.isFinite(Date.parse(input.at))) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
    }
    const aliases = [...new Set(input.aliases.map((alias) => alias.trim()).filter(Boolean))];
    const { rows } = await this.database.query<SeriesRow>(
      'SELECT id, name, aliases_json, season_mode FROM analytics_series WHERE tenant_id = $1',
      [tenantId],
    );
    const claimed = new Set([normalizedName, ...aliases.map(normalizeSeriesIdentity)]);
    for (const row of rows) {
      const candidates = [row.name, ...this.parseJson<string[]>(row.aliases_json)].map(normalizeSeriesIdentity);
      if (candidates.some((candidate) => claimed.has(candidate))) {
        throw new AnalyticsEntryError('ANALYTICS_ENTRY_SERIES_CONFLICT');
      }
    }
    const id = randomUUID();
    await this.database.query(
      `INSERT INTO analytics_series (
         id, tenant_id, name, normalized_name, aliases_json, season_mode, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [id, tenantId, name, normalizedName, JSON.stringify(aliases), input.seasonMode, input.at],
    );
    return { id, name, aliases, seasonMode: input.seasonMode };
  }

  async createEpisode(
    tenantId: string,
    input: Parameters<AnalyticsEntryRepository['createEpisode']>[1],
  ): Promise<AnalyticsEpisodeRecord> {
    const episodeCode = typeof input.episodeCode === 'string' ? input.episodeCode.trim() : '';
    if (!episodeCode || !Number.isSafeInteger(input.episodeNumber) || input.episodeNumber < 1
      || (input.seasonNumber !== null && (!Number.isSafeInteger(input.seasonNumber) || input.seasonNumber < 1))
      || !this.validMoney(input.productionCost)
      || (input.productionTimeSeconds !== null
        && (!Number.isSafeInteger(input.productionTimeSeconds) || input.productionTimeSeconds < 0))
      || !Number.isFinite(Date.parse(input.at))) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
    }
    const series = await this.findSeries(tenantId, input.seriesId);
    if (!series) throw new AnalyticsEntryError('ANALYTICS_ENTRY_SERIES_NOT_FOUND');
    if ((series.seasonMode === 'SEASONAL' && (input.seasonNumber === null || input.seasonNumber < 1))
      || (series.seasonMode === 'NON_SEASONAL' && input.seasonNumber !== null)) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
    }
    const { rows: codeRows } = await this.database.query<{ id: string }>(
      'SELECT id FROM analytics_episodes WHERE tenant_id = $1 AND episode_code = $2',
      [tenantId, episodeCode],
    );
    if (codeRows.length) throw new AnalyticsEntryError('ANALYTICS_ENTRY_CODE_CONFLICT');
    const { rows: identityRows } = await this.database.query<{ id: string }>(
      `SELECT id FROM analytics_episodes
       WHERE tenant_id = $1 AND series_id = $2 AND COALESCE(season_number, 0) = $3 AND episode_number = $4`,
      [tenantId, input.seriesId, input.seasonNumber ?? 0, input.episodeNumber],
    );
    if (identityRows.length) throw new AnalyticsEntryError('ANALYTICS_ENTRY_EPISODE_CONFLICT');
    const id = randomUUID();
    await this.database.query(
      `INSERT INTO analytics_episodes (
         id, tenant_id, series_id, season_number, episode_number, episode_code,
         production_cost_amount, production_time_seconds, created_at, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id, tenantId, input.seriesId, input.seasonNumber, input.episodeNumber, episodeCode,
        input.productionCost?.amount ?? null, input.productionTimeSeconds, input.at, input.actorId,
      ],
    );
    return {
      id,
      seriesId: input.seriesId,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
      episodeCode,
      productionCost: input.productionCost,
      productionTimeSeconds: input.productionTimeSeconds,
    };
  }

  async createEpisodeWithPublications(
    tenantId: string,
    input: CreateEpisodeWithPublicationsInput,
  ): Promise<ManualEpisodeCreationResult> {
    const episodeCode = typeof input.episodeCode === 'string' ? input.episodeCode.trim() : '';
    const selections = input.publicationSelections;
    if (!episodeCode || episodeCode.length > 100 || !Number.isSafeInteger(input.episodeNumber) || input.episodeNumber < 1
      || (input.seasonNumber !== null && (!Number.isSafeInteger(input.seasonNumber) || input.seasonNumber < 1))
      || !this.validMoney(input.productionCost)
      || (input.productionTimeSeconds !== null
        && (!Number.isSafeInteger(input.productionTimeSeconds) || input.productionTimeSeconds < 0))
      || !Number.isFinite(Date.parse(input.at))
      || !Array.isArray(selections) || selections.length > 4) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
    }
    const selectedSources = new Set<string>();
    for (const selection of selections) {
      if (!selection.socialAccountId || !selection.externalPublicationId?.trim()) {
        throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
      }
      const key = `${selection.socialAccountId}\u0000${selection.externalPublicationId}`;
      if (selectedSources.has(key)) throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
      selectedSources.add(key);
    }

    return this.database.transaction(async (transaction) => {
      const { rows: seriesRows } = await transaction.query<SeriesRow>(
        'SELECT id, name, aliases_json, season_mode FROM analytics_series WHERE tenant_id = $1 AND id = $2',
        [tenantId, input.seriesId],
      );
      if (!seriesRows[0]) throw new AnalyticsEntryError('ANALYTICS_ENTRY_SERIES_NOT_FOUND');
      const series = {
        id: seriesRows[0].id,
        name: seriesRows[0].name,
        aliases: this.parseJson<string[]>(seriesRows[0].aliases_json),
        seasonMode: seriesRows[0].season_mode as EpisodeReviewSeasonMode,
      };
      if ((series.seasonMode === 'SEASONAL' && (input.seasonNumber === null || input.seasonNumber < 1))
        || (series.seasonMode === 'NON_SEASONAL' && input.seasonNumber !== null)) {
        throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
      }

      const { rows: codeRows } = await transaction.query<{ id: string }>(
        'SELECT id FROM analytics_episodes WHERE tenant_id = $1 AND episode_code = $2',
        [tenantId, episodeCode],
      );
      if (codeRows.length) throw new AnalyticsEntryError('ANALYTICS_ENTRY_CODE_CONFLICT');
      const { rows: identityRows } = await transaction.query<{ id: string }>(
        `SELECT id FROM analytics_episodes
         WHERE tenant_id = $1 AND series_id = $2 AND COALESCE(season_number, 0) = $3 AND episode_number = $4`,
        [tenantId, input.seriesId, input.seasonNumber ?? 0, input.episodeNumber],
      );
      if (identityRows.length) throw new AnalyticsEntryError('ANALYTICS_ENTRY_EPISODE_CONFLICT');

      const selectedPublications: {
        readonly socialAccountId: SocialAccountId;
        readonly externalPublicationId: string;
        readonly platform: SocialPlatform;
      }[] = [];
      const selectedPlatforms = new Set<string>();
      for (const selection of selections) {
        const { rows } = await transaction.query<{
          social_account_id: string;
          platform: string;
          linked_episode_id: string | null;
        }>(
          `SELECT publication.social_account_id, publication.platform,
                  linked.episode_id AS linked_episode_id
           FROM social_publications AS publication
           LEFT JOIN analytics_episode_publication_links AS linked
             ON linked.tenant_id = publication.tenant_id
            AND linked.social_account_id = publication.social_account_id
            AND linked.external_publication_id = publication.external_publication_id
           WHERE publication.tenant_id = $1 AND publication.social_account_id = $2
             AND publication.external_publication_id = $3`,
          [tenantId, selection.socialAccountId, selection.externalPublicationId],
        );
        const source = rows[0];
        if (!source) throw new AnalyticsEntryError('ANALYTICS_ENTRY_PUBLICATION_NOT_LINKED');
        if (source.linked_episode_id) throw new AnalyticsEntryError('ANALYTICS_ENTRY_PUBLICATION_ALREADY_LINKED');
        if (selectedPlatforms.has(source.platform)) throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
        selectedPlatforms.add(source.platform);
        selectedPublications.push({
          socialAccountId: parseSocialAccountId(source.social_account_id),
          externalPublicationId: selection.externalPublicationId,
          platform: source.platform as SocialPlatform,
        });
      }

      const episodeId = randomUUID();
      await transaction.query(
        `INSERT INTO analytics_episodes (
           id, tenant_id, series_id, season_number, episode_number, episode_code,
           production_cost_amount, production_time_seconds, created_at, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          episodeId,
          tenantId,
          input.seriesId,
          input.seasonNumber,
          input.episodeNumber,
          episodeCode,
          input.productionCost?.amount ?? null,
          input.productionTimeSeconds,
          input.at,
          input.actorId,
        ],
      );
      for (const publication of selectedPublications) {
        await transaction.query(
          `INSERT INTO analytics_episode_publication_links (
             tenant_id, episode_id, social_account_id, external_publication_id, platform, linked_at, linked_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            tenantId,
            episodeId,
            publication.socialAccountId,
            publication.externalPublicationId,
            publication.platform,
            input.at,
            input.actorId,
          ],
        );
        await transaction.query(
          `UPDATE analytics_episode_suggestions
           SET status = 'APPROVED', decided_at = $4, decision_actor_id = $5, episode_id = $6
           WHERE tenant_id = $1 AND social_account_id = $2
             AND external_publication_id = $3 AND status = 'PENDING'`,
          [
            tenantId,
            publication.socialAccountId,
            publication.externalPublicationId,
            input.at,
            input.actorId,
            episodeId,
          ],
        );
      }
      return {
        episode: {
          id: episodeId,
          seriesId: input.seriesId,
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
          episodeCode,
          productionCost: input.productionCost,
          productionTimeSeconds: input.productionTimeSeconds,
        },
        linkedPublicationCount: selectedPublications.length,
      };
    });
  }

  async findEpisodeById(tenantId: string, episodeId: string): Promise<AnalyticsEpisodeRecord | null> {
    const { rows } = await this.database.query<EpisodeRow>(
      `SELECT id, series_id, season_number, episode_number, episode_code,
              production_cost_amount, production_time_seconds
       FROM analytics_episodes
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, episodeId],
    );
    return rows[0] ? this.restoreEpisode(rows[0]) : null;
  }

  async updateEpisodeEconomics(
    tenantId: string,
    input: Parameters<AnalyticsEntryRepository['updateEpisodeEconomics']>[1],
  ): Promise<AnalyticsEpisodeRecord> {
    if (!this.validMoney(input.productionCost)
      || (input.productionTimeSeconds !== null
        && (!Number.isSafeInteger(input.productionTimeSeconds) || input.productionTimeSeconds < 0))) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
    }
    const { rowCount } = await this.database.query(
      `UPDATE analytics_episodes
       SET production_cost_amount = $3, production_time_seconds = $4
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, input.episodeId, input.productionCost?.amount ?? null, input.productionTimeSeconds],
    );
    if (rowCount !== 1) throw new AnalyticsEntryError('ANALYTICS_ENTRY_EPISODE_NOT_FOUND');
    const episode = await this.findEpisodeById(tenantId, input.episodeId);
    if (!episode) throw new AnalyticsEntryError('ANALYTICS_ENTRY_EPISODE_NOT_FOUND');
    return episode;
  }

  async savePerformanceObservation(
    tenantId: string,
    input: Parameters<AnalyticsEntryRepository['savePerformanceObservation']>[1],
  ): Promise<PerformanceObservationRecord> {
    this.validateObservation(input);
    const { rows: links } = await this.database.query<{ episode_id: string; platform: string }>(
      `SELECT episode_id, platform FROM analytics_episode_publication_links
       WHERE tenant_id = $1 AND social_account_id = $2 AND external_publication_id = $3`,
      [tenantId, input.socialAccountId, input.externalPublicationId],
    );
    if (!links[0] || links[0].episode_id !== input.episodeId) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_PUBLICATION_NOT_LINKED');
    }
    if (!(performancePlatforms as readonly string[]).includes(links[0].platform)) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_PLATFORM_UNSUPPORTED');
    }
    const { rows } = await this.database.query<ObservationRow>(
      `INSERT INTO analytics_performance_observations (
         id, tenant_id, episode_id, social_account_id, external_publication_id, platform,
         observed_at, published_at, duration_seconds,
         views, likes, comments, shares, saves, reach, followers_gained, profile_visits,
         average_watch_time_seconds, retention_percent, metric_definitions_json,
         created_at, updated_at, created_by, updated_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
         $21, $21, $22, $22
       )
       ON CONFLICT (tenant_id, social_account_id, external_publication_id, observed_at)
       DO UPDATE SET
         episode_id = EXCLUDED.episode_id,
         platform = EXCLUDED.platform,
         published_at = EXCLUDED.published_at,
         duration_seconds = EXCLUDED.duration_seconds,
         views = EXCLUDED.views,
         likes = EXCLUDED.likes,
         comments = EXCLUDED.comments,
         shares = EXCLUDED.shares,
         saves = EXCLUDED.saves,
         reach = EXCLUDED.reach,
         followers_gained = EXCLUDED.followers_gained,
         profile_visits = EXCLUDED.profile_visits,
         average_watch_time_seconds = EXCLUDED.average_watch_time_seconds,
         retention_percent = EXCLUDED.retention_percent,
         metric_definitions_json = EXCLUDED.metric_definitions_json,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by
       RETURNING id, episode_id, social_account_id, external_publication_id, platform,
         observed_at, published_at, duration_seconds,
         views, likes, comments, shares, saves, reach, followers_gained, profile_visits,
         average_watch_time_seconds, retention_percent, metric_definitions_json,
         created_at, updated_at`,
      [
        randomUUID(), tenantId, input.episodeId, input.socialAccountId, input.externalPublicationId,
        links[0].platform, input.observedAt, input.publishedAt, input.durationSeconds,
        input.metrics.views, input.metrics.likes, input.metrics.comments, input.metrics.shares,
        input.metrics.saves, input.metrics.reach, input.metrics.followersGained,
        input.metrics.profileVisits, input.metrics.averageWatchTimeSeconds,
        input.metrics.retentionPercent, this.json(input.metricDefinitions),
        input.at, input.actorId,
      ],
    );
    return this.restoreObservation(rows[0]);
  }

  async saveAccountFollowerSnapshot(
    tenantId: string,
    input: Parameters<AnalyticsEntryRepository['saveAccountFollowerSnapshot']>[1],
  ): Promise<AccountFollowerSnapshotRecord> {
    if (!input.socialAccountId
      || !Number.isFinite(Date.parse(input.observedAt))
      || !Number.isSafeInteger(input.totalFollowers)
      || input.totalFollowers < 0
      || !Number.isFinite(Date.parse(input.at))) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
    }
    const { rows: accounts } = await this.database.query<{ id: string }>(
      'SELECT id FROM social_accounts WHERE tenant_id = $1 AND id = $2',
      [tenantId, input.socialAccountId],
    );
    if (!accounts[0]) throw new AnalyticsEntryError('ANALYTICS_ENTRY_ACCOUNT_NOT_FOUND');
    const { rows } = await this.database.query<SnapshotRow>(
      `INSERT INTO analytics_account_follower_snapshots (
         tenant_id, social_account_id, observed_at, total_followers,
         created_at, updated_at, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $5, $6, $6)
       ON CONFLICT (tenant_id, social_account_id, observed_at)
       DO UPDATE SET
         total_followers = EXCLUDED.total_followers,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by
       RETURNING social_account_id, observed_at, total_followers, created_at, updated_at`,
      [tenantId, input.socialAccountId, input.observedAt, input.totalFollowers, input.at, input.actorId],
    );
    return {
      socialAccountId: rows[0].social_account_id as SocialAccountId,
      observedAt: this.toIsoString(rows[0].observed_at) as string,
      totalFollowers: Number(rows[0].total_followers),
      createdAt: this.toIsoString(rows[0].created_at) as string,
      updatedAt: this.toIsoString(rows[0].updated_at) as string,
    };
  }

  async saveMonthlyPlatformRevenue(
    tenantId: string,
    input: Parameters<AnalyticsEntryRepository['saveMonthlyPlatformRevenue']>[1],
  ): Promise<MonthlyPlatformRevenueRecord> {
    if (!(performancePlatforms as readonly string[]).includes(input.platform)
      || typeof input.month !== 'string'
      || !monthDatePattern.test(input.month)
      || !Number.isFinite(Date.parse(input.month))
      || !this.validMoney(input.amount)
      || !input.amount
      || !Number.isFinite(Date.parse(input.at))) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
    }
    const { rows } = await this.database.query<RevenueRow>(
      `INSERT INTO analytics_platform_monthly_revenue (
         tenant_id, platform, month, amount, currency,
         created_at, updated_at, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, 'BRL', $5, $5, $6, $6)
       ON CONFLICT (tenant_id, platform, month)
       DO UPDATE SET
         amount = EXCLUDED.amount,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by
       RETURNING platform, month, amount, currency, created_at, updated_at`,
      [tenantId, input.platform, input.month, input.amount.amount, input.at, input.actorId],
    );
    const row = rows[0];
    return {
      platform: row.platform as MonthlyPlatformRevenueRecord['platform'],
      month: this.toDateString(row.month),
      amount: { amount: this.formatAmount(row.amount), currency: 'BRL' },
      createdAt: this.toIsoString(row.created_at) as string,
      updatedAt: this.toIsoString(row.updated_at) as string,
    };
  }

  private async findSeries(tenantId: string, seriesId: string): Promise<EpisodeReviewSeries | null> {
    const { rows } = await this.database.query<SeriesRow>(
      'SELECT id, name, aliases_json, season_mode FROM analytics_series WHERE tenant_id = $1 AND id = $2',
      [tenantId, seriesId],
    );
    if (!rows[0]) return null;
    return {
      id: rows[0].id,
      name: rows[0].name,
      aliases: this.parseJson<string[]>(rows[0].aliases_json),
      seasonMode: rows[0].season_mode as EpisodeReviewSeasonMode,
    };
  }

  private validateObservation(
    input: Parameters<AnalyticsEntryRepository['savePerformanceObservation']>[1],
  ): void {
    if (!input.episodeId || !input.socialAccountId || !input.externalPublicationId
      || !Number.isFinite(Date.parse(input.observedAt))
      || !Number.isFinite(Date.parse(input.publishedAt))
      || !Number.isSafeInteger(input.durationSeconds) || input.durationSeconds < 0
      || typeof input.metrics !== 'object' || input.metrics === null
      || !Number.isFinite(Date.parse(input.at))) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
    }
    for (const key of counterMetrics) {
      const value = input.metrics[key];
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
        throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
      }
    }
    for (const key of durationMetrics) {
      const value = input.metrics[key];
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
      }
    }
    if (input.metricDefinitions !== null
      && (typeof input.metricDefinitions !== 'object' || Array.isArray(input.metricDefinitions))) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
    }
  }

  private validMoney(amount: AnalyticsMoneyAmount | null): boolean {
    if (amount === null || amount === undefined) return true;
    return typeof amount === 'object'
      && typeof amount.amount === 'string'
      && moneyAmountPattern.test(amount.amount)
      && amount.currency === 'BRL';
  }

  private restoreEpisode(row: EpisodeRow): AnalyticsEpisodeRecord {
    return {
      id: row.id,
      seriesId: row.series_id,
      seasonNumber: row.season_number,
      episodeNumber: row.episode_number,
      episodeCode: row.episode_code,
      productionCost: row.production_cost_amount === null
        ? null
        : { amount: this.formatAmount(row.production_cost_amount), currency: 'BRL' },
      productionTimeSeconds: row.production_time_seconds,
    };
  }

  private restoreObservation(row: ObservationRow): PerformanceObservationRecord {
    return {
      id: row.id,
      episodeId: row.episode_id,
      socialAccountId: row.social_account_id as SocialAccountId,
      externalPublicationId: row.external_publication_id,
      platform: row.platform as PerformanceObservationRecord['platform'],
      observedAt: this.toIsoString(row.observed_at) as string,
      publishedAt: this.toIsoString(row.published_at) as string,
      durationSeconds: row.duration_seconds,
      metrics: {
        views: this.counter(row.views),
        likes: this.counter(row.likes),
        comments: this.counter(row.comments),
        shares: this.counter(row.shares),
        saves: this.counter(row.saves),
        reach: this.counter(row.reach),
        followersGained: this.counter(row.followers_gained),
        profileVisits: this.counter(row.profile_visits),
        averageWatchTimeSeconds: this.counter(row.average_watch_time_seconds),
        retentionPercent: this.counter(row.retention_percent),
      } satisfies PerformanceMetricValues,
      metricDefinitions: this.parseJson(row.metric_definitions_json),
      createdAt: this.toIsoString(row.created_at) as string,
      updatedAt: this.toIsoString(row.updated_at) as string,
    };
  }

  private counter(value: string | number | null): number | null {
    return value === null ? null : Number(value);
  }

  private formatAmount(value: string | number): string {
    const [integer, fraction = ''] = String(value).split('.');
    return `${integer}.${fraction.padEnd(2, '0').slice(0, 2)}`;
  }

  private json(value: unknown): string | null {
    return value === null || value === undefined ? null : JSON.stringify(value);
  }

  private parseJson<T>(value: string | null): T {
    if (value === null) return null as T;
    try {
      return JSON.parse(value) as T;
    } catch {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_SAVE_FAILED');
    }
  }

  private toIsoString(value: Date | string | null): string | null {
    if (value === null) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  private toDateString(value: Date | string): string {
    if (value instanceof Date) {
      const year = value.getUTCFullYear();
      const month = `${value.getUTCMonth() + 1}`.padStart(2, '0');
      const day = `${value.getUTCDate()}`.padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return value.slice(0, 10);
  }
}
