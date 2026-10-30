import type { LocalizationPort } from '../ports/localization.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { SocialPublicationRepository } from '../ports/social-publication-repository.port';
import type {
  EpisodeReviewApprovalCommand,
  EpisodeReviewApprovalResult,
  EpisodeReviewRepository,
  EpisodeReviewSeasonMode,
  EpisodeReviewSuggestion,
} from '../ports/episode-review.repository.port';
import type { PublicationEpisodeClassifier } from '../ports/publication-episode-classifier.port';
import {
  extractExplicitEpisodeIdentity,
  groupEpisodePublicationSuggestions,
  normalizeSeriesIdentity,
} from '../../domain/analytics/episode-identity';
import { ClassifyImportedPublication } from './classify-imported-publication';
import { EpisodeReviewError } from './episode-review-error';

const reviewActorId = 'LOCAL_PILOT_CREATOR';

export function episodePublicationFingerprint(publication: {
  readonly platform: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly permalink: string | null;
  readonly publishedAt: string | null;
}): string {
  return JSON.stringify([
    publication.platform,
    publication.title,
    publication.description,
    publication.permalink,
    publication.publishedAt,
  ]);
}

export class RefreshEpisodeSuggestions {
  private readonly classifyPublication: ClassifyImportedPublication;

  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly publications: SocialPublicationRepository,
    private readonly reviews: EpisodeReviewRepository,
    classifier: PublicationEpisodeClassifier,
    localization: LocalizationPort,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {
    this.classifyPublication = new ClassifyImportedPublication(classifier, localization);
  }

  async execute(): Promise<{
    readonly scanned: number;
    readonly classified: number;
    readonly skipped: number;
    readonly failures: readonly {
      readonly socialAccountId: string;
      readonly externalPublicationId: string | null;
      readonly code: string;
    }[];
  }> {
    const tenantId = await this.tenant.resolveTenantId();
    const [accounts, sourceStates] = await Promise.all([
      this.accounts.listByTenant(tenantId),
      this.reviews.listSourceStates(tenantId),
    ]);
    const stateBySource = new Map(sourceStates.map((source) => [
      this.sourceKey(source.socialAccountId, source.externalPublicationId),
      source,
    ]));
    let scanned = 0;
    let classified = 0;
    let skipped = 0;
    const failures: { socialAccountId: string; externalPublicationId: string | null; code: string }[] = [];

    for (const account of accounts) {
      let accountPublications;
      try {
        accountPublications = await this.publications.listByAccount(tenantId, account.id);
      } catch {
        failures.push({
          socialAccountId: account.id,
          externalPublicationId: null,
          code: 'ANALYTICS_EPISODE_PUBLICATIONS_UNAVAILABLE',
        });
        continue;
      }

      for (const publication of accountPublications) {
        scanned += 1;
        const fingerprint = episodePublicationFingerprint(publication);
        const source = stateBySource.get(this.sourceKey(account.id, publication.externalPublicationId));
        if (source?.linkedEpisodeId || source?.sourceFingerprint === fingerprint) {
          skipped += 1;
          continue;
        }

        try {
          const suggestion = await this.classifyPublication.execute({
            publication: {
              platform: publication.platform,
              externalPublicationId: publication.externalPublicationId,
              title: publication.title,
              description: publication.description,
            },
          });
          await this.reviews.saveSuggestion(tenantId, {
            ...suggestion,
            socialAccountId: account.id,
            sourceFingerprint: fingerprint,
            publication: {
              platform: publication.platform,
              externalPublicationId: publication.externalPublicationId,
              title: publication.title,
              description: publication.description,
              permalink: publication.permalink,
              thumbnailUrl: publication.thumbnailUrl,
              publishedAt: publication.publishedAt,
            },
            createdAt: new Date(this.now()).toISOString(),
          });
          stateBySource.set(this.sourceKey(account.id, publication.externalPublicationId), {
            socialAccountId: account.id,
            externalPublicationId: publication.externalPublicationId,
            sourceFingerprint: fingerprint,
            linkedEpisodeId: null,
          });
          classified += 1;
        } catch (error) {
          failures.push({
            socialAccountId: account.id,
            externalPublicationId: publication.externalPublicationId,
            code: this.safeFailureCode(error),
          });
        }
      }
    }

    return { scanned, classified, skipped, failures };
  }

