import { DynamicModule, Module } from '@nestjs/common';
import { GetResponseGenerationSettings, UpdateResponseGenerationSettings } from '../../../src/application/social/response-generation-settings';
import { ResponseGenerationSettingsController } from '../../../src/presentation/http/response-generation-settings.controller';

@Module({})
class ResponseGenerationSettingsE2eModule {}

export function createResponseGenerationSettingsE2eModule(options: {
  readonly get: Pick<GetResponseGenerationSettings, 'execute'>;
  readonly update: Pick<UpdateResponseGenerationSettings, 'execute'>;
}): DynamicModule {
  return {
    module: ResponseGenerationSettingsE2eModule,
    controllers: [ResponseGenerationSettingsController],
    providers: [
      { provide: GetResponseGenerationSettings, useValue: options.get },
      { provide: UpdateResponseGenerationSettings, useValue: options.update },
    ],
  };
}
