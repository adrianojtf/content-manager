import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Query } from '@nestjs/common';
import type { ApproveEpisodeSuggestionGroupInput } from '../../application/analytics/episode-review.usecases';
import type { EpisodeReviewErrorCode } from '../../application/analytics/episode-review-error';
import {
  ApproveEpisodeSuggestionGroup,
  ConfirmEpisodeSetupSeasons,
  ConfirmEpisodeSetupSeries,
  DecideEpisodeSuggestions,
  GetEpisodeReview,
  RefreshEpisodeSuggestions,
} from '../../application/analytics/episode-review.usecases';

const approvalKeys = ['suggestionIds', 'seriesId', 'newSeries', 'seasonNumber', 'episodeNumber', 'episodeCode'] as const;
const newSeriesKeys = ['name', 'aliases', 'seasonMode'] as const;
const decisionKeys = ['suggestionIds', 'decision'] as const;
const seriesConfirmationKeys = ['suggestionIds', 'seriesId', 'newSeries'] as const;
const seasonConfirmationKeys = ['suggestionIds', 'seasonNumber'] as const;

@Controller('analytics/episodes')
export class EpisodeReviewController {
  constructor(
    private readonly refreshSuggestions: RefreshEpisodeSuggestions,
    private readonly getReview: GetEpisodeReview,
    private readonly confirmSeries: ConfirmEpisodeSetupSeries,
    private readonly confirmSeasons: ConfirmEpisodeSetupSeasons,
    private readonly approveGroup: ApproveEpisodeSuggestionGroup,
    private readonly decideSuggestions: DecideEpisodeSuggestions,
  ) {}

