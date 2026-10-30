import { randomUUID } from 'node:crypto';
import type {
  EpisodeReviewApprovalCommand,
  EpisodeReviewApprovalResult,
  EpisodeReviewRepository,
  EpisodeReviewSeasonMode,
  EpisodeReviewSeries,
  EpisodeReviewSourceState,
  EpisodeReviewSuggestion,
} from '../../application/ports/episode-review.repository.port';
import type { RelationalDatabase, RelationalQueryExecutor } from '../../application/ports/relational-database.port';
import { EpisodeReviewError } from '../../application/analytics/episode-review-error';
import { extractExplicitEpisodeIdentity, normalizeSeriesIdentity } from '../../domain/analytics/episode-identity';
import { parseSocialAccountId, type SocialAccountId } from '../../domain/social/social-account-id';
import type { SocialPlatform } from '../../domain/social/social-account';
import type { ClassifiedPublicationEpisodeSuggestion } from '../../application/analytics/classify-imported-publication';

interface SeriesRow extends Record<string, unknown> {
  id: string;
  name: string;
  aliases_json: string;
  season_mode: string;
}

interface SuggestionRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  social_account_id: string;
  social_account_name: string | null;
  external_publication_id: string;
  platform: string;
  source_fingerprint: string;
  title: string | null;
  description: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  published_at: Date | string | null;
  classification: string;
  confidence: number | null;
  probabilities_json: string | null;
  identity_json: string;
  rationale_variants_json: string;
  rationale_failures_json: string;
  evidence_json: string | null;
  provider: string;
  model: string | null;
  schema_version: string;
  usage_json: string | null;
  status: string;
  created_at: Date | string;
  decided_at: Date | string | null;
  decision_actor_id: string | null;
  decision_reason: string | null;
  setup_series_id: string | null;
  setup_series_confirmed_at: Date | string | null;
  setup_season_number: number | null;
  setup_season_confirmed_at: Date | string | null;
}

interface EpisodeRow extends Record<string, unknown> {
  id: string;
  series_id: string;
  season_number: number | null;
  episode_number: number;
  episode_code: string;
}

