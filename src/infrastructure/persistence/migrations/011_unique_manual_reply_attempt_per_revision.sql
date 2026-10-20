ALTER TABLE comment_workflow_events
  ADD COLUMN IF NOT EXISTS reply_revision_event_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS comment_workflow_events_manual_reply_revision_idx
  ON comment_workflow_events (tenant_id, social_account_id, external_comment_id, reply_revision_event_id)
  WHERE reply_revision_event_id IS NOT NULL;
