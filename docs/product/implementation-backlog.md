# MVP Implementation Backlog

**Status:** Draft — tasks are ordered by dependency, not by estimate. Product/technical decisions are explicit prerequisite tasks where the specs are still open.

**Initial task state:** Todo. Update individual tasks to In Progress, Blocked, or Done as work proceeds. An epic dependency means its prerequisite capability is complete, including its E2E task, unless a task-level dependency allows earlier work.

**Product index:** [MVP PRD](prd.md)  
**Technical specs:** [Content](../specifications/technical-content-management.md) · [Publishing](../specifications/technical-social-publishing.md) · [Social content synchronization](../specifications/technical-social-content-synchronization.md) · [Analytics](../specifications/technical-analytics.md) · [Community](../specifications/technical-community-management.md) · [Response Refinement](../specifications/technical-response-refinement.md) · [Intelligence](../specifications/technical-audience-intelligence.md) · [Localization](../specifications/internationalization.md)

## Execution and Definition of Done

- Resolve blocking open decisions and update the linked PRD/tech spec before implementing behavior that depends on them.
- Apply Clean Code and TDD: add/update a failing test first, implement the smallest suitable change, then refactor with tests green.
- Every use case has unit tests; every external integration boundary has integration tests.
- Complete the epic's E2E task for critical user journeys using deterministic test doubles for external services; do not rely on production APIs or live AI output.
- Acceptance criteria and failure paths in the relevant specification are covered; keep specifications synchronized with behavior.
- User-facing text uses semantic localization keys at presentation boundaries; locale must not alter domain rules, persisted structured values, or technical logs. Follow the [localization contract](../contracts/localization.md).
- Follow the Hexagonal Architecture and AI/social integration boundaries in `AGENTS.md` and the linked technical specifications.

## Product Roadmap and Delivery Priority

The dependency order below does not define product priority. Execute capabilities by these phases; do not pull later-phase features into Phase 1 without an explicit scope decision.

1. **Phase 1 — Authenticated pilot, publications, and manual replies:** controlled single-creator deployment with a domain, trusted HTTPS, Auth0 login federated through Google, and VPN/source-IP restriction as defense-in-depth; platform authorization/connected accounts; list existing publications and comments; generate and edit response suggestions; require an explicit manual send for every reply. Prioritize IAM-07/IAM-08, SOC-01, SOC-02 account/read workflows, the publication-listing task, COM-01–COM-10, and only the platform adapter work needed for read/reply. Do not expose a public multi-user service or self-service registration. No dashboard or video upload/publishing.
2. **Phase 2 — Dashboard:** deliver the Novelaria dashboard with AI-assisted episode suggestions from already-imported publications, creator approval, and manually fed performance data (AN-01–AN-07). Episode discovery does not add social API calls; keep future metric-provider integrations deferred.
3. **Phase 3 — Multi-tenant identity and administration:** deliver tenant administration, membership management, and the platform-admin console (IAM-06, FND-04 and any blocked tenant-context integrations); enable multi-user/tenant access only after the required isolation and authorization journeys pass. The Phase 1 Auth0 pilot login is not public multi-tenant access.
4. **Phase 4 — Video upload and publishing:** deliver CMS upload (CMS-03–CMS-04) and the video-publishing portions of SOC-01–SOC-07, after platform capability verification. Keep scheduling/retry only where separately specified and verified.
5. **Future discovery — Vertical-drama streaming:** after consolidation of the earlier phases, assess a streaming product for vertical dramas and creator subscriptions by channel, playlist, or series/novel. This is feasibility research, not committed implementation scope.

Platform OAuth and permission checks for social accounts are distinct from the Phase 1 product-user login. The remote Phase 1 deployment requires an authenticated, explicitly provisioned pilot identity; VPN/source-IP restriction is additional defense-in-depth. Phase 1 remains a controlled, single-creator pilot and must not be made publicly accessible as a multi-user service.

## EPIC FND — MVP Technical Foundation

**Source:** [Architecture](../architecture/architecture.md), [Test Strategy](../validation/test-strategy.md).  
**Depends on:** none.

### FND-01 — Bootstrap the modular-monolith application

**Status:** Done

Create the documented TypeScript application foundation and module boundaries for domain, application, infrastructure, and HTTP presentation.

**Acceptance criteria**

- [x] The application has the documented modular-monolith boundaries and dependency direction.
- [x] The domain has no dependency on NestJS, ORM, database, queue, storage, social SDKs, or JEV SDK.
- [x] A minimal build and unit-test command can run in the repository.
- [x] No feature behavior or provider-specific business rules are introduced by the scaffold.

### FND-02 — Establish persistence, queue, and storage adapter foundations

**Status:** Done

Implement only the infrastructure ports needed by the capability specs: relational persistence, RabbitMQ job dispatch/consumption, and S3-compatible media storage.

**Acceptance criteria**

- [x] Each infrastructure capability is accessed through an application-facing port.
- [x] Adapter integration tests cover successful operation and representative failure behavior.
- [x] Provider/configuration secrets are kept outside domain objects and test output.
- [x] Local/test configuration is documented without committing secrets.

**Depends on:** FND-01.

### FND-03 — Establish deterministic E2E test support

**Status:** Done

Provide a test setup that exercises application journeys while replacing external providers with controlled test doubles.

**Acceptance criteria**

- [x] E2E tests can exercise the relevant presentation, application, and persistence path.
- [x] Social, storage, queue, and JEV boundaries can be controlled in tests.
- [x] Tests do not call production services or depend on nondeterministic AI output.

**Depends on:** FND-01.

## EPIC IAM — Tenant Identity, Authentication, and Isolation

**Source:** [MVP PRD](prd.md), [ADR-006](../architecture/decisions/ADR-006-tenant-identity-and-access.md), [IAM technical specification](../specifications/technical-identity-and-access.md), [Localization Contract](../contracts/localization.md).  
**Depends on:** FND-01, FND-02, FND-03. IAM-04 has a task-level dependency on CMS-02 so the existing Content repository is tenant-scoped before upload is implemented.

### IAM-01 — Finalize tenant, membership, and authentication model

**Status:** Done

Define tenant/user/membership cardinality, data ownership, OIDC identity mapping, roles, and tenant administration before implementation.

**Acceptance criteria**

- [x] A user belongs to exactly one tenant; tenant roles are `OWNER` and `MEMBER`, with exactly one Owner per tenant and ownership transfer required before removal or demotion.
- [x] Managed OIDC is the authentication protocol; local identity maps the immutable `(issuer, subject)` pair. Provider-vendor deployment selection is tracked in IAM-07.
- [x] `PLATFORM_ADMIN` is separate from tenant roles; a platform-admin web console provisions tenants and initial Owners. Self-service tenant creation is excluded.
- [x] Owners manage tenant settings and memberships; Members operate product workflows. Tenant ID is resolved server-side and never trusted from request data.
- [x] Content, media, social accounts, publications, analytics, comments, responses, and intelligence records are tenant-owned.
- [x] Master PRD, ADR, and IAM technical specification reflect the accepted multi-tenant MVP model.

### IAM-02 — Implement identity and authenticated tenant context

**Status:** Done

Implement managed OIDC verification and map identities to active local users and tenant memberships. Expose an authenticated principal containing user ID, tenant ID, and role.

**Acceptance criteria**

- [x] OIDC issuer, audience, signature, subject, expiry, and applicable time claims are validated against configured JWKS with an asymmetric algorithm allowlist.
- [x] Local identity is resolved only by verified `(issuer, subject)`; unknown/inactive identities, inactive tenants, and users without membership are rejected.
- [x] The HTTP guard accepts only a Bearer token, attaches the server-resolved principal, and keeps tenant and platform-admin guards separate.
- [x] PostgreSQL identity storage enforces unique OIDC identity, at most one tenant membership per user, one Owner per tenant, and separate platform-admin grants.
- [x] Integration tests use deterministic local signing keys and PostgreSQL-compatible doubles, not production identity services.

**Depends on:** IAM-01, FND-01, FND-02.

### IAM-03 — Persist tenant and user localization preferences

**Status:** Done

Persist tenant locale/timezone/currency settings and nullable user locale/timezone overrides through tenant-scoped repositories.

**Acceptance criteria**

