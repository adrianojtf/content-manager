import { DynamicModule, Module } from '@nestjs/common';
import { GetTenantVerifiedReleaseSchedule, GetVerifiedReleaseSchedule, UpdateTenantVerifiedReleaseSchedule, UpdateVerifiedReleaseSchedule } from '../../../src/application/social/verified-release-schedule';
import { VerifiedReleaseScheduleController } from '../../../src/presentation/http/verified-release-schedule.controller';
import { TenantVerifiedReleaseScheduleController } from '../../../src/presentation/http/tenant-verified-release-schedule.controller';

@Module({})
class VerifiedReleaseScheduleE2eModule {}

export function createVerifiedReleaseScheduleE2eModule(options: {
  readonly get: Pick<GetVerifiedReleaseSchedule, 'execute'>;
  readonly update: Pick<UpdateVerifiedReleaseSchedule, 'execute'>;
  readonly getTenant: Pick<GetTenantVerifiedReleaseSchedule, 'execute'>;
  readonly updateTenant: Pick<UpdateTenantVerifiedReleaseSchedule, 'execute'>;
}): DynamicModule {
  return {
    module: VerifiedReleaseScheduleE2eModule,
    controllers: [VerifiedReleaseScheduleController, TenantVerifiedReleaseScheduleController],
    providers: [
      { provide: GetVerifiedReleaseSchedule, useValue: options.get },
      { provide: UpdateVerifiedReleaseSchedule, useValue: options.update },
      { provide: GetTenantVerifiedReleaseSchedule, useValue: options.getTenant },
      { provide: UpdateTenantVerifiedReleaseSchedule, useValue: options.updateTenant },
    ],
  };
}