  private sourceKey(accountId: string, externalPublicationId: string): string {
    return `${accountId}\u0000${externalPublicationId}`;
  }

  private safeFailureCode(error: unknown): string {
    return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'ANALYTICS_EPISODE_CLASSIFICATION_FAILED';
  }
}

export class GetEpisodeReview {
  constructor(
    private readonly reviews: EpisodeReviewRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(requestedStage?: 'SERIES' | 'SEASONS' | 'EPISODES') {
    const tenantId = await this.tenant.resolveTenantId();
    const [storedSuggestions, series] = await Promise.all([
      this.reviews.listPendingSuggestions(tenantId),
      this.reviews.listSeries(tenantId),
    ]);
    const suggestions = storedSuggestions.map((suggestion) => {
      const currentIdentity = extractExplicitEpisodeIdentity(
        suggestion.publication.title,
        suggestion.publication.description,
      );
      return currentIdentity.episodeNumber === null && currentIdentity.seriesName === null
        ? suggestion
        : { ...suggestion, identity: currentIdentity };
    });
    if (!suggestions.length) {
      return { stage: 'COMPLETE' as const, series, seriesProposals: [], seasonProposals: [], groups: [], unmatched: [] };
    }

    const awaitingSeries = suggestions.filter((suggestion) => !suggestion.setupSeriesId || !suggestion.setupSeriesConfirmedAt);
    if (requestedStage === 'SERIES') {
      return {
        stage: 'SERIES' as const,
        series,
        seriesProposals: this.groupSeriesProposals(suggestions, series),
        seasonProposals: [],
        groups: [],
        unmatched: [],
      };
    }
    if (awaitingSeries.length) {
      return {
        stage: 'SERIES' as const,
        series,
        seriesProposals: this.groupSeriesProposals(awaitingSeries, series),
        seasonProposals: [],
        groups: [],
        unmatched: [],
      };
    }

    const seriesById = new Map(series.map((candidate) => [candidate.id, candidate]));
    const resolved = suggestions.flatMap((suggestion) => {
      const selectedSeries = suggestion.setupSeriesId ? seriesById.get(suggestion.setupSeriesId) : null;
      return selectedSeries ? [{ suggestion, selectedSeries }] : [];
    });
    const awaitingSeasons = resolved.filter(({ suggestion, selectedSeries }) => (
      selectedSeries.seasonMode === 'SEASONAL'
      && (!suggestion.setupSeasonConfirmedAt || !Number.isSafeInteger(suggestion.setupSeasonNumber)
        || (suggestion.setupSeasonNumber as number) < 1)
    ));
    if (requestedStage === 'SEASONS') {
      const seasonal = resolved.filter(({ selectedSeries }) => selectedSeries.seasonMode === 'SEASONAL');
      if (seasonal.length) {
        return {
          stage: 'SEASONS' as const,
          series,
          seriesProposals: [],
          seasonProposals: this.groupSeasonProposals(seasonal),
          groups: [],
          unmatched: [],
        };
      }
    }
    if (awaitingSeasons.length) {
      return {
        stage: 'SEASONS' as const,
        series,
        seriesProposals: [],
        seasonProposals: this.groupSeasonProposals(awaitingSeasons),
        groups: [],
        unmatched: [],
      };
    }

    const grouped = groupEpisodePublicationSuggestions(resolved.map(({ suggestion, selectedSeries }) => ({
      ...suggestion,
      seriesSeasonMode: selectedSeries.seasonMode,
      identity: {
        ...suggestion.identity,
        seriesName: selectedSeries.name,
        seasonNumber: selectedSeries.seasonMode === 'SEASONAL' ? suggestion.setupSeasonNumber : null,
        seasonStatus: selectedSeries.seasonMode === 'SEASONAL' ? 'NUMBERED' as const : 'NON_SEASONAL' as const,
      },
    })));
    return {
      stage: 'EPISODES' as const,
      series,
      seriesProposals: [],
      seasonProposals: [],
      groups: grouped.groups.map((group) => ({
        ...group,
        seriesId: series.find((candidate) => (
          normalizeSeriesIdentity(candidate.name) === normalizeSeriesIdentity(group.seriesName)
        ))?.id ?? null,
      })),
      unmatched: grouped.unmatched,
    };
  }

  private groupSeriesProposals(
    suggestions: readonly EpisodeReviewSuggestion[],
    series: readonly { readonly id: string; readonly name: string }[],
  ) {
    const groups = new Map<string, { suggestedName: string | null; suggestions: EpisodeReviewSuggestion[] }>();
    for (const suggestion of suggestions) {
      const confirmedSeries = series.find((candidate) => candidate.id === suggestion.setupSeriesId);
      const suggestedName = confirmedSeries?.name ?? suggestion.identity.seriesName?.trim() ?? null;
      const normalizedName = suggestedName ? normalizeSeriesIdentity(suggestedName) : '';
      const key = confirmedSeries
        ? `confirmed:${confirmedSeries.id}`
        : normalizedName || `unmatched:${suggestion.id}`;
      const group = groups.get(key) ?? { suggestedName, suggestions: [] };
      group.suggestions.push(suggestion);
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  private groupSeasonProposals(
    awaitingSeasons: readonly {
      readonly suggestion: EpisodeReviewSuggestion;
      readonly selectedSeries: { readonly id: string; readonly name: string; readonly seasonMode: EpisodeReviewSeasonMode };
    }[],
  ) {
    const groups = new Map<string, {
      seriesId: string;
      seriesName: string;
      proposedSeasonNumber: number | null;
      suggestions: EpisodeReviewSuggestion[];
    }>();
    for (const { suggestion, selectedSeries } of awaitingSeasons) {
      const storedSeasonNumber = suggestion.setupSeasonConfirmedAt ? suggestion.setupSeasonNumber : null;
      const proposedSeasonNumber = storedSeasonNumber
        ?? (suggestion.identity.seasonStatus === 'NUMBERED'
          && Number.isSafeInteger(suggestion.identity.seasonNumber)
          && (suggestion.identity.seasonNumber as number) > 0
          ? suggestion.identity.seasonNumber
          : null);
      const episodeKey = suggestion.identity.episodeNumber ?? suggestion.id;
      const key = `${selectedSeries.id}\u0000${proposedSeasonNumber ?? 'unknown'}\u0000${episodeKey}`;
      const group = groups.get(key) ?? {
        seriesId: selectedSeries.id,
        seriesName: selectedSeries.name,
        proposedSeasonNumber,
        suggestions: [],
      };
      group.suggestions.push(suggestion);
      groups.set(key, group);
    }
    return [...groups.values()];
  }
}

export interface ConfirmEpisodeSetupSeriesInput {
  readonly suggestionIds: readonly string[];
  readonly seriesId?: string;
  readonly newSeries?: {
    readonly name: string;
    readonly aliases?: readonly string[];
    readonly seasonMode: EpisodeReviewSeasonMode;
  };
}

export class ConfirmEpisodeSetupSeries {
  constructor(
    private readonly reviews: EpisodeReviewRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: ConfirmEpisodeSetupSeriesInput) {
    const tenantId = await this.tenant.resolveTenantId();
    const suggestionIds = validSuggestionIds(input.suggestionIds);
    if (Boolean(input.seriesId) === Boolean(input.newSeries)) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
    let selection: EpisodeReviewApprovalCommand['series'];
    if (input.seriesId) {
      if (input.seriesId.trim() !== input.seriesId) throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
      selection = { id: input.seriesId };
    } else {
      const name = input.newSeries?.name?.trim();
      const seasonMode = input.newSeries?.seasonMode;
      const aliases = input.newSeries?.aliases ?? [];
      if (!name || name.length > 200 || !normalizeSeriesIdentity(name)
        || (seasonMode !== 'SEASONAL' && seasonMode !== 'NON_SEASONAL')
        || !Array.isArray(aliases)
        || aliases.some((alias) => typeof alias !== 'string' || alias.trim().length > 200)) {
        throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
      }
      selection = {
        name,
        aliases: [...new Set(aliases.map((alias) => alias.trim()).filter((alias) => (
          alias && normalizeSeriesIdentity(alias) !== normalizeSeriesIdentity(name)
        )))],
        seasonMode,
      };
    }
    const decidedAt = new Date(this.now()).toISOString();
    return this.reviews.confirmSetupSeries(tenantId, suggestionIds, selection, reviewActorId, decidedAt);
  }
}

export class ConfirmEpisodeSetupSeasons {
  constructor(
    private readonly reviews: EpisodeReviewRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: { readonly suggestionIds: readonly string[]; readonly seasonNumber: number }) {
    const tenantId = await this.tenant.resolveTenantId();
    const suggestionIds = validSuggestionIds(input.suggestionIds);
    if (!Number.isSafeInteger(input.seasonNumber) || input.seasonNumber < 1) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
    const decidedAt = new Date(this.now()).toISOString();
    return this.reviews.confirmSetupSeason(tenantId, suggestionIds, input.seasonNumber, reviewActorId, decidedAt);
  }
}

export interface ApproveEpisodeSuggestionGroupInput {
  readonly suggestionIds: readonly string[];
  readonly seriesId?: string;
  readonly newSeries?: {
    readonly name: string;
    readonly aliases?: readonly string[];
    readonly seasonMode: EpisodeReviewSeasonMode;
  };
  readonly seasonNumber: number | null;
  readonly episodeNumber: number;
  readonly episodeCode: string;
}

export class ApproveEpisodeSuggestionGroup {
  constructor(
    private readonly reviews: EpisodeReviewRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: ApproveEpisodeSuggestionGroupInput): Promise<EpisodeReviewApprovalResult> {
    const tenantId = await this.tenant.resolveTenantId();
    const suggestionIds = this.validSuggestionIds(input.suggestionIds);
    const series = await this.resolveSeries(tenantId, input);
    const episodeCode = input.episodeCode?.trim();
    if (!episodeCode || episodeCode.length > 100
      || !Number.isSafeInteger(input.episodeNumber) || input.episodeNumber < 1
      || (series.seasonMode === 'SEASONAL'
        && (!Number.isSafeInteger(input.seasonNumber) || (input.seasonNumber as number) < 1))
      || (series.seasonMode === 'NON_SEASONAL' && input.seasonNumber !== null)) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }

    const command: EpisodeReviewApprovalCommand = {
      suggestionIds,
      series,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
      episodeCode,
      actorId: reviewActorId,
      decidedAt: new Date(this.now()).toISOString(),
    };
    return this.reviews.approveGroup(tenantId, command);
  }

  private async resolveSeries(
    tenantId: string,
    input: ApproveEpisodeSuggestionGroupInput,
  ): Promise<EpisodeReviewApprovalCommand['series']> {
    if (input.seriesId && input.newSeries) throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    if (input.seriesId) {
      const series = await this.reviews.findSeriesById(tenantId, input.seriesId);
      if (!series) throw new EpisodeReviewError('ANALYTICS_EPISODE_SERIES_NOT_FOUND');
      return { id: series.id, seasonMode: series.seasonMode };
    }
    const name = input.newSeries?.name?.trim();
    const seasonMode = input.newSeries?.seasonMode;
    if (!name || name.length > 200 || (seasonMode !== 'SEASONAL' && seasonMode !== 'NON_SEASONAL')) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
    const aliases = [...new Set((input.newSeries?.aliases ?? [])
      .map((alias) => alias.trim())
      .filter((alias) => alias && normalizeSeriesIdentity(alias) !== normalizeSeriesIdentity(name)))];
    if (aliases.some((alias) => alias.length > 200)) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
    return { name, aliases, seasonMode };
  }

  private validSuggestionIds(ids: readonly string[]): readonly string[] {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50
      || ids.some((id) => typeof id !== 'string' || !id.trim())
      || new Set(ids).size !== ids.length) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
    return ids;
  }
}

export class DecideEpisodeSuggestions {
  constructor(
    private readonly reviews: EpisodeReviewRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: {
    readonly suggestionIds: readonly string[];
    readonly decision: 'REJECTED' | 'DEFERRED';
  }): Promise<{ readonly updated: number }> {
    if (input.decision !== 'REJECTED' && input.decision !== 'DEFERRED') {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
    const ids = input.suggestionIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50
      || ids.some((id) => typeof id !== 'string' || !id.trim())
      || new Set(ids).size !== ids.length) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
    }
    const tenantId = await this.tenant.resolveTenantId();
    const updated = await this.reviews.decideSuggestions(
      tenantId,
      ids,
      input.decision,
      reviewActorId,
      new Date(this.now()).toISOString(),
    );
    return { updated };
  }
}

function validSuggestionIds(ids: readonly string[]): readonly string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50
    || ids.some((id) => typeof id !== 'string' || !id.trim())
    || new Set(ids).size !== ids.length) {
    throw new EpisodeReviewError('ANALYTICS_EPISODE_INPUT_INVALID');
  }
  return ids;
}
