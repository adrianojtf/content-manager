import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type {
  ResponseGenerationScheduleContext,
  StoredVerifiedReleaseSchedule,
  TenantVerifiedReleaseScheduleRepository,
  VerifiedReleaseScheduleConfig,
  VerifiedReleaseScheduleRepository,
  VerifiedReleaseScheduleSnapshot,
  VerifiedReleaseScheduleSource,
} from '../ports/verified-release-schedule.repository.port';
import {
  isValidStoredVerifiedReleaseSchedule,
  isValidVerifiedReleaseScheduleConfig,
} from '../../domain/social/verified-release-schedule';
import { parseSocialAccountId } from '../../domain/social/social-account-id';
import { SocialProviderError } from './social-provider-error';
import { VerifiedReleaseScheduleError } from './verified-release-schedule-error';

export {
  isValidIanaTimeZone,
  isValidStoredVerifiedReleaseSchedule,
  isValidVerifiedReleaseScheduleConfig,
} from '../../domain/social/verified-release-schedule';

export type VerifiedReleaseScheduleViewSource = VerifiedReleaseScheduleSource | 'UNCONFIGURED';

export interface VerifiedReleaseScheduleView {
  readonly schedule: StoredVerifiedReleaseSchedule | null;
  readonly source: VerifiedReleaseScheduleViewSource;
}

export type ResolvedVerifiedReleaseSchedule =
  | { readonly source: 'UNCONFIGURED'; readonly schedule: null }
  | { readonly source: VerifiedReleaseScheduleSource; readonly schedule: StoredVerifiedReleaseSchedule };

export interface VerifiedReleaseScheduleInput {
  readonly accountId: string;
}

export interface UpdateVerifiedReleaseScheduleInput extends VerifiedReleaseScheduleInput {
  readonly config: VerifiedReleaseScheduleConfig;
}

export function resolveVerifiedReleaseSchedule(
  accountSchedule: StoredVerifiedReleaseSchedule | null,
  tenantSchedule: StoredVerifiedReleaseSchedule | null,
): ResolvedVerifiedReleaseSchedule {
  if (accountSchedule) return { source: 'ACCOUNT', schedule: accountSchedule };
  if (tenantSchedule) return { source: 'TENANT', schedule: tenantSchedule };
  return { source: 'UNCONFIGURED', schedule: null };
}

export function verifiedReleaseScheduleSnapshot(
  resolved: ResolvedVerifiedReleaseSchedule,
): VerifiedReleaseScheduleSnapshot {
  if (!resolved.schedule) return { status: 'UNCONFIGURED', schedule: null };
  const copy = { ...resolved.schedule, daysOfWeek: [...resolved.schedule.daysOfWeek] };
  return { status: resolved.schedule.enabled ? 'ACTIVE' : 'DISABLED', schedule: copy, source: resolved.source };
}

export function responseGenerationScheduleContext(
  snapshot: VerifiedReleaseScheduleSnapshot,
): ResponseGenerationScheduleContext {
  if (snapshot.status !== 'ACTIVE') return { status: snapshot.status };
  return {
    status: 'ACTIVE',
    daysOfWeek: [...snapshot.schedule.daysOfWeek],
    localTime: snapshot.schedule.localTime,
    timeZone: snapshot.schedule.timeZone,
  };
}

