import type {
  SentReplyReportAnalysisCorrection,
  SentReplyReportQuery,
  SentReplyReportQueryResult,
  SentReplyReportRepository,
  SentReplyReportRow,
} from '../../application/ports/sent-reply-report.repository.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';
import { SentRepliesReportError } from '../../application/social/sent-replies-report-error';

interface SentReplyBaseRow extends Record<string, unknown> {
  result_event_id: string;
  sent_at: Date | string;
  platform: string;
  social_account_id: string;
  external_comment_id: string;
  external_publication_id: string;
  publication_title: string | null;
  publication_permalink: string | null;
  comment_text: string | null;
  comment_author_display_name: string | null;
  comment_created_at: Date | string | null;
  account_display_name: string | null;
  external_account_id: string;
  attempt_recorded_at: Date | string;
  attempt_payload_json: string;
}

interface WorkflowEventRow extends Record<string, unknown> {
  id: string;
  social_account_id: string;
  external_comment_id: string;
  event_type: 'COMMENT_ANALYSIS_CREATED' | 'COMMENT_ANALYSIS_CORRECTED';
  actor_source: string;
  parent_event_id: string | null;
  payload_json: string;
  recorded_at: Date | string;
  event_sequence: number;
}

const sentReplyFrom = `
  FROM comment_workflow_events e
  JOIN comment_workflow_events a
    ON a.id = e.parent_event_id
    AND a.tenant_id = e.tenant_id
    AND a.social_account_id = e.social_account_id
    AND a.external_comment_id = e.external_comment_id
    AND a.operation_id = e.operation_id
    AND a.event_type = 'MANUAL_REPLY_ATTEMPTED'
    AND a.status = 'IN_PROGRESS'
  JOIN social_comments c
    ON c.tenant_id = e.tenant_id
    AND c.social_account_id = e.social_account_id
    AND c.external_comment_id = e.external_comment_id
  JOIN social_accounts sa
    ON sa.tenant_id = c.tenant_id
    AND sa.id = c.social_account_id
  LEFT JOIN social_publications p
    ON p.tenant_id = c.tenant_id
    AND p.social_account_id = c.social_account_id
    AND p.platform = c.platform
    AND p.external_publication_id = c.external_publication_id`;

export class PostgresSentReplyReportRepository implements SentReplyReportRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async query(tenantId: string, filters: SentReplyReportQuery): Promise<SentReplyReportQueryResult> {
    const { where, parameters } = this.buildWhere(tenantId, filters);
    const { rows: countRows } = await this.database.query<{ total: string | number }>(
      `SELECT COUNT(*) AS total ${sentReplyFrom} WHERE ${where}`,
      parameters,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const pageParameters = [...parameters];
    let cursorCondition = '';
    if (filters.after) {
      const sentAtParameter = this.addParameter(pageParameters, filters.after.sentAt);
      const idParameter = this.addParameter(pageParameters, filters.after.id);
      cursorCondition = `AND (e.recorded_at < ${sentAtParameter} OR (e.recorded_at = ${sentAtParameter} AND e.id < ${idParameter}))`;
    }
    let limitCondition = '';
    if (filters.limit !== null) {
      const limitParameter = this.addParameter(pageParameters, filters.limit + 1);
      limitCondition = `LIMIT ${limitParameter}`;
    }
    const { rows } = await this.database.query<SentReplyBaseRow>(
      `SELECT e.id AS result_event_id, e.recorded_at AS sent_at, c.platform, e.social_account_id, e.external_comment_id,
              c.external_publication_id, p.title AS publication_title, p.permalink AS publication_permalink,
              c.comment_text, c.author_display_name AS comment_author_display_name,
              c.provider_created_at AS comment_created_at, c.retention_expires_at,
              sa.display_name AS account_display_name, sa.external_account_id, a.recorded_at AS attempt_recorded_at,
              a.payload_json AS attempt_payload_json
       ${sentReplyFrom}
       WHERE ${where} ${cursorCondition}
       ORDER BY e.recorded_at DESC, e.id DESC
       ${limitCondition}`,
      pageParameters,
    );
    const hasMore = filters.limit !== null && rows.length > filters.limit;
    const selectedRows = hasMore ? rows.slice(0, filters.limit as number) : rows;
    const events = await this.loadCommentEvents(tenantId, filters.asOf, selectedRows);
    return {
      items: selectedRows.map((row) => this.restore(row, events)),
      total,
      hasMore,
    };
  }

  private buildWhere(tenantId: string, filters: SentReplyReportQuery): { where: string; parameters: unknown[] } {
    const parameters: unknown[] = [tenantId, filters.asOf, filters.from, filters.to];
    const where = [
      'e.tenant_id = $1',
      "e.event_type = 'MANUAL_REPLY_RESULT'",
      "e.status = 'SUCCEEDED'",
      'e.expires_at > $2',
      'a.expires_at > $2',
      'c.retention_expires_at > $2',
      'e.recorded_at >= $3',
      'e.recorded_at < $4',
    ];
    if (filters.platform) {
      where.push(`c.platform = ${this.addParameter(parameters, filters.platform)}`);
    }
    if (filters.accountId) {
      where.push(`c.social_account_id = ${this.addParameter(parameters, filters.accountId)}`);
    }
    if (filters.search) {
      const searchParameter = this.addParameter(parameters, filters.search.toLocaleLowerCase('en-US'));
      where.push(`(
        STRPOS(LOWER(COALESCE(c.comment_text, '')), ${searchParameter}) > 0
        OR STRPOS(LOWER(COALESCE(c.author_display_name, '')), ${searchParameter}) > 0
        OR STRPOS(LOWER(COALESCE(a.payload_json::jsonb ->> 'text', '')), ${searchParameter}) > 0
      )`);
    }
    return { where: where.join(' AND '), parameters };
  }