- [x] Tenant `defaultLocale` and `timezone` may be unset and then use system-locale/UTC fallback; `currency` is required, supported ISO 4217, and is never inferred.
- [x] User `locale` and `timezone` are nullable overrides; currency is not duplicated on User.
- [x] Locale values are canonicalized against shipped catalogs; timezone values are validated as IANA identifiers; invalid writes are rejected.
- [x] Only tenant Owners may change tenant preferences; users change only their own user preferences, using server-resolved tenant context.
- [x] Preference repositories and tests prove settings cannot be read or changed across tenant boundaries.

**Depends on:** IAM-01, IAM-02, FND-02.

### IAM-04 — Retrofit Content persistence with tenant isolation

**Status:** Done

Add tenant ownership to Content and require tenant context for content repository reads/writes before CMS-03.

**Acceptance criteria**

- [x] Content persists a required tenant identifier with a relational constraint to the tenant record.
- [x] Repository lookup and mutation require tenant context; a known Content ID from another tenant cannot be read or changed.
- [x] Tests cover same-tenant access and cross-tenant denial.

**Depends on:** IAM-01, IAM-02, IAM-03, CMS-02, FND-02.

### IAM-05 — Verify tenant identity and isolation end to end

**Status:** Done

Exercise authenticated tenant resolution and settings/content isolation with deterministic authentication and persistence doubles.

**Acceptance criteria**

- [x] Requests from two tenants cannot read or mutate one another's records.
- [x] User locale overrides tenant locale; timezone fallback remains centralized and deterministic.
- [x] Tests do not use production identity or persistence services.

**Depends on:** IAM-02, IAM-03, IAM-04, FND-03.

### IAM-07 — Configure Auth0 for deployment

**Status:** Required for the Phase 1 remote Docker deployment — Auth0 is selected and the environment config loader is implemented; provider configuration, the Google connection, exact callback URLs, and pilot-user bootstrap remain pending.

Configure Auth0 as the managed OIDC provider and Google as its federated login connection. The application verifier remains provider-neutral and reads the issuer, API audience, and JWKS URI from runtime configuration. The API trusts Auth0-issued access tokens only; it does not accept Google tokens directly. See the Auth0 setup instructions in the [README](../../README.md).

**Acceptance criteria**

- [x] Auth0 supports the OIDC authorization-code flow with PKCE and signed JWT access tokens for a registered API audience.
- [x] The application requires `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URI` at composition and defaults to `RS256`.
- [x] Verifier tests cover issuer/audience/signature/expiry checks and reject insecure remote endpoints or unsupported signing algorithms without production credentials.
- [ ] The Auth0 API and Google connection are configured; the deployment uses the exact OIDC Discovery issuer/JWKS and registered API audience.
- [ ] The Phase 1 BFF login has exact HTTPS callback/logout/web origins for its implemented routes; wildcard production callbacks are prohibited.
- [ ] BFF client/session secrets are delivered server-side through the deployment secret mechanism, and the pre-provisioned pilot identity is mapped by `(issuer, subject)` to the pilot tenant.

**Depends on:** IAM-01, IAM-02.

### IAM-08 — Wire Auth0 pilot login into the deployed runtime

**Status:** Todo — Phase 1 remote deployment gate. OIDC verification and guard foundations exist, but the production HTTP composition and CreatorDesk login are not wired.

Connect Auth0 login to the current CreatorDesk web application through the same-origin NestJS BFF/session pattern in [ADR-008](../architecture/decisions/ADR-008-phase1-authenticated-session.md), and enforce the server-resolved principal on product APIs. Keep the reserved pilot tenant, but resolve access through the provisioned identity and membership rather than trusting caller-supplied tenant IDs. The Auth0 Google connection authenticates the creator; the application accepts Auth0-issued identity/access tokens and local `(issuer, subject)` membership.

**Acceptance criteria**

- [ ] The remote pilot uses OIDC authorization-code with PKCE and a secure callback/state/nonce flow; the browser receives only an opaque `Secure`, `HttpOnly`, `SameSite=Lax` session cookie and no OIDC tokens in `localStorage`.
- [ ] Server-side sessions have expiration, revocation, and CSRF protection for state-changing requests; session state is persisted outside process memory.
- [ ] The authorized Google identity is explicitly provisioned; unknown or inactive Auth0 identities and users without active pilot-tenant membership are denied.
- [ ] Product API routes reject missing or invalid authentication; tenant context comes from the server-resolved principal. Static assets and any health endpoint expose no tenant data.
- [ ] Social OAuth callbacks are protected by a single-use, short-lived state bound to the authenticated browser/user/tenant; a callback cannot connect an account to another tenant.
- [ ] Login/logout use the configured HTTPS domain and exact Auth0 callback/logout origins. VPN/source-IP restrictions remain an additional network control.
- [ ] Deterministic tests cover unauthenticated denial, valid pilot access, inactive/unknown identity denial, tenant isolation, logout/session expiry, and social OAuth callback state binding.
- [ ] No test depends on a live Auth0 tenant, Google account, or social provider.

**Depends on:** IAM-01, IAM-02, IAM-05, IAM-07, SOC-02, COM-03–COM-05, COM-12.

### FND-04 — Integrate localization with tenant/user context

**Status:** Deferred to Phase 3 — tenant preferences, tenant-scoped Content persistence, and isolation foundations exist; request-context localization for the tenant-administration console remains later-phase work. Phase 1 OIDC request context is tracked in IAM-08.

Wire the existing localization foundation into authenticated request context and product presentation. Reuse the existing locale/timezone resolution and catalog ports; do not add a second resolver.

**Acceptance criteria**

- [ ] Authenticated requests resolve user locale, then tenant default, then system default; anonymous `Accept-Language` negotiation cannot override a persisted preference.
- [ ] User timezone, tenant timezone, and UTC fallback are resolved centrally; unsupported preferences follow the localization contract.
- [ ] API instants remain ISO 8601 with explicit offsets; presentation formatting uses the resolved locale/timezone without endpoint-specific locale query parameters.
- [ ] Tests cover request-context resolution, tenant isolation, and deterministic formatting; any frontend in scope uses a localization facade.

**Depends on:** FND-01, FND-02, FND-03, IAM-01, IAM-02, IAM-03, IAM-04, IAM-05, IAM-07, IAM-08.

### FND-05 — Localize the CreatorDesk interface to supported locales

**Status:** In Progress

Complete frontend localization for the supported locales `pt-BR`, `en-US`, and `es-ES`. The local pilot persists the interface language in browser storage; authenticated locale resolution remains owned by FND-04. Keep the interface locale independent from provider wire formats.

**Acceptance criteria**

- [x] The profile settings screen lets the user select `pt-BR`, `en-US`, or `es-ES`; the local pilot persists the selection in browser storage.
- [ ] Authenticated selection is persisted as the user's locale preference after FND-04 wiring.
- [ ] The interface resolves locale using the existing precedence: user locale, tenant default, then system default; anonymous `Accept-Language` negotiation follows the localization contract.
- [x] All user-facing interface text, including validation, empty/loading/error states, accessible labels, and dynamic messages, is translated through semantic keys in all three catalogs.
- [x] Dates, numbers, and plural forms use the selected locale and explicit timezone policy; API data remains structured and independent of interface locale.
- [x] AI response suggestions are generated as separate `pt-BR`, `en-US`, and `es-ES` variants regardless of selected interface locale.
- [x] Automated tests verify catalog key parity, locale selection, interpolation, and representative formatting for all supported locales.
- [ ] Authenticated locale precedence and `Accept-Language` negotiation are wired through FND-04.

**Depends on:** FND-04, IAM-03.

### IAM-06 — Build the tenant administration web console (Phase 3)

Build a localized Next.js console for platform-admin tenant provisioning, tenant-owner membership/settings administration, and global response-generation provider/model selection. The model selector is a system-level setting: the pilot API stores it globally now; Phase 3 records the authenticated platform-admin actor.

**Acceptance criteria**

