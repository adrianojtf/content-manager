import { randomUUID } from 'node:crypto';
import type {
  AppendResponseRefinementAnalysisInput,
  ResponseRefinementAnalysisCandidate,
  ResponseRefinementAnalysisCandidatePage,
  ResponseRefinementAnalysisFilters,
  ResponseRefinementAnalysisQuery,
  ResponseRefinementAnalysisRepository,
  ResponseRefinementAnalysisRetryCandidate,
} from '../../application/ports/response-refinement-analysis.repository.port';
import type { AiResponseEditPair } from '../../application/ports/response-refinement-pair-repository.port';
import type { JevCommentAnalysisResult } from '../../application/ports/comment-evaluator.port';
import type { StoredPlatformComment } from '../../application/ports/social-comment-repository.port';
import type { ActiveVerifiedReleaseScheduleContext } from '../../application/ports/verified-release-schedule.repository.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';
import { isValidJevCommentAnalysisResult } from '../../application/social/comment-workflow-audit';
import { ResponseRefinementAnalysisError } from '../../application/social/response-refinement-analysis-error';
import { parseSocialAccountId } from '../../domain/social/social-account-id';

interface PairRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  social_account_id: string;
  platform: string;
  language: string;
  ai_text: string;
  final_text: string;
  ai_provider: string;
  ai_model: string;
  prompt_version: string | null;
  ai_confidence: number | string;
  ai_rationale: string | null;
  intended_tone: string;
  tone_profile_json: string;
  revision_count: number;
  last_edit_reason: string | null;
  evaluation_json: string | null;
  analysis_labels_json: string | null;
  manual_reply_attempt_id: string;
  recorded_at: Date | string;
}

interface SourceRow extends Record<string, unknown> {
  attempt_id: string;
  external_comment_id: string;
  attempt_payload_json: string;
  result_payload_json: string | null;
  result_status: string | null;
  comment_text: string | null;
  comment_author_display_name: string | null;
  comment_platform: string | null;
  external_thread_id: string | null;
  external_publication_id: string | null;
  provider_created_at: Date | string | null;
  can_reply: boolean | null;
  app_replied: boolean | null;
  app_liked: boolean | null;
  last_synced_at: Date | string | null;
  retention_expires_at: Date | string | null;
}

interface EventRow extends Record<string, unknown> {
  id: string;
  event_type: string;
  status: string;
  actor_source: string;
  parent_event_id: string | null;
  payload_json: string;
  recorded_at: Date | string;
}

interface WorkflowEvent {
  readonly id: string;
  readonly eventType: string;
  readonly status: string;
  readonly actorSource: string;
  readonly parentEventId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly recordedAt: string;
}

const pairColumns = `
  id, tenant_id, social_account_id, platform, language, ai_text, final_text,
  ai_provider, ai_model, prompt_version, ai_confidence, ai_rationale, intended_tone,
  tone_profile_json, revision_count, last_edit_reason, evaluation_json,
  analysis_labels_json, manual_reply_attempt_id, recorded_at`;

