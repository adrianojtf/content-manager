# Technical Specification — Tenant Identity and Access

**Status:** IAM-01 model accepted; IAM-02 generic OIDC verification, local identity lookup, PostgreSQL mapping, and bearer-guard foundations are implemented. IAM-03 preference persistence and IAM-05 authenticated tenant-isolation E2E coverage are implemented. ADR-008 selects a same-origin NestJS BFF/session for the Phase 1 remote pilot, but the production HTTP composition and CreatorDesk login are not yet wired. Auth0 configuration, Google federation, pilot-user bootstrap, and operational migration/rollback remain open Phase 1 deployment gates.

**Product source:** [MVP PRD](../product/prd.md)  
**Architecture decision:** [ADR-006 — Tenant Identity and Access](../architecture/decisions/ADR-006-tenant-identity-and-access.md)  
- **Phase 1 session decision:** [ADR-008 — Phase 1 Authenticated Browser Session](../architecture/decisions/ADR-008-phase1-authenticated-session.md)
**Localization contract:** [Localization Contract](../contracts/localization.md)

## 1. Scope

Provide authenticated tenant context for the remote Phase 1 pilot and tenant isolation for the multi-tenant MVP, plus a later web administration console for platform tenant provisioning and membership administration. The Phase 1 pilot provisions one approved creator; it does not introduce public registration or self-service tenant creation. This is an application boundary; it does not introduce a separate identity microservice.

## 2. Accepted Identity Model

- A `Tenant` owns all Content, media assets, connected social accounts, Publications, metric snapshots, comments, responses, and intelligence records created within it.
- A local `User` is linked to a managed OIDC identity by the immutable `(issuer, subject)` pair. Email is mutable profile data and is not an identity key.
- One user belongs to exactly one tenant in the MVP; no tenant switching or multi-tenant memberships for a single user.
- `TenantMembership` assigns `OWNER` or `MEMBER`. Each tenant has exactly one owner; ownership must be transferred before that user is removed or demoted.
- `OWNER` inherits member product capabilities and can manage tenant settings and memberships. `MEMBER` can operate the tenant's content and publication workflows but cannot administer membership or tenant settings.
- `PLATFORM_ADMIN` is a separate global role, not a tenant role. It is granted through a controlled operations process and is required to create tenants and provision their initial owners.
- Self-service tenant creation and user registration are not part of this MVP. Tenant owners manage memberships for provisioned users.

## 3. Authentication and Request Context

Auth0 is the selected managed OpenID Connect provider. Google is federated through Auth0; the application never accepts Google tokens directly. The browser login uses authorization-code flow with PKCE. The API receives the exact Auth0 discovery `issuer`, registered API `audience`, and discovery `jwks_uri` through runtime configuration; it validates access-token signature, issuer, audience, required subject and expiry, and applicable `nbf` time claims. Configure the Auth0 API to sign with `RS256`; the verifier accepts only explicitly configured asymmetric algorithms. OIDC issuer and JWKS endpoints require HTTPS; HTTP localhost is permitted only in deterministic tests. The API validates access tokens for its API audience, not ID tokens.

For the Phase 1 remote pilot, the selected pattern is a same-origin BFF/session in NestJS. Auth0 tokens and client secrets remain server-side; the browser receives an opaque `Secure`, `HttpOnly`, `SameSite=Lax` session cookie. Session records are persisted with expiry/revocation so a restart or later horizontal scaling does not lose all sessions. State-changing cookie-authenticated requests require CSRF protection. The social-provider callback must return through this authenticated browser session and bind its single-use state to the authenticated user and tenant. VPN/source-IP restrictions are additional network controls.

Application-facing authentication contracts are provider-neutral:

```typescript
interface OidcAccessTokenVerifier {
  verifyAccessToken(token: string): Promise<{ issuer: string; subject: string }>;
}

interface LocalIdentity {
  userId: string;
  isActive: boolean;
  tenantId: string | null;
  tenantRole: 'OWNER' | 'MEMBER' | null;
  tenantIsActive: boolean | null;
  isPlatformAdmin: boolean;
}

interface OidcIdentityRepository {
  findByIssuerAndSubject(issuer: string, subject: string): Promise<LocalIdentity | null>;
}

type AuthenticatedPrincipal =
  | { kind: 'tenant-user'; userId: string; tenantId: string; tenantRole: 'OWNER' | 'MEMBER' }
  | { kind: 'platform-admin'; userId: string };
```

The application principal contains only identities resolved from local records. Tenant ID is never trusted from a request body, query parameter, or unvalidated token claim. Missing/invalid tokens, unknown/inactive identities, inactive tenants, and users without the required membership are rejected before application workflows run with stable error codes. Raw tokens and OIDC claims are not logged.

In the Phase 1 remote pilot, Auth0 is the OIDC broker and Google is enabled as its federated login connection. The NestJS BFF validates Auth0 access tokens issued for the registered API audience, then creates a server-side session; browser API requests use that session, not a token in local storage. The application does not accept Google ID/access tokens directly. Only explicitly provisioned pilot identities mapped by `(issuer, subject)` to an active local user and pilot-tenant membership are allowed. Email/domain allowlisting at Auth0 or the deployment edge is defense-in-depth, not a replacement for the local identity/membership check. Self-service registration and tenant switching remain out of scope.

