import type {
  StoredVerifiedReleaseSchedule,
  VerifiedReleaseScheduleConfig,
  VerifiedReleaseScheduleDay,
} from '../../domain/social/verified-release-schedule';

export type {
  StoredVerifiedReleaseSchedule,
  VerifiedReleaseScheduleConfig,
  VerifiedReleaseScheduleDay,
} from '../../domain/social/verified-release-schedule';

export type VerifiedReleaseScheduleSource = 'ACCOUNT' | 'TENANT';

export type VerifiedReleaseScheduleSnapshot =
  | { readonly status: 'UNCONFIGURED'; readonly schedule: null }
  | { readonly status: 'DISABLED'; readonly schedule: StoredVerifiedReleaseSchedule; readonly source: VerifiedReleaseScheduleSource }
  | { readonly status: 'ACTIVE'; readonly schedule: StoredVerifiedReleaseSchedule; readonly source: VerifiedReleaseScheduleSource };

export type ResponseGenerationScheduleContext =
  | {
      readonly status: 'ACTIVE';
      readonly daysOfWeek: readonly VerifiedReleaseScheduleDay[];
      readonly localTime: string;
      readonly timeZone: string;
    }
  | { readonly status: 'UNCONFIGURED' | 'DISABLED' };

export interface ActiveVerifiedReleaseScheduleContext {
  readonly daysOfWeek: readonly VerifiedReleaseScheduleDay[];
  readonly localTime: string;
  readonly timeZone: string;
}

export interface VerifiedReleaseScheduleRepository {
  get(tenantId: string, socialAccountId: string): Promise<StoredVerifiedReleaseSchedule | null>;
  save(
    tenantId: string,
    socialAccountId: string,
    config: VerifiedReleaseScheduleConfig,
  ): Promise<StoredVerifiedReleaseSchedule>;
}

export interface TenantVerifiedReleaseScheduleRepository {
  get(tenantId: string): Promise<StoredVerifiedReleaseSchedule | null>;
  save(
    tenantId: string,
    config: VerifiedReleaseScheduleConfig,
  ): Promise<StoredVerifiedReleaseSchedule>;
}
