CREATE TABLE IF NOT EXISTS ai_provider_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
