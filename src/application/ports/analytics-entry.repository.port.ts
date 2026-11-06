import type { SocialAccountId } from '../../domain/social/social-account-id';
import type { EpisodeReviewSeasonMode, EpisodeReviewSeries } from './episode-review.repository.port';
import type { SocialPlatform } from '../../domain/social/social-account';
import type { AnalyticsDashboardSourceData } from '../../domain/analytics/dashboard-report';

export type AnalyticsPerformancePlatform = 'instagram' | 'facebook' | 'tiktok';
export type AnalyticsRevenuePlatform = AnalyticsPerformancePlatform;

export interface AnalyticsMoneyAmount {
  readonly amount: string;
  readonly currency: 'BRL';
}

export interface AnalyticsEpisodeRecord {
  readonly id: string;
  readonly seriesId: string;
  readonly seasonNumber: number | null;
  readonly episodeNumber: number;
  readonly episodeCode: string;
  readonly productionCost: AnalyticsMoneyAmount | null;
  readonly productionTimeSeconds: number | null;
}

export interface AnalyticsSeriesEpisodePublication {
  readonly platform: SocialPlatform;
  readonly socialAccountId: SocialAccountId;
  readonly socialAccountName: string | null;
  readonly externalPublicationId: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly permalink: string | null;
  readonly thumbnailUrl: string | null;
  readonly publishedAt: string | null;
}

export interface AnalyticsSeriesEpisodeDetails extends AnalyticsEpisodeRecord {
  readonly publications: readonly AnalyticsSeriesEpisodePublication[];
}

export interface AvailableEpisodePublication {
  readonly platform: SocialPlatform;
  readonly socialAccountId: SocialAccountId;
  readonly socialAccountName: string | null;
  readonly externalPublicationId: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly permalink: string | null;
  readonly thumbnailUrl: string | null;
  readonly publishedAt: string | null;
}

export interface ManualEpisodePublicationSelection {
  readonly socialAccountId: SocialAccountId;
  readonly externalPublicationId: string;
}

export interface CreateEpisodeWithPublicationsInput {
  readonly seriesId: string;
  readonly seasonNumber: number | null;
  readonly episodeNumber: number;
  readonly episodeCode: string;
  readonly productionCost: AnalyticsMoneyAmount | null;
  readonly productionTimeSeconds: number | null;
  readonly publicationSelections: readonly ManualEpisodePublicationSelection[];
  readonly actorId: string;
  readonly at: string;
}

export interface ManualEpisodeCreationResult {
  readonly episode: AnalyticsEpisodeRecord;
  readonly linkedPublicationCount: number;
}

export interface PerformanceMetricValues {
  readonly views: number | null;
  readonly likes: number | null;
  readonly comments: number | null;
  readonly shares: number | null;
  readonly saves: number | null;
  readonly reach: number | null;
  readonly followersGained: number | null;
  readonly profileVisits: number | null;
  readonly averageWatchTimeSeconds: number | null;
  readonly retentionPercent: number | null;
}

export type PerformanceMetricDefinitions = Partial<Record<keyof PerformanceMetricValues, string>>;

