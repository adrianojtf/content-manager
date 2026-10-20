export type TenantRole = 'OWNER' | 'MEMBER';

export interface TenantUserPrincipal {
  readonly kind: 'tenant-user';
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantRole: TenantRole;
}

export interface PlatformAdminPrincipal {
  readonly kind: 'platform-admin';
  readonly userId: string;
}

export type AuthenticatedPrincipal = TenantUserPrincipal | PlatformAdminPrincipal;
