CREATE TABLE IF NOT EXISTS ai_response_generation_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL CHECK (provider IN ('google', 'openai')),
  model TEXT NOT NULL,
  updated_at TIMESTAMPTZ,
  updated_by_admin_user_id UUID,
  CHECK (
    (provider = 'google' AND model = 'gemini-3.5-flash-lite')
    OR (provider = 'openai' AND model = 'gpt-6-luna')
  )
);

INSERT INTO ai_response_generation_settings (id, provider, model)
VALUES (1, 'google', 'gemini-3.5-flash-lite')
ON CONFLICT (id) DO NOTHING;
