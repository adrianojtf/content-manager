ALTER TABLE comment_workflow_events
  ADD COLUMN IF NOT EXISTS event_sequence BIGSERIAL;

CREATE UNIQUE INDEX IF NOT EXISTS comment_workflow_events_sequence_idx
  ON comment_workflow_events (event_sequence);
