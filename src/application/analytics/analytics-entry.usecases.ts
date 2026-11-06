import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type {
  AnalyticsEntryRepository,
  AnalyticsEpisodeRecord,
  AnalyticsMoneyAmount,
  AnalyticsSeriesEpisodeDetails,
  AccountFollowerSnapshotRecord,
  AvailableEpisodePublication,
  ManualEpisodeCreationResult,
  ManualEpisodePublicationSelection,
  MonthlyPlatformRevenueRecord,
  PerformanceMetricDefinitions,
  PerformanceMetricValues,
  PerformanceObservationRecord,
} from '../ports/analytics-entry.repository.port';
import type { EpisodeReviewSeasonMode, EpisodeReviewSeries } from '../ports/episode-review.repository.port';
import { generateCanonicalEpisodeCode, normalizeSeriesIdentity } from '../../domain/analytics/episode-identity';
import { parseSocialAccountId, type SocialAccountId } from '../../domain/social/social-account-id';
import type { SocialPlatform } from '../../domain/social/social-account';
import { buildAnalyticsDashboardReport } from '../../domain/analytics/dashboard-report';
import { AnalyticsEntryError } from './analytics-entry-error';

const entryActorId = 'LOCAL_PILOT_CREATOR';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const moneyAmountPattern = /^\d{1,12}(\.\d{1,2})?$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const isoInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
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
const metricKeys = [...counterMetrics, ...durationMetrics] as const;

export class GetAnalyticsDashboard {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute() {
    const tenantId = await this.tenant.resolveTenantId();
    const data = await this.entries.getDashboardData(tenantId);
    return buildAnalyticsDashboardReport(data, this.now());
  }
}

function invalid(): never {
  throw new AnalyticsEntryError('ANALYTICS_ENTRY_INPUT_INVALID');
}

function requireUuid(value: string): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) invalid();
  return value;
}

function requireAccountId(value: string): SocialAccountId {
  try {
    return parseSocialAccountId(requireUuid(value));
  } catch {
    return invalid();
  }
}

function requireIsoInstant(value: string): string {
  if (typeof value !== 'string' || !isoInstantPattern.test(value) || !Number.isFinite(Date.parse(value))) {
    invalid();
  }
  return new Date(value).toISOString();
}

function requireNonNegativeInteger(value: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function requireMoneyAmount(value: AnalyticsMoneyAmount | null): AnalyticsMoneyAmount | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object'
    || typeof value.amount !== 'string'
    || !moneyAmountPattern.test(value.amount)
    || value.currency !== 'BRL') {
    invalid();
  }
  return { amount: value.amount, currency: 'BRL' };
}

function readMetricValues(metrics: PerformanceMetricValues): PerformanceMetricValues {
  if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) invalid();
  const normalized: Record<string, number | null> = {};
  for (const key of Object.keys(metrics)) {
    if (!(metricKeys as readonly string[]).includes(key)) invalid();
  }
  for (const key of counterMetrics) {
    const value = metrics[key];
    if (value === undefined || value === null) {
      normalized[key] = null;
      continue;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
    normalized[key] = value;
  }
  for (const key of durationMetrics) {
    const value = metrics[key];
    if (value === undefined || value === null) {
      normalized[key] = null;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid();
    normalized[key] = value;
  }
  return normalized as unknown as PerformanceMetricValues;
}

function readMetricDefinitions(
  definitions: PerformanceMetricDefinitions | null | undefined,
): PerformanceMetricDefinitions | null {
  if (definitions === null || definitions === undefined) return null;
  if (typeof definitions !== 'object' || Array.isArray(definitions)) invalid();
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(definitions)) {
    if (!(metricKeys as readonly string[]).includes(key)
      || typeof value !== 'string'
      || value.length > 500) {
      invalid();
    }
    normalized[key] = value;
  }
  return normalized;
}

export class CreateAnalyticsSeries {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: {
    readonly name: string;
    readonly aliases?: readonly string[];
    readonly seasonMode: EpisodeReviewSeasonMode;
  }): Promise<EpisodeReviewSeries> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 200 || !normalizeSeriesIdentity(name)
      || (input.seasonMode !== 'SEASONAL' && input.seasonMode !== 'NON_SEASONAL')) {
      invalid();
    }
    if (input.aliases !== undefined && !Array.isArray(input.aliases)) invalid();
    const normalizedName = normalizeSeriesIdentity(name);
    const aliases = [...new Set((input.aliases ?? []).map((alias) => {
      if (typeof alias !== 'string') invalid();
      return alias.trim();
    }).filter((alias) => alias && normalizeSeriesIdentity(alias) !== normalizedName))];
    if (aliases.some((alias) => alias.length > 200)) invalid();
    const tenantId = await this.tenant.resolveTenantId();
    return this.entries.createSeries(tenantId, {
      name,
      aliases,
      seasonMode: input.seasonMode,
      actorId: entryActorId,
      at: new Date(this.now()).toISOString(),
    });
  }
}

