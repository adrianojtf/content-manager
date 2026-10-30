ALTER TABLE analytics_episodes
  ADD COLUMN IF NOT EXISTS production_cost_amount NUMERIC(14,2);

ALTER TABLE analytics_episodes
  ADD COLUMN IF NOT EXISTS production_time_seconds INTEGER;

CREATE TABLE IF NOT EXISTS analytics_performance_observations (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  episode_id UUID NOT NULL,
  social_account_id UUID NOT NULL,
  external_publication_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'facebook')),
  observed_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  views BIGINT CHECK (views IS NULL OR views >= 0),
  likes BIGINT CHECK (likes IS NULL OR likes >= 0),
  comments BIGINT CHECK (comments IS NULL OR comments >= 0),
  shares BIGINT CHECK (shares IS NULL OR shares >= 0),
  saves BIGINT CHECK (saves IS NULL OR saves >= 0),
  reach BIGINT CHECK (reach IS NULL OR reach >= 0),
  followers_gained BIGINT CHECK (followers_gained IS NULL OR followers_gained >= 0),
  profile_visits BIGINT CHECK (profile_visits IS NULL OR profile_visits >= 0),
  average_watch_time_seconds DOUBLE PRECISION CHECK (average_watch_time_seconds IS NULL OR average_watch_time_seconds >= 0),
  retention_percent DOUBLE PRECISION CHECK (retention_percent IS NULL OR retention_percent >= 0),
  metric_definitions_json TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL CHECK (char_length(btrim(created_by)) > 0),
  updated_by TEXT NOT NULL CHECK (char_length(btrim(updated_by)) > 0),
  UNIQUE (tenant_id, social_account_id, external_publication_id, observed_at),
  FOREIGN KEY (tenant_id, episode_id) REFERENCES analytics_episodes (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, social_account_id, external_publication_id)
    REFERENCES analytics_episode_publication_links (tenant_id, social_account_id, external_publication_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analytics_performance_observations_episode_idx
  ON analytics_performance_observations (tenant_id, episode_id, platform, observed_at);

CREATE TABLE IF NOT EXISTS analytics_account_follower_snapshots (
  tenant_id UUID NOT NULL,
  social_account_id UUID NOT NULL REFERENCES social_accounts (id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL,
  total_followers BIGINT NOT NULL CHECK (total_followers >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL CHECK (char_length(btrim(created_by)) > 0),
  updated_by TEXT NOT NULL CHECK (char_length(btrim(updated_by)) > 0),
  PRIMARY KEY (tenant_id, social_account_id, observed_at)
);

CREATE TABLE IF NOT EXISTS analytics_platform_monthly_revenue (
  tenant_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'facebook')),
  month DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL CHECK (currency = 'BRL'),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL CHECK (char_length(btrim(created_by)) > 0),
  updated_by TEXT NOT NULL CHECK (char_length(btrim(updated_by)) > 0),
  PRIMARY KEY (tenant_id, platform, month)
);
