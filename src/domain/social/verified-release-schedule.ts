export type VerifiedReleaseScheduleDay =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

export interface VerifiedReleaseScheduleConfig {
  readonly enabled: boolean;
  readonly daysOfWeek: readonly VerifiedReleaseScheduleDay[];
  readonly localTime: string;
  readonly timeZone: string;
}

export interface StoredVerifiedReleaseSchedule extends VerifiedReleaseScheduleConfig {
  readonly version: number;
  readonly updatedAt: string;
  readonly confirmedAt: string;
}

const scheduleDays: readonly VerifiedReleaseScheduleDay[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

export function isValidVerifiedReleaseScheduleConfig(value: unknown): value is VerifiedReleaseScheduleConfig {
  if (!isRecord(value)
    || Object.keys(value).length !== 4
    || !Object.keys(value).every((key) => ['enabled', 'daysOfWeek', 'localTime', 'timeZone'].includes(key))) {
    return false;
  }
  if (typeof value.enabled !== 'boolean'
    || !Array.isArray(value.daysOfWeek)
    || value.daysOfWeek.some((day) => typeof day !== 'string' || !scheduleDays.includes(day as VerifiedReleaseScheduleDay))
    || new Set(value.daysOfWeek).size !== value.daysOfWeek.length
    || (value.enabled && value.daysOfWeek.length === 0)
    || typeof value.localTime !== 'string'
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.localTime)
    || !isValidIanaTimeZone(value.timeZone)) {
    return false;
  }
  return true;
}

export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function isValidStoredVerifiedReleaseSchedule(value: unknown): value is StoredVerifiedReleaseSchedule {
  if (!isRecord(value)
    || !isValidVerifiedReleaseScheduleConfig({
      enabled: value.enabled,
      daysOfWeek: value.daysOfWeek,
      localTime: value.localTime,
      timeZone: value.timeZone,
    })
    || !Number.isSafeInteger(value.version)
    || (value.version as number) < 1
    || !isValidTimestamp(value.updatedAt)
    || !isValidTimestamp(value.confirmedAt)) {
    return false;
  }
  return true;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