export class ListAnalyticsEpisodesBySeries {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(seriesId: string): Promise<readonly AnalyticsSeriesEpisodeDetails[]> {
    const tenantId = await this.tenant.resolveTenantId();
    return this.entries.listEpisodesBySeries(tenantId, requireUuid(seriesId));
  }
}

export interface CreateAnalyticsEpisodeInput {
  readonly seriesId: string;
  readonly seasonNumber: number | null;
  readonly episodeNumber: number;
  readonly episodeCode?: string;
  readonly productionCost: AnalyticsMoneyAmount | null;
  readonly productionTimeSeconds: number | null;
}

export class CreateAnalyticsEpisode {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: CreateAnalyticsEpisodeInput): Promise<AnalyticsEpisodeRecord> {
    const providedEpisodeCode = typeof input.episodeCode === 'string' ? input.episodeCode.trim() : '';
    if ((input.episodeCode !== undefined && typeof input.episodeCode !== 'string')
      || providedEpisodeCode.length > 100
      || typeof input.episodeNumber !== 'number' || !Number.isSafeInteger(input.episodeNumber) || input.episodeNumber < 1) {
      invalid();
    }
    if (input.seasonNumber !== null
      && (typeof input.seasonNumber !== 'number' || !Number.isSafeInteger(input.seasonNumber) || input.seasonNumber < 1)) {
      invalid();
    }
    const productionCost = requireMoneyAmount(input.productionCost);
    const productionTimeSeconds = input.productionTimeSeconds === null || input.productionTimeSeconds === undefined
      ? null
      : requireNonNegativeInteger(input.productionTimeSeconds);
    const seriesId = requireUuid(input.seriesId);
    const episodeCode = providedEpisodeCode || generateCanonicalEpisodeCode(
      seriesId,
      input.seasonNumber,
      input.episodeNumber,
    );
    const tenantId = await this.tenant.resolveTenantId();
    return this.entries.createEpisode(tenantId, {
      seriesId,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
      episodeCode,
      productionCost,
      productionTimeSeconds,
      actorId: entryActorId,
      at: new Date(this.now()).toISOString(),
    });
  }
}

export interface CreateManualAnalyticsEpisodeInput extends CreateAnalyticsEpisodeInput {
  readonly publicationSelections: readonly {
    readonly socialAccountId: string;
    readonly externalPublicationId: string;
  }[];
}

export class CreateManualAnalyticsEpisode {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: CreateManualAnalyticsEpisodeInput): Promise<ManualEpisodeCreationResult> {
    const providedEpisodeCode = typeof input.episodeCode === 'string' ? input.episodeCode.trim() : '';
    if ((input.episodeCode !== undefined && typeof input.episodeCode !== 'string')
      || providedEpisodeCode.length > 100
      || !Number.isSafeInteger(input.episodeNumber) || input.episodeNumber < 1
      || (input.seasonNumber !== null
        && (!Number.isSafeInteger(input.seasonNumber) || input.seasonNumber < 1))) {
      invalid();
    }
    const productionCost = requireMoneyAmount(input.productionCost);
    const productionTimeSeconds = input.productionTimeSeconds === null || input.productionTimeSeconds === undefined
      ? null
      : requireNonNegativeInteger(input.productionTimeSeconds);
    if (!Array.isArray(input.publicationSelections) || input.publicationSelections.length > 4) invalid();
    const seenSources = new Set<string>();
    const publicationSelections: ManualEpisodePublicationSelection[] = input.publicationSelections.map((selection) => {
      if (typeof selection !== 'object' || selection === null
        || typeof selection.externalPublicationId !== 'string'
        || !selection.externalPublicationId.trim()) {
        invalid();
      }
      const socialAccountId = requireAccountId(selection.socialAccountId);
      const key = `${socialAccountId}\u0000${selection.externalPublicationId}`;
      if (seenSources.has(key)) invalid();
      seenSources.add(key);
      return { socialAccountId, externalPublicationId: selection.externalPublicationId };
    });
    const seriesId = requireUuid(input.seriesId);
    const episodeCode = providedEpisodeCode || generateCanonicalEpisodeCode(
      seriesId,
      input.seasonNumber,
      input.episodeNumber,
    );
    const tenantId = await this.tenant.resolveTenantId();
    return this.entries.createEpisodeWithPublications(tenantId, {
      seriesId,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
      episodeCode,
      productionCost,
      productionTimeSeconds,
      publicationSelections,
      actorId: entryActorId,
      at: new Date(this.now()).toISOString(),
    });
  }
}