- [ ] Only authenticated `PLATFORM_ADMIN` users can create tenants, provision initial Owners, and change the global response-generation provider/model; tenant creation supplies a required valid ISO 4217 currency, while tenant locale/timezone may be unset.
- [ ] Only allowlisted provider/model pairs (currently Google `gemini-3.5-flash-lite` and OpenAI `gpt-6-luna`) can be selected; selection is persisted and the active value is shown after reload.
- [ ] The interface never accepts, displays, stores, or returns provider API keys; keys stay in server-side secret configuration, and the UI may show only a configured/not-configured status.
- [ ] The setting records the acting `PLATFORM_ADMIN` user ID; tenant Owners and Members cannot modify the global model setting.
- [ ] Tenant Owners can manage their own tenant memberships/settings; Members cannot administer roles or access another tenant.
- [ ] The UI calls authenticated APIs and never treats a client-supplied tenant ID or client-side role check as authorization.
- [ ] Tests cover access denial, tenant isolation, model/provider allowlisting, settings persistence, and secret non-disclosure with deterministic OIDC doubles.

**Depends on:** IAM-02, IAM-03, IAM-05, IAM-07, IAM-08, FND-04.

## EPIC CMS — Content Management

**Source:** [Content Management PRD](prds/content-management.md), [Content Management Tech Spec](../specifications/technical-content-management.md).  
**Depends on:** FND-01, FND-02.

### CMS-01 — Finalize content and media rules

**Status:** Done

Resolve the metadata schema, media constraints, validity checks, draft/ready transitions, upload protocol, and partial-failure/orphan cleanup behavior. Update the PRD and tech spec.

**Acceptance criteria**

- [x] Content requires non-empty editorial title and description; destination metadata is stored independently.
- [x] Content accepts declared `video/*` streams up to 5 GB; platform compatibility is validated per destination.
- [x] A key returned after successful storage is a valid media reference; new Content starts in draft and readiness is manually reversible.
- [x] Upload is non-resumable with no external URL import; persistence failure leaves an object for later reconciliation without synchronous deletion.
- [x] PRD and technical acceptance criteria are documented and testable.

### CMS-02 — Implement Content domain and persistence

**Status:** Done

Implement the stable Content identity, metadata, state, media-reference invariant, and repository adapter.

**Acceptance criteria**

- [x] Tests cover valid/invalid Content, metadata updates, and readiness behavior.
- [x] Content cannot be publishable without a valid media reference.
- [x] Unit and persistence integration tests pass against a deterministic PostgreSQL-compatible test database.

**Depends on:** CMS-01, FND-01, FND-02.

### CMS-03 — Implement media upload and content-creation use case

**Status:** Deferred to Phase 4 — tenant-scoped persistence is complete; resume after Phase 3 authentication and API composition are available.

Orchestrate upload through the media-storage port and creation/persistence of Content.

**Acceptance criteria**

- [ ] Tests are written first for successful upload, storage failure, invalid media, and persistence failure.
- [ ] Video bytes remain in object storage; only the approved media reference and content data are persisted in the relational store.
- [ ] Storage credentials and raw media contents are not exposed in logs or domain data.
- [ ] The authenticated tenant context, not a client-supplied tenant ID, scopes Content persistence and media ownership.

**Depends on:** CMS-01, CMS-02, FND-02, IAM-02, IAM-04, IAM-07.

### CMS-04 — Cover content creation with E2E scenarios

Verify the creator-facing upload/create path end to end with deterministic storage dependencies.

**Acceptance criteria**

- [ ] Valid upload creates content with a stable identifier and usable media reference.
- [ ] Missing/invalid media is rejected and does not create publishable content.
- [ ] Storage/persistence failure returns an explicit failure without corrupting content state.

**Depends on:** CMS-03, FND-03.

## EPIC SOC — Social Accounts and Publishing

**Source:** [Social Publishing PRD](prds/social-publishing.md), [Social Publishing Tech Spec](../specifications/technical-social-publishing.md).  
**Phase 1 dependencies:** FND-01, FND-02, SOC-01. Platform authorization is required for connected social accounts. **Phase 4 dependencies:** CMS and product-user authentication/tenant isolation tasks before multi-user video publishing.

### SOC-01 — Verify provider requirements and finalize publication policy

**Status:** In Progress — YouTube, Instagram Login, Facebook Login/Page selection, and configurable TikTok Business OAuth have local implementations with deterministic tests; Google/Meta/TikTok live access and app approvals remain pending. TikTok reads the authorization URL generated in My Apps from runtime configuration, validates `state`, exchanges the documented account code, and requires the official token example's `video.list`, `comment.list`, and `comment.list.manage` scopes. Do not substitute TikTok for Developers Login Kit or Research API. The [Platform Capability Matrix](../integrations/platform-capabilities.md) records local versus live status. The documented TikTok refresh request matches the adapter; approved-app verification remains pending. TikTok documents a separate account-token revoke endpoint, which the application does not expose. Phase 4 publishing/scheduling decisions remain deferred until that phase.

Verify production account eligibility, app access tiers, and failure/rate behavior separately for YouTube, Instagram, Facebook Pages, and TikTok Business. For TikTok, configure the app-generated authorization URL and registered callback at runtime; verify the provider's actual state/code callback behavior and refresh flow against an approved TikTok Business app before live rollout. Confirm that the existing scopes authorize `/business/video/list/`, `/business/comment/list/`, and `/business/comment/reply/create/` for the selected app. Do not use the advertiser token revoke endpoint for account tokens; if account-token revocation is added, use the documented short-term account-token endpoint and first specify the user-facing disconnect behavior. For Phase 4, separately verify publishing scopes, per-destination metadata/media constraints, publication statuses, retry/idempotency behavior, and scheduler/timezone policy. Validate each platform operation independently; do not impose a shared media intersection on Content. Before scheduling ships, define wall-clock-to-instant resolution, the explicit/resolved IANA timezone, DST gap/overlap behavior, and whether the original timezone is retained for edits or recurrence. Persist/transport resolved instants in UTC; UI locale affects display only.

**Acceptance criteria**

- [ ] YouTube, Instagram professional, Facebook Page, and TikTok Business account/comment read/reply permissions, access tiers, and unsupported outcomes are verified for production.
- [ ] Phase 4 publishing metadata/media constraints, unsupported outcomes, retry/idempotency, scheduling, timezone, and DST behavior are documented and testable before those features ship.
- [ ] Scheduled publication instants use canonical UTC/ISO 8601 data; display formatting follows the localization contract without changing schedule semantics.
- [ ] No capability parity is assumed across platforms or operations.

### SOC-02 — Implement account and publication application workflows

**Status:** In Progress — Phase 1 `SocialAccount` domain, tenant-scoped Postgres persistence, fixed local pilot context, credential-reference-safe connect use case, encrypted tenant-scoped vault, and local YouTube/Instagram/Facebook/TikTok OAuth connection flows are implemented. Facebook requires explicit Page selection. TikTok uses runtime app URL/configuration, single-use state, official scope checks, encrypted `open_id` credentials, and an account-specific refresh adapter. Google/Meta/TikTok live app access and refresh verification remain pending. The documented account-token revoke endpoint is not exposed by the application; the advertiser-token endpoint is not used. Phase 4 content-backed publication creation/status/idempotent publishing waits for CMS.

Implement connected social account records and capability checks in Phase 1. Implement content-backed per-destination Publication creation/status/idempotent publishing orchestration in Phase 4 after CMS is available.

**Acceptance criteria**

- [x] Social accounts preserve tenant, platform, provider account ID, display name, and an opaque credential reference; raw access/refresh tokens are not columns in the social account table.
- [x] The Phase 1 pilot tenant is fixed and resolved server-side; account connection accepts no client-supplied tenant ID, and response DTOs omit credential references.
- [x] Account repository reads/writes are tenant-scoped; duplicate provider identity in a tenant is rejected without leaking another tenant's record.
- [x] `GET /social/accounts` lists tenant-owned account summaries without credential references or provider reads for profile settings.
- [x] YouTube, Instagram, Facebook, and TikTok callbacks use independent provider adapters, one-time expiring state, validated scopes/identities, lazy configuration, encrypted vault storage, stable error codes, and persistence-compensation tests.
- [x] Facebook returns managed Page candidates without tokens and persists only the explicitly selected Page-scoped credential; selection is tenant-bound and single-use.
- [x] Deterministic HTTP/fetch doubles cover Instagram/Facebook/TikTok authorization, callbacks, token exchange, refresh, Page selection, and vault token rotation; no test calls a provider.
- [x] TikTok Business local connection uses the runtime app-generated authorization URL, checks `open_id` and `video.list`/`comment.list`/`comment.list.manage`, and stores tokens/scopes encrypted without requiring a migration.
- [ ] Verify TikTok refresh requests with an approved Business app; keep remote revocation out of scope until disconnect behavior is specified, and use only the documented short-term account-token endpoint if added.
- [ ] Tests cover authorization/capability gates, independent destination states, partial failure, and duplicate external requests.
- [ ] Unsupported operations do not call a social provider.
- [ ] One destination failure does not rollback or alter another destination.
- [x] Access/refresh tokens are encrypted at rest in the infrastructure vault, scoped by tenant/platform, and never returned by account or publication responses; the encryption key is not required at startup.

