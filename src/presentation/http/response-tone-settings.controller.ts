import { Body, Controller, Get, HttpException, Param, Put } from '@nestjs/common';
import { GetAccountResponseToneSettings, UpdateAccountResponseToneSettings } from '../../application/social/response-tone-settings';
import { ResponseToneSettingsError } from '../../application/social/response-tone-settings-error';
import { SocialProviderError } from '../../application/social/social-provider-error';
import { SocialAccountInvariantError } from '../../domain/social/social-account-invariant-error';

@Controller('social/accounts')
export class ResponseToneSettingsController {
  constructor(
    private readonly getSettings: GetAccountResponseToneSettings,
    private readonly updateSettings: UpdateAccountResponseToneSettings,
  ) {}

  @Get(':accountId/response-tone')
  async get(@Param('accountId') accountId: string) {
    try {
      return await this.getSettings.execute({ accountId });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Put(':accountId/response-tone')
  async update(@Param('accountId') accountId: string, @Body() body: unknown) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)
      || Object.keys(body).length !== 3
      || !Object.keys(body).every((key) => key === 'primaryTone' || key === 'modifiers' || key === 'customNote')) {
      throw new HttpException({ code: 'RESPONSE_TONE_SETTINGS_INVALID' }, 400);
    }
    try {
      return await this.updateSettings.execute({ accountId, profile: body as { primaryTone: string; modifiers: readonly string[]; customNote: string | null } });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    if (error instanceof ResponseToneSettingsError) {
      const status = error.code === 'RESPONSE_TONE_SETTINGS_INVALID' ? 400 : 503;
      throw new HttpException({ code: error.code }, status);
    }
    if (error instanceof SocialProviderError && error.code === 'SOCIAL_ACCOUNT_NOT_FOUND') {
      throw new HttpException({ code: error.code }, 404);
    }
    if (error instanceof SocialAccountInvariantError && error.code === 'SOCIAL_ACCOUNT_ID_INVALID') {
      throw new HttpException({ code: error.code }, 400);
    }
    throw new HttpException({ code: 'RESPONSE_TONE_SETTINGS_FAILED' }, 500);
  }
}
