ALTER TABLE ai_response_edit_pairs
  ADD COLUMN IF NOT EXISTS prompt_version TEXT;
