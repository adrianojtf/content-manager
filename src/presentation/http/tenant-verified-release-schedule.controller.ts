import { Body, Controller, Get, HttpException, Put } from '@nestjs/common';
import type { VerifiedReleaseScheduleConfig } from '../../application/ports/verified-release-schedule.repository.port';
import { GetTenantVerifiedReleaseSchedule, UpdateTenantVerifiedReleaseSchedule } from '../../application/social/verified-release-schedule';

const configKeys = ['enabled', 'daysOfWeek', 'localTime', 'timeZone'] as const;

@Controller('social/settings')
export class TenantVerifiedReleaseScheduleController {
  constructor(
    private readonly getSchedule: GetTenantVerifiedReleaseSchedule,
    private readonly updateSchedule: UpdateTenantVerifiedReleaseSchedule,
  ) {}

  @Get('verified-release-schedule')
  async get() {
    try {
      return await this.getSchedule.execute();
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Put('verified-release-schedule')
  async update(@Body() body: unknown) {
    if (!isConfigBody(body)) {
      throw new HttpException({ code: 'VERIFIED_RELEASE_SCHEDULE_INVALID' }, 400);
    }
    try {
      return await this.updateSchedule.execute({ config: body });
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
