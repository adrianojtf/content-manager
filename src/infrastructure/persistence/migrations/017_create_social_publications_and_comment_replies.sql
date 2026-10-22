CREATE TABLE IF NOT EXISTS social_publications (
  tenant_id UUID NOT NULL,
  social_account_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
  external_publication_id TEXT NOT NULL CHECK (char_length(btrim(external_publication_id)) > 0),
  title TEXT,
  description TEXT,
  permalink TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, social_account_id, external_publication_id),
  FOREIGN KEY (tenant_id, social_account_id) REFERENCES social_accounts (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS social_publications_account_page_idx
  ON social_publications (tenant_id, social_account_id, published_at DESC, external_publication_id);

CREATE TABLE IF NOT EXISTS social_comment_replies (
  tenant_id UUID NOT NULL,
  social_account_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
  external_comment_id TEXT NOT NULL,
  external_reply_id TEXT NOT NULL CHECK (char_length(btrim(external_reply_id)) > 0),
  reply_text TEXT,
  provider_created_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, social_account_id, external_reply_id),
  FOREIGN KEY (tenant_id, social_account_id, external_comment_id)
    REFERENCES social_comments (tenant_id, social_account_id, external_comment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS social_comment_replies_comment_idx
  ON social_comment_replies (tenant_id, social_account_id, external_comment_id, provider_created_at);
