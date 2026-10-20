CREATE TABLE IF NOT EXISTS comment_workflow_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  social_account_id UUID NOT NULL,
  external_comment_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'COMMENT_SYNCED',
    'COMMENT_ANALYSIS_CREATED',
    'COMMENT_CLASSIFIED',
    'COMMENT_ANALYSIS_CORRECTED',
    'RESPONSE_SUGGESTION_GENERATED',
    'RESPONSE_SUGGESTION_EDITED',
    'MANUAL_RESPONSE_CREATED',
    'MANUAL_RESPONSE_EDITED',
    'RESPONSE_EVALUATED',
    'MANUAL_REPLY_ATTEMPTED',
    'MANUAL_REPLY_RESULT'
  )),
  actor_source TEXT NOT NULL CHECK (actor_source IN ('AI', 'GENERATOR', 'CREATOR_LOCAL', 'APPLICATION', 'SOCIAL_PLATFORM')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'UNSUPPORTED')),
  operation_id UUID,
  batch_operation_id UUID,
  parent_event_id UUID REFERENCES comment_workflow_events(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL CHECK (char_length(btrim(payload_json)) > 1),
  recorded_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (tenant_id, social_account_id, external_comment_id)
    REFERENCES social_comments (tenant_id, social_account_id, external_comment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS comment_workflow_events_comment_idx
  ON comment_workflow_events (tenant_id, social_account_id, external_comment_id, recorded_at);

CREATE INDEX IF NOT EXISTS comment_workflow_events_batch_idx
  ON comment_workflow_events (tenant_id, batch_operation_id);

CREATE INDEX IF NOT EXISTS comment_workflow_events_expiration_idx
  ON comment_workflow_events (tenant_id, expires_at);
