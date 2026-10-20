INSERT INTO tenants (id, name, currency)
VALUES ('30000000-0000-4000-8000-000000000001', 'Local creator pilot', 'BRL')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
  external_account_id TEXT NOT NULL CHECK (char_length(btrim(external_account_id)) > 0),
  display_name TEXT,
  credential_reference TEXT NOT NULL CHECK (char_length(btrim(credential_reference)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, platform, external_account_id)
);

CREATE INDEX IF NOT EXISTS social_accounts_tenant_id_idx ON social_accounts (tenant_id);
