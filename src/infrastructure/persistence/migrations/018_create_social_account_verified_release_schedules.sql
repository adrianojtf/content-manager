CREATE TABLE IF NOT EXISTS social_account_verified_release_schedules (
  tenant_id UUID NOT NULL,
  social_account_id UUID NOT NULL,
  enabled BOOLEAN NOT NULL,
  days_of_week TEXT[] NOT NULL,
  local_time TIME WITHOUT TIME ZONE NOT NULL,
  time_zone TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, social_account_id),
  FOREIGN KEY (tenant_id, social_account_id)
    REFERENCES social_accounts (tenant_id, id) ON DELETE CASCADE
);