export interface PerformanceObservationRecord {
  readonly id: string;
  readonly episodeId: string;
  readonly socialAccountId: SocialAccountId;
  readonly externalPublicationId: string;
  readonly platform: AnalyticsPerformancePlatform;
  readonly observedAt: string;
  readonly publishedAt: string;
  readonly durationSeconds: number;
  readonly metrics: PerformanceMetricValues;
  readonly metricDefinitions: PerformanceMetricDefinitions | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AccountFollowerSnapshotRecord {
  readonly socialAccountId: SocialAccountId;
  readonly observedAt: string;
  readonly totalFollowers: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MonthlyPlatformRevenueRecord {
  readonly platform: AnalyticsRevenuePlatform;
  readonly month: string;
  readonly amount: AnalyticsMoneyAmount;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalyticsEntryRepository {
  getDashboardData(tenantId: string): Promise<AnalyticsDashboardSourceData>;

  listEpisodesBySeries(tenantId: string, seriesId: string): Promise<readonly AnalyticsSeriesEpisodeDetails[]>;

  listUnlinkedPublications(tenantId: string, platform: SocialPlatform): Promise<readonly AvailableEpisodePublication[]>;

  createSeries(
    tenantId: string,
    input: {
      readonly name: string;
      readonly aliases: readonly string[];
      readonly seasonMode: EpisodeReviewSeasonMode;
      readonly actorId: string;
      readonly at: string;
    },
  ): Promise<EpisodeReviewSeries>;

  createEpisode(
    tenantId: string,
    input: {
      readonly seriesId: string;
      readonly seasonNumber: number | null;
      readonly episodeNumber: number;
      readonly episodeCode: string;
      readonly productionCost: AnalyticsMoneyAmount | null;
      readonly productionTimeSeconds: number | null;
      readonly actorId: string;
      readonly at: string;
    },
  ): Promise<AnalyticsEpisodeRecord>;

  createEpisodeWithPublications(
    tenantId: string,
    input: CreateEpisodeWithPublicationsInput,
  ): Promise<ManualEpisodeCreationResult>;

  findEpisodeById(tenantId: string, episodeId: string): Promise<AnalyticsEpisodeRecord | null>;

  updateEpisode(
    tenantId: string,
    input: {
      readonly episodeId: string;
      readonly seriesId: string;
      readonly seasonNumber: number | null;
      readonly episodeNumber: number;
      readonly episodeCode: string;
      readonly productionCost: AnalyticsMoneyAmount | null;
      readonly productionTimeSeconds: number | null;
      readonly actorId: string;
      readonly at: string;
    },
  ): Promise<AnalyticsEpisodeRecord>;

  replaceEpisodePublicationLink(
    tenantId: string,
    input: {
      readonly episodeId: string;
      readonly socialAccountId: SocialAccountId;
      readonly externalPublicationId: string;
      readonly next: ManualEpisodePublicationSelection | null;
      readonly actorId: string;
      readonly at: string;
    },
  ): Promise<{ readonly replaced: boolean }>;

  moveEpisodePublicationLink(
    tenantId: string,
    input: {
      readonly episodeId: string;
      readonly socialAccountId: SocialAccountId;
      readonly externalPublicationId: string;
      readonly target: { readonly seasonNumber: number | null; readonly episodeNumber: number };
      readonly actorId: string;
      readonly at: string;
    },
  ): Promise<{ readonly moved: boolean }>;

  updateEpisodeEconomics(
    tenantId: string,
    input: {
      readonly episodeId: string;
      readonly productionCost: AnalyticsMoneyAmount | null;
      readonly productionTimeSeconds: number | null;
      readonly actorId: string;
      readonly at: string;
    },
  ): Promise<AnalyticsEpisodeRecord>;

  savePerformanceObservation(
    tenantId: string,
    input: {
      readonly episodeId: string;
      readonly socialAccountId: SocialAccountId;
      readonly externalPublicationId: string;
      readonly observedAt: string;
      readonly publishedAt: string;
      readonly durationSeconds: number;
      readonly metrics: PerformanceMetricValues;
      readonly metricDefinitions: PerformanceMetricDefinitions | null;
      readonly actorId: string;
      readonly at: string;
    },
  ): Promise<PerformanceObservationRecord>;

  saveAccountFollowerSnapshot(
    tenantId: string,
    input: {
      readonly socialAccountId: SocialAccountId;
      readonly observedAt: string;
      readonly totalFollowers: number;
      readonly actorId: string;
      readonly at: string;
    },
  ): Promise<AccountFollowerSnapshotRecord>;

  saveMonthlyPlatformRevenue(
    tenantId: string,
    input: {
      readonly platform: AnalyticsRevenuePlatform;
      readonly month: string;
      readonly amount: AnalyticsMoneyAmount;
      readonly actorId: string;
      readonly at: string;
    },
  ): Promise<MonthlyPlatformRevenueRecord>;
}
