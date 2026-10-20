export type CommentWorkflowEventType =
  | 'COMMENT_SYNCED'
  | 'COMMENT_ANALYSIS_CREATED'
  | 'COMMENT_CLASSIFIED'
  | 'COMMENT_ANALYSIS_CORRECTED'
  | 'RESPONSE_SUGGESTION_GENERATED'
  | 'RESPONSE_SUGGESTION_EDITED'
  | 'MANUAL_RESPONSE_CREATED'
  | 'MANUAL_RESPONSE_EDITED'
  | 'RESPONSE_EVALUATED'
  | 'MANUAL_REPLY_ATTEMPTED'
  | 'MANUAL_REPLY_RESULT';

export type CommentWorkflowActorSource = 'AI' | 'GENERATOR' | 'CREATOR_LOCAL' | 'APPLICATION' | 'SOCIAL_PLATFORM';
export type CommentWorkflowEventStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'UNSUPPORTED';

export interface AppendCommentWorkflowEventInput {
  readonly tenantId: string;
  readonly socialAccountId: string;
  readonly externalCommentId: string;
  readonly eventType: CommentWorkflowEventType;
  readonly actorSource: CommentWorkflowActorSource;
  readonly status: CommentWorkflowEventStatus;
  readonly operationId: string | null;
  readonly batchOperationId: string | null;
  readonly parentEventId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly recordedAt: string;
}

export interface CommentWorkflowEvent extends AppendCommentWorkflowEventInput {
  readonly id: string;
  readonly expiresAt: string;
}

export interface CommentWorkflowEventRepository {
  append(input: AppendCommentWorkflowEventInput): Promise<CommentWorkflowEvent>;
  listByComment(tenantId: string, socialAccountId: string, externalCommentId: string, asOf: string): Promise<readonly CommentWorkflowEvent[]>;
  listByBatchOperationId(tenantId: string, batchOperationId: string, asOf: string): Promise<readonly CommentWorkflowEvent[]>;
}