export class GetVerifiedReleaseSchedule {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly schedules: VerifiedReleaseScheduleRepository,
    private readonly tenantSchedules: TenantVerifiedReleaseScheduleRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(input: VerifiedReleaseScheduleInput): Promise<VerifiedReleaseScheduleView> {
    const tenantId = await this.tenant.resolveTenantId();
    const accountId = parseSocialAccountId(input.accountId);
    if (!await this.accounts.findById(tenantId, accountId)) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    }
    try {
      const resolved = await this.resolveEffective(tenantId, accountId);
      return { schedule: resolved.schedule ? copySchedule(resolved.schedule) : null, source: resolved.source };
    } catch (error) {
      if (error instanceof VerifiedReleaseScheduleError) throw error;
      throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE');
    }
  }

  private async resolveEffective(tenantId: string, accountId: string): Promise<ResolvedVerifiedReleaseSchedule> {
    const accountSchedule = await this.schedules.get(tenantId, accountId);
    if (accountSchedule && !isValidStoredVerifiedReleaseSchedule(accountSchedule)) {
      throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_DATA_INVALID');
    }
    if (accountSchedule) return { source: 'ACCOUNT', schedule: accountSchedule };
    const tenantSchedule = await this.tenantSchedules.get(tenantId);
    if (tenantSchedule && !isValidStoredVerifiedReleaseSchedule(tenantSchedule)) {
      throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_DATA_INVALID');
    }
    return resolveVerifiedReleaseSchedule(null, tenantSchedule);
  }
}

export class UpdateVerifiedReleaseSchedule {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly schedules: VerifiedReleaseScheduleRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(input: UpdateVerifiedReleaseScheduleInput): Promise<VerifiedReleaseScheduleView> {
    const tenantId = await this.tenant.resolveTenantId();
    const accountId = parseSocialAccountId(input.accountId);
    if (!await this.accounts.findById(tenantId, accountId)) {
      throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    }
    if (!isValidVerifiedReleaseScheduleConfig(input.config)) {
      throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_INVALID');
    }
    try {
      const schedule = await this.schedules.save(tenantId, accountId, {
        enabled: input.config.enabled,
        daysOfWeek: [...input.config.daysOfWeek],
        localTime: input.config.localTime,
        timeZone: input.config.timeZone,
      });
      if (!isValidStoredVerifiedReleaseSchedule(schedule)) {
        throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_DATA_INVALID');
      }
      return { schedule: copySchedule(schedule), source: 'ACCOUNT' };
    } catch (error) {
      if (error instanceof VerifiedReleaseScheduleError) throw error;
      throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE');
    }
  }
}

export class GetTenantVerifiedReleaseSchedule {
  constructor(
    private readonly tenantSchedules: TenantVerifiedReleaseScheduleRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(): Promise<VerifiedReleaseScheduleView> {
    const tenantId = await this.tenant.resolveTenantId();
    try {
      const schedule = await this.tenantSchedules.get(tenantId);
      if (schedule && !isValidStoredVerifiedReleaseSchedule(schedule)) {
        throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_DATA_INVALID');
      }
      return {
        schedule: schedule ? copySchedule(schedule) : null,
        source: schedule ? 'TENANT' : 'UNCONFIGURED',
      };
    } catch (error) {
      if (error instanceof VerifiedReleaseScheduleError) throw error;
      throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE');
    }
  }
}

export class UpdateTenantVerifiedReleaseSchedule {
  constructor(
    private readonly tenantSchedules: TenantVerifiedReleaseScheduleRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(input: { readonly config: VerifiedReleaseScheduleConfig }): Promise<VerifiedReleaseScheduleView> {
    const tenantId = await this.tenant.resolveTenantId();
    if (!isValidVerifiedReleaseScheduleConfig(input.config)) {
      throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_INVALID');
    }
    try {
      const schedule = await this.tenantSchedules.save(tenantId, {
        enabled: input.config.enabled,
        daysOfWeek: [...input.config.daysOfWeek],
        localTime: input.config.localTime,
        timeZone: input.config.timeZone,
      });
      if (!isValidStoredVerifiedReleaseSchedule(schedule)) {
        throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_DATA_INVALID');
      }
      return { schedule: copySchedule(schedule), source: 'TENANT' };
    } catch (error) {
      if (error instanceof VerifiedReleaseScheduleError) throw error;
      throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE');
    }
  }
}

function copySchedule(schedule: StoredVerifiedReleaseSchedule): StoredVerifiedReleaseSchedule {
  return { ...schedule, daysOfWeek: [...schedule.daysOfWeek] };
}
