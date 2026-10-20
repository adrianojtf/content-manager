import { Body, Controller, DynamicModule, Get, Inject, Module, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../../src/application/identity/authenticated-principal';
import { LocalizationPreferencesService } from '../../../src/application/localization/localization-preferences.service';
import { resolveLocale, resolveTimezone } from '../../../src/application/localization/locale-resolution';
import type { OidcIdentityRepository } from '../../../src/application/ports/oidc-identity-repository.port';
import type {
  TenantLocalizationPreferencesRepository,
  UserLocalizationPreferencesRepository,
} from '../../../src/application/ports/localization-preferences.repository.port';
import { JsonLocalizationAdapter } from '../../../src/infrastructure/localization/json-localization.adapter';
import type { JoseOidcAccessTokenVerifierConfig } from '../../../src/infrastructure/identity/jose-oidc-access-token-verifier';
import { AppModule } from '../../../src/presentation/http/app.module';
import type { AuthenticatedHttpRequest } from '../../../src/presentation/http/guards/oidc-authentication.guard';
import { OidcAuthenticationGuard, TenantMembershipGuard } from '../../../src/presentation/http/guards/oidc-authentication.guard';
import { OidcAuthenticationModule } from '../../../src/presentation/http/oidc-authentication.module';

const CONTENT_REPOSITORY = Symbol('IAM_E2E_CONTENT_REPOSITORY');
const TENANT_PREFERENCES = Symbol('IAM_E2E_TENANT_PREFERENCES');
const USER_PREFERENCES = Symbol('IAM_E2E_USER_PREFERENCES');
const LOCALIZATION = Symbol('IAM_E2E_LOCALIZATION');

interface ContentRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly description: string;
  readonly mediaReference: string;
}

interface TenantIsolationContentRepository {
  save(tenantId: string, content: ContentRecord): Promise<void>;
  findById(tenantId: string, id: string): Promise<ContentRecord | null>;
}

interface TenantIsolationE2eOptions {
  readonly issuer: string;
  readonly jwksUri: string;
  readonly identities: OidcIdentityRepository;
  readonly tenantPreferences: TenantLocalizationPreferencesRepository;
  readonly userPreferences: UserLocalizationPreferencesRepository;
  readonly contentRepository: TenantIsolationContentRepository;
}

interface LocalizationContextResponse {
  readonly locale: string;
  readonly timezone: string;
}

class TenantIsolationE2eJourney {
  constructor(
    @Inject(CONTENT_REPOSITORY) private readonly content: TenantIsolationContentRepository,
    private readonly preferences: LocalizationPreferencesService,
    @Inject(LOCALIZATION) private readonly localization: JsonLocalizationAdapter,
  ) {}

  async createContent(principal: AuthenticatedPrincipal, input: Omit<ContentRecord, 'tenantId'>): Promise<ContentRecord> {
    const tenant = this.requireTenant(principal);
    const content = { ...input, tenantId: tenant.tenantId };
    await this.content.save(tenant.tenantId, content);
    return content;
  }

  async findContent(principal: AuthenticatedPrincipal, id: string): Promise<ContentRecord> {
    const tenant = this.requireTenant(principal);
    const content = await this.content.findById(tenant.tenantId, id);
    if (!content) {
      throw new NotFoundException();
    }
    return content;
  }

  async updateContent(
    principal: AuthenticatedPrincipal,
    id: string,
    input: Pick<ContentRecord, 'title' | 'description'>,
  ): Promise<ContentRecord> {
    const tenant = this.requireTenant(principal);
    const content = await this.content.findById(tenant.tenantId, id);
    if (!content) {
      throw new NotFoundException();
    }
    const updated = { ...content, ...input };
    await this.content.save(tenant.tenantId, updated);
    return updated;
  }

  async localizationContext(principal: AuthenticatedPrincipal, acceptLanguage: string | undefined): Promise<LocalizationContextResponse> {
    const tenant = this.requireTenant(principal);
    const [tenantPreferences, userPreferences] = await Promise.all([
      this.preferences.findTenantPreferences(tenant),
      this.preferences.findUserPreferences(tenant),
    ]);
    return {
      locale: resolveLocale({
        userLocale: userPreferences.locale,
        tenantDefaultLocale: tenantPreferences.defaultLocale,
        acceptLanguage,
      }, this.localization.getSupportedLocales(), 'en-US'),
      timezone: resolveTimezone(userPreferences.timezone, tenantPreferences.timezone),
    };
  }

  private requireTenant(principal: AuthenticatedPrincipal): Extract<AuthenticatedPrincipal, { kind: 'tenant-user' }> {
    if (principal.kind !== 'tenant-user') {
      throw new NotFoundException();
    }
    return principal;
  }
}

@Controller('_test/iam')
@UseGuards(OidcAuthenticationGuard, TenantMembershipGuard)
class TenantIsolationE2eController {
  constructor(private readonly journey: TenantIsolationE2eJourney) {}

  @Post('content')
  createContent(@Req() request: AuthenticatedHttpRequest, @Body() input: Omit<ContentRecord, 'tenantId'>): Promise<ContentRecord> {
    return this.journey.createContent(request.principal!, input);
  }

  @Get('content/:id')
  findContent(@Req() request: AuthenticatedHttpRequest, @Param('id') id: string): Promise<ContentRecord> {
    return this.journey.findContent(request.principal!, id);
  }

  @Patch('content/:id')
  updateContent(
    @Req() request: AuthenticatedHttpRequest,
    @Param('id') id: string,
    @Body() input: Pick<ContentRecord, 'title' | 'description'>,
  ): Promise<ContentRecord> {
    return this.journey.updateContent(request.principal!, id, input);
  }

  @Get('localization')
  localizationContext(@Req() request: AuthenticatedHttpRequest): Promise<LocalizationContextResponse> {
    const acceptLanguage = request.headers['accept-language'];
    return this.journey.localizationContext(request.principal!, Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage);
  }
}

@Module({})
class TenantIsolationE2eModule {}

export function createTenantIsolationE2eModule(options: TenantIsolationE2eOptions): DynamicModule {
  const verifierConfig: JoseOidcAccessTokenVerifierConfig = {
    issuer: options.issuer,
    audience: 'content-manager-api',
    jwksUri: options.jwksUri,
    allowedAlgorithms: ['RS256'],
    allowInsecureLocalhost: true,
  };
  const localization = new JsonLocalizationAdapter('en-US');

  return {
    module: TenantIsolationE2eModule,
    imports: [
      AppModule,
      OidcAuthenticationModule.register({ verifierConfig, identities: options.identities }),
    ],
    controllers: [TenantIsolationE2eController],
    providers: [
      TenantIsolationE2eJourney,
      { provide: CONTENT_REPOSITORY, useValue: options.contentRepository },
      { provide: TENANT_PREFERENCES, useValue: options.tenantPreferences },
      { provide: USER_PREFERENCES, useValue: options.userPreferences },
      { provide: LOCALIZATION, useValue: localization },
      {
        provide: LocalizationPreferencesService,
        useFactory: (
          tenants: TenantLocalizationPreferencesRepository,
          users: UserLocalizationPreferencesRepository,
        ) => new LocalizationPreferencesService(tenants, users, localization),
        inject: [TENANT_PREFERENCES, USER_PREFERENCES],
      },
    ],
  };
}
