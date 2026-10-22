import type {
  StoredVerifiedReleaseSchedule,
  TenantVerifiedReleaseScheduleRepository,
  VerifiedReleaseScheduleConfig,
} from '../../application/ports/verified-release-schedule.repository.port';
import { VerifiedReleaseScheduleError } from '../../application/social/verified-release-schedule-error';
import { isValidStoredVerifiedReleaseSchedule } from '../../domain/social/verified-release-schedule';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';

interface TenantVerifiedReleaseScheduleRow extends Record<string, unknown> {
  enabled: boolean;
  days_of_week: unknown;
  local_time: string;
  time_zone: string;
  version: number | string;
  updated_at: Date | string;
  confirmed_at: Date | string;
}

export class PostgresTenantVerifiedReleaseScheduleRepository implements TenantVerifiedReleaseScheduleRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async get(tenantId: string): Promise<StoredVerifiedReleaseSchedule | null> {
    let rows: readonly TenantVerifiedReleaseScheduleRow[];
    try {
      const result = await this.database.query<TenantVerifiedReleaseScheduleRow>(
        `SELECT enabled, days_of_week, local_time, time_zone, version, updated_at, confirmed_at
         FROM tenant_verified_release_schedules
         WHERE tenant_id = $1`,
        [tenantId],
      );
      rows = result.rows;
    } catch {
      throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE');
    }
    return rows[0] ? this.restore(rows[0]) : null;
  }

  async save(
    tenantId: string,
    config: VerifiedReleaseScheduleConfig,
  ): Promise<StoredVerifiedReleaseSchedule> {
    let rows: readonly TenantVerifiedReleaseScheduleRow[];
    try {
      const result = await this.database.query<TenantVerifiedReleaseScheduleRow>(
        `INSERT INTO tenant_verified_release_schedules
          (tenant_id, enabled, days_of_week, local_time, time_zone, version, updated_at, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, 1, NOW(), NOW())
         ON CONFLICT (tenant_id) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             days_of_week = EXCLUDED.days_of_week,
             local_time = EXCLUDED.local_time,
             time_zone = EXCLUDED.time_zone,
             version = tenant_verified_release_schedules.version + 1,
             updated_at = NOW(),
             confirmed_at = NOW()
         RETURNING enabled, days_of_week, local_time, time_zone, version, updated_at, confirmed_at`,
        [tenantId, config.enabled, [...config.daysOfWeek], config.localTime, config.timeZone],
      );
      rows = result.rows;
    } catch {
      throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE');
    }
    if (!rows[0]) throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE');
    return this.restore(rows[0]);
  }

  private restore(row: TenantVerifiedReleaseScheduleRow): StoredVerifiedReleaseSchedule {
    const localTime = restoreLocalTime(row.local_time);
    const version = Number(row.version);
    const schedule = {
      enabled: row.enabled,
      daysOfWeek: row.days_of_week,
      localTime,
      timeZone: row.time_zone,
      version,
      updatedAt: restoreTimestamp(row.updated_at),
      confirmedAt: restoreTimestamp(row.confirmed_at),
    };
    if (!isValidStoredVerifiedReleaseSchedule(schedule)) {
      throw new VerifiedReleaseScheduleError('VERIFIED_RELEASE_SCHEDULE_DATA_INVALID');
    }
    return {
      ...schedule,
      daysOfWeek: [...schedule.daysOfWeek],
    };
  }
}

function restoreLocalTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^([01]\d|2[0-3]):[0-5]\d(?::00(?:\.0+)?)?$/.exec(value);
  return match ? `${match[1]}:${value.slice(3, 5)}` : '';
}

function restoreTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}
