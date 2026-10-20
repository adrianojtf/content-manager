CREATE TABLE IF NOT EXISTS social_credentials (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  credential_reference TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, credential_reference)
);

CREATE INDEX IF NOT EXISTS social_credentials_tenant_platform_idx ON social_credentials (tenant_id, platform);