  @Get('review')
  async listReview(@Query('stage') stage?: string) {
    if (stage && stage !== 'SERIES' && stage !== 'SEASONS' && stage !== 'EPISODES') {
      throw new HttpException({ code: 'ANALYTICS_EPISODE_INPUT_INVALID' }, HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.getReview.execute(stage as 'SERIES' | 'SEASONS' | 'EPISODES' | undefined);
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post('review/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh() {
    try {
      return await this.refreshSuggestions.execute();
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post('setup/series/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmSeriesSetup(@Body() body: unknown) {
    const input = readSeriesConfirmationInput(body);
    if (!input) throw new HttpException({ code: 'ANALYTICS_EPISODE_INPUT_INVALID' }, HttpStatus.BAD_REQUEST);
    try {
      return await this.confirmSeries.execute(input);
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post('setup/seasons/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmSeasonSetup(@Body() body: unknown) {
    if (!hasOnlyKeys(body, seasonConfirmationKeys)
      || !Array.isArray(body.suggestionIds)
      || !body.suggestionIds.every((id) => typeof id === 'string')
      || typeof body.seasonNumber !== 'number') {
      throw new HttpException({ code: 'ANALYTICS_EPISODE_INPUT_INVALID' }, HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.confirmSeasons.execute({
        suggestionIds: body.suggestionIds as string[],
        seasonNumber: body.seasonNumber,
      });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post('review/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@Body() body: unknown) {
    const input = readApprovalInput(body);
    if (!input) throw new HttpException({ code: 'ANALYTICS_EPISODE_INPUT_INVALID' }, HttpStatus.BAD_REQUEST);
    try {
      return await this.approveGroup.execute(input);
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Post('review/decision')
  @HttpCode(HttpStatus.OK)
  async decide(@Body() body: unknown) {
    const input = readDecisionInput(body);
    if (!input) throw new HttpException({ code: 'ANALYTICS_EPISODE_INPUT_INVALID' }, HttpStatus.BAD_REQUEST);
    try {
      return await this.decideSuggestions.execute(input);
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    const requestedCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
    const code = requestedCode && isEpisodeReviewErrorCode(requestedCode)
      ? requestedCode
      : 'ANALYTICS_EPISODE_REVIEW_FAILED';
    const statusByCode: Record<EpisodeReviewErrorCode, number> = {
      ANALYTICS_EPISODE_INPUT_INVALID: HttpStatus.BAD_REQUEST,
      ANALYTICS_EPISODE_SERIES_NOT_FOUND: HttpStatus.NOT_FOUND,
      ANALYTICS_EPISODE_SUGGESTION_NOT_FOUND: HttpStatus.NOT_FOUND,
      ANALYTICS_EPISODE_SUGGESTION_NOT_PENDING: HttpStatus.CONFLICT,
      ANALYTICS_EPISODE_IDENTITY_CONFLICT: HttpStatus.CONFLICT,
      ANALYTICS_EPISODE_CODE_CONFLICT: HttpStatus.CONFLICT,
      ANALYTICS_EPISODE_SOURCE_INVALID: HttpStatus.CONFLICT,
      ANALYTICS_EPISODE_REVIEW_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
    };
    throw new HttpException({ code }, statusByCode[code] ?? HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

function isEpisodeReviewErrorCode(value: string): value is EpisodeReviewErrorCode {
  return value === 'ANALYTICS_EPISODE_INPUT_INVALID'
    || value === 'ANALYTICS_EPISODE_SERIES_NOT_FOUND'
    || value === 'ANALYTICS_EPISODE_SUGGESTION_NOT_FOUND'
    || value === 'ANALYTICS_EPISODE_SUGGESTION_NOT_PENDING'
    || value === 'ANALYTICS_EPISODE_IDENTITY_CONFLICT'
    || value === 'ANALYTICS_EPISODE_CODE_CONFLICT'
    || value === 'ANALYTICS_EPISODE_SOURCE_INVALID'
    || value === 'ANALYTICS_EPISODE_REVIEW_FAILED';
}

function readApprovalInput(value: unknown): ApproveEpisodeSuggestionGroupInput | null {
  if (!hasOnlyKeys(value, approvalKeys)
    || !Array.isArray(value.suggestionIds)
    || !value.suggestionIds.every((id) => typeof id === 'string')
    || typeof value.episodeNumber !== 'number'
    || !(value.seasonNumber === null || typeof value.seasonNumber === 'number')
    || typeof value.episodeCode !== 'string'
    || !((typeof value.seriesId === 'string' && value.seriesId.length > 0 && value.newSeries === undefined)
      || (value.seriesId === undefined && isNewSeries(value.newSeries)))) {
    return null;
  }
  return value as unknown as ApproveEpisodeSuggestionGroupInput;
}

function readDecisionInput(value: unknown): {
  readonly suggestionIds: readonly string[];
  readonly decision: 'REJECTED' | 'DEFERRED';
} | null {
  if (!hasOnlyKeys(value, decisionKeys)
    || !Array.isArray(value.suggestionIds)
    || !value.suggestionIds.every((id) => typeof id === 'string')
    || (value.decision !== 'REJECTED' && value.decision !== 'DEFERRED')) {
    return null;
  }
  return value as { readonly suggestionIds: readonly string[]; readonly decision: 'REJECTED' | 'DEFERRED' };
}

function readSeriesConfirmationInput(value: unknown): {
  readonly suggestionIds: readonly string[];
  readonly seriesId?: string;
  readonly newSeries?: { readonly name: string; readonly aliases: readonly string[]; readonly seasonMode: 'SEASONAL' | 'NON_SEASONAL' };
} | null {
  if (!hasOnlyKeys(value, seriesConfirmationKeys)
    || !Array.isArray(value.suggestionIds)
    || !value.suggestionIds.every((id) => typeof id === 'string')
    || !((typeof value.seriesId === 'string' && value.seriesId.length > 0 && value.newSeries === undefined)
      || (value.seriesId === undefined && isNewSeries(value.newSeries)))) {
    return null;
  }
  return value as {
    readonly suggestionIds: readonly string[];
    readonly seriesId?: string;
    readonly newSeries?: { readonly name: string; readonly aliases: readonly string[]; readonly seasonMode: 'SEASONAL' | 'NON_SEASONAL' };
  };
}

function isNewSeries(value: unknown): boolean {
  return hasOnlyKeys(value, newSeriesKeys)
    && typeof value.name === 'string'
    && Array.isArray(value.aliases)
    && value.aliases.every((alias) => typeof alias === 'string')
    && (value.seasonMode === 'SEASONAL' || value.seasonMode === 'NON_SEASONAL');
}

function hasOnlyKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}
