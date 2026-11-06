CREATE TABLE IF NOT EXISTS response_refinement_analyses (
  id UUID PRIMARY KEY,
  analysis_request_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  pair_id UUID NOT NULL REFERENCES ai_response_edit_pairs (id) ON DELETE CASCADE,
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'PARTIAL', 'FAILED', 'SKIPPED')),
  skip_reason TEXT,
  ai_evaluation_json TEXT,
  final_evaluation_json TEXT,
  edit_classification_json TEXT,
  capability_errors_json TEXT NOT NULL CHECK (char_length(btrim(capability_errors_json)) > 1),
  score_deltas_json TEXT,
  recorded_at TIMESTAMPTZ NOT NULL,
  UNIQUE (analysis_request_id, pair_id)
);

CREATE INDEX IF NOT EXISTS response_refinement_analyses_tenant_idx
  ON response_refinement_analyses (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS response_refinement_analyses_request_idx
  ON response_refinement_analyses (tenant_id, analysis_request_id);

CREATE INDEX IF NOT EXISTS response_refinement_analyses_pair_idx
  ON response_refinement_analyses (tenant_id, pair_id, recorded_at);
