import type { TenantRole } from '../identity/authenticated-principal';

export interface LocalOidcIdentity {
  readonly userId: string;
  readonly isActive: boolean;
  readonly tenantId: string | null;
  readonly tenantRole: TenantRole | null;
  readonly tenantIsActive: boolean | null;
  readonly isPlatformAdmin: boolean;
}

export interface OidcIdentityRepository {
  findByIssuerAndSubject(issuer: string, subject: string): Promise<LocalOidcIdentity | null>;
}
