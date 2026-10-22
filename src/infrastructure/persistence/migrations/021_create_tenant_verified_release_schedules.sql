CREATE TABLE IF NOT EXISTS tenant_verified_release_schedules (
  tenant_id UUID NOT NULL,
  enabled BOOLEAN NOT NULL,
  days_of_week TEXT[] NOT NULL,
  local_time TIME WITHOUT TIME ZONE NOT NULL,
  time_zone TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);
