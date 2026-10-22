import { Body, Controller, Get, HttpException, Put } from '@nestjs/common';
import { GetTenantResponseToneSettings, UpdateTenantResponseToneSettings } from '../../application/social/response-tone-settings';
import { ResponseToneSettingsError } from '../../application/social/response-tone-settings-error';

@Controller('social/settings')
export class TenantResponseToneSettingsController {
  constructor(
    private readonly getSettings: GetTenantResponseToneSettings,
    private readonly updateSettings: UpdateTenantResponseToneSettings,
  ) {}

  @Get('response-tone')
  async get() {
    try {
      return await this.getSettings.execute();
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Put('response-tone')
  async update(@Body() body: unknown) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)
      || Object.keys(body).length !== 3
      || !Object.keys(body).every((key) => key === 'primaryTone' || key === 'modifiers' || key === 'customNote')) {
      throw new HttpException({ code: 'RESPONSE_TONE_SETTINGS_INVALID' }, 400);
    }
    try {
      return await this.updateSettings.execute({ profile: body as { primaryTone: string; modifiers: readonly string[]; customNote: string | null } });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    if (error instanceof ResponseToneSettingsError) {
      const status = error.code === 'RESPONSE_TONE_SETTINGS_INVALID' ? 400 : 503;
      throw new HttpException({ code: error.code }, status);
    }
    throw new HttpException({ code: 'RESPONSE_TONE_SETTINGS_FAILED' }, 500);
  }
}
