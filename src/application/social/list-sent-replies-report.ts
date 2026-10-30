import type {
  SentReplyReportPlatform,
  SentReplyReportQuery,
  SentReplyReportRepository,
  SentReplyReportRow,
} from '../ports/sent-reply-report.repository.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import { parseSocialAccountId } from '../../domain/social/social-account-id';
import { renderSentRepliesReportCsv } from './sent-replies-report-csv';
import { SentRepliesReportError } from './sent-replies-report-error';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORT_DAYS = 30;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const platforms = new Set<SentReplyReportPlatform>(['youtube', 'instagram', 'facebook', 'tiktok']);

export interface ListSentRepliesReportInput {
  readonly from?: string;
  readonly to?: string;
  readonly platform?: string;
  readonly accountId?: string;
  readonly search?: string;
  readonly cursor?: string;
  readonly pageSize?: string | number;
}

export interface SentRepliesReportView {
  readonly items: readonly SentReplyReportRow[];
  readonly total: number;
  readonly nextCursor: string | null;
}

interface NormalizedFilters {
  readonly from: string;
  readonly to: string;
  readonly platform: SentReplyReportPlatform | null;
  readonly accountId: string | null;
  readonly search: string | null;
  readonly pageSize: number | null;
}

interface CursorPayload {
  readonly sentAt: string;
  readonly id: string;
  readonly filters: NormalizedFilters;
}

export class ListSentRepliesReport {
  constructor(
    private readonly reports: SentReplyReportRepository,
    private readonly tenant: PilotTenantContext,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: ListSentRepliesReportInput = {}): Promise<SentRepliesReportView> {
    const asOf = new Date(this.now()).toISOString();
    const cursorPayload = input.cursor ? this.decodeCursor(input.cursor) : null;
    const filters = this.normalizeFilters(input, asOf, false, cursorPayload?.filters);
    if (cursorPayload && JSON.stringify(cursorPayload.filters) !== JSON.stringify(filters)) {
      throw new SentRepliesReportError('SENT_REPLIES_REPORT_CURSOR_INVALID');
    }
    const after = cursorPayload ? { sentAt: cursorPayload.sentAt, id: cursorPayload.id } : null;
    const tenantId = await this.tenant.resolveTenantId();
    const result = await this.reports.query(tenantId, {
      asOf,
      from: filters.from,
      to: filters.to,
      platform: filters.platform,
      accountId: filters.accountId,
      search: filters.search,
      after,
      limit: filters.pageSize,
    });
    const lastItem = result.items.at(-1);
    const nextCursor = result.hasMore && lastItem
      ? this.encodeCursor({ sentAt: lastItem.sentAt, id: lastItem.id, filters })
      : null;
    return { items: result.items, total: result.total, nextCursor };
  }

  async exportCsv(input: Omit<ListSentRepliesReportInput, 'cursor' | 'pageSize'> = {}): Promise<string> {
    const asOf = new Date(this.now()).toISOString();
    const filters = this.normalizeFilters(input, asOf, true);
    const tenantId = await this.tenant.resolveTenantId();
    const result = await this.reports.query(tenantId, {
      asOf,
      from: filters.from,
      to: filters.to,
      platform: filters.platform,
      accountId: filters.accountId,
      search: filters.search,
      after: null,
      limit: null,
    });
    return renderSentRepliesReportCsv(result.items);
  }

  private normalizeFilters(
    input: ListSentRepliesReportInput,
    asOf: string,
    exporting: boolean,
    cursorFilters?: NormalizedFilters,
  ): NormalizedFilters {
    const now = Date.parse(asOf);
    const from = input.from === undefined
      ? cursorFilters?.from ?? new Date(now - MAX_REPORT_DAYS * DAY_MS).toISOString()
      : this.parseDate(input.from);
    const to = input.to === undefined ? cursorFilters?.to ?? asOf : this.parseDate(input.to);
    if (Date.parse(from) >= Date.parse(to) || Date.parse(to) > now || Date.parse(to) - Date.parse(from) > MAX_REPORT_DAYS * DAY_MS) {
      throw new SentRepliesReportError('SENT_REPLIES_REPORT_FILTER_INVALID');
    }

    let platform: SentReplyReportPlatform | null = null;
    const platformInput = input.platform === undefined ? cursorFilters?.platform ?? null : input.platform;
    if (platformInput !== null && platformInput !== '') {
      if (!platforms.has(platformInput as SentReplyReportPlatform)) {
        throw new SentRepliesReportError('SENT_REPLIES_REPORT_FILTER_INVALID');
      }
      platform = platformInput as SentReplyReportPlatform;
    }

    let accountId: string | null = null;
    const accountInput = input.accountId === undefined ? cursorFilters?.accountId ?? null : input.accountId;
    if (accountInput !== null && accountInput !== '') {
      try {
        accountId = parseSocialAccountId(accountInput);
      } catch {
        throw new SentRepliesReportError('SENT_REPLIES_REPORT_FILTER_INVALID');
      }
    }

    const searchInput = input.search === undefined ? cursorFilters?.search ?? null : input.search;
    if (searchInput !== null && typeof searchInput !== 'string') {
      throw new SentRepliesReportError('SENT_REPLIES_REPORT_FILTER_INVALID');
    }
    const search = searchInput?.trim() || null;
    if (search && search.length > 200) {
      throw new SentRepliesReportError('SENT_REPLIES_REPORT_FILTER_INVALID');
    }

    let pageSize: number | null = null;
    if (!exporting) {
      const value = input.pageSize === undefined
        ? cursorFilters?.pageSize ?? DEFAULT_PAGE_SIZE
        : Number(input.pageSize);
      if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
        throw new SentRepliesReportError('SENT_REPLIES_REPORT_FILTER_INVALID');
      }
      pageSize = value;
    }

    return { from, to, platform, accountId, search, pageSize };
  }

  private parseDate(value: string): string {
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) {
      throw new SentRepliesReportError('SENT_REPLIES_REPORT_FILTER_INVALID');
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      throw new SentRepliesReportError('SENT_REPLIES_REPORT_FILTER_INVALID');
    }
    return new Date(timestamp).toISOString();
  }

  private encodeCursor(cursor: CursorPayload): string {
    return encodeBase64Url(JSON.stringify(cursor));
  }

  private decodeCursor(value: string): CursorPayload {
    try {
      if (value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
      const payload = JSON.parse(decodeBase64Url(value)) as Partial<CursorPayload>;
      if (typeof payload.sentAt !== 'string' || !Number.isFinite(Date.parse(payload.sentAt))
        || typeof payload.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.id)
        || typeof payload.filters !== 'object' || payload.filters === null) {
        throw new Error();
      }
      return {
        sentAt: new Date(payload.sentAt).toISOString(),
        id: payload.id.toLowerCase(),
        filters: payload.filters,
      };
    } catch {
      throw new SentRepliesReportError('SENT_REPLIES_REPORT_CURSOR_INVALID');
    }
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const standard = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
