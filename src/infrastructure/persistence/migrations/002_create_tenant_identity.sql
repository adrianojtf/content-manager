CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  oidc_issuer TEXT NOT NULL CHECK (char_length(btrim(oidc_issuer)) > 0),
  oidc_subject TEXT NOT NULL CHECK (char_length(btrim(oidc_subject)) > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'MEMBER'))
);

CREATE UNIQUE INDEX IF NOT EXISTS one_owner_per_tenant
  ON tenant_memberships (tenant_id)
  WHERE role = 'OWNER';

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id UUID PRIMARY KEY REFERENCES users(id)
);
