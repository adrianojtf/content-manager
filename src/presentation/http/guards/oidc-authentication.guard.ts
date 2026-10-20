import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { AuthenticatedPrincipal } from '../../../application/identity/authenticated-principal';
import { AuthenticateOidcRequest } from '../../../application/identity/authenticate-oidc-request';
import { AuthenticationError } from '../../../application/identity/authentication-error';

export interface AuthenticatedHttpRequest extends IncomingMessage {
  principal?: AuthenticatedPrincipal;
}

@Injectable()
export class OidcAuthenticationGuard implements CanActivate {
  constructor(private readonly authenticate: AuthenticateOidcRequest) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedHttpRequest>();
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string' ? /^Bearer\s+(\S+)$/i.exec(authorization.trim()) : null;

    if (!match) {
      throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED' });
    }

    try {
      request.principal = await this.authenticate.execute(match[1]);
      return true;
    } catch (error) {
      if (error instanceof AuthenticationError && error.code === 'IDENTITY_PROVIDER_UNAVAILABLE') {
        throw new ServiceUnavailableException({ code: error.code });
      }
      if (error instanceof AuthenticationError) {
        throw new UnauthorizedException({ code: error.code });
      }
      throw error;
    }
  }
}

@Injectable()
export class TenantMembershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedHttpRequest>();
    if (request.principal?.kind !== 'tenant-user') {
      throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED' });
    }
    return true;
  }
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedHttpRequest>();
    if (request.principal?.kind !== 'platform-admin') {
      throw new ForbiddenException({ code: 'PLATFORM_ADMIN_REQUIRED' });
    }
    return true;
  }
}