  private async loadCommentEvents(
    tenantId: string,
    asOf: string,
    rows: readonly SentReplyBaseRow[],
  ): Promise<ReadonlyMap<string, readonly WorkflowEventRow[]>> {
    const commentKeys = [...new Map(rows.map((row) => [this.commentKey(row.social_account_id, row.external_comment_id), row])).values()];
    if (!commentKeys.length) return new Map();

    const parameters: unknown[] = [tenantId, asOf];
    const conditions = commentKeys.map((row) => {
      const accountParameter = this.addParameter(parameters, row.social_account_id);
      const commentParameter = this.addParameter(parameters, row.external_comment_id);
      return `(e.social_account_id = ${accountParameter} AND e.external_comment_id = ${commentParameter})`;
    });
    const { rows: events } = await this.database.query<WorkflowEventRow>(
      `SELECT e.id, e.social_account_id, e.external_comment_id, e.event_type, e.actor_source, e.parent_event_id,
              e.payload_json, e.recorded_at, e.event_sequence
       FROM comment_workflow_events e
       WHERE e.tenant_id = $1
         AND e.expires_at > $2
         AND e.recorded_at <= $2
         AND e.status = 'SUCCEEDED'
         AND e.event_type IN ('COMMENT_ANALYSIS_CREATED', 'COMMENT_ANALYSIS_CORRECTED')
         AND (${conditions.join(' OR ')})
       ORDER BY e.recorded_at, e.event_sequence`,
      parameters,
    );
    const grouped = new Map<string, WorkflowEventRow[]>();
    for (const event of events) {
      const key = this.commentKey(event.social_account_id, event.external_comment_id);
      const group = grouped.get(key) ?? [];
      group.push(event);
      grouped.set(key, group);
    }
    return grouped;
  }

  private restore(
    row: SentReplyBaseRow,
    commentEvents: ReadonlyMap<string, readonly WorkflowEventRow[]>,
  ): SentReplyReportRow {
    const attempt = this.parsePayload(row.attempt_payload_json);
    if (typeof attempt.text !== 'string' || !attempt.text.trim()) {
      throw new SentRepliesReportError('SENT_REPLIES_REPORT_DATA_INVALID');
    }
    const attemptAt = this.toIsoString(row.attempt_recorded_at);
    const history = commentEvents.get(this.commentKey(row.social_account_id, row.external_comment_id)) ?? [];
    const analysisEvent = history.filter((event) => event.event_type === 'COMMENT_ANALYSIS_CREATED'
      && Date.parse(this.toIsoString(event.recorded_at)) <= Date.parse(attemptAt)).at(-1);
    const analysis = analysisEvent ? this.parsePayload(analysisEvent.payload_json) : null;
    if (analysis) analysis.evaluatedAt ??= this.toIsoString(analysisEvent?.recorded_at as Date | string);
    const correctionEvent = analysisEvent
      ? history.filter((event) => event.event_type === 'COMMENT_ANALYSIS_CORRECTED'
        && event.parent_event_id === analysisEvent.id
        && Date.parse(this.toIsoString(event.recorded_at)) <= Date.parse(attemptAt)).at(-1)
      : undefined;
    const correction = correctionEvent ? this.restoreCorrection(correctionEvent) : null;
    return {
      id: row.result_event_id,
      sentAt: this.toIsoString(row.sent_at),
      platform: this.restorePlatform(row),
      socialAccountId: row.social_account_id,
      accountDisplayName: row.account_display_name,
      externalAccountId: row.external_account_id,
      externalPublicationId: row.external_publication_id,
      publicationTitle: row.publication_title,
      publicationPermalink: row.publication_permalink,
      commentText: row.comment_text,
      commentAuthorDisplayName: row.comment_author_display_name,
      commentCreatedAt: row.comment_created_at === null ? null : this.toIsoString(row.comment_created_at),
      sentResponse: attempt.text,
      jevCommentAnalysis: analysis,
      analysisCorrection: correction,
    };
  }

  private restoreCorrection(event: WorkflowEventRow): SentReplyReportAnalysisCorrection {
    const payload = this.parsePayload(event.payload_json);
    if (typeof payload.correctedFields !== 'object' || payload.correctedFields === null || Array.isArray(payload.correctedFields)) {
      throw new SentRepliesReportError('SENT_REPLIES_REPORT_DATA_INVALID');
    }
    return {
      actorSource: event.actor_source,
      recordedAt: this.toIsoString(event.recorded_at),
      correctedFields: payload.correctedFields as Record<string, unknown>,
      reason: typeof payload.reason === 'string' ? payload.reason : null,
    };
  }

  private parsePayload(value: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, unknown>;
    } catch {
      throw new SentRepliesReportError('SENT_REPLIES_REPORT_DATA_INVALID');
    }
  }

  private restorePlatform(row: SentReplyBaseRow): SentReplyReportRow['platform'] {
    const platform = row.platform;
    if (platform === 'youtube' || platform === 'instagram' || platform === 'facebook' || platform === 'tiktok') return platform;
    throw new SentRepliesReportError('SENT_REPLIES_REPORT_DATA_INVALID');
  }

  private commentKey(accountId: string, commentId: string): string {
    return `${accountId}\u0000${commentId}`;
  }

  private addParameter(parameters: unknown[], value: unknown): string {
    parameters.push(value);
    return `$${parameters.length}`;
  }

  private toIsoString(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new SentRepliesReportError('SENT_REPLIES_REPORT_DATA_INVALID');
    return date.toISOString();
  }
}
