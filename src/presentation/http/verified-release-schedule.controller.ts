import { Body, Controller, Get, HttpException, Param, Put } from '@nestjs/common';
import type { VerifiedReleaseScheduleConfig } from '../../application/ports/verified-release-schedule.repository.port';
import { GetVerifiedReleaseSchedule, UpdateVerifiedReleaseSchedule } from '../../application/social/verified-release-schedule';

const configKeys = ['enabled', 'daysOfWeek', 'localTime', 'timeZone'] as const;

@Controller('social/accounts')
export class VerifiedReleaseScheduleController {
  constructor(
    private readonly getSchedule: GetVerifiedReleaseSchedule,
    private readonly updateSchedule: UpdateVerifiedReleaseSchedule,
  ) {}

  @Get(':accountId/verified-release-schedule')
  async get(@Param('accountId') accountId: string) {
    try {
      return await this.getSchedule.execute({ accountId });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Put(':accountId/verified-release-schedule')
  async update(@Param('accountId') accountId: string, @Body() body: unknown) {
    if (!isConfigBody(body)) {
      throw new HttpException({ code: 'VERIFIED_RELEASE_SCHEDULE_INVALID' }, 400);
    }
    try {
      return await this.updateSchedule.execute({ accountId, config: body });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    const requestedCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
    const statusByCode: Record<string, number> = {
      VERIFIED_RELEASE_SCHEDULE_INVALID: 400,
      VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE: 503,
      VERIFIED_RELEASE_SCHEDULE_DATA_INVALID: 500,
      VERIFIED_RELEASE_SCHEDULE_FAILED: 500,
      SOCIAL_ACCOUNT_ID_INVALID: 400,
      SOCIAL_ACCOUNT_NOT_FOUND: 404,
    };
    const code = requestedCode && Object.hasOwn(statusByCode, requestedCode)
      ? requestedCode
      : 'VERIFIED_RELEASE_SCHEDULE_FAILED';
    throw new HttpException({ code }, statusByCode[code] ?? 500);
  }
}

function isConfigBody(value: unknown): value is VerifiedReleaseScheduleConfig {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).length === configKeys.length
    && Object.keys(value).every((key) => configKeys.includes(key as typeof configKeys[number]));
}