**Phase 1 dependencies:** SOC-01, FND-01. **Phase 4 dependencies:** CMS-02, SOC-01, FND-01.

### SOC-08 — Implement existing-publication listing

**Status:** In Progress — tenant-scoped aggregation, per-account partial outcomes, page-scoped PostgreSQL metadata upserts, idempotent external IDs, account-disconnect cascades, and the localhost listing route are implemented. Deterministic publication readers for all four targets are composed. Local Instagram/Facebook/TikTok OAuth connections are wired; the TikTok app-generated URL and live provider access/refresh behavior still require operator configuration and controlled verification.

Implement a provider-backed, paginated workflow to list existing publications from connected accounts for the Phase 1 community workflow and persist metadata for every successfully fetched page. Normalize results and preserve platform/external identifiers; keep provider pagination and DTOs inside each adapter. This task does not download, upload, or publish video content. See the [Social Content Synchronization PRD](prds/social-content-synchronization.md) and [technical specification](../specifications/technical-social-content-synchronization.md).

**Acceptance criteria**

- [x] The application normalizes publication data, preserves external IDs, passes opaque cursors through adapters, and reports unsupported/read failures per account without discarding other accounts' results.
- [x] A creator can list publications for all connected accounts or page one account through the localhost HTTP route.
- [x] A creator can navigate from a publication to its persisted comments through the HTTP API, including app/external reply states.
- [x] Tests cover pagination, partial platform failure, and unsupported read capability with deterministic provider doubles.
- [x] Successfully fetched pages are upserted by `(tenantId, socialAccountId, externalPublicationId)`; pages not requested by the creator are not backfilled.
- [x] Publication metadata is isolated by tenant/account and removed by account disconnection; failed reads/writes do not claim a successful synchronization.
- [ ] End-to-end listing is connected to OAuth-backed accounts and verified on the provider's approved test environment.

**Depends on:** SOC-01, SOC-02, the active-platform read adapters in SOC-04–SOC-06 and COM-12, FND-02. Provider account authorization remains a separate prerequisite for live results.

### SOC-03 — Implement publication queue and scheduling (Phase 4)

Dispatch independent publication jobs and enforce the agreed schedule, retry, and duplicate-delivery policies.

**Acceptance criteria**

- [ ] Tests cover repeated queue delivery and idempotent side-effect handling.
- [ ] A scheduled publication is not dispatched before its requested time.
- [ ] Retry and dead-letter behavior follows the documented policy.
- [ ] Job outcomes are persisted per publication.

**Depends on:** SOC-01, SOC-02, FND-02.

### SOC-04 — Implement YouTube account/read/reply and publishing adapter

**Status:** In Progress — YouTube publication/comment/reply adapters, local OAuth authorization-code flow (state/PKCE, read-only default, explicit reply-scope opt-in), encrypted token storage, and access-token refresh are implemented and covered with deterministic tests. Live Google app verification and Phase 4 video publishing remain pending; backend comment routes and the prototype-based comments frontend are implemented.

Implement Phase 1 account authorization and verified read/reply capabilities, then Phase 4 video publishing, against the YouTube provider contract. Keep the phases independently releasable.

**Acceptance criteria**

- [x] Phase 1 YouTube uploads are listed via the uploads playlist and mapped to the normalized publication contract with preserved video IDs and opaque pagination.
- [x] YouTube authorization, permission, rate-limit, server, network, and invalid-response errors map to stable application error codes without exposing provider error text.
- [x] Deterministic adapter tests cover successful listing, pagination, missing credentials, unsupported platform, and provider failures.
- [x] Local YouTube OAuth uses one-time state and PKCE, requests read-only scope by default, requires explicit reply-scope opt-in, and stores tokens only through the encrypted vault; OAuth settings are lazy and do not block startup.
- [x] YouTube comment reads preserve thread/comment IDs, pagination, and `canReply`; manual replies recheck the thread, require `youtube.force-ssl`, and do not blindly retry ambiguous results.
- [x] Expired access tokens refresh through the encrypted refresh token; revoked refresh grants map to reauthorization-required.
- [ ] Live YouTube OAuth is verified with an approved Google test client; backend comment/reply routes are covered by tests. Phase 4 video publishing remains deferred.

**Phase 1 read/reply dependencies:** SOC-01, SOC-02. **Phase 4 publishing dependencies:** CMS-02, SOC-03.

### SOC-05 — Implement Instagram account/read/reply and Reel publishing adapter

**Status:** In Progress — deterministic comment/publication adapters and the local Instagram Login connection flow are implemented for professional Business/Creator accounts. The flow validates `instagram_business_basic` and `instagram_business_manage_comments`, upgrades to a long-lived token, and proactively refreshes before expiry. Live Meta access-tier/App Review remains pending. Personal Instagram accounts are not supported by the current official API contract.

Complete provider authorization and verify comment read/reply capability for supported professional accounts. Keep any Phase 4 Reel publishing work separate.

**Acceptance criteria**

- [x] Comment read/reply adapters check configured professional-account scopes before provider calls; unsupported/failure outcomes use stable codes.
- [x] Provider data/errors are normalized without leaking Instagram DTOs into the domain.
- [x] Adapter integration tests cover success, permission/capability failure, and provider failure with deterministic doubles.
- [x] Implement Instagram Login/OAuth account linking with state, exact-grant/identity validation, encrypted long-lived token storage, provider-specific refresh, stable errors, deterministic adapter tests, and HTTP callback E2E coverage.
- [ ] Verify live Meta access/App Review with a controlled approved test account before production.
- [ ] Phase 4 Reel publishing capability is checked before dispatch.

**Phase 1 read/reply dependencies:** SOC-01, SOC-02. **Phase 4 publishing dependencies:** CMS-02, SOC-03.

### SOC-06 — Implement Facebook Pages account/read/reply and publishing adapter

**Status:** In Progress — deterministic comment/publication adapters and local Facebook Login/Page selection are implemented for managed Pages. The callback validates Page permissions and returns candidates; the creator explicitly selects one Page before its Page-scoped token is stored. Live Meta access/App Review remains pending. Personal profile timelines are not in the supported API contract.

Complete Page authorization and verify comment read/reply capability. Keep any Phase 4 video publishing work separate.

**Acceptance criteria**

- [x] Comment read/reply adapters check configured Page scopes before provider calls; unsupported/failure outcomes use stable codes.
- [x] Provider data/errors are normalized without leaking Facebook DTOs into the domain.
- [x] Adapter integration tests cover success, permission/capability failure, and provider failure with deterministic doubles.
- [x] Implement Facebook Login, state/grant validation, managed-Page listing, explicit tenant-bound single-use Page selection, Page-scoped token storage, stable errors, deterministic adapter tests, and HTTP callback/selection E2E coverage.
- [ ] Verify live Meta access/App Review with a controlled approved test account before production.
- [ ] Phase 4 video-publishing capability is checked before dispatch.

**Phase 1 read/reply dependencies:** SOC-01, SOC-02. **Phase 4 publishing dependencies:** CMS-02, SOC-03.

### SOC-07 — Verify multi-platform publishing E2E (Phase 4)

Exercise the creator's multi-destination flow across the application with deterministic provider doubles.

**Acceptance criteria**

- [ ] YouTube, Instagram, and Facebook Page publications are tracked independently.
- [ ] Mixed success/failure preserves each destination's result.
- [ ] Unsupported capability and duplicate delivery do not produce unintended external calls.
- [ ] Scheduled and retry paths satisfy the policies fixed in SOC-01.

**Depends on:** SOC-04, SOC-05, SOC-06, FND-03.

## EPIC AN — Publication Analytics and Novelaria Dashboard

**Source:** [Analytics PRD](prds/analytics.md), [Analytics Tech Spec](../specifications/technical-analytics.md), [Domain Model](../domain/domain-model.md), [Architecture](../architecture/architecture.md).  
**Phase 2 dependencies:** FND-01, FND-02, IAM-04, SOC-02. Use a controlled single-creator pilot context; do not expose tenant data publicly until Phase 3 authentication and authorization are complete.

