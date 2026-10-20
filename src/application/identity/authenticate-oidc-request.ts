import type { AuthenticatedPrincipal, TenantRole } from './authenticated-principal';
import { AuthenticationError } from './authentication-error';
import type { OidcAccessTokenVerifier } from '../ports/oidc-access-token-verifier.port';
import type { OidcIdentityRepository } from '../ports/oidc-identity-repository.port';

export class AuthenticateOidcRequest {
  constructor(
    private readonly tokenVerifier: OidcAccessTokenVerifier,
    private readonly identities: OidcIdentityRepository,
  ) {}

  async execute(accessToken: string | undefined): Promise<AuthenticatedPrincipal> {
    if (!accessToken?.trim()) {
      throw new AuthenticationError('AUTHENTICATION_REQUIRED');
    }

    const externalIdentity = await this.tokenVerifier.verifyAccessToken(accessToken);
    const identity = await this.identities.findByIssuerAndSubject(externalIdentity.issuer, externalIdentity.subject);

    if (!identity) {
      throw new AuthenticationError('IDENTITY_NOT_PROVISIONED');
    }
    if (!identity.isActive) {
      throw new AuthenticationError('IDENTITY_INACTIVE');
    }
    if (identity.isPlatformAdmin) {
      return { kind: 'platform-admin', userId: identity.userId };
    }
    if (!identity.tenantId || !identity.tenantRole) {
      throw new AuthenticationError('TENANT_MEMBERSHIP_REQUIRED');
    }
    if (!identity.tenantIsActive) {
      throw new AuthenticationError('TENANT_INACTIVE');
    }
    if (!this.isTenantRole(identity.tenantRole)) {
      throw new AuthenticationError('TENANT_MEMBERSHIP_REQUIRED');
    }

    return {
      kind: 'tenant-user',
      userId: identity.userId,
      tenantId: identity.tenantId,
      tenantRole: identity.tenantRole,
    };
  }

  private isTenantRole(role: TenantRole): boolean {
    return role === 'OWNER' || role === 'MEMBER';
  }
}
