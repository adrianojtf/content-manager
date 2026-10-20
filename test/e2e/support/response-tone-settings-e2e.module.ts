import { DynamicModule, Module } from '@nestjs/common';
import { GetAccountResponseToneSettings, UpdateAccountResponseToneSettings } from '../../../src/application/social/response-tone-settings';
import { ResponseToneSettingsController } from '../../../src/presentation/http/response-tone-settings.controller';

@Module({})
class ResponseToneSettingsE2eModule {}

export function createResponseToneSettingsE2eModule(options: {
  readonly get: Pick<GetAccountResponseToneSettings, 'execute'>;
  readonly update: Pick<UpdateAccountResponseToneSettings, 'execute'>;
}): DynamicModule {
  return {
    module: ResponseToneSettingsE2eModule,
    controllers: [ResponseToneSettingsController],
    providers: [
      { provide: GetAccountResponseToneSettings, useValue: options.get },
      { provide: UpdateAccountResponseToneSettings, useValue: options.update },
    ],
  };
}
