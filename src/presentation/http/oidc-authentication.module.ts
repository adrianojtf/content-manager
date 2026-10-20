import { DynamicModule, Module } from '@nestjs/common';
import type { OidcIdentityRepository } from '../../application/ports/oidc-identity-repository.port';
import type { OidcAccessTokenVerifier } from '../../application/ports/oidc-access-token-verifier.port';
import { AuthenticateOidcRequest } from '../../application/identity/authenticate-oidc-request';
import type { JoseOidcAccessTokenVerifierConfig } from '../../infrastructure/identity/jose-oidc-access-token-verifier';
import { JoseOidcAccessTokenVerifier } from '../../infrastructure/identity/jose-oidc-access-token-verifier';
import { oidcVerifierConfigFromEnvironment, type OidcEnvironment } from '../../infrastructure/identity/oidc-verifier-config';
import { OidcAuthenticationGuard, PlatformAdminGuard, TenantMembershipGuard } from './guards/oidc-authentication.guard';

export const OIDC_ACCESS_TOKEN_VERIFIER = Symbol('OIDC_ACCESS_TOKEN_VERIFIER');
export const OIDC_IDENTITY_REPOSITORY = Symbol('OIDC_IDENTITY_REPOSITORY');

export interface OidcAuthenticationModuleOptions {
  readonly verifierConfig: JoseOidcAccessTokenVerifierConfig;
  readonly identities: OidcIdentityRepository;
}

@Module({})
export class OidcAuthenticationModule {
  static registerFromEnvironment(
    identities: OidcIdentityRepository,
    environment: OidcEnvironment = process.env,
  ): DynamicModule {
    return this.register({
      verifierConfig: oidcVerifierConfigFromEnvironment(environment),
      identities,
    });
  }

  static register(options: OidcAuthenticationModuleOptions): DynamicModule {
    const verifier = new JoseOidcAccessTokenVerifier(options.verifierConfig);

    return {
      module: OidcAuthenticationModule,
      providers: [
        { provide: OIDC_ACCESS_TOKEN_VERIFIER, useValue: verifier },
        { provide: OIDC_IDENTITY_REPOSITORY, useValue: options.identities },
        {
          provide: AuthenticateOidcRequest,
          useFactory: (tokenVerifier: OidcAccessTokenVerifier, identities: OidcIdentityRepository) => new AuthenticateOidcRequest(tokenVerifier, identities),
          inject: [OIDC_ACCESS_TOKEN_VERIFIER, OIDC_IDENTITY_REPOSITORY],
        },
        OidcAuthenticationGuard,
        TenantMembershipGuard,
        PlatformAdminGuard,
      ],
      exports: [AuthenticateOidcRequest, OidcAuthenticationGuard, TenantMembershipGuard, PlatformAdminGuard],
    };
  }
}