The CreatorDesk login uses the BFF/session pattern in [ADR-008](../architecture/decisions/ADR-008-phase1-authenticated-session.md). The web client/session integration must not persist access or refresh tokens in browser `localStorage`. Social-provider callback state is single-use, short-lived, persisted outside process memory, and bound to the authenticated user and tenant. VPN/source-IP restriction is an additional pilot control.

`OidcAuthenticationModule.register` composes the verifier, identity repository, and bearer guards. IAM-08 must compose it with the server-side session authenticator and ensure product controllers reject unauthenticated requests; tenant routes additionally apply `TenantMembershipGuard`, and administration routes apply `PlatformAdminGuard`. Missing/invalid credentials map to 401, an unavailable identity provider maps to 503, and a role/context mismatch maps to 403. The current `AppModule.withPostgres` composition does not yet import the OIDC module or guard the production controllers; IAM-08 tracks this integration.

### IAM-02 identity persistence foundation

The migration `src/infrastructure/persistence/migrations/002_create_tenant_identity.sql` creates `tenants`, `users`, `tenant_memberships`, and `platform_admins`. `users` has a unique `(oidc_issuer, oidc_subject)` identity and an active flag. `tenant_memberships.user_id` is the primary key, enforcing one tenant per user; its role check accepts only `OWNER` or `MEMBER`, and a partial unique index enforces one Owner per tenant. `platform_admins` stores global grants separately from tenant roles. The `PostgresOidcIdentityRepository` resolves only this local mapping. Tenant creation and insertion of the initial Owner must be transactional; IAM-06 performs that operation. IAM-03 adds tenant/user localization preference fields.

## 4. Tenant Isolation

- All tenant-owned repository methods require a tenant ID obtained from the authenticated principal.
- Reads and mutations always constrain records to that tenant, even when a globally unique record ID is supplied.
- Connected social credentials, queued jobs, and media object references remain associated with their tenant; secrets are never placed in tenant context or logs.
- IAM-04 adds a required tenant foreign key and tenant-scoped Content repository. CMS-03 remains blocked until OIDC deployment configuration is available.

## 5. Tenant Administration

A web console provides separate capabilities for the global platform administrator and tenant owners:

- Platform administrators create tenants and provision their initial owner and user identities.
- Tenant owners manage tenant settings and memberships; members cannot grant roles or access another tenant.
- The console itself authenticates through OIDC and checks the corresponding platform or tenant role on every server-side operation.
- No client-side role check is an authorization boundary.

The console uses the existing localization port. IAM-03 persists tenant/user preferences; FND-04 wires those persisted values into authenticated request context and presentation for the Phase 3 tenant-administration console.

## 6. Localization Preferences

`Tenant.defaultLocale` and `Tenant.timezone` are nullable and fall back to the configured system locale and UTC. `Tenant.currency` is required, validated as a supported ISO 4217 code, and has no inferred/default value. `User.locale` and `User.timezone` are nullable overrides; User never stores currency. Writes canonicalize supported locale tags, validate IANA timezones, and reject unsupported values; reads continue to use the existing fallback policy. Only `OWNER` may update tenant preferences, while each tenant user may update only their own preferences, with IDs derived from the authenticated principal. The IAM-03 migration is `src/infrastructure/persistence/migrations/003_add_localization_preferences.sql` and must be applied before tenant provisioning.

## 6.1 Profile appearance

- The profile settings screen lets the user select the light or dark appearance for the console.
- Appearance is applied to the complete console, including profile settings, and takes effect immediately without a reload.
- The selection is stored in browser `localStorage` for that browser profile; it is not an account/server preference and does not synchronize across devices.
- A missing or invalid stored value uses light appearance. Only the explicit `light` and `dark` values are accepted.
- Changing appearance must not change localization, tenant settings, or account data.

## 7. Verification

- **Unit:** OIDC identity mapping, principal construction, preference validation/canonicalization, and Owner-versus-Member update authorization.
- **Frontend unit:** appearance selection accepts only light/dark, persists per browser, applies to the document, and defaults to light for missing/invalid storage.
- **Integration:** OIDC verification against deterministic local signing keys; PostgreSQL-compatible tests for identity and preference reads/writes scoped by tenant.
- **IAM-05 E2E:** authenticated requests for two tenants cannot read or mutate one another's Content; server-resolved tenant context scopes preference reads, user locale overrides tenant locale, and timezone falls back deterministically. Local signing keys and in-memory identity/persistence doubles are used.
- **IAM-06 E2E:** platform-admin provisioning and tenant-owner membership actions use deterministic identity-provider doubles.
- No test contacts a production OIDC provider or relies on live credentials.

## 8. Remaining Implementation Decisions

- Deployment-specific Auth0 domain, API identifier, Google connection, exact callback/logout origins, server-side secret delivery, and bootstrap procedure for the Phase 1 pilot identity; finalize in IAM-07/IAM-08.
- Maintained OIDC/BFF session library and exact login/logout/social callback routes for the current static CreatorDesk; resolve and test these in IAM-08 before registering Auth0 callback URLs.
- Invitation/activation details for additional users, platform-admin provisioning, and tenant/member deactivation or deletion policy; finalize in IAM-06 for Phase 3.
- Operational migration runner, rollout ordering, and rollback tooling; IAM-03 defines the SQL migration, which must be applied before tenant provisioning.