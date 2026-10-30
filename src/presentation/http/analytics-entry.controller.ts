import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import type { AnalyticsEntryErrorCode } from '../../application/analytics/analytics-entry-error';
import {
  CreateAnalyticsEpisode,
  CreateAnalyticsSeries,
  CreateManualAnalyticsEpisode,
  ListAvailableEpisodePublications,
  UpdateAnalyticsEpisodeEconomics,
  UpsertAnalyticsFollowerSnapshot,
  UpsertAnalyticsMonthlyRevenue,
  UpsertAnalyticsPerformanceObservation,
} from '../../application/analytics/analytics-entry.usecases';
import type {
  CreateManualAnalyticsEpisodeInput,
  CreateAnalyticsEpisodeInput,
  UpsertAnalyticsPerformanceObservationInput,
} from '../../application/analytics/analytics-entry.usecases';
import type {
  AnalyticsMoneyAmount,
  PerformanceMetricDefinitions,
  PerformanceMetricValues,
} from '../../application/ports/analytics-entry.repository.port';

const seriesKeys = ['name', 'aliases', 'seasonMode'] as const;
const episodeKeys = ['seriesId', 'seasonNumber', 'episodeNumber', 'episodeCode', 'productionCost', 'productionTimeSeconds'] as const;
const manualEpisodeKeys = [...episodeKeys, 'publicationSelections'] as const;
const manualPublicationSelectionKeys = ['socialAccountId', 'externalPublicationId'] as const;
const economicsKeys = ['productionCost', 'productionTimeSeconds'] as const;
const observationKeys = [
  'episodeId',
  'socialAccountId',
  'externalPublicationId',
  'observedAt',
  'publishedAt',
  'durationSeconds',
  'metrics',
  'metricDefinitions',
] as const;
const snapshotKeys = ['socialAccountId', 'observedAt', 'totalFollowers'] as const;
const revenueKeys = ['platform', 'month', 'amount'] as const;
const moneyKeys = ['amount', 'currency'] as const;

@Controller('analytics')
export class AnalyticsEntryController {
  constructor(
    private readonly createSeries: CreateAnalyticsSeries,
    private readonly createEpisode: CreateAnalyticsEpisode,
    private readonly createManualEpisode: CreateManualAnalyticsEpisode,
    private readonly listAvailableEpisodePublications: ListAvailableEpisodePublications,
    private readonly updateEconomics: UpdateAnalyticsEpisodeEconomics,
    private readonly upsertObservation: UpsertAnalyticsPerformanceObservation,
    private readonly upsertSnapshot: UpsertAnalyticsFollowerSnapshot,
    private readonly upsertRevenue: UpsertAnalyticsMonthlyRevenue,
  ) {}

  @Post('series')
  async createAnalyticsSeries(@Body() body: unknown) {
    if (!hasOnlyKeys(body, seriesKeys)
      || typeof body.name !== 'string'
      || (body.aliases !== undefined && (!Array.isArray(body.aliases) || body.aliases.some((alias) => typeof alias !== 'string')))
      || (body.seasonMode !== 'SEASONAL' && body.seasonMode !== 'NON_SEASONAL')) {
      this.throwInvalid();
    }
    try {
      return await this.createSeries.execute({
        name: body.name,
        aliases: body.aliases as string[] | undefined,
        seasonMode: body.seasonMode,
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post('episodes')
  async createAnalyticsEpisode(@Body() body: unknown) {
    if (!hasOnlyKeys(body, episodeKeys)
      || typeof body.seriesId !== 'string'
      || !(body.seasonNumber === null || typeof body.seasonNumber === 'number')
      || typeof body.episodeNumber !== 'number'
      || typeof body.episodeCode !== 'string'
      || !isNullableMoney(body.productionCost)
      || !isNullableInteger(body.productionTimeSeconds)) {
      this.throwInvalid();
    }
    try {
      return await this.createEpisode.execute({
        seriesId: body.seriesId,
        seasonNumber: body.seasonNumber,
        episodeNumber: body.episodeNumber,
        episodeCode: body.episodeCode,
        productionCost: (body.productionCost ?? null) as AnalyticsMoneyAmount | null,
        productionTimeSeconds: (body.productionTimeSeconds ?? null) as number | null,
      } satisfies CreateAnalyticsEpisodeInput);
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Get('episodes/manual/publications')
  async listAvailableManualEpisodePublications(@Query('platform') platform?: string) {
    if (typeof platform !== 'string' || !['instagram', 'tiktok', 'youtube', 'facebook'].includes(platform)) {
      this.throwInvalid();
    }
    try {
      return await this.listAvailableEpisodePublications.execute({ platform });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post('episodes/manual')
  async createManualAnalyticsEpisode(@Body() body: unknown) {
    if (!hasOnlyKeys(body, manualEpisodeKeys)
      || typeof body.seriesId !== 'string'
      || !(body.seasonNumber === null || typeof body.seasonNumber === 'number')
      || typeof body.episodeNumber !== 'number'
      || typeof body.episodeCode !== 'string'
      || !isNullableMoney(body.productionCost)
      || !isNullableInteger(body.productionTimeSeconds)
      || !Array.isArray(body.publicationSelections)
      || body.publicationSelections.some((selection) => (
        !hasOnlyKeys(selection, manualPublicationSelectionKeys)
        || typeof selection.socialAccountId !== 'string'
        || typeof selection.externalPublicationId !== 'string'
      ))) {
      this.throwInvalid();
    }
    try {
      return await this.createManualEpisode.execute({
        seriesId: body.seriesId,
        seasonNumber: body.seasonNumber,
        episodeNumber: body.episodeNumber,
        episodeCode: body.episodeCode,
        productionCost: (body.productionCost ?? null) as AnalyticsMoneyAmount | null,
        productionTimeSeconds: (body.productionTimeSeconds ?? null) as number | null,
        publicationSelections: body.publicationSelections as CreateManualAnalyticsEpisodeInput['publicationSelections'],
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Put('episodes/:episodeId/economics')
  async updateEpisodeEconomicsEntry(
    @Param('episodeId') episodeId: string,
    @Body() body: unknown,
  ) {
    if (!hasOnlyKeys(body, economicsKeys)
      || !isNullableMoney(body.productionCost)
      || !isNullableInteger(body.productionTimeSeconds)) {
      this.throwInvalid();
    }
    try {
      return await this.updateEconomics.execute({
        episodeId,
        productionCost: (body.productionCost ?? null) as AnalyticsMoneyAmount | null,
        productionTimeSeconds: (body.productionTimeSeconds ?? null) as number | null,
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Put('observations/performance')
  @HttpCode(HttpStatus.OK)
  async upsertPerformanceObservation(@Body() body: unknown) {
    if (!hasOnlyKeys(body, observationKeys)
      || typeof body.episodeId !== 'string'
      || typeof body.socialAccountId !== 'string'
      || typeof body.externalPublicationId !== 'string'
      || typeof body.observedAt !== 'string'
      || typeof body.publishedAt !== 'string'
      || typeof body.durationSeconds !== 'number'
      || typeof body.metrics !== 'object'
      || body.metrics === null
      || Array.isArray(body.metrics)
      || (body.metricDefinitions !== undefined
        && body.metricDefinitions !== null
        && (typeof body.metricDefinitions !== 'object' || Array.isArray(body.metricDefinitions)))) {
      this.throwInvalid();
    }
    try {
      return await this.upsertObservation.execute({
        episodeId: body.episodeId,
        socialAccountId: body.socialAccountId,
        externalPublicationId: body.externalPublicationId,
        observedAt: body.observedAt,
        publishedAt: body.publishedAt,
        durationSeconds: body.durationSeconds,
        metrics: body.metrics as PerformanceMetricValues,
        metricDefinitions: (body.metricDefinitions ?? null) as PerformanceMetricDefinitions | null,
      } satisfies UpsertAnalyticsPerformanceObservationInput);
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Put('audience/snapshots')
  @HttpCode(HttpStatus.OK)
  async upsertFollowerSnapshot(@Body() body: unknown) {
    if (!hasOnlyKeys(body, snapshotKeys)
      || typeof body.socialAccountId !== 'string'
      || typeof body.observedAt !== 'string'
      || typeof body.totalFollowers !== 'number') {
      this.throwInvalid();
    }
    try {
      return await this.upsertSnapshot.execute({
        socialAccountId: body.socialAccountId,
        observedAt: body.observedAt,
        totalFollowers: body.totalFollowers,
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Put('revenue/monthly')
  @HttpCode(HttpStatus.OK)
  async upsertMonthlyRevenue(@Body() body: unknown) {
    if (!hasOnlyKeys(body, revenueKeys)
      || typeof body.platform !== 'string'
      || typeof body.month !== 'string'
      || !isMoney(body.amount)) {
      this.throwInvalid();
    }
    try {
      return await this.upsertRevenue.execute({
        platform: body.platform,
        month: body.month,
        amount: body.amount as unknown as AnalyticsMoneyAmount,
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwInvalid(): never {
    throw new HttpException({ code: 'ANALYTICS_ENTRY_INPUT_INVALID' }, HttpStatus.BAD_REQUEST);
  }

  private throwHttpError(error: unknown): never {
    const requestedCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
    const code = requestedCode && isAnalyticsEntryErrorCode(requestedCode)
      ? requestedCode
      : 'ANALYTICS_ENTRY_SAVE_FAILED';
    const statusByCode: Record<AnalyticsEntryErrorCode, number> = {
      ANALYTICS_ENTRY_INPUT_INVALID: HttpStatus.BAD_REQUEST,
      ANALYTICS_ENTRY_SERIES_NOT_FOUND: HttpStatus.NOT_FOUND,
      ANALYTICS_ENTRY_EPISODE_NOT_FOUND: HttpStatus.NOT_FOUND,
      ANALYTICS_ENTRY_ACCOUNT_NOT_FOUND: HttpStatus.NOT_FOUND,
      ANALYTICS_ENTRY_PUBLICATION_NOT_LINKED: HttpStatus.NOT_FOUND,
      ANALYTICS_ENTRY_PUBLICATION_ALREADY_LINKED: HttpStatus.CONFLICT,
      ANALYTICS_ENTRY_PLATFORM_UNSUPPORTED: HttpStatus.BAD_REQUEST,
      ANALYTICS_ENTRY_SERIES_CONFLICT: HttpStatus.CONFLICT,
      ANALYTICS_ENTRY_EPISODE_CONFLICT: HttpStatus.CONFLICT,
      ANALYTICS_ENTRY_CODE_CONFLICT: HttpStatus.CONFLICT,
      ANALYTICS_ENTRY_SAVE_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
    };
    throw new HttpException({ code }, statusByCode[code]);
  }
}

function isAnalyticsEntryErrorCode(value: string): value is AnalyticsEntryErrorCode {
  return value === 'ANALYTICS_ENTRY_INPUT_INVALID'
    || value === 'ANALYTICS_ENTRY_SERIES_NOT_FOUND'
    || value === 'ANALYTICS_ENTRY_EPISODE_NOT_FOUND'
    || value === 'ANALYTICS_ENTRY_ACCOUNT_NOT_FOUND'
    || value === 'ANALYTICS_ENTRY_PUBLICATION_NOT_LINKED'
    || value === 'ANALYTICS_ENTRY_PUBLICATION_ALREADY_LINKED'
    || value === 'ANALYTICS_ENTRY_PLATFORM_UNSUPPORTED'
    || value === 'ANALYTICS_ENTRY_SERIES_CONFLICT'
    || value === 'ANALYTICS_ENTRY_EPISODE_CONFLICT'
    || value === 'ANALYTICS_ENTRY_CODE_CONFLICT'
    || value === 'ANALYTICS_ENTRY_SAVE_FAILED';
}

function hasOnlyKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

function isMoney(value: unknown): boolean {
  return hasOnlyKeys(value, moneyKeys)
    && typeof value.amount === 'string'
    && value.currency === 'BRL';
}

function isNullableMoney(value: unknown): boolean {
  return value === undefined || value === null || isMoney(value);
}

function isNullableInteger(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'number';
}
