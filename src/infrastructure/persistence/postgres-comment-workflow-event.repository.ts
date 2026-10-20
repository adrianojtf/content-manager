import { randomUUID } from 'node:crypto';
import type {
  AppendCommentWorkflowEventInput,
  CommentWorkflowEvent,
  CommentWorkflowEventRepository,
} from '../../application/ports/comment-workflow-event-repository.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';
import { CommentWorkflowAuditError } from '../../application/social/comment-workflow-audit-error';

interface CommentWorkflowEventRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  social_account_id: string;
  external_comment_id: string;
  event_type: CommentWorkflowEvent['eventType'];
  actor_source: CommentWorkflowEvent['actorSource'];
  status: CommentWorkflowEvent['status'];
  operation_id: string | null;
  batch_operation_id: string | null;
  parent_event_id: string | null;
  payload_json: string;
  recorded_at: Date | string;
  expires_at: Date | string;
}

export class PostgresCommentWorkflowEventRepository implements CommentWorkflowEventRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async append(input: AppendCommentWorkflowEventInput): Promise<CommentWorkflowEvent> {
    if (!input.tenantId.trim() || !input.socialAccountId.trim() || !input.externalCommentId.trim()
      || !this.isValidDate(input.recordedAt)) {
      throw new CommentWorkflowAuditError('COMMENT_WORKFLOW_EVENT_INVALID');
    }
    const payload = this.serializePayload(input.payload);
    const replyRevisionEventId = input.eventType === 'MANUAL_REPLY_ATTEMPTED' ? input.payload.revisionEventId : null;
    if (replyRevisionEventId !== null && (typeof replyRevisionEventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(replyRevisionEventId))) {
      throw new CommentWorkflowAuditError('COMMENT_WORKFLOW_EVENT_INVALID');
    }
    const { rows: comments } = await this.database.query<{ retention_expires_at: Date | string }>(
      `SELECT retention_expires_at FROM social_comments
       WHERE tenant_id = $1 AND social_account_id = $2 AND external_comment_id = $3 AND retention_expires_at > $4`,
      [input.tenantId, input.socialAccountId, input.externalCommentId, input.recordedAt],
    );
    if (!comments.length) {
      throw new CommentWorkflowAuditError('COMMENT_NOT_FOUND');
    }
    if (input.parentEventId) {
      const { rows: parents } = await this.database.query<{ id: string }>(
        `SELECT id FROM comment_workflow_events
         WHERE id = $1 AND tenant_id = $2 AND social_account_id = $3 AND external_comment_id = $4`,
        [input.parentEventId, input.tenantId, input.socialAccountId, input.externalCommentId],
      );
      if (!parents.length) {
        throw new CommentWorkflowAuditError('COMMENT_WORKFLOW_EVENT_PARENT_NOT_FOUND');
      }
    }