### AN-01 — Finalize the Novelaria dashboard product contract

**Status:** In Progress — the PRD/tech contract and JEV classification foundation now describe episode suggestions from already-imported publications; suggestion persistence, creator review, and approval remain to be implemented. Performance metrics remain manually entered.

Define tenant-scoped Series records with aliases and seasonal/non-seasonal mode; season-aware episode identity; AI-assisted episode suggestions from existing TikTok, Instagram, Facebook, and YouTube publication metadata; explicit creator approval; manual performance observations for TikTok, Instagram, and Facebook; historical reporting windows; metric formulas; BRL production economics and monthly revenue; dashboard answers and milestones. YouTube is a discovery source only; keep metric synchronization and YouTube performance entry out of this MVP. Update PRD, tech spec, and JEV capability rules.

**Acceptance criteria**

- [x] Series/Episode identity, aliases, season mode, season-aware uniqueness, source publication references, approval boundary, manual-metric platforms, discovery platforms, and distinction from Content/Publication/provider IDs are documented.
- [x] Observation history, missing-versus-zero behavior, reporting timezone, formulae, economics, and monthly milestone definitions are documented.
- [x] The six primary dashboard questions and the required dashboard content are specified.
- [ ] JEV classification schema, confidence/evidence, trilingual rationale variants, deterministic grouping, and creator approval are verified against the configured provider.
- [x] TikTok manual analytics entry is explicitly separate from TikTok publishing/API support; YouTube discovery is separate from deferred YouTube performance entry.

### AN-02 — Implement tenant-scoped episode and observation persistence

**Status:** Done — migrations `023_create_episode_review.sql` and `024_create_analytics_entries.sql` persist tenant-scoped Series, season-aware Episodes with production economics, suggestion/decision lifecycle, approved publication links, TikTok/Instagram/Facebook performance observations, account follower snapshots, and monthly platform revenue.

Persist tenant-scoped Series records with aliases and season mode, season-aware Episodes, pending episode suggestions with references to imported tenant publications, creator decisions, one-time production fields, dated platform observations, platform-account follower snapshots, and monthly platform revenue using the contracts in AN-01.

**Acceptance criteria**

- [x] Tests are written first for tenant-unique Series identity, seasonal/non-seasonal constraints, season-aware episode identity/code, pending suggestion/source identity, creator-approved links to multiple platforms, observation identity/history, account-follower snapshots, and episode-level cost/time.
- [x] Persistence is tenant-scoped; a tenant cannot read or mutate another tenant's episode, observations, or revenue.
- [x] Duplicate observation submissions are idempotent; corrections target an observation identity without erasing unrelated history.
- [x] Integration tests cover suggestion lifecycle and atomic approval, persistence, unavailable-versus-zero, follower snapshots, and BRL structured amounts.
- [x] Dashboard episodes do not require a Content/Publication link; any later intelligence association is explicit and tenant-authorized, never inferred from the episode code.

**Depends on:** AN-01, FND-01, IAM-04, SOC-02.

### AN-03 — Implement manual episode and analytics entry use cases

**Status:** Done — episode review use cases plus the manual-entry use cases and `analytics-entry.controller.ts` cover Series/Episode registration, episode economics, performance observations, follower snapshots, and monthly revenue with server-resolved tenant/actor and whitelisted request bodies.

Provide controlled single-creator pilot use cases to classify already-imported publication metadata, group exact series/season/episode identity matches as pending suggestions, approve/correct/reject/defer suggestions, manually register fallback Series and Episodes, record TikTok/Instagram/Facebook observations and account-follower snapshots, and record monthly platform revenue. Keep persistence tenant-scoped; do not expose these use cases publicly before Phase 3. Classification never calls social APIs and never mutates Series/Episodes without creator approval.

**Acceptance criteria**

- [x] Tests are written first for JEV output validation, publication candidate classification, deterministic series/season/episode grouping, approval/rejection/deferral, tenant-derived authorization, manual observation entry, follower snapshots, and revenue entry.
- [x] Series mode, episode/season numbers, code, publication date, platform, duration, metric values/units, and observation time are validated.
- [x] Missing optional metrics remain unavailable; negative or malformed values are rejected.
- [x] A creator can enter separate platform data for one episode without re-creating the episode.
- [x] JEV failure, uncertainty, or missing series/season/episode identity fields leave a reviewable candidate and do not create/link canonical records.

**Depends on:** AN-02. Use only the controlled single-creator pilot context until Phase 3 auth is complete; tenant scoping remains mandatory.

### AN-04 — Implement dashboard aggregation and metric calculations

Build tenant-scoped queries for period totals, platform/series/episode rankings and trends, account follower metrics, episode conversion rates, and goal progress according to the PRD formulas.

**Acceptance criteria**

- [ ] Unit tests cover 7/30/90-day views, month-over-month growth for complete and partial months, platform breakdown, rankings, series trends, account follower totals/net-new deltas, episode follower conversion, and incomplete-history behavior.
- [ ] Engagement, share, and view-to-follower rates follow AN-06 in the Analytics PRD and become unavailable when inputs are missing or views are zero.
- [ ] Cumulative observations are never summed as independent counts; only supported period deltas are aggregated.
- [ ] Cross-platform totals are labeled as account sums, not unique viewers/followers.
- [ ] Reporting calendar boundaries use tenant timezone with UTC fallback.

**Depends on:** AN-03.

### AN-05 — Build the prioritized Novelaria dashboard

Build the Episodes review queue for pending suggestions and present the six decision answers, headline metrics, platform growth, rankings/trends, and monthly goal progress together in the primary dashboard view.

**Status:** In Progress — responsive, localized dashboard entry screen and JEV classification/grouping foundation are implemented; suggestion persistence/review and analytics reporting remain pending.

**Acceptance criteria**

- [ ] The first view answers: overall growth; growing platform; top series; top episode; follower conversion relative to views; and progress toward monetization milestones.
- [ ] An Episodes screen lists pending suggestions segmented by Series, season, and episode with source platform links, imported title/description evidence, classification/confidence, and localized rationale variants; creator approve/correct/remove/reject/defer actions are explicit.
- [ ] It includes 7/30/90-day views, month-over-month growth, total/new followers, platform-separated views/growth, episode/series rankings, and series trends.
- [ ] It distinguishes zero, unavailable, incomplete history, and not-yet-monetized values and identifies each reporting window.
- [ ] In a task-based usability check, at least 4 of 5 representative creators answer all six questions within 10 seconds each, without assistance.
- [ ] Dashboard presentation is localized and does not change stored metric values or calculation rules.

**Depends on:** AN-04.

### AN-06 — Implement production economics and monthly goals

Expose episode-level production cost/time, per-platform monthly revenue, cost-versus-revenue reporting, and view/revenue milestones.

**Acceptance criteria**

- [ ] Tests cover costs entered once per episode, revenue by platform/month, BRL aggregation, and attribution of costs to the month of each episode's earliest platform publication.
- [ ] Monthly view milestones are 1M, 3M, 5M, and 10M; revenue milestones are BRL 1k, 3k, 5k, 10k, 20k, and 50k.
- [ ] Goal progress uses the current calendar month in tenant timezone (UTC fallback) and identifies achieved and next milestones.
- [ ] Unknown revenue is not presented as zero; cost and revenue are not inferred from other metrics.

**Depends on:** AN-02, AN-04.

### AN-07 — Verify the analytics dashboard E2E journey

Exercise imported-publication suggestion review and approval through the dashboard using deterministic JEV, authentication, and persistence doubles.

**Acceptance criteria**

- [ ] Publications from TikTok, Instagram, Facebook, and YouTube are classified from imported metadata without additional social API calls; approved source IDs and Series/season/Episode identity remain preserved.
- [ ] One episode is created only after explicit approval and receives separate TikTok, Instagram, and Facebook observations; YouTube analytics entry remains unavailable.
- [ ] Dashboard totals, platform breakdown, rankings, conversion, economics, and milestones match deterministic fixtures.
- [ ] Tenant isolation, missing metrics, zero denominators, and insufficient observation history are covered.
- [ ] The journey performs no production social API calls and does not require API credentials.

