ALTER TABLE contents
  ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);

CREATE INDEX contents_tenant_id_idx ON contents (tenant_id);
