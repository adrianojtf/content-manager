ALTER TABLE response_refinement_analyses
  ADD COLUMN IF NOT EXISTS source_context_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_analysis_id UUID REFERENCES response_refinement_analyses (id) ON DELETE SET NULL;