**Depends on:** AN-05, AN-06, FND-03.

### AN-08 — Add future provider analytics integrations

**Status:** Blocked — automated performance metric collection remains outside the Novelaria dashboard MVP; revisit after explicit scope approval.

Add verified official metric integrations independently per platform, including YouTube only after the dashboard scope is extended. Manual data entry must remain available if an API is unsupported or fails.

**Acceptance criteria**

- [ ] Product scope and official capabilities/permissions are confirmed before implementation for each platform.
- [ ] Provider data is normalized while preserving external identifiers, observation time, platform semantics, and unavailable state.
- [ ] Integration tests use deterministic provider doubles and cover partial results and failures.

**Depends on:** AN-01, AN-02, SOC-01; platform-specific tasks require the corresponding provider capability decision.

## EPIC COM — Community Management

**Source:** [Community PRD](prds/community-management.md), [Community Tech Spec](../specifications/technical-community-management.md).  
**Depends on:** SOC, FND-01, FND-02.

### COM-01 — Finalize comment and response policies

**Status:** In Progress — manual stage triggers, selected-network sync, per-comment outcomes, persisted app/external reply states, 30-day retention, append-only AI/manual history, per-comment sends, and a confirmed send-all action for individually approved semi-automatic replies are defined. AI generation requires comment analysis, creator-authored responses do not, and optional response evaluation is advisory. The controlled pilot uses a fixed manual-only communication policy with no numeric risk thresholds or configurable policy schema. TypeSafe account/credit verification and Gemini Free-tier data-use acceptance remain open; the frontend exposes evaluation when its analysis/response prerequisites are met.

The Phase 1 communication policy is fixed for the controlled pilot: no automatic generation or background sending; spam/toxicity and response-evaluation results are advisory; explicit per-comment sends or a separately confirmed send-all of individually approved saved responses dispatch after per-comment capability/authorization checks. No configurable policy schema or numeric risk threshold is introduced. Every phase is triggered separately by the creator. AI generation requires prior comment analysis; creator-authored text does not. Each explicit AI request creates separate `pt-BR`, `en-US`, and `es-ES` variants independent of UI locale; source comments are never translated. The creator selects one saved variant for review, edit, optional evaluation, or manual send. Send-all is serial, stops on a provider rate limit, and never retries an attempted or ambiguous revision.

**Acceptance criteria**

- [ ] YouTube, Instagram professional, Facebook Pages, and TikTok Business read/reply permissions, account eligibility, access tiers, and unsupported outcomes are verified for production.
- [x] Phase 1 comments sync on demand and expire 30 days after their last successful sync.
- [x] Sync, JEV classification, and response generation run at comment, publication, or one selected-network scope, with independent per-comment outcomes; no cross-network all-scope operation is exposed.
- [x] AI analysis/suggestion artifacts remain immutable; edits and JEV corrections are append-only audit records linked to their originals and expire with comment text after 30 days.
- [x] Human TypeSafe/Jev corrections may change labels and normalized spam/toxicity/estimated-engagement scores but never overwrite per-question probabilities, confidence, usage, or raw evidence.
- [x] Response generation is separate from JEV; the pilot API can select an allowlisted Google/OpenAI provider-model pair without storing API keys.
- [x] Model selection is global to the local pilot now and reserves a nullable admin-user association for Phase 3.
- [x] Every generation request creates separate `pt-BR`, `en-US`, and `es-ES` variants independent from UI locale; source-comment translation is out of scope.
- [x] Every Phase 1 reply requires deliberate creator action; the semi-automatic send-all action includes only individually approved saved versions and has a separate confirmation.
- [x] Deterministic risk/evaluation behavior and the fixed manual-only creator communication policy are explicit and testable; no score threshold is inferred.

### COM-02 — Implement normalized comment ingestion

**Status:** Done — content-level and selected-network on-demand sync, tenant-scoped persistence, 30-day retention cleanup, direct creator-reply persistence, and separate app/external reply state are implemented. External state is normalized per adapter and remains `UNKNOWN` when it cannot be reliably determined.

Synchronize comments only after a creator requests one publication/video or all accessible publications on one selected network. Normalize provider data, preserve IDs, upsert by tenant/account/comment identity, persist app reply state and provider external-reply state (`REPLIED`, `NOT_REPLIED`, or `UNKNOWN`), and remove expired rows during sync/read. Do not dispatch AI evaluation from this sync path.

**Acceptance criteria**

- [x] Tests cover normalization, duplicate delivery, external-ID preservation, tenant isolation, pagination, and provider failure without mutating valid stored comments.
- [x] Unsupported read capability produces an explicit result and no provider call.
- [x] Comment upserts refresh a 30-day expiration and expired comments are removed on each subsequent sync/read request.
- [x] Manual network-level sync covers only the selected network and does not perform an all-network sync.
- [x] App reply status is persisted; external creator reply status is detected only where reliable, otherwise remains `UNKNOWN`.
- [x] Only direct replies reliably attributed to the connected account owner are persisted; other commenters' and deeper replies are excluded, including when the parent comment was synchronized on an earlier page.
- [x] The sync use case returns normalized comments/pagination to presentation and leaves analysis/evaluation to COM-06.

**Depends on:** COM-01, SOC-02, FND-02.

### COM-03 — Implement YouTube comment adapter

**Status:** Done — deterministic adapter boundary implements paginated comment reading and manual reply requests; live OAuth permissions remain to be exercised when Google app credentials are available.

Read and normalize YouTube comments according to verified capabilities; send a reply only after rechecking the thread and account capability.

**Acceptance criteria**

- [x] Platform, publication, thread, and external comment IDs are preserved in normalized results.
- [x] Adapter tests cover pagination, normalization, comments-disabled/permission failure, reply capability and scope gates, and ambiguous write outcomes with deterministic provider doubles.
- [x] Replies use the creator-edited text and the provider's top-level comment identity; ambiguous outcomes are not retried blindly.

**Depends on:** COM-01, COM-02, SOC-04.

### COM-04 — Implement Instagram comment adapter

**Status:** In Progress — deterministic comment/publication adapters and local Instagram Login/OAuth account linking are implemented for professional Business/Creator accounts. Live access-tier/App Review and controlled-provider verification remain pending; personal accounts are outside the supported API contract.

Read and normalize comments for connected professional Instagram media; keep provider DTOs and comments/replies endpoints inside the Instagram adapter.

**Acceptance criteria**

- [x] Comment read/reply adapters check the configured professional-account scopes before provider calls.
- [x] External IDs are preserved and provider DTOs remain in the adapter.
- [x] Adapter integration tests cover supported and unsupported/failure results with deterministic doubles.
- [x] Implement local Instagram Login/OAuth account linking with deterministic token-exchange, scope, identity, refresh, vault, persistence, and HTTP callback tests.
- [ ] Verify live Meta access/App Review with an approved test account before production.

**Depends on:** COM-01, COM-02, SOC-05.

### COM-05 — Implement Facebook Pages comment adapter

**Status:** In Progress — deterministic comment/publication adapters and local Facebook Login/Page selection are implemented for managed Pages. Live Meta access/App Review and controlled-provider verification remain pending; personal profile timelines are outside the supported API contract.

Read and normalize Page comments for verified capabilities.

**Acceptance criteria**

- [x] Comment read/reply adapters check configured Page scopes before provider calls.
- [x] External IDs are preserved and provider DTOs remain in the adapter.
- [x] Adapter integration tests cover supported and unsupported/failure results with deterministic doubles.
- [x] Implement local Facebook Login/Page selection with deterministic token/grant/Page-selection, vault, persistence, and HTTP callback/selection tests.
- [ ] Verify live Meta access/App Review with an approved test account before production.

**Depends on:** COM-01, COM-02, SOC-06.

### COM-12 — Implement TikTok Business comment adapter

**Status:** In Progress — independent deterministic TikTok Business comment/read/reply and owned-video listing adapters plus local OAuth/account connection are implemented. The connection uses the app-generated URL as runtime config, validates one-time state and the official sample scopes `video.list`, `comment.list`, and `comment.list.manage`, and stores the returned `open_id` token pair in the encrypted vault. Live TikTok Business app access and refresh-flow verification remain pending. TikTok documents a dedicated short-term account-token revoke endpoint; the application does not expose it and does not use the advertiser-token endpoint. TikTok Research API is not used for this commercial product.

