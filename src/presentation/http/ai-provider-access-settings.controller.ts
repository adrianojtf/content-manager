import { Body, Controller, Get, HttpException, Put } from '@nestjs/common';
import {
  AIProviderSettingsError,
  GetAIProviderAccessStatus,
  UpdateAIProviderAccessSettings,
} from '../../application/social/ai-provider-access-settings';

@Controller('ai/provider-access')
export class AIProviderAccessSettingsController {
  constructor(
    private readonly getAccessStatus: GetAIProviderAccessStatus,
    private readonly updateAccessSettings: UpdateAIProviderAccessSettings,
  ) {}

  @Get()
  async get() {
    try {
      return await this.getAccessStatus.execute();
    } catch {
      throw new HttpException({ code: 'AI_PROVIDER_SETTINGS_UNAVAILABLE' }, 503);
    }
  }

  @Put()
  async update(@Body() body: unknown) {
    try {
      await this.updateAccessSettings.execute(body);
      return await this.getAccessStatus.execute();
    } catch (error) {
      if (error instanceof AIProviderSettingsError) {
        const status = error.code === 'AI_PROVIDER_SETTINGS_INVALID' ? 400 : 503;
        throw new HttpException({ code: error.code }, status);
      }
      throw new HttpException({ code: 'AI_PROVIDER_SETTINGS_FAILED' }, 500);
    }
  }
}