export class ListAvailableEpisodePublications {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(input: { readonly platform: string }): Promise<readonly AvailableEpisodePublication[]> {
    const supportedPlatforms: readonly SocialPlatform[] = ['instagram', 'tiktok', 'youtube', 'facebook'];
    if (!supportedPlatforms.includes(input.platform as SocialPlatform)) {
      throw new AnalyticsEntryError('ANALYTICS_ENTRY_PLATFORM_UNSUPPORTED');
    }
    const tenantId = await this.tenant.resolveTenantId();
    return this.entries.listUnlinkedPublications(tenantId, input.platform as SocialPlatform);
  }
}

export class UpdateAnalyticsEpisode {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: {
    readonly episodeId: string;
    readonly seriesId: string;
    readonly seasonNumber: number | null;
    readonly episodeNumber: number;
    readonly episodeCode?: string;
    readonly productionCost: AnalyticsMoneyAmount | null;
    readonly productionTimeSeconds: number | null;
  }): Promise<AnalyticsEpisodeRecord> {
    const episodeId = requireUuid(input.episodeId);
    const seriesId = requireUuid(input.seriesId);
    const providedEpisodeCode = typeof input.episodeCode === 'string' ? input.episodeCode.trim() : '';
    if ((input.episodeCode !== undefined && typeof input.episodeCode !== 'string')
      || providedEpisodeCode.length > 100
      || !Number.isSafeInteger(input.episodeNumber) || input.episodeNumber < 1
      || (input.seasonNumber !== null
        && (!Number.isSafeInteger(input.seasonNumber) || input.seasonNumber < 1))) {
      invalid();
    }
    const productionCost = requireMoneyAmount(input.productionCost);
    const productionTimeSeconds = input.productionTimeSeconds === null || input.productionTimeSeconds === undefined
      ? null
      : requireNonNegativeInteger(input.productionTimeSeconds);
    const tenantId = await this.tenant.resolveTenantId();
    const existing = await this.entries.findEpisodeById(tenantId, episodeId);
    if (!existing) throw new AnalyticsEntryError('ANALYTICS_ENTRY_EPISODE_NOT_FOUND');
    const episodeCode = providedEpisodeCode || existing.episodeCode;
    return this.entries.updateEpisode(tenantId, {
      episodeId,
      seriesId,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
      episodeCode,
      productionCost,
      productionTimeSeconds,
      actorId: entryActorId,
      at: new Date(this.now()).toISOString(),
    });
  }
}

export class UpdateAnalyticsEpisodePublication {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: {
    readonly episodeId: string;
    readonly socialAccountId: string;
    readonly externalPublicationId: string;
    readonly next?: { readonly socialAccountId: string; readonly externalPublicationId: string } | null;
    readonly moveTo?: { readonly seasonNumber: number | null; readonly episodeNumber: number };
  }): Promise<{ readonly replaced?: boolean; readonly moved?: boolean }> {
    const episodeId = requireUuid(input.episodeId);
    const socialAccountId = requireAccountId(input.socialAccountId);
    const externalPublicationId = typeof input.externalPublicationId === 'string'
      ? input.externalPublicationId.trim()
      : '';
    if (!externalPublicationId || externalPublicationId.length > 300) invalid();
    const hasNext = input.next !== undefined;
    const hasMoveTo = input.moveTo !== undefined;
    if (hasNext === hasMoveTo) invalid();
    const tenantId = await this.tenant.resolveTenantId();
    const at = new Date(this.now()).toISOString();
    if (hasMoveTo) {
      const moveTo = input.moveTo;
      if (typeof moveTo !== 'object' || moveTo === null
        || !Number.isSafeInteger(moveTo.episodeNumber) || moveTo.episodeNumber < 1
        || (moveTo.seasonNumber !== null
          && (!Number.isSafeInteger(moveTo.seasonNumber) || moveTo.seasonNumber < 1))) {
        invalid();
      }
      return this.entries.moveEpisodePublicationLink(tenantId, {
        episodeId,
        socialAccountId,
        externalPublicationId,
        target: { seasonNumber: moveTo.seasonNumber, episodeNumber: moveTo.episodeNumber },
        actorId: entryActorId,
        at,
      });
    }
    let next: ManualEpisodePublicationSelection | null = null;
    if (input.next !== null) {
      if (typeof input.next !== 'object') invalid();
      const nextAccountId = requireAccountId(input.next.socialAccountId);
      const nextExternalId = typeof input.next.externalPublicationId === 'string'
        ? input.next.externalPublicationId.trim()
        : '';
      if (!nextExternalId || nextExternalId.length > 300) invalid();
      next = { socialAccountId: nextAccountId, externalPublicationId: nextExternalId };
    }
    return this.entries.replaceEpisodePublicationLink(tenantId, {
      episodeId,
      socialAccountId,
      externalPublicationId,
      next,
      actorId: entryActorId,
      at,
    });
  }
}

