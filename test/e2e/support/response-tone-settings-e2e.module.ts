import { DynamicModule, Module } from '@nestjs/common';
import { GetAccountResponseToneSettings, GetTenantResponseToneSettings, UpdateAccountResponseToneSettings, UpdateTenantResponseToneSettings } from '../../../src/application/social/response-tone-settings';
import { ResponseToneSettingsController } from '../../../src/presentation/http/response-tone-settings.controller';
import { TenantResponseToneSettingsController } from '../../../src/presentation/http/tenant-response-tone-settings.controller';

@Module({})
class ResponseToneSettingsE2eModule {}

export function createResponseToneSettingsE2eModule(options: {
  readonly get: Pick<GetAccountResponseToneSettings, 'execute'>;
  readonly update: Pick<UpdateAccountResponseToneSettings, 'execute'>;
  readonly getTenant: Pick<GetTenantResponseToneSettings, 'execute'>;
  readonly updateTenant: Pick<UpdateTenantResponseToneSettings, 'execute'>;
}): DynamicModule {
  return {
    module: ResponseToneSettingsE2eModule,
    controllers: [ResponseToneSettingsController, TenantResponseToneSettingsController],
    providers: [
      { provide: GetAccountResponseToneSettings, useValue: options.get },
      { provide: UpdateAccountResponseToneSettings, useValue: options.update },
      { provide: GetTenantResponseToneSettings, useValue: options.getTenant },
      { provide: UpdateTenantResponseToneSettings, useValue: options.updateTenant },
    ],
  };
}