export class PostgresResponseRefinementAnalysisRepository
implements ResponseRefinementAnalysisQuery, ResponseRefinementAnalysisRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async listCandidates(
    tenantId: string,
    filters: ResponseRefinementAnalysisFilters,
    asOf: string,
  ): Promise<ResponseRefinementAnalysisCandidatePage> {
    const parameters: unknown[] = [tenantId, filters.from, filters.to];
    const where = [
      'tenant_id = $1',
      'recorded_at >= $2',
      'recorded_at < $3',
    ];
    if (filters.accountId) where.push(`social_account_id = ${this.parameter(parameters, filters.accountId)}`);
    if (filters.platform) where.push(`platform = ${this.parameter(parameters, filters.platform)}`);
    if (filters.language) where.push(`language = ${this.parameter(parameters, filters.language)}`);
    const after = filters.after ? this.decodeCursor(filters.after) : null;
    if (after) {
      const recordedAt = this.parameter(parameters, after.recordedAt);
      const id = this.parameter(parameters, after.id);
      where.push(`(recorded_at > ${recordedAt} OR (recorded_at = ${recordedAt} AND id > ${id}))`);
    }
    const limitParameter = this.parameter(parameters, filters.limit + 1);
    const { rows } = await this.database.query<PairRow>(
      `SELECT ${pairColumns} FROM ai_response_edit_pairs
       WHERE ${where.join(' AND ')}
       ORDER BY recorded_at, id
       LIMIT ${limitParameter}`,
      parameters,
    );
    const hasMore = rows.length > filters.limit;
    const selected = hasMore ? rows.slice(0, filters.limit) : rows;
    const candidates: ResponseRefinementAnalysisCandidate[] = [];
    for (const row of selected) {
      const pair = this.restorePair(row);
      candidates.push({
        pair,
        context: await this.resolveContext(tenantId, pair, asOf),
      });
    }
    const last = selected.at(-1);
    return {
      items: candidates,
      nextCursor: hasMore && last ? this.encodeCursor(this.toIsoString(last.recorded_at), last.id) : null,
    };
  }

  async listRetryCandidates(
    tenantId: string,
    analysisRequestId: string,
    asOf: string,
  ): Promise<{ readonly items: readonly ResponseRefinementAnalysisRetryCandidate[] }> {
    const { rows } = await this.database.query<PairRow & Record<string, unknown>>(
      `SELECT ${pairColumns.split(',').map((column) => `p.${column.trim()}`).join(', ')},
              a.id AS previous_analysis_id, a.status AS previous_status,
              a.ai_evaluation_json AS previous_ai_evaluation_json,
              a.final_evaluation_json AS previous_final_evaluation_json,
              a.edit_classification_json AS previous_edit_classification_json,
              a.capability_errors_json AS previous_capability_errors_json,
              a.score_deltas_json AS previous_score_deltas_json,
              a.recorded_at AS previous_recorded_at
       FROM response_refinement_analyses a
       JOIN ai_response_edit_pairs p ON p.id = a.pair_id AND p.tenant_id = a.tenant_id
       LEFT JOIN response_refinement_analyses retry
         ON retry.tenant_id = a.tenant_id AND retry.source_analysis_id = a.id
        AND retry.edit_classification_json IS NOT NULL
       WHERE a.tenant_id = $1 AND a.analysis_request_id = $2
         AND a.status = 'PARTIAL'
         AND a.ai_evaluation_json IS NOT NULL AND a.final_evaluation_json IS NOT NULL
         AND a.edit_classification_json IS NULL
         AND retry.id IS NULL
       ORDER BY a.recorded_at, a.id
       LIMIT 25`,
      [tenantId, analysisRequestId],
    );
    const items: ResponseRefinementAnalysisRetryCandidate[] = [];
    for (const row of rows) {
      const pair = this.restorePair(row);
      const context = await this.resolveContext(tenantId, pair, asOf);
      items.push({
        pair,
        context,
        previousAnalysis: {
          id: String(row.previous_analysis_id),
          status: row.previous_status as ResponseRefinementAnalysisRetryCandidate['previousAnalysis']['status'],
          aiEvaluation: this.parsePayload(row.previous_ai_evaluation_json as string) as unknown as import('../../application/ports/response-evaluator.port').JevResponseEvaluationResult,
          finalEvaluation: this.parsePayload(row.previous_final_evaluation_json as string) as unknown as import('../../application/ports/response-evaluator.port').JevResponseEvaluationResult,
          editClassification: row.previous_edit_classification_json === null
            ? null
            : this.parsePayload(row.previous_edit_classification_json as string) as unknown as import('../../application/ports/response-edit-classifier.port').ResponseEditClassification,
          scoreDeltas: row.previous_score_deltas_json === null
            ? null
            : this.parsePayload(row.previous_score_deltas_json as string) as unknown as import('../../application/ports/response-refinement-analysis.repository.port').ResponseRefinementScoreDeltas,
          capabilityErrors: this.parseStringRecord(row.previous_capability_errors_json as string),
          recordedAt: this.toIsoString(row.previous_recorded_at as Date | string),
        },
      });
    }
    return { items };
  }

  async append(input: AppendResponseRefinementAnalysisInput): Promise<{ readonly id: string }> {
    const id = randomUUID();
    await this.database.query(
      `INSERT INTO response_refinement_analyses (
         id, analysis_request_id, source_analysis_id, tenant_id, pair_id, prompt_version,
         source_context_updated_at, status, skip_reason,
         ai_evaluation_json, final_evaluation_json, edit_classification_json,
         capability_errors_json, score_deltas_json, recorded_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [id, input.analysisRequestId, input.sourceAnalysisId, input.tenantId, input.pairId, input.promptVersion,
        input.sourceContextUpdatedAt, input.status, input.skipReason, this.jsonOrNull(input.aiEvaluation),
        this.jsonOrNull(input.finalEvaluation), this.jsonOrNull(input.editClassification),
        JSON.stringify(input.capabilityErrors), this.jsonOrNull(input.scoreDeltas), input.recordedAt],
    );
    return { id };
  }

  private async resolveContext(
    tenantId: string,
    pair: AiResponseEditPair,
    asOf: string,
  ): Promise<ResponseRefinementAnalysisCandidate['context']> {
    const { rows } = await this.database.query<SourceRow>(
      `SELECT a.operation_id AS attempt_id, a.external_comment_id, a.payload_json AS attempt_payload_json,
              r.payload_json AS result_payload_json, r.status AS result_status,
              c.comment_text, c.author_display_name AS comment_author_display_name, c.platform AS comment_platform,
              c.external_thread_id, c.external_publication_id, c.provider_created_at, c.can_reply,
              c.app_replied, c.app_liked, c.last_synced_at, c.retention_expires_at
       FROM comment_workflow_events a
       LEFT JOIN comment_workflow_events r
         ON r.tenant_id = a.tenant_id AND r.social_account_id = a.social_account_id
        AND r.external_comment_id = a.external_comment_id AND r.operation_id = a.operation_id
        AND r.parent_event_id = a.id AND r.event_type = 'MANUAL_REPLY_RESULT'
        AND r.expires_at > $4
       LEFT JOIN social_comments c
         ON c.tenant_id = a.tenant_id AND c.social_account_id = a.social_account_id
        AND c.external_comment_id = a.external_comment_id AND c.retention_expires_at > $4
       WHERE a.tenant_id = $1 AND a.social_account_id = $2 AND a.operation_id = $3
         AND a.event_type = 'MANUAL_REPLY_ATTEMPTED' AND a.expires_at > $4
       ORDER BY a.recorded_at DESC
       LIMIT 1`,
      [tenantId, pair.socialAccountId, pair.manualReplyAttemptId, asOf],
    );
    const source = rows[0];
    if (!source || !source.retention_expires_at) {
      return { status: 'SOURCE_CONTEXT_EXPIRED' };
    }
    if (source.result_status !== 'SUCCEEDED' || !source.result_payload_json) {
      return { status: 'SOURCE_RESULT_NOT_SUCCEEDED' };
    }
    if (!source.comment_text?.trim() || !source.comment_platform || !source.external_thread_id
      || !source.external_publication_id || !source.last_synced_at) {
      return { status: 'SOURCE_CONTEXT_INVALID' };
    }

    const attempt = this.parsePayload(source.attempt_payload_json);
    const result = this.parsePayload(source.result_payload_json);
    if (typeof attempt.responseRootEventId !== 'string'
      || typeof attempt.responseVersionEventId !== 'string'
      || typeof attempt.text !== 'string'
      || result.responseVersionEventId !== attempt.responseVersionEventId) {
      return { status: 'SOURCE_LINEAGE_UNAVAILABLE' };
    }
    const { rows: eventRows } = await this.database.query<EventRow>(
      `SELECT id, event_type, status, actor_source, parent_event_id, payload_json, recorded_at
       FROM comment_workflow_events
       WHERE tenant_id = $1 AND social_account_id = $2 AND external_comment_id = $3
         AND expires_at > $4
         AND event_type IN (
           'COMMENT_ANALYSIS_CREATED', 'COMMENT_ANALYSIS_CORRECTED',
           'RESPONSE_SUGGESTION_GENERATED', 'RESPONSE_SUGGESTION_EDITED', 'RESPONSE_EVALUATED'
         )
       ORDER BY recorded_at, event_sequence`,
      [tenantId, pair.socialAccountId, source.external_comment_id, asOf],
    );
    let history: readonly WorkflowEvent[];
    try {
      history = eventRows.map((event) => ({
        id: event.id,
        eventType: event.event_type,
        status: event.status,
        actorSource: event.actor_source,
        parentEventId: event.parent_event_id,
        payload: this.parsePayload(event.payload_json),
        recordedAt: this.toIsoString(event.recorded_at),
      }));
    } catch {
      return { status: 'SOURCE_CONTEXT_INVALID' };
    }

    const suggestion = history.find((event) => event.id === attempt.responseRootEventId
      && event.eventType === 'RESPONSE_SUGGESTION_GENERATED' && event.status === 'SUCCEEDED');
    const sentVersion = history.find((event) => event.id === attempt.responseVersionEventId
      && (event.eventType === 'RESPONSE_SUGGESTION_EDITED' || event.eventType === 'RESPONSE_SUGGESTION_GENERATED'));
    if (!suggestion || !sentVersion
      || suggestion.payload.text !== pair.aiText
      || suggestion.payload.language !== pair.language
      || sentVersion.payload.text !== pair.finalText
      || attempt.text !== pair.finalText) {
      return { status: 'SOURCE_LINEAGE_UNAVAILABLE' };
    }

    const analysis = this.effectiveAnalysis(suggestion, history);
    if (!analysis) return { status: 'SOURCE_CONTEXT_INVALID' };
    const comment: StoredPlatformComment = {
      platform: source.comment_platform as StoredPlatformComment['platform'],
      externalReplyStatus: undefined,
      externalCommentId: source.external_comment_id,
      externalThreadId: source.external_thread_id,
      externalPublicationId: source.external_publication_id,
      authorDisplayName: typeof source.comment_author_display_name === 'string' ? source.comment_author_display_name : null,
      text: source.comment_text,
      createdAt: source.provider_created_at === null ? null : this.toIsoString(source.provider_created_at),
      canReply: Boolean(source.can_reply),
      canLike: false,
      socialAccountId: parseSocialAccountId(pair.socialAccountId),
      appReplied: Boolean(source.app_replied),
      appLiked: Boolean(source.app_liked),
      lastSyncedAt: this.toIsoString(source.last_synced_at),
      expiresAt: this.toIsoString(source.retention_expires_at),
      creatorReplies: [],
    };
    return {
      status: 'AVAILABLE',
      comment,
      analysis,
      verifiedReleaseSchedule: this.scheduleContext(sentVersion, history),
      sourceContextUpdatedAt: this.latestTimestamp([
        this.toIsoString(source.last_synced_at),
        ...(this.analysisRootId(suggestion, history)
          ? [history.find((event) => event.id === this.analysisRootId(suggestion, history))?.recordedAt ?? '1970-01-01T00:00:00.000Z']
          : []),
        suggestion.recordedAt,
        sentVersion.recordedAt,
        ...history.filter((event) => event.eventType === 'COMMENT_ANALYSIS_CORRECTED'
          && event.parentEventId === this.analysisRootId(suggestion, history)).map((event) => event.recordedAt),
      ]),
    };
  }

  private analysisRootId(suggestion: WorkflowEvent, history: readonly WorkflowEvent[]): string | null {
    let event = suggestion.parentEventId
      ? history.find((candidate) => candidate.id === suggestion.parentEventId)
      : undefined;
    while (event?.eventType === 'COMMENT_ANALYSIS_CORRECTED') {
      event = event.parentEventId ? history.find((candidate) => candidate.id === event?.parentEventId) : undefined;
    }
    return event?.eventType === 'COMMENT_ANALYSIS_CREATED' ? event.id : null;
  }

  private effectiveAnalysis(
    suggestion: WorkflowEvent,
    history: readonly WorkflowEvent[],
  ): JevCommentAnalysisResult | null {
    let event = suggestion.parentEventId
      ? history.find((candidate) => candidate.id === suggestion.parentEventId)
      : undefined;
    while (event?.eventType === 'COMMENT_ANALYSIS_CORRECTED') {
      event = event.parentEventId ? history.find((candidate) => candidate.id === event?.parentEventId) : undefined;
    }
    if (!event || event.eventType !== 'COMMENT_ANALYSIS_CREATED' || event.status !== 'SUCCEEDED') return null;
    const corrections = history
      .filter((candidate) => candidate.eventType === 'COMMENT_ANALYSIS_CORRECTED'
        && candidate.status === 'SUCCEEDED' && candidate.parentEventId === event?.id)
      .reduce<Record<string, unknown>>((result, candidate) => {
        const fields = candidate.payload.correctedFields;
        if (this.isRecord(fields)) Object.assign(result, fields);
        return result;
      }, {});
    const effective = { ...event.payload, ...corrections };
    return isValidJevCommentAnalysisResult(effective) ? effective : null;
  }

  private scheduleContext(
    sentVersion: WorkflowEvent,
    history: readonly WorkflowEvent[],
  ): ActiveVerifiedReleaseScheduleContext | undefined {
    const evaluation = history.filter((event) => event.eventType === 'RESPONSE_EVALUATED'
      && event.status === 'SUCCEEDED'
      && event.parentEventId === sentVersion.id
      && event.payload.revisionEventId === sentVersion.id).at(-1);
    const snapshot = evaluation?.payload.verifiedReleaseScheduleSnapshot;
    if (!this.isRecord(snapshot) || snapshot.status !== 'ACTIVE' || !this.isRecord(snapshot.schedule)) return undefined;
    const schedule = snapshot.schedule;
    if (!Array.isArray(schedule.daysOfWeek) || schedule.daysOfWeek.some((day) => typeof day !== 'string')
      || typeof schedule.localTime !== 'string' || typeof schedule.timeZone !== 'string') return undefined;
    return {
      daysOfWeek: schedule.daysOfWeek as ActiveVerifiedReleaseScheduleContext['daysOfWeek'],
      localTime: schedule.localTime,
      timeZone: schedule.timeZone,
    };
  }

  private restorePair(row: PairRow): AiResponseEditPair {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      socialAccountId: row.social_account_id,
      platform: row.platform,
      language: row.language,
      aiText: row.ai_text,
      finalText: row.final_text,
      aiProvider: row.ai_provider,
      aiModel: row.ai_model,
      promptVersion: row.prompt_version,
      aiConfidence: Number(row.ai_confidence),
      aiRationale: row.ai_rationale,
      intendedTone: row.intended_tone,
      toneProfile: this.parsePayload(row.tone_profile_json),
      revisionCount: row.revision_count,
      lastEditReason: row.last_edit_reason,
      evaluation: row.evaluation_json === null ? null : this.parsePayload(row.evaluation_json),
      analysisLabels: row.analysis_labels_json === null ? null : this.parsePayload(row.analysis_labels_json),
      manualReplyAttemptId: row.manual_reply_attempt_id,
      recordedAt: this.toIsoString(row.recorded_at),
    };
  }

  private parsePayload(value: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(value);
    if (!this.isRecord(parsed)) throw new Error('Invalid JSON payload');
    return parsed;
  }

  private parseStringRecord(value: string): Readonly<Record<string, string>> {
    const parsed = this.parsePayload(value);
    if (Object.values(parsed).some((entry) => typeof entry !== 'string')) {
      throw new Error('Invalid capability errors');
    }
    return parsed as Record<string, string>;
  }

  private jsonOrNull(value: unknown): string | null {
    if (value === null) return null;
    const serialized = JSON.stringify(value);
    if (!serialized) throw new Error('Invalid analysis payload');
    return serialized;
  }

  private parameter(parameters: unknown[], value: unknown): string {
    parameters.push(value);
    return `$${parameters.length}`;
  }

  private decodeCursor(value: string): { readonly recordedAt: string; readonly id: string } {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
      if (!this.isRecord(parsed) || typeof parsed.recordedAt !== 'string' || typeof parsed.id !== 'string'
        || !Number.isFinite(Date.parse(parsed.recordedAt)) || !/^[0-9a-f-]{36}$/i.test(parsed.id)) {
        throw new Error();
      }
      return { recordedAt: parsed.recordedAt, id: parsed.id };
    } catch {
      throw new ResponseRefinementAnalysisError('RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID');
    }
  }

  private encodeCursor(recordedAt: string, id: string): string {
    return Buffer.from(JSON.stringify({ recordedAt, id }), 'utf8').toString('base64url');
  }

  private latestTimestamp(values: readonly string[]): string {
    return values.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
  }

  private toIsoString(value: Date | string): string {
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
