CREATE TABLE IF NOT EXISTS social_account_response_tone_settings (
  tenant_id UUID NOT NULL,
  social_account_id UUID NOT NULL,
  primary_tone TEXT NOT NULL CHECK (primary_tone IN ('FRIENDLY', 'PROFESSIONAL', 'CASUAL', 'EMPATHETIC')),
  modifiers_json TEXT NOT NULL DEFAULT '[]',
  custom_note TEXT CHECK (custom_note IS NULL OR char_length(custom_note) <= 500),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, social_account_id),
  FOREIGN KEY (tenant_id, social_account_id) REFERENCES social_accounts (tenant_id, id) ON DELETE CASCADE
);