export class UpdateAnalyticsEpisodeEconomics {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: {
    readonly episodeId: string;
    readonly productionCost: AnalyticsMoneyAmount | null;
    readonly productionTimeSeconds: number | null;
  }): Promise<AnalyticsEpisodeRecord> {
    const episodeId = requireUuid(input.episodeId);
    const productionCost = requireMoneyAmount(input.productionCost);
    const productionTimeSeconds = input.productionTimeSeconds === null || input.productionTimeSeconds === undefined
      ? null
      : requireNonNegativeInteger(input.productionTimeSeconds);
    const tenantId = await this.tenant.resolveTenantId();
    const episode = await this.entries.findEpisodeById(tenantId, episodeId);
    if (!episode) throw new AnalyticsEntryError('ANALYTICS_ENTRY_EPISODE_NOT_FOUND');
    return this.entries.updateEpisodeEconomics(tenantId, {
      episodeId,
      productionCost,
      productionTimeSeconds,
      actorId: entryActorId,
      at: new Date(this.now()).toISOString(),
    });
  }
}

export interface UpsertAnalyticsPerformanceObservationInput {
  readonly episodeId: string;
  readonly socialAccountId: string;
  readonly externalPublicationId: string;
  readonly observedAt: string;
  readonly publishedAt: string;
  readonly durationSeconds: number;
  readonly metrics: PerformanceMetricValues;
  readonly metricDefinitions?: PerformanceMetricDefinitions | null;
}

export class UpsertAnalyticsPerformanceObservation {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: UpsertAnalyticsPerformanceObservationInput): Promise<PerformanceObservationRecord> {
    const episodeId = requireUuid(input.episodeId);
    const socialAccountId = requireAccountId(input.socialAccountId);
    const externalPublicationId = typeof input.externalPublicationId === 'string'
      ? input.externalPublicationId.trim()
      : '';
    if (!externalPublicationId || externalPublicationId.length > 300) invalid();
    const observedAt = requireIsoInstant(input.observedAt);
    const publishedAt = requireIsoInstant(input.publishedAt);
    const durationSeconds = requireNonNegativeInteger(input.durationSeconds);
    const metrics = readMetricValues(input.metrics);
    const metricDefinitions = readMetricDefinitions(input.metricDefinitions);
    const tenantId = await this.tenant.resolveTenantId();
    return this.entries.savePerformanceObservation(tenantId, {
      episodeId,
      socialAccountId,
      externalPublicationId,
      observedAt,
      publishedAt,
      durationSeconds,
      metrics,
      metricDefinitions,
      actorId: entryActorId,
      at: new Date(this.now()).toISOString(),
    });
  }
}

export class UpsertAnalyticsFollowerSnapshot {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: {
    readonly socialAccountId: string;
    readonly observedAt: string;
    readonly totalFollowers: number;
  }): Promise<AccountFollowerSnapshotRecord> {
    const socialAccountId = requireAccountId(input.socialAccountId);
    const observedAt = requireIsoInstant(input.observedAt);
    const totalFollowers = requireNonNegativeInteger(input.totalFollowers);
    const tenantId = await this.tenant.resolveTenantId();
    return this.entries.saveAccountFollowerSnapshot(tenantId, {
      socialAccountId,
      observedAt,
      totalFollowers,
      actorId: entryActorId,
      at: new Date(this.now()).toISOString(),
    });
  }
}

export class UpsertAnalyticsMonthlyRevenue {
  constructor(
    private readonly entries: AnalyticsEntryRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: {
    readonly platform: string;
    readonly month: string;
    readonly amount: AnalyticsMoneyAmount;
  }): Promise<MonthlyPlatformRevenueRecord> {
    if (typeof input.platform !== 'string'
      || !(performancePlatforms as readonly string[]).includes(input.platform)
      || typeof input.month !== 'string'
      || !monthPattern.test(input.month)) {
      invalid();
    }
    const amount = requireMoneyAmount(input.amount);
    if (!amount) invalid();
    const tenantId = await this.tenant.resolveTenantId();
    return this.entries.saveMonthlyPlatformRevenue(tenantId, {
      platform: input.platform as 'tiktok' | 'instagram' | 'facebook',
      month: `${input.month}-01`,
      amount,
      actorId: entryActorId,
      at: new Date(this.now()).toISOString(),
    });
  }
}