    const event: CommentWorkflowEvent = { ...input, id: randomUUID(), expiresAt: this.toIsoString(comments[0].retention_expires_at) };
    await this.database.query(
      `INSERT INTO comment_workflow_events (
         id, tenant_id, social_account_id, external_comment_id, event_type, actor_source, status,
         operation_id, batch_operation_id, parent_event_id, payload_json, recorded_at, expires_at, reply_revision_event_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [event.id, input.tenantId, input.socialAccountId, input.externalCommentId, input.eventType, input.actorSource,
        input.status, input.operationId, input.batchOperationId, input.parentEventId, payload, input.recordedAt, event.expiresAt, replyRevisionEventId],
    ).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null
        && (('constraint' in error && error.constraint === 'comment_workflow_events_manual_reply_revision_idx')
          || ('code' in error && error.code === '23505')
          || (input.eventType === 'MANUAL_REPLY_ATTEMPTED' && 'message' in error && typeof error.message === 'string' && error.message.includes('duplicate key value violates unique constraint')))) {
        throw new CommentWorkflowAuditError('MANUAL_REPLY_ATTEMPT_ALREADY_EXISTS');
      }
      throw error;
    });
    return event;
  }

  async listByComment(tenantId: string, socialAccountId: string, externalCommentId: string, asOf: string): Promise<readonly CommentWorkflowEvent[]> {
    if (!this.isValidDate(asOf)) {
      throw new CommentWorkflowAuditError('COMMENT_WORKFLOW_EVENT_INVALID');
    }
    await this.database.query('DELETE FROM social_comments WHERE tenant_id = $1 AND retention_expires_at <= $2', [tenantId, asOf]);
    await this.database.query('DELETE FROM comment_workflow_events WHERE tenant_id = $1 AND expires_at <= $2', [tenantId, asOf]);
    const { rows } = await this.database.query<CommentWorkflowEventRow>(
      `SELECT id, tenant_id, social_account_id, external_comment_id, event_type, actor_source, status,
              operation_id, batch_operation_id, parent_event_id, payload_json, recorded_at, expires_at
       FROM comment_workflow_events
       WHERE tenant_id = $1 AND social_account_id = $2 AND external_comment_id = $3 AND expires_at > $4
       ORDER BY recorded_at, event_sequence`,
      [tenantId, socialAccountId, externalCommentId, asOf],
    );
    return rows.map((row) => this.restore(row));
  }

  async listByBatchOperationId(tenantId: string, batchOperationId: string, asOf: string): Promise<readonly CommentWorkflowEvent[]> {
    if (!this.isValidDate(asOf) || !/^[0-9a-f-]{36}$/i.test(batchOperationId)) {
      throw new CommentWorkflowAuditError('COMMENT_WORKFLOW_EVENT_INVALID');
    }
    await this.database.query('DELETE FROM social_comments WHERE tenant_id = $1 AND retention_expires_at <= $2', [tenantId, asOf]);
    await this.database.query('DELETE FROM comment_workflow_events WHERE tenant_id = $1 AND expires_at <= $2', [tenantId, asOf]);
    const { rows } = await this.database.query<CommentWorkflowEventRow>(
      `SELECT id, tenant_id, social_account_id, external_comment_id, event_type, actor_source, status,
              operation_id, batch_operation_id, parent_event_id, payload_json, recorded_at, expires_at
       FROM comment_workflow_events
       WHERE tenant_id = $1 AND batch_operation_id = $2 AND expires_at > $3
       ORDER BY recorded_at, event_sequence`,
      [tenantId, batchOperationId, asOf],
    );
    return rows.map((row) => this.restore(row));
  }

  private serializePayload(payload: Readonly<Record<string, unknown>>): string {
    try {
      const serialized = JSON.stringify(payload);
      if (!serialized || serialized === '{}') {
        throw new Error();
      }
      return serialized;
    } catch {
      throw new CommentWorkflowAuditError('COMMENT_WORKFLOW_EVENT_DATA_INVALID');
    }
  }

  private restore(row: CommentWorkflowEventRow): CommentWorkflowEvent {
    let payload: Readonly<Record<string, unknown>>;
    try {
      payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
      throw new CommentWorkflowAuditError('COMMENT_WORKFLOW_EVENT_DATA_INVALID');
    }
    return {
      id: row.id,
      tenantId: row.tenant_id,
      socialAccountId: row.social_account_id,
      externalCommentId: row.external_comment_id,
      eventType: row.event_type,
      actorSource: row.actor_source,
      status: row.status,
      operationId: row.operation_id,
      batchOperationId: row.batch_operation_id,
      parentEventId: row.parent_event_id,
      payload,
      recordedAt: this.toIsoString(row.recorded_at),
      expiresAt: this.toIsoString(row.expires_at),
    };
  }

  private isValidDate(value: string): boolean {
    return Number.isFinite(Date.parse(value));
  }

  private toIsoString(value: Date | string): string {
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }
}
