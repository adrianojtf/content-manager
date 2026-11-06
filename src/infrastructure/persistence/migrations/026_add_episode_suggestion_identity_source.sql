ALTER TABLE analytics_episode_suggestions
  ADD COLUMN identity_source TEXT,
  ADD COLUMN identity_audit_json TEXT;

ALTER TABLE analytics_episode_suggestions
  ADD CONSTRAINT analytics_episode_suggestions_identity_source_check
  CHECK (identity_source IS NULL OR identity_source IN ('RULES', 'LEARNED_PATTERN', 'JEV_VERIFIED', 'JEV_EXTRACTED'));