Implement TikTok comment/reply workflows only for authorized Business accounts and owned organic videos. Do not include TikTok video publishing in this task.

**Acceptance criteria**

- [x] Implement local TikTok Business OAuth using a runtime app-generated authorization URL, single-use state, `auth_code`/`code` callback support, official token exchange, required-scope validation, tenant-scoped `open_id`, encrypted vault storage, and deterministic unit/integration/E2E tests.
- [ ] Verify the account-token refresh flow against an approved TikTok Business app. Keep account-token revocation unexposed until disconnect behavior is specified; if added, use TikTok's documented short-term account-token endpoint, never the advertiser-token endpoint.
- [x] Adapter checks required read/manage scopes before provider calls.
- [x] Comment/reply IDs, text, pagination, and supported reply-state evidence are normalized inside the TikTok adapter.
- [x] Manual reply sends use the exact creator-approved text, check per-comment capability, and preserve ambiguous results without automatic retry.
- [x] Integration tests cover read, reply, unsupported/access failures, pagination, and ambiguous outcomes with deterministic HTTP doubles.
- [ ] Live provider access and API-version/permission requirements are verified before production release.

**Depends on:** COM-01, COM-02, SOC-01, SOC-02.

### COM-06 — Implement versioned comment evaluation

**Status:** In Progress — the application use case, single-comment HTTP route, TypeSafe System One adapter, typed-answer/score validation, audit persistence, correction safeguards, and synchronous per-video/selected-network execution are implemented. Live smoke testing with the configured TypeSafe account remains opt-in because it consumes credits.

Invoke TypeSafe Jev through `CommentEvaluator`, validate typed answers, preserve per-question probabilities/confidence and token usage, and persist immutable `CommentAnalysis` artifacts. Persist creator corrections separately; never mutate original model evidence.

**Acceptance criteria**

- [x] Tests cover Choice/Score/Noul answer validation, normalized 0–1 scores, per-question confidence/probabilities, usage, provenance, and immutable analysis versions.
- [x] Invalid TypeSafe output does not replace a prior analysis; a failed workflow event records only the stable error code.
- [x] Human correction appends allowed labels/spam/toxicity/estimated-engagement fields while preserving original probabilities/confidences; corrections include source/time/reason fields.
- [x] Per-publication and selected-network classification return independent outcomes and partial failures.
- [x] TypeSafe adapter integration tests use deterministic HTTP doubles and do not make live requests or consume credits.

**Depends on:** COM-02, FND-01, FND-02.

### COM-07 — Implement editable response suggestions

**Status:** In Progress — Gemini Flash-Lite/OpenAI GPT-6 Luna adapters, persisted provider/model selector, trilingual per-comment suggestion generation after JEV analysis, structured validation, append-only AI suggestion/edit events, selected-platform batches, and creator-authored response roots/edits are implemented. The approved account-scoped tone configurator and provider prompt integration are implemented under COM-13 and exposed by the prototype-based browser screen. Live provider verification remains pending; Phase 1 communication policy is fixed and manual-only.

AI generation requires a prior JEV comment analysis. Creator-authored response text is an independent path and does not require comment analysis. Keep every response version auditable; append creator edits instead of replacing prior text.

**Acceptance criteria**

- [x] The selected Google/OpenAI model is called once per supported response language (`pt-BR`, `en-US`, `es-ES`) on explicit per-comment requests with bounded source context.
- [x] Each language result is separately auditable; one failed language does not discard successful variants.
- [x] Gemini/OpenAI structured JSON output is schema-validated; missing/malformed/refusal/rate-limit outcomes map to stable errors without exposing provider bodies or keys.
- [x] `GET/PUT /ai/response-generation/settings` exposes the allowlisted provider/model selector; only provider/model are persisted, never API keys.
- [x] Gemini/OpenAI keys and model API configuration are lazy; missing settings do not prevent startup.
- [x] Tests cover per-video/selected-network generation fan-out and per-comment outcomes.
- [x] AI-generated text/provider/model/time are immutable; every creator edit stores original suggestion ID, exact manual text, actor source/time, and optional reason.
- [x] Suggestions remain advisory and are persisted independently of publication.
- [x] A batch failure does not remove successful artifacts or hide per-comment outcomes.
- [x] Toxic/spam signals never trigger generation or sending; an explicit generation request receives the analysis as advisory context and sending remains a separate manual action.

**Depends on:** COM-01, COM-06.

### COM-13 — Configure per-account response tone

**Status:** Done — per-account tone profile API, tenant-scoped persistence, generator prompts, immutable audit snapshots, deterministic tests, and prototype-based frontend controls are implemented. Extended with a tenant-global default: `GET/PUT /social/settings/response-tone`, hierarchical resolution (account → global → Friendly), and scope/inheritance indicators in the frontend.

Expose a creator-managed tone profile separately from the global provider/model selector. Apply the profile only to future explicit AI generation and snapshot it on each generated suggestion event.

**Acceptance criteria**

- [x] `GET/PUT /social/accounts/{accountId}/response-tone` is tenant-scoped and validates account ownership.
- [x] `GET/PUT /social/settings/response-tone` manages the tenant-global profile; tenant scoping is resolved server-side and never accepted from callers.
- [x] A saved account profile is a complete replacement of the global profile for that account only; scopes are never merged, and the account `GET` reports the effective source (`ACCOUNT`, `TENANT`, or `DEFAULT`).
- [x] Primary choices are Friendly, Professional, Casual, and Empathetic; up to two distinct modifiers may be selected from Concise, Warm, and Enthusiastic; optional note is capped at 500 characters.
- [x] An account with no saved profile uses the tenant-global profile, or Friendly with no modifiers/note when no global profile exists; profiles do not leak across accounts or tenants.
- [x] Gemini/OpenAI receive the profile as style guidance without overriding accuracy, respectful-response rules, or manual-send controls.
- [x] Each generated suggestion event snapshots the exact profile used and its source; changing settings does not rewrite old suggestions or creator-authored text.
- [x] Unit, persistence, provider-adapter, and HTTP E2E tests use deterministic doubles; startup does not require tone settings or provider keys.

**Depends on:** COM-02, COM-07.

### COM-14 — Implement the prototype-based community frontend

**Status:** Done — the comments UI is served from the API origin, uses the documented community endpoints, and contains no simulated social content or provider results.

Implement the prototype's network/account/publication/comment hierarchy and connect its manual workflows to the API.

**Acceptance criteria**

- [x] The responsive screen serves from `/` and loads publications/accounts from the API; it shows loading, empty, unsupported, and error states without fabricated counts or demo comments.
- [x] Profile settings list connected accounts without provider reads, start configured OAuth flows without collecting secrets, and require explicit Facebook Page selection.
- [x] Search, reply-state filters, publication expansion, per-publication/network sync, and independent workflow outcomes are connected to the documented API.
- [x] Comment evaluation, trilingual suggestion generation, account tone settings, manual/edited response saving, optional response evaluation, and audit history are wired to the corresponding endpoints.
- [x] Individual sending requires confirmation and sends only the saved response-version ID; the semi-automatic dialog separately confirms and sends only individually approved rows through the per-comment route.
- [x] Frontend API tests use deterministic fetch doubles; static asset delivery is covered without a database or live provider.
- [x] User-facing interface copy uses semantic localization keys through a `pt-BR` facade; persisted user/tenant locale integration remains deferred to FND-04.

**Depends on:** SOC-08, COM-02, COM-06, COM-07, COM-08, COM-09, COM-11, COM-13.

### COM-08 — Implement optional advisory response evaluation

**Status:** In Progress — response evaluation is optional, manually requested, tied to a saved version, and advisory; `APPROVE`, `REVIEW`, and `REJECT` do not block a manual send. The frontend exposes the optional action when prerequisites are met; deterministic TypeSafe request/response mapping is implemented, while live credit-backed smoke testing remains opt-in.

Evaluate only when the creator explicitly requests it; validate and persist structured output as an immutable advisory result. Do not auto-evaluate on generation/edit or use any recommendation as a send gate.

**Acceptance criteria**

- [x] Tests cover schema validation, all three recommendations as advisory-only outcomes, invalid-output non-mutation, and stale-version history.
- [x] Evaluation is tied to the exact saved response version; later edits remain append-only and do not overwrite prior evaluations.
- [x] JEV recommendation is advisory only and never blocks or dispatches manual sending.
- [x] Frontend exposes optional evaluation when analysis and a saved response exist; the advisory result never blocks an explicit manual send.

