CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_tenant_id_id_unique_idx
  ON social_accounts (tenant_id, id);

CREATE TABLE IF NOT EXISTS social_comments (
  tenant_id UUID NOT NULL,
  social_account_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
  external_publication_id TEXT NOT NULL CHECK (char_length(btrim(external_publication_id)) > 0),
  external_comment_id TEXT NOT NULL CHECK (char_length(btrim(external_comment_id)) > 0),
  external_thread_id TEXT NOT NULL CHECK (char_length(btrim(external_thread_id)) > 0),
  author_display_name TEXT,
  comment_text TEXT,
  provider_created_at TIMESTAMPTZ,
  can_reply BOOLEAN NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, social_account_id, external_comment_id),
  FOREIGN KEY (tenant_id, social_account_id) REFERENCES social_accounts (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS social_comments_publication_idx
  ON social_comments (tenant_id, social_account_id, external_publication_id, provider_created_at);

CREATE INDEX IF NOT EXISTS social_comments_expiration_idx
  ON social_comments (tenant_id, retention_expires_at);
