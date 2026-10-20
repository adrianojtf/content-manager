import { Body, Controller, Get, HttpException, Put } from '@nestjs/common';
import { ResponseGenerationSettingsError } from '../../application/social/response-generation-settings-error';
import { GetResponseGenerationSettings, UpdateResponseGenerationSettings } from '../../application/social/response-generation-settings';

@Controller('ai/response-generation/settings')
export class ResponseGenerationSettingsController {
  constructor(
    private readonly getSettings: GetResponseGenerationSettings,
    private readonly updateSettings: UpdateResponseGenerationSettings,
  ) {}

  @Get()
  async get() {
    try {
      return await this.getSettings.execute();
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  @Put()
  async update(@Body() body: { provider?: unknown; model?: unknown }) {
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => key !== 'provider' && key !== 'model')
      || typeof body.provider !== 'string' || typeof body.model !== 'string') {
      throw new HttpException({ code: 'RESPONSE_GENERATION_SETTINGS_INVALID' }, 400);
    }
    try {
      return await this.updateSettings.execute({ provider: body.provider, model: body.model });
    } catch (error) {
      this.throwHttpError(error);
    }
  }

  private throwHttpError(error: unknown): never {
    if (error instanceof ResponseGenerationSettingsError) {
      const status = error.code === 'RESPONSE_GENERATION_SETTINGS_INVALID' ? 400 : 503;
      throw new HttpException({ code: error.code }, status);
    }
    throw new HttpException({ code: 'RESPONSE_GENERATION_SETTINGS_FAILED' }, 500);
  }
}
