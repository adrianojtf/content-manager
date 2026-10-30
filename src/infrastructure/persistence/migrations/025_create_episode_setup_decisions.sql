ALTER TABLE analytics_episode_suggestions
  ADD CONSTRAINT analytics_episode_suggestions_tenant_id_id_unique UNIQUE (tenant_id, id);

CREATE TABLE analytics_episode_setup_decisions (
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  suggestion_id UUID NOT NULL,
  series_id UUID NOT NULL,
  series_confirmed_at TIMESTAMPTZ NOT NULL,
  series_confirmed_by TEXT NOT NULL CHECK (char_length(btrim(series_confirmed_by)) > 0),
  season_number INTEGER,
  season_confirmed_at TIMESTAMPTZ,
  season_confirmed_by TEXT,
  PRIMARY KEY (tenant_id, suggestion_id),
  FOREIGN KEY (tenant_id, suggestion_id)
    REFERENCES analytics_episode_suggestions (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, series_id)
    REFERENCES analytics_series (tenant_id, id) ON DELETE CASCADE,
  CHECK (season_number IS NULL OR season_number > 0),
  CHECK ((season_confirmed_at IS NULL) = (season_confirmed_by IS NULL))
);

CREATE INDEX analytics_episode_setup_decisions_series_idx
  ON analytics_episode_setup_decisions (tenant_id, series_id, season_number);
