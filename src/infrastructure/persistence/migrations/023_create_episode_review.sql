CREATE TABLE IF NOT EXISTS analytics_series (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) > 0),
  normalized_name TEXT NOT NULL CHECK (char_length(btrim(normalized_name)) > 0),
  aliases_json TEXT NOT NULL CHECK (char_length(btrim(aliases_json)) > 1),
  season_mode TEXT NOT NULL CHECK (season_mode IN ('SEASONAL', 'NON_SEASONAL')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS analytics_episodes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  series_id UUID NOT NULL,
  season_number INTEGER,
  episode_number INTEGER NOT NULL CHECK (episode_number > 0),
  episode_code TEXT NOT NULL CHECK (char_length(btrim(episode_code)) > 0),
  created_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL CHECK (char_length(btrim(created_by)) > 0),
  CHECK (season_number IS NULL OR season_number > 0),
  FOREIGN KEY (tenant_id, series_id) REFERENCES analytics_series (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, episode_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS analytics_episodes_identity_idx
  ON analytics_episodes (tenant_id, series_id, COALESCE(season_number, 0), episode_number);

CREATE TABLE IF NOT EXISTS analytics_episode_publication_links (
  tenant_id UUID NOT NULL,
  episode_id UUID NOT NULL,
  social_account_id UUID NOT NULL,
  external_publication_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
  linked_at TIMESTAMPTZ NOT NULL,
  linked_by TEXT NOT NULL CHECK (char_length(btrim(linked_by)) > 0),
  PRIMARY KEY (tenant_id, social_account_id, external_publication_id),
  FOREIGN KEY (tenant_id, episode_id) REFERENCES analytics_episodes (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, social_account_id, external_publication_id)
    REFERENCES social_publications (tenant_id, social_account_id, external_publication_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analytics_episode_publication_links_episode_idx
  ON analytics_episode_publication_links (tenant_id, episode_id, platform);

CREATE TABLE IF NOT EXISTS analytics_episode_suggestions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  social_account_id UUID NOT NULL,
  external_publication_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
  source_fingerprint TEXT NOT NULL CHECK (char_length(source_fingerprint) > 0),
  title TEXT,
  description TEXT,
  permalink TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ,
  classification TEXT NOT NULL CHECK (classification IN ('EPISODE', 'NOT_EPISODE', 'UNCERTAIN')),
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  probabilities_json TEXT,
  identity_json TEXT NOT NULL,
  rationale_variants_json TEXT NOT NULL,
  rationale_failures_json TEXT NOT NULL,
  evidence_json TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('JEV', 'RULES')),
  model TEXT,
  schema_version TEXT NOT NULL,
  usage_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'DEFERRED', 'SUPERSEDED', 'NOT_EPISODE')),
  created_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  decision_actor_id TEXT,
  decision_reason TEXT,
  episode_id UUID,
  FOREIGN KEY (tenant_id, social_account_id, external_publication_id)
    REFERENCES social_publications (tenant_id, social_account_id, external_publication_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, episode_id) REFERENCES analytics_episodes (tenant_id, id),
  UNIQUE (tenant_id, social_account_id, external_publication_id, source_fingerprint)
);

CREATE INDEX IF NOT EXISTS analytics_episode_suggestions_pending_idx
  ON analytics_episode_suggestions (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS analytics_episode_suggestions_source_idx
  ON analytics_episode_suggestions (tenant_id, social_account_id, external_publication_id, created_at DESC);
