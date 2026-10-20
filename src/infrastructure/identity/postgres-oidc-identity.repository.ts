import type { LocalOidcIdentity, OidcIdentityRepository } from '../../application/ports/oidc-identity-repository.port';
import type { TenantRole } from '../../application/identity/authenticated-principal';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';

interface IdentityRow extends Record<string, unknown> {
  user_id: string;
  user_is_active: boolean;
  tenant_id: string | null;
  tenant_role: string | null;
  tenant_is_active: boolean | null;
  is_platform_admin: boolean;
}

export class PostgresOidcIdentityRepository implements OidcIdentityRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async findByIssuerAndSubject(issuer: string, subject: string): Promise<LocalOidcIdentity | null> {
    const { rows } = await this.database.query<IdentityRow>(
      `SELECT users.id AS user_id,
              users.is_active AS user_is_active,
              tenant_memberships.tenant_id,
              tenant_memberships.role AS tenant_role,
              tenants.is_active AS tenant_is_active,
              CASE WHEN platform_admins.user_id IS NULL THEN FALSE ELSE TRUE END AS is_platform_admin
       FROM users
       LEFT JOIN tenant_memberships ON tenant_memberships.user_id = users.id
       LEFT JOIN tenants ON tenants.id = tenant_memberships.tenant_id
       LEFT JOIN platform_admins ON platform_admins.user_id = users.id
       WHERE users.oidc_issuer = $1 AND users.oidc_subject = $2`,
      [issuer, subject],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      userId: row.user_id,
      isActive: row.user_is_active,
      tenantId: row.tenant_id,
      tenantRole: this.toTenantRole(row.tenant_role),
      tenantIsActive: row.tenant_is_active,
      isPlatformAdmin: row.is_platform_admin,
    };
  }

  private toTenantRole(role: string | null): TenantRole | null {
    if (role === 'OWNER' || role === 'MEMBER') {
      return role;
    }
    return null;
  }
}