export class PostgresEpisodeReviewRepository implements EpisodeReviewRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async listSourceStates(tenantId: string): Promise<readonly EpisodeReviewSourceState[]> {
    const { rows } = await this.database.query<SuggestionRow & {
      linked_episode_id: string | null;
    }>(
      `SELECT suggestion.social_account_id, suggestion.external_publication_id, suggestion.source_fingerprint,
              link.episode_id AS linked_episode_id, suggestion.created_at
       FROM analytics_episode_suggestions AS suggestion
       LEFT JOIN analytics_episode_publication_links AS link
         ON link.tenant_id = suggestion.tenant_id
        AND link.social_account_id = suggestion.social_account_id
        AND link.external_publication_id = suggestion.external_publication_id
       WHERE suggestion.tenant_id = $1
       ORDER BY suggestion.created_at DESC, suggestion.id DESC`,
      [tenantId],
    );
    const latest = new Map<string, EpisodeReviewSourceState>();
    for (const row of rows) {
      const key = this.sourceKey(row.social_account_id, row.external_publication_id);
      if (latest.has(key)) continue;
      latest.set(key, {
        socialAccountId: parseSocialAccountId(row.social_account_id),
        externalPublicationId: row.external_publication_id,
        sourceFingerprint: row.source_fingerprint,
        linkedEpisodeId: row.linked_episode_id,
      });
    }
    return [...latest.values()];
  }

  async saveSuggestion(
    tenantId: string,
    suggestion: Parameters<EpisodeReviewRepository['saveSuggestion']>[1],
  ): Promise<void> {
    this.validateSuggestion(suggestion);
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE analytics_episode_suggestions
         SET status = 'SUPERSEDED', decided_at = $5,
             decision_actor_id = 'SYSTEM', decision_reason = 'SOURCE_METADATA_CHANGED'
         WHERE tenant_id = $1 AND social_account_id = $2 AND external_publication_id = $3
           AND source_fingerprint <> $4 AND status = 'PENDING'`,
        [
          tenantId,
          suggestion.socialAccountId,
          suggestion.publication.externalPublicationId,
          suggestion.sourceFingerprint,
          suggestion.createdAt,
        ],
      );
      const status = suggestion.classification === 'NOT_EPISODE' ? 'NOT_EPISODE' : 'PENDING';
      await transaction.query(
        `INSERT INTO analytics_episode_suggestions (
           id, tenant_id, social_account_id, external_publication_id, platform, source_fingerprint,
           title, description, permalink, thumbnail_url, published_at, classification, confidence,
           probabilities_json, identity_json, rationale_variants_json, rationale_failures_json,
           evidence_json, provider, model, schema_version, usage_json, status, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
           $19, $20, $21, $22, $23, $24
         )
         ON CONFLICT (tenant_id, social_account_id, external_publication_id, source_fingerprint) DO NOTHING`,
        [
          randomUUID(),
          tenantId,
          suggestion.socialAccountId,
          suggestion.publication.externalPublicationId,
          suggestion.publication.platform,
          suggestion.sourceFingerprint,
          suggestion.publication.title,
          suggestion.publication.description,
          suggestion.publication.permalink,
          suggestion.publication.thumbnailUrl,
          suggestion.publication.publishedAt,
          suggestion.classification,
          suggestion.confidence,
          this.json(suggestion.probabilities),
          this.json(suggestion.identity),
          this.json(suggestion.rationaleVariants),
          this.json(suggestion.rationaleFailures),
          this.json(suggestion.evidence),
          suggestion.provider,
          suggestion.model,
          suggestion.schemaVersion,
          this.json(suggestion.usage),
          status,
          suggestion.createdAt,
        ],
      );
    });
  }

  async listPendingSuggestions(tenantId: string): Promise<readonly EpisodeReviewSuggestion[]> {
    const { rows } = await this.database.query<SuggestionRow>(
      `SELECT suggestion.id, suggestion.tenant_id, suggestion.social_account_id,
              suggestion.external_publication_id, suggestion.platform, suggestion.source_fingerprint,
              suggestion.title, suggestion.description, suggestion.permalink, suggestion.thumbnail_url,
              account.display_name AS social_account_name,
              suggestion.published_at, suggestion.classification, suggestion.confidence,
              suggestion.probabilities_json, suggestion.identity_json, suggestion.rationale_variants_json,
              suggestion.rationale_failures_json, suggestion.evidence_json, suggestion.provider,
              suggestion.model, suggestion.schema_version, suggestion.usage_json, suggestion.status,
              suggestion.created_at, suggestion.decided_at, suggestion.decision_actor_id,
              suggestion.decision_reason, setup.series_id AS setup_series_id,
              setup.series_confirmed_at AS setup_series_confirmed_at,
              setup.season_number AS setup_season_number,
              setup.season_confirmed_at AS setup_season_confirmed_at
       FROM analytics_episode_suggestions AS suggestion
       LEFT JOIN social_accounts AS account
         ON account.tenant_id = suggestion.tenant_id AND account.id = suggestion.social_account_id
       LEFT JOIN analytics_episode_setup_decisions AS setup
         ON setup.tenant_id = suggestion.tenant_id AND setup.suggestion_id = suggestion.id
       WHERE suggestion.tenant_id = $1 AND suggestion.status = 'PENDING'
       ORDER BY suggestion.created_at, suggestion.id`,
      [tenantId],
    );
    return rows.map((row) => this.restoreSuggestion(row));
  }

  async listSeries(tenantId: string): Promise<readonly EpisodeReviewSeries[]> {
    const { rows } = await this.database.query<SeriesRow>(
      `SELECT id, name, aliases_json, season_mode
       FROM analytics_series
       WHERE tenant_id = $1
       ORDER BY normalized_name, id`,
      [tenantId],
    );
    return rows.map((row) => this.restoreSeries(row));
  }

  async findSeriesById(tenantId: string, seriesId: string): Promise<EpisodeReviewSeries | null> {
    const { rows } = await this.database.query<SeriesRow>(
      `SELECT id, name, aliases_json, season_mode
       FROM analytics_series
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, seriesId],
    );
    return rows[0] ? this.restoreSeries(rows[0]) : null;
  }

  async confirmSetupSeries(
    tenantId: string,
    suggestionIds: readonly string[],
    seriesInput: EpisodeReviewApprovalCommand['series'],
    actorId: string,
    decidedAt: string,
  ): Promise<EpisodeReviewSeries> {
    if (!suggestionIds.length || new Set(suggestionIds).size !== suggestionIds.length) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
    return this.database.transaction(async (transaction) => {
      const suggestions = await this.loadPendingSuggestionsForSetup(transaction, tenantId, suggestionIds);
      const series = await this.resolveOrCreateSeries(transaction, tenantId, seriesInput, decidedAt);
      const nonSeasonal = series.seasonMode === 'NON_SEASONAL';
      for (const suggestion of suggestions) {
        await transaction.query(
          `INSERT INTO analytics_episode_setup_decisions (
             tenant_id, suggestion_id, series_id, series_confirmed_at, series_confirmed_by,
             season_number, season_confirmed_at, season_confirmed_by
           ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)
           ON CONFLICT (tenant_id, suggestion_id) DO UPDATE SET
             series_id = EXCLUDED.series_id,
             series_confirmed_at = EXCLUDED.series_confirmed_at,
             series_confirmed_by = EXCLUDED.series_confirmed_by,
             season_number = NULL,
             season_confirmed_at = EXCLUDED.season_confirmed_at,
             season_confirmed_by = EXCLUDED.season_confirmed_by`,
          [
            tenantId,
            suggestion.id,
            series.id,
            decidedAt,
            actorId,
            nonSeasonal ? decidedAt : null,
            nonSeasonal ? actorId : null,
          ],
        );
      }
      return series;
    });
  }

  async confirmSetupSeason(
    tenantId: string,
    suggestionIds: readonly string[],
    seasonNumber: number,
    actorId: string,
    decidedAt: string,
  ): Promise<number> {
    if (!suggestionIds.length || new Set(suggestionIds).size !== suggestionIds.length
      || !Number.isSafeInteger(seasonNumber) || seasonNumber < 1) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
    return this.database.transaction(async (transaction) => {
      const suggestions = await this.loadPendingSuggestionsForSetup(transaction, tenantId, suggestionIds);
      let confirmedSeriesId: string | null = null;
      for (const suggestion of suggestions) {
        const { rows } = await transaction.query<{ series_id: string; season_mode: string }>(
          `SELECT setup.series_id, series.season_mode
           FROM analytics_episode_setup_decisions AS setup
           JOIN analytics_series AS series
             ON series.tenant_id = setup.tenant_id AND series.id = setup.series_id
           WHERE setup.tenant_id = $1 AND setup.suggestion_id = $2`,
          [tenantId, suggestion.id],
        );
        const decision = rows[0];
        if (!decision || decision.season_mode !== 'SEASONAL'
          || (confirmedSeriesId !== null && confirmedSeriesId !== decision.series_id)) {
          throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
        }
        confirmedSeriesId = decision.series_id;
      }
      for (const suggestion of suggestions) {
        const updated = await transaction.query(
          `UPDATE analytics_episode_setup_decisions
           SET season_number = $3, season_confirmed_at = $4, season_confirmed_by = $5
           WHERE tenant_id = $1 AND suggestion_id = $2`,
          [tenantId, suggestion.id, seasonNumber, decidedAt, actorId],
        );
        if (updated.rowCount !== 1) throw new EpisodeReviewError('ANALYTICS_EPISODE_SUGGESTION_NOT_PENDING');
      }
      return suggestions.length;
    });
  }

  async approveGroup(tenantId: string, input: EpisodeReviewApprovalCommand): Promise<EpisodeReviewApprovalResult> {
    if (!input.suggestionIds.length || new Set(input.suggestionIds).size !== input.suggestionIds.length) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
    return this.database.transaction(async (transaction) => {
      const suggestionRows: SuggestionRow[] = [];
      for (const suggestionId of input.suggestionIds) {
        const { rows } = await transaction.query<SuggestionRow>(
        `SELECT id, tenant_id, social_account_id, external_publication_id, platform, classification, status,
                title, description, identity_json
           FROM analytics_episode_suggestions
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, suggestionId],
        );
        if (!rows[0]) throw new EpisodeReviewError('ANALYTICS_EPISODE_SUGGESTION_NOT_FOUND');
        if (rows[0].status !== 'PENDING'
          || (rows[0].classification !== 'EPISODE' && rows[0].classification !== 'UNCERTAIN')) {
          throw new EpisodeReviewError('ANALYTICS_EPISODE_SUGGESTION_NOT_PENDING');
        }
        suggestionRows.push(rows[0]);
      }

      let confirmedSeriesId: string | null = null;
      let candidateEpisodeNumber: number | null = null;
      let candidateEpisodeCode: string | null = null;
      for (const suggestion of suggestionRows) {
        const { rows } = await transaction.query<{
          series_id: string;
          season_number: number | null;
          season_confirmed_at: Date | string | null;
        }>(
          `SELECT series_id, season_number, season_confirmed_at
           FROM analytics_episode_setup_decisions
           WHERE tenant_id = $1 AND suggestion_id = $2`,
          [tenantId, suggestion.id],
        );
        const setup = rows[0];
        if (!setup || !setup.season_confirmed_at
          || (setup.season_number === null ? null : Number(setup.season_number)) !== input.seasonNumber
          || (confirmedSeriesId !== null && confirmedSeriesId !== setup.series_id)) {
          throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
        }
        confirmedSeriesId = setup.series_id;
        const identity = extractExplicitEpisodeIdentity(suggestion.title, suggestion.description);
        if (identity.episodeNumber !== null && candidateEpisodeNumber !== null
          && identity.episodeNumber !== candidateEpisodeNumber) {
          throw new EpisodeReviewError('ANALYTICS_EPISODE_IDENTITY_CONFLICT');
        }
        if (identity.episodeNumber !== null) candidateEpisodeNumber = identity.episodeNumber;
        if (identity.episodeCode && candidateEpisodeCode && identity.episodeCode !== candidateEpisodeCode) {
          throw new EpisodeReviewError('ANALYTICS_EPISODE_IDENTITY_CONFLICT');
        }
        if (identity.episodeCode) candidateEpisodeCode = identity.episodeCode;
      }
      const { rows: seriesRows } = await transaction.query<SeriesRow>(
        `SELECT id, name, aliases_json, season_mode
         FROM analytics_series
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, confirmedSeriesId],
      );
      const series = seriesRows[0] ? this.restoreSeries(seriesRows[0]) : null;
      if (!series) throw new EpisodeReviewError('ANALYTICS_EPISODE_SERIES_NOT_FOUND');
      if (input.series.id && input.series.id !== series.id) {
        throw new EpisodeReviewError('ANALYTICS_EPISODE_IDENTITY_CONFLICT');
      }
      if (!input.series.id) {
        const selectedName = input.series.name?.trim();
        const selectedNameMatches = Boolean(selectedName)
          && ([series.name, ...series.aliases].some((name) => (
            normalizeSeriesIdentity(name) === normalizeSeriesIdentity(selectedName as string)
          )));
        if (!selectedNameMatches || input.series.seasonMode !== series.seasonMode) {
          throw new EpisodeReviewError('ANALYTICS_EPISODE_IDENTITY_CONFLICT');
        }
      }
      if ((series.seasonMode === 'SEASONAL' && (input.seasonNumber === null || input.seasonNumber < 1))
        || (series.seasonMode === 'NON_SEASONAL' && input.seasonNumber !== null)) {
        throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
      }
      let episode = await this.findEpisode(transaction, tenantId, series.id, input.seasonNumber, input.episodeNumber);
      if (!episode) {
        await this.assertEpisodeCodeAvailable(transaction, tenantId, input.episodeCode);
        const id = randomUUID();
        await transaction.query(
          `INSERT INTO analytics_episodes (
             id, tenant_id, series_id, season_number, episode_number, episode_code, created_at, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, tenantId, series.id, input.seasonNumber, input.episodeNumber, input.episodeCode, input.decidedAt, input.actorId],
        );
        episode = {
          id,
          series_id: series.id,
          season_number: input.seasonNumber,
          episode_number: input.episodeNumber,
          episode_code: input.episodeCode,
        };
      }

      for (const suggestion of suggestionRows) {
        const existing = await transaction.query<{ episode_id: string }>(
          `SELECT episode_id FROM analytics_episode_publication_links
           WHERE tenant_id = $1 AND social_account_id = $2 AND external_publication_id = $3`,
          [tenantId, suggestion.social_account_id, suggestion.external_publication_id],
        );
        if (existing.rows[0] && existing.rows[0].episode_id !== episode.id) {
          throw new EpisodeReviewError('ANALYTICS_EPISODE_SOURCE_INVALID');
        }
        await transaction.query(
          `INSERT INTO analytics_episode_publication_links (
             tenant_id, episode_id, social_account_id, external_publication_id, platform, linked_at, linked_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (tenant_id, social_account_id, external_publication_id) DO NOTHING`,
          [
            tenantId,
            episode.id,
            suggestion.social_account_id,
            suggestion.external_publication_id,
            suggestion.platform,
            input.decidedAt,
            input.actorId,
          ],
        );
      }

      for (const suggestionId of input.suggestionIds) {
        const updated = await transaction.query(
          `UPDATE analytics_episode_suggestions
           SET status = 'APPROVED', decided_at = $3, decision_actor_id = $4, episode_id = $5
           WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
          [tenantId, suggestionId, input.decidedAt, input.actorId, episode.id],
        );
        if (updated.rowCount !== 1) {
          throw new EpisodeReviewError('ANALYTICS_EPISODE_SUGGESTION_NOT_PENDING');
        }
      }

      return {
        series,
        episode: this.restoreEpisode(episode),
        linkedPublicationCount: suggestionRows.length,
      };
    });
  }

  async decideSuggestions(
    tenantId: string,
    suggestionIds: readonly string[],
    decision: 'REJECTED' | 'DEFERRED',
    actorId: string,
    decidedAt: string,
  ): Promise<number> {
    return this.database.transaction(async (transaction) => {
      let updatedCount = 0;
      for (const suggestionId of suggestionIds) {
        const { rowCount } = await transaction.query(
          `UPDATE analytics_episode_suggestions
           SET status = $2, decided_at = $3, decision_actor_id = $4
           WHERE tenant_id = $1 AND id = $5 AND status = 'PENDING'`,
          [tenantId, decision, decidedAt, actorId, suggestionId],
        );
        if (rowCount !== 1) {
          throw new EpisodeReviewError('ANALYTICS_EPISODE_SUGGESTION_NOT_PENDING');
        }
        updatedCount += 1;
      }
      return updatedCount;
    });
  }

  private async resolveOrCreateSeries(
    transaction: RelationalQueryExecutor,
    tenantId: string,
    input: EpisodeReviewApprovalCommand['series'],
    at: string,
  ): Promise<EpisodeReviewSeries> {
    const seriesRows = await transaction.query<SeriesRow>(
      'SELECT id, name, aliases_json, season_mode FROM analytics_series WHERE tenant_id = $1',
      [tenantId],
    );
    const series = seriesRows.rows.map((row) => this.restoreSeries(row));
    if (input.id) {
      const selected = series.find((candidate) => candidate.id === input.id);
      if (!selected) throw new EpisodeReviewError('ANALYTICS_EPISODE_SERIES_NOT_FOUND');
      if (input.seasonMode && input.seasonMode !== selected.seasonMode) {
        throw new EpisodeReviewError('ANALYTICS_EPISODE_IDENTITY_CONFLICT');
      }
      return selected;
    }
    if (!input.name || !input.seasonMode || !Array.isArray(input.aliases)) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
    const normalizedName = normalizeSeriesIdentity(input.name);
    const existing = series.filter((candidate) => (
      [candidate.name, ...candidate.aliases].some((name) => normalizeSeriesIdentity(name) === normalizedName)
    ));
    if (existing.length > 1) throw new EpisodeReviewError('ANALYTICS_EPISODE_IDENTITY_CONFLICT');
    if (existing.length === 1) {
      if (existing[0].seasonMode !== input.seasonMode) {
        throw new EpisodeReviewError('ANALYTICS_EPISODE_IDENTITY_CONFLICT');
      }
      return existing[0];
    }
    const aliases = [...new Set(input.aliases.map((alias) => alias.trim()).filter(Boolean))];
    for (const alias of aliases) {
      const normalizedAlias = normalizeSeriesIdentity(alias);
      if (series.some((candidate) => (
        [candidate.name, ...candidate.aliases].some((name) => normalizeSeriesIdentity(name) === normalizedAlias)
      ))) {
        throw new EpisodeReviewError('ANALYTICS_EPISODE_IDENTITY_CONFLICT');
      }
    }
    const id = randomUUID();
    await transaction.query(
      `INSERT INTO analytics_series (
         id, tenant_id, name, normalized_name, aliases_json, season_mode, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [id, tenantId, input.name.trim(), normalizedName, JSON.stringify(aliases), input.seasonMode, at],
    );
    return { id, name: input.name.trim(), aliases, seasonMode: input.seasonMode };
  }

  private async findEpisode(
    transaction: RelationalQueryExecutor,
    tenantId: string,
    seriesId: string,
    seasonNumber: number | null,
    episodeNumber: number,
  ): Promise<EpisodeRow | null> {
    const seasonPredicate = seasonNumber === null ? 'season_number IS NULL' : 'season_number = $3';
    const parameters = seasonNumber === null
      ? [tenantId, seriesId, episodeNumber]
      : [tenantId, seriesId, seasonNumber, episodeNumber];
    const episodePredicate = seasonNumber === null ? '$3' : '$4';
    const { rows } = await transaction.query<EpisodeRow>(
      `SELECT id, series_id, season_number, episode_number, episode_code
       FROM analytics_episodes
       WHERE tenant_id = $1 AND series_id = $2 AND ${seasonPredicate}
         AND episode_number = ${episodePredicate}`,
      parameters,
    );
    return rows[0] ?? null;
  }

  private async assertEpisodeCodeAvailable(
    transaction: RelationalQueryExecutor,
    tenantId: string,
    episodeCode: string,
  ): Promise<void> {
    const { rows } = await transaction.query(
      'SELECT id FROM analytics_episodes WHERE tenant_id = $1 AND episode_code = $2',
      [tenantId, episodeCode],
    );
    if (rows.length) throw new EpisodeReviewError('ANALYTICS_EPISODE_CODE_CONFLICT');
  }

  private validateSuggestion(
    suggestion: Parameters<EpisodeReviewRepository['saveSuggestion']>[1],
  ): void {
    if (!suggestion.sourceFingerprint || !suggestion.socialAccountId || !suggestion.publication.externalPublicationId
      || !['EPISODE', 'NOT_EPISODE', 'UNCERTAIN'].includes(suggestion.classification)
      || !['JEV', 'RULES'].includes(suggestion.provider)
      || !suggestion.schemaVersion
      || !Number.isFinite(Date.parse(suggestion.createdAt))) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
  }

  private async loadPendingSuggestionsForSetup(
    transaction: RelationalQueryExecutor,
    tenantId: string,
    suggestionIds: readonly string[],
  ): Promise<{ readonly id: string }[]> {
    const suggestions: { readonly id: string }[] = [];
    for (const suggestionId of suggestionIds) {
      const { rows } = await transaction.query<{ id: string; status: string; classification: string }>(
        `SELECT id, status, classification
         FROM analytics_episode_suggestions
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, suggestionId],
      );
      if (!rows[0]) throw new EpisodeReviewError('ANALYTICS_EPISODE_SUGGESTION_NOT_FOUND');
      if (rows[0].status !== 'PENDING'
        || (rows[0].classification !== 'EPISODE' && rows[0].classification !== 'UNCERTAIN')) {
        throw new EpisodeReviewError('ANALYTICS_EPISODE_SUGGESTION_NOT_PENDING');
      }
      suggestions.push(rows[0]);
    }
    return suggestions;
  }

  private restoreSuggestion(row: SuggestionRow): EpisodeReviewSuggestion {
    return {
      id: row.id,
      socialAccountId: parseSocialAccountId(row.social_account_id),
      socialAccountName: row.social_account_name,
      sourceFingerprint: row.source_fingerprint,
      classification: row.classification as ClassifiedPublicationEpisodeSuggestion['classification'],
      confidence: row.confidence,
      probabilities: this.parseJson(row.probabilities_json),
      evidence: this.parseJson(row.evidence_json),
      provider: row.provider as ClassifiedPublicationEpisodeSuggestion['provider'],
      model: row.model,
      schemaVersion: row.schema_version,
      usage: this.parseJson(row.usage_json),
      identity: this.parseJson(row.identity_json),
      rationaleVariants: this.parseJson(row.rationale_variants_json),
      rationaleFailures: this.parseJson(row.rationale_failures_json),
      publication: {
        platform: row.platform as SocialPlatform,
        externalPublicationId: row.external_publication_id,
        title: row.title,
        description: row.description,
        permalink: row.permalink,
        thumbnailUrl: row.thumbnail_url,
        publishedAt: this.toIsoString(row.published_at),
      },
      status: row.status as EpisodeReviewSuggestion['status'],
      createdAt: this.toIsoString(row.created_at) as string,
      decidedAt: this.toIsoString(row.decided_at),
      decisionActorId: row.decision_actor_id,
      decisionReason: row.decision_reason,
      setupSeriesId: row.setup_series_id,
      setupSeriesConfirmedAt: this.toIsoString(row.setup_series_confirmed_at),
      setupSeasonNumber: row.setup_season_number === null ? null : Number(row.setup_season_number),
      setupSeasonConfirmedAt: this.toIsoString(row.setup_season_confirmed_at),
    };
  }

  private restoreSeries(row: SeriesRow): EpisodeReviewSeries {
    return {
      id: row.id,
      name: row.name,
      aliases: this.parseJson(row.aliases_json),
      seasonMode: row.season_mode as EpisodeReviewSeasonMode,
    };
  }

  private restoreEpisode(row: EpisodeRow): EpisodeReviewApprovalResult['episode'] {
    return {
      id: row.id,
      seriesId: row.series_id,
      seasonNumber: row.season_number,
      episodeNumber: row.episode_number,
      episodeCode: row.episode_code,
    };
  }

  private sourceKey(accountId: string, externalPublicationId: string): string {
    return `${accountId}\u0000${externalPublicationId}`;
  }

  private json(value: unknown): string | null {
    return value === null || value === undefined ? null : JSON.stringify(value);
  }

  private parseJson<T>(value: string | null): T {
    if (value === null) return null as T;
    try {
      return JSON.parse(value) as T;
    } catch {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_REVIEW_FAILED');
    }
  }

  private toIsoString(value: Date | string | null): string | null {
    if (value === null) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
}
