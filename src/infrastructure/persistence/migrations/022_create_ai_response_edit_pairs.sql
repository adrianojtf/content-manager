CREATE TABLE IF NOT EXISTS ai_response_edit_pairs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  social_account_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
  language TEXT NOT NULL CHECK (language IN ('pt-BR', 'en-US', 'es-ES')),
  ai_text TEXT NOT NULL,
  final_text TEXT NOT NULL,
  ai_provider TEXT NOT NULL,
  ai_model TEXT NOT NULL,
  ai_confidence DOUBLE PRECISION NOT NULL CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  ai_rationale TEXT,
  intended_tone TEXT NOT NULL,
  tone_profile_json TEXT NOT NULL CHECK (char_length(btrim(tone_profile_json)) > 1),
  revision_count INTEGER NOT NULL CHECK (revision_count >= 0),
  last_edit_reason TEXT,
  evaluation_json TEXT,
  analysis_labels_json TEXT,
  manual_reply_attempt_id UUID NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (tenant_id, social_account_id) REFERENCES social_accounts (tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_response_edit_pairs_attempt_idx
  ON ai_response_edit_pairs (manual_reply_attempt_id);

CREATE INDEX IF NOT EXISTS ai_response_edit_pairs_tenant_idx
  ON ai_response_edit_pairs (tenant_id);