**Depends on:** COM-01, COM-07, FND-02.

### COM-09 — Implement creator decision and supported reply adapters

Persist creator-authored response versions independently of AI suggestions, then dispatch the exact latest saved text only through a verified platform adapter after an explicit per-comment send or a final confirmation for the semi-automatic dialog's individually approved rows. Neither comment analysis nor optional response evaluation is required to send creator-authored text. No batch-send endpoint or background send exists.

**Acceptance criteria**

- [x] Tests prove manual and AI-generated response versions can be sent individually without requiring optional response evaluation.
- [x] Capability and account authorization are checked before each reply; response evaluation is advisory and never a send prerequisite/blocker.
- [x] The fixed Phase 1 manual-only communication policy is enforced; configurable creator policies and numeric risk thresholds are out of scope.
- [x] Unsupported reply capability makes no provider call; ambiguous attempts remain visible and cannot trigger automatic duplicate sends.
- [x] The semi-automatic dialog sends only individually approved, saved, reply-capable versions, sequentially through the per-comment route; individual failures do not stop later rows, while a provider rate limit pauses the queue and per-comment outcomes remain visible.
- [x] The action log records actor source, timestamp, final text/revision, provider attempt/result, and external reply ID when returned.
- [x] Integration tests cover the implemented YouTube, Instagram, Facebook Pages, and TikTok reply adapters using deterministic doubles.

**Depends on:** COM-01, COM-08, SOC-04. Deferred platform adapters are not prerequisites for YouTube manual replies.

### COM-10 — Verify community-management E2E journeys

Exercise comment ingestion through evaluation and response decision with deterministic social/JEV test doubles.

**Acceptance criteria**

- [ ] Positive, question, complaint, spam, toxic, ambiguous, and low-confidence cases have deterministic per-comment outcomes.
- [ ] Single-comment, per-publication, and selected-network workflows show separate stage status/results and preserve partial successes without chaining phases.
- [ ] Human score corrections, creator-authored responses, and AI response edits appear as audit revisions while original JEV/AI artifacts remain unchanged.
- [ ] AI generation requires comment analysis; creator-authored responses do not. Optional response evaluation is advisory and does not gate the individual manual send.
- [x] An AI suggestion can be edited; only a deliberate per-comment send or separately confirmed send-all of approved responses can dispatch the latest saved text.
- [ ] Unsupported replies, app/external reply-status states, and ambiguous outcomes are shown without automatic retries; send-all excludes unsupported rows and preserves per-comment outcomes.

**Depends on:** SOC-08, COM-03, COM-04, COM-05, COM-06, COM-07, COM-08, COM-09, COM-12, SOC-04, SOC-05, SOC-06, FND-03.

### COM-11 — Implement per-comment audit history and versioning

**Status:** In Progress — append-only AI/correction/revision events, creator-authored response roots/edits, selected-platform sync, persisted app/external reply status, serial per-item batches, batch history, and manual-send attempt/result events are implemented. Batch requests return after all items finish; live progress streaming remains pending.

**Acceptance criteria**

- [x] AI/JEV artifacts and creator edits/corrections are distinct linked events; original AI output is never overwritten.
- [x] TypeSafe/Jev corrections allow only labels and normalized spam/toxicity/estimated-engagement values; original per-question confidence/probabilities and usage remain immutable.
- [x] AI-generated suggestions, creator-authored roots, and creator edits are separate append-only response versions with actor source and timestamp.
- [x] Workflow events share the comment's 30-day retention and are removed with it.
- [x] A tenant-scoped history endpoint returns the audit trail without exposing credentials.
- [x] Batch operation IDs/statuses are returned per item and stored on child workflow events; the batch history endpoint groups those events.
- [x] Manual reply attempts log the exact sent response version and external outcome; response evaluation is optional.

**Depends on:** COM-02, COM-06, COM-07, COM-08, COM-09.

### COM-15 — Implement the AI response refinement dataset

**Status:** Done — migration `022_create_ai_response_edit_pairs`, the `ResponseRefinementPairRepository` port/Postgres adapter, the `RecordResponseRefinementPair` use case, and best-effort capture inside `SendManualCommentReply` are implemented; successful results carry the `refinementPairPersisted` flag.

Persist an append-only anonymized record pairing the original AI-generated text with the exact sent text whenever a successful manual send dispatches a version edited from an AI suggestion. See the [Response Refinement PRD](prds/response-refinement.md) and [technical specification](../specifications/technical-response-refinement.md).

**Acceptance criteria**

- [x] A successful send of an edited AI suggestion appends exactly one pair record; unedited AI sends, creator-authored sends, and failed/unsupported/ambiguous sends create none.
- [x] The record preserves platform, language, provider/model, confidence/rationale, tone snapshot, revision count, optional last edit reason, evaluation snapshot, and derived analysis labels.
- [x] The record stores no audience identifiers, comment text, external IDs, or comment-scoped foreign keys, and survives the 30-day comment retention cascade.
- [x] `manual_reply_attempt_id` uniqueness makes capture idempotent; capture failure never changes the send outcome.

**Depends on:** COM-09, COM-11.

## EPIC AI — Audience and Content Intelligence

**Source:** [Audience Intelligence PRD](prds/audience-intelligence.md), [Audience Intelligence Tech Spec](../specifications/technical-audience-intelligence.md).  
**Depends on:** AN, COM, FND-01, FND-02.

### AI-01 — Finalize evidence and audit policy

Define minimum evidence volume, evidence windows, historical comparisons, partial-source failure behavior, context limits/provenance, regeneration identity, and audit retention. The generated-output language policy is decided: insights and recommendations have independent `pt-BR`, `en-US`, and `es-ES` variants, separate from UI locale, preserving evidence and provenance.

**Acceptance criteria**

- [ ] Evidence-period and minimum-volume rules are explicit.
- [ ] Sparse/conflicting/partial evidence handling is explicit.
- [ ] Context provenance, regeneration, and audit retention are documented.
- [x] Generated-output language is specified separately from interface locale; each of the three generated variants preserves source evidence and provenance.

### AI-02 — Implement evidence-context assembly

Query content, normalized analyses, and metric observations through application-owned ports and assemble the bounded, time-scoped provider context. Include Novelaria dashboard episode observations only when an explicit tenant-authorized Episode-to-Content association exists; preserve manual/provider provenance and never infer association by title or episode code.

**Acceptance criteria**

- [ ] Tests are written first for evidence-period filtering, source association, manual/provider provenance, and partial-data rules.
- [ ] Unlinked dashboard episodes are omitted from content-scoped context; explicitly linked data retains episode, platform, source, and observation-period evidence.
- [ ] Observed data is distinguishable from derived summaries/inference.
- [ ] JEV receives prepared context only and has no persistence/social API access.

**Depends on:** AI-01, AN-04, COM-06.

### AI-03 — Implement insight and recommendation generation with validation/audit

Invoke the capability-specific JEV ports, validate outputs, and persist `IntelligenceAnalysis`, insights, recommendations, confidence, rationale, and evidence references.

**Acceptance criteria**

- [ ] Tests cover schema, required evidence/rationale, confidence bounds, duplicate requests, and invalid-output non-mutation.
- [ ] Provider/model or prompt version is recorded where available and non-secret.
- [ ] Provider failure does not persist a partial result as complete.

**Depends on:** AI-01, AI-02, FND-02.

### AI-04 — Implement recommendation decisions

Persist creator acceptance/rejection while preserving the advisory boundary.

**Acceptance criteria**

- [ ] Unit tests cover accepted/rejected decisions and repeated requests.
- [ ] Accepting a recommendation does not itself edit content, publish, or trigger a social API call.

**Depends on:** AI-03.

### AI-05 — Verify audience-intelligence E2E journeys

Exercise evidence assembly, generation, validation, persistence, and creator decision with deterministic JEV fixtures.

**Acceptance criteria**

- [ ] Recurring evidence produces an auditable insight with period, evidence, and confidence.
- [ ] A recommendation includes rationale/evidence/confidence and can be accepted or rejected.
- [ ] Invalid provider output leaves domain state unchanged; no E2E scenario depends on live AI output.

**Depends on:** AI-02, AI-03, AI-04, FND-03.
