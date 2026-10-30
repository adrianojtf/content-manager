# Technical Specification — Social Accounts and Publishing

**Status:** Local authorization flows are implemented for YouTube, Instagram Login, Facebook Pages, and TikTok Business with deterministic tests. Phase 1 synchronized-publication metadata persistence is implemented with tenant/account-scoped storage. Provider live app access/approval and creator-reply attribution remain pending verification. TikTok uses the app-generated account authorization URL as runtime configuration; its official token example includes `video.list`, `comment.list`, and `comment.list.manage`. The refresh request matches the documented short-term account-token renewal contract and is covered by deterministic tests; verification against an approved app remains pending. TikTok documents a distinct short-term account-token revoke endpoint, but this application does not expose or call it. Phase 4 outbound publication metadata, scheduling, and retry policy remain open.

**Product PRD:** [Social Accounts and Publishing](../product/prds/social-publishing.md)

**Synchronization specification:** [Social Content Synchronization](technical-social-content-synchronization.md)

**Existing use-case specification:** [Publish Content](publication/publish-content.md)

## 1. Scope

The active initial MVP targets YouTube, Instagram professional Business/Creator accounts, Facebook Pages managed by the authorizing user, and TikTok Business accounts for comment/read/reply workflows on owned organic videos. Each adapter, account type, permission, and operation is independent and must be verified before live dispatch. Phase 4 video upload/publishing, scheduling, and safe retries remain deferred.

### Connected-account profile settings

- `GET /social/accounts` returns only tenant-owned account summaries (`id`, `platform`, `externalAccountId`, and `displayName`). It does not resolve credentials or call any social provider.
- The CreatorDesk profile settings screen uses this list to show connected accounts and opens the existing provider-specific `/social/connections/{platform}/authorize` route for connection/reauthorization. OAuth client credentials remain runtime-only; the UI never accepts or stores them.
- Each listed account has an explicit disconnect action. The UI warns that disconnect permanently removes the locally cached account data and asks for confirmation before calling `DELETE /social/accounts/{accountId}`.
- Disconnect resolves the pilot tenant on the server and atomically deletes only the matching account and its encrypted credential. Foreign-key cascades remove synchronized publication metadata, comments and creator replies, comment workflow history, and account tone settings. Missing or other-tenant account IDs return the same not-found result.
- Disconnect does not call platform APIs or revoke the provider-side authorization grant. The creator must revoke that grant separately in the provider's account settings if desired.
- Provider callbacks return normalized account data without tokens. Facebook returns a short-lived `selectionId` and Page candidates instead of connecting a Page implicitly; the UI requires a Page choice and posts only `{ selectionId, pageId }` to `/social/connections/facebook/select`.
- After a successful connection, the screen reloads the safe account list. Listing accounts is kept separate from publication listing so opening profile settings does not trigger provider reads.

### Publication page size and cursors

- `GET /social/publications` accepts an optional `platform` filter and a `pageSize` of `5`, `10`, or `25`; omission defaults to `5`. Other page sizes/platforms are rejected with a stable client error.
- `ListSocialPublications` passes the requested size to each platform adapter. YouTube maps it to `maxResults`, Instagram/Facebook to Graph API `limit`, and TikTok Business to `max_count`. Each adapter preserves its own opaque cursor and provider-specific page behavior.
- The browser requests only the active platform and keeps only the current provider page per account. Previous/next navigation reuses cursor history and replaces publication data instead of appending pages.
- A successfully fetched and normalized page is upserted as tenant/account-scoped social publication metadata before the account result is reported as available. Only explicitly requested pages are persisted; no historical backfill is implied. See [Social Content Synchronization](technical-social-content-synchronization.md).
- Comment sync remains a separate explicit operation; listing a publication page never syncs comments. See the community-management specification for the page-scoped sync action.
- The YouTube reader filters playlist placeholder items only when the title is `Deleted video` and the description is `This video is unavailable.` (case/outer-whitespace-insensitive, with an optional final period) before normalizing IDs. Preserve the provider cursor, and keep valid videos from the same page. Do not apply this text heuristic to other providers.

### 1.1 Phase 1 provider contract baseline (SOC-01)

- **YouTube:** list the authenticated channel's uploads by calling `channels.list(mine=true)` and then paginated `playlistItems.list`; list video comment threads with `commentThreads.list`, and retrieve additional replies through `comments.list` when needed. The provider documents `youtube.readonly` for view access. Sending a reply uses `comments.insert` with the parent comment ID and requires `youtube.force-ssl`; this is a broader write-capable scope and should not be requested before the creator explicitly enables replies. Respect `canReply`, disabled comments, API errors, and quota limits (1 unit per commentThreads.list call; 50 units per comments.insert call).
- **Instagram:** local connection uses Instagram Login for professional Business/Creator accounts and media owned by the connected account. The authorization requests `instagram_business_basic` and `instagram_business_manage_comments`; personal accounts are outside the official API contract. Live Meta Standard/Advanced Access and App Review remain unverified.
- **Facebook Pages:** local connection uses Facebook Login with `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, and `pages_manage_engagement`, then derives a Page-scoped token. The creator must explicitly select a Page; no multiple Pages are connected implicitly. Personal profile timelines are unsupported. Live Meta access/App Review remains unverified.
- **TikTok:** deterministic read/reply adapters and a local account OAuth flow target TikTok Business accounts and owned organic videos through TikTok API for Business. The official short-token response example lists `video.list`, `comment.list`, and `comment.list.manage`; the code requires all three grants. The account-holder authorization URL is app-generated and loaded from `TIKTOK_BUSINESS_AUTHORIZATION_URL`, not constructed by the application. The callback validates state and accepts `auth_code` or `code`, then exchanges it with the documented TT4B token endpoint. This is separate from TikTok for Developers Login Kit even though scope strings overlap. Access-token refresh uses the documented short-term account-token renewal endpoint and request fields; verify it against an approved app before live use. TikTok also documents `/tt_user/oauth2/revoke/` for short-term account tokens, but this application does not expose or call it. Do not substitute the advertiser-token `/oauth2/revoke_token/` endpoint. The Research API is not the application integration path.
- These local flows do not imply that this application has provider credentials, granted permissions, approved app access, or production authorization. OAuth client IDs/secrets are read lazily from runtime configuration, never stored in PostgreSQL or returned in DTOs. Live verification remains pending; never commit provider credentials.
- OAuth connection flows only exchange credentials and perform the provider reads required to verify grants/identity/Page selection. They never send replies, publish content, or execute other social writes.
- See the [Platform Capability Matrix](../integrations/platform-capabilities.md) for official references, local implementation status, and live-access status. Video publishing and scheduling remain Phase 4 and are not authorized by the Phase 1 contracts.

### Optional local HTTPS for OAuth

- HTTP remains the default. When both `LOCAL_HTTPS_KEY_PATH` and `LOCAL_HTTPS_CERT_PATH` are configured, the Nest server serves HTTPS on the configured `PORT` and still listens only on `127.0.0.1`; specifying just one path fails at startup.
- The browser must trust the certificate and its Subject Alternative Name must cover `localhost`. The interface origin and the provider's registered callback must use the same HTTPS host and port; the app never rewrites OAuth redirect URIs.
- Local TLS does not enable access from other machines or add product-user authentication. Private key material stays outside version control and is never returned to the frontend.

### LAN access through an optional Nginx container

- Loopback-only local development binds the API to `127.0.0.1`; optional LAN access is provided by a separately started Nginx container using Linux host networking and proxying to `http://127.0.0.1:3000`. This local unauthenticated composition is not the remote Docker VM deployment.
- The proxy redirects its HTTP listener to HTTPS, requires a locally supplied certificate/key pair, restricts requests to the configured LAN CIDR, and disables access logs so OAuth callback codes/state are not written to request logs. Certificate private keys are local-only and must not be committed.
- The proxy forwards the original path and query to the API. It does not rewrite OAuth `redirect_uri` values: each provider's registered callback and the matching `*_OAUTH_REDIRECT_URI` must use the same HTTPS URL reachable from the browser. TikTok's app-generated authorization URL must use that same callback.
- An HTTPS hostname/certificate accepted by the browser and provider configuration is an operational prerequisite. A LAN IP or locally trusted certificate may not be accepted by every provider; verify each provider's redirect-URI rules before enabling its flow.
- The loopback/LAN development API has no end-user authentication. The remote Docker VM deployment must complete IAM-08 Auth0 login and API authorization; a CIDR restriction/VPN is additional protection, not a replacement. OAuth flow state remains single-use and process-local until shared persistence is implemented; keep one API instance running throughout the flow.

## 2. Architectural Placement

- **Domain:** `SocialAccount`, `Publication`, and platform-independent publication invariants.
- **Application:** account connection coordination, existing-publication listing, capability checks, publication creation, scheduling coordination, dispatch, retry, and result handling.
- **Ports:** account authorization/provider access, capability lookup, normalized publication reader, publication repository, scheduler/queue, and platform publishing adapter.
- **Adapters:** independent YouTube, Instagram, Facebook Pages, and TikTok Business adapters for their supported comment/read/reply contracts. Persistence, RabbitMQ workers, and HTTP presentation remain shared infrastructure.

Provider SDK DTOs and OAuth/API details remain in infrastructure. The domain must not depend on platform SDKs. Follow [Architecture](../architecture/architecture.md), [Platform Capabilities](../integrations/platform-capabilities.md), and [ADR-001](../architecture/decisions/ADR-001-hexagonal-architecture.md).

### Localization, timestamps, and scheduling

Locale affects presentation only. Persist and transport publication instants as ISO 8601 timestamps with an explicit offset, normally UTC; display them using the resolved locale and timezone in the [localization contract](../contracts/localization.md). A creator-entered wall-clock schedule must be resolved against an explicit IANA timezone, not the server timezone. SOC-01 must decide whether the API requires an explicit timezone or uses the resolved user/tenant timezone, how DST gaps/overlaps are handled, and whether the intended zone must be retained for edits or recurrence before scheduling is implemented. See the [localization architecture](../architecture/internationalization.md).

## 3. Logical Data and Invariants

### SocialAccount

Stores one connected account per tenant/platform/provider account identity:

- internal UUID `id`;
- server-resolved `tenantId`;
- `platform` (`youtube`, `instagram`, `facebook`, or `tiktok`);
- preserved provider `externalAccountId`;
- optional normalized `displayName`;
- opaque `credentialReference` pointing to the infrastructure credential vault; never store access/refresh token values in this record or the domain;
- creation/update timestamps maintained by persistence.

The unique provider identity is `(tenantId, platform, externalAccountId)`. Repository reads/writes always require tenant scope and a cross-tenant ID is not visible or mutable. Loopback-only local development resolves the reserved `LOCAL_PILOT_TENANT_ID` (`30000000-0000-4000-8000-000000000001`); no HTTP payload may select a tenant. Migration 005 provisions this tenant. The remote Phase 1 Docker deployment must instead resolve the pre-provisioned pilot identity and tenant from the Auth0-authenticated principal; it must not expose the unauthenticated local composition.

The credential vault keeps provider tokens and granted scopes out of account rows and domain objects. Its table stores base64-encoded AES-256-GCM ciphertext, nonce, and authentication tag, plus tenant/platform/reference and access-token expiry metadata; provider-specific refresh-token expiry remains inside the encrypted payload. Encryption uses a 32-byte base64 key from `SOCIAL_CREDENTIAL_ENCRYPTION_KEY`, read only when a credential is stored or resolved; API startup does not require it. Associated data binds ciphertext to tenant, platform, and credential reference. YouTube refreshes an expired access token through its encrypted OAuth refresh token. Instagram refreshes a still-valid long-lived token before its stored expiry; if refresh is no longer accepted, the creator must reconnect. Facebook uses the selected Page-scoped token and has no refresh token in this integration; provider revocation/expiry requires reconnection. TikTok's access/refresh tokens and scopes are encrypted in the same vault, and the account refresh flow updates rotated access/refresh tokens. TikTok documents short-term account-token revocation at `/tt_user/oauth2/revoke/`; the application does not currently expose or call this operation. OAuth state and temporary Facebook Page-selection records are process-local, single-use, and expire after five minutes; the short-lived pending Facebook user token is stored in the encrypted vault and is deleted after selection. Token values never enter `SocialAccount`, DTOs, or logs. `credentialReference` is not itself a provider token and is omitted from response DTOs/logs.

### YouTube local OAuth (Phase 1)

- `GET /social/connections/youtube/authorize` starts the local authorization-code flow using OAuth `state` and PKCE S256. State/verifier pairs are single-use, expire after five minutes, and are held in process memory for the localhost-only pilot.
- The default consent requests only `youtube.readonly`. The creator may explicitly opt into replies with `enableReplies=true`, which requests the broader `youtube.force-ssl` scope instead.
- `GET /social/connections/youtube/callback` consumes a valid state, exchanges the code, identifies the authorized channel, stores access/refresh tokens in the encrypted vault, and creates/reauthorizes that channel's `SocialAccount`. The response omits tokens and credential references.
- `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, and `YOUTUBE_OAUTH_REDIRECT_URI` are read only when an authorization or callback request runs; they are not required at API startup. Google app verification/consent configuration remains necessary for live accounts.
- Expired access tokens are refreshed through the encrypted refresh token. A revoked or rejected refresh grant requires the creator to reconnect.

### Instagram Login (Phase 1 local connection)

- `GET /social/connections/instagram/authorize` creates a random, single-use `state` with a five-minute lifetime and redirects to the official Instagram Login authorization endpoint. It requests only `instagram_business_basic` and `instagram_business_manage_comments`, sends `state`, and sets `enable_fb_login=false` so the login UI does not offer the Facebook Login path. The official Instagram Login contract documents `state` but not PKCE; do not copy the YouTube PKCE behavior into this flow.
- `GET /social/connections/instagram/callback` consumes the state before processing the callback. It exchanges the code at `api.instagram.com/oauth/access_token`, accepting either a flat token response or exactly one wrapped `data` entry, never an ambiguous combination. It requires explicit granted permissions including both requested scopes before exchanging the short-lived token for a 60-day long-lived token and reading `/me?fields=id,user_id,username`. Numeric IDs are parsed without JSON precision loss. The code-exchange `user_id` must match either the app-scoped `id` or the professional-account `user_id` from `/me`; the professional `user_id` is stored as `externalAccountId` because it is the ID used by `/{ig-id}/media` and webhook notifications. Missing/ambiguous token data or grants do not persist credentials. Instagram Login itself limits this API to professional accounts. Tokens are stored only in the encrypted vault.
- A long-lived Instagram token is refreshed through `graph.instagram.com/refresh_access_token` when it is within seven days of expiry, while it is still valid. A provider rejection or already expired token requires reauthorization. The refresh request does not receive or expose a client secret.
- `INSTAGRAM_OAUTH_CLIENT_ID`, `INSTAGRAM_OAUTH_CLIENT_SECRET`, `INSTAGRAM_OAUTH_REDIRECT_URI`, and `META_GRAPH_API_VERSION` are read at request time; they are not required at startup. Google/Meta credentials and access approvals are never part of a SocialAccount or API response. Live Meta app access/review is still pending.

### Facebook Login and explicit Page selection (Phase 1 local connection)

- `GET /social/connections/facebook/authorize` creates a random, single-use five-minute `state` and requests `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, and `pages_manage_engagement` through the versioned Facebook Login dialog. When `FACEBOOK_OAUTH_CONFIG_ID` is configured — required for apps that only offer Facebook Login for Business — the dialog sends `config_id` instead of `scope`, and the granted permissions are the ones defined in that Meta dashboard configuration; the same four permissions must be enabled there. Meta's documented server-side code flow uses `state`; the selected manual flow does not document PKCE.
- `GET /social/connections/facebook/callback` consumes state, exchanges the code for a user token, exchanges that token for a long-lived user token, verifies all required grants through `/me/permissions`, then lists manageable Pages through `/me/accounts` with Page access tokens and tasks. Meta may omit `expires_in` for tokens without reported expiry; the adapter accepts that as an unknown expiry while still requiring `access_token` and `token_type=bearer`, and the temporary user credential remains capped at five minutes regardless. The callback returns only a random five-minute `selectionId` and Page IDs/display names; it never connects every returned Page or exposes any token.
- `POST /social/connections/facebook/select` accepts only the callback's `selectionId` and one listed `pageId`. The application re-reads Pages, requires the selected Page to retain the `MODERATE` task, stores only that Page-scoped access token in the encrypted vault, deletes the temporary encrypted user credential, and connects the tenant-scoped Facebook SocialAccount. Selection IDs are tenant-bound, single-use, and cannot select an unlisted Page.
- `FACEBOOK_OAUTH_CLIENT_ID`, `FACEBOOK_OAUTH_CLIENT_SECRET`, `FACEBOOK_OAUTH_REDIRECT_URI`, `FACEBOOK_OAUTH_CONFIG_ID` (optional; required for Facebook Login for Business apps), and `META_GRAPH_API_VERSION` are read at request time and are not required at startup. Facebook Page tokens do not use the YouTube refresh behavior; if the Page token or underlying Page authorization is revoked/invalidated, the creator must reconnect. Live Meta App Review/access remains pending.

### TikTok Business OAuth (Phase 1 local connection)

- `GET /social/connections/tiktok/authorize` reads the app-generated authorization URL from `TIKTOK_BUSINESS_AUTHORIZATION_URL`, appends a random single-use five-minute state, and redirects only to HTTPS TikTok domains. It does not construct a vendor-specific authorization endpoint. State query parameter name defaults to `state` and can be configured with `TIKTOK_BUSINESS_STATE_PARAMETER`. The documented TT4B token exchange has no `code_verifier` field, so this adapter does not apply the separate Developer Login Kit PKCE contract.
- `GET /social/connections/tiktok/callback` consumes state once and accepts `auth_code` or `code` from the app-generated callback, then exchanges it using the documented `POST /open_api/v1.3/tt_user/oauth2/token/` JSON contract: client ID/secret, `grant_type=authorization_code`, `auth_code`, and the same registered redirect URI.
- The exchange validates `open_id`, bearer token type, access/refresh expiry, and all required scope values (`video.list`, `comment.list`, `comment.list.manage`) before storing the TikTok identity and credentials. `open_id` is preserved as the Business API `business_id`. Access token, refresh token, granted scopes, and refresh-token expiry are encrypted in the vault; the relational expiry column continues to represent the access token. No migration is required because the existing `social_credentials` schema already supports TikTok.
- Expired/near-expiry access tokens refresh through `/tt_user/oauth2/refresh_token/`. The local adapter sends JSON `client_id`, `client_secret`, `grant_type=refresh_token`, and `refresh_token`, matching TikTok's documented short-term account-token renewal request. Deterministic tests cover the payload, token rotation, and failure mapping; verification against an approved TikTok Business app remains a live rollout gate.
- TikTok documents short-term account-token revocation through `POST /tt_user/oauth2/revoke/`, distinct from advertiser-token `/oauth2/revoke_token/`. The application does not currently expose or call account-token revocation; do not substitute the advertiser-token operation.
- Configure `TIKTOK_BUSINESS_CLIENT_ID`, `TIKTOK_BUSINESS_CLIENT_SECRET`, `TIKTOK_BUSINESS_REDIRECT_URI`, and the generated `TIKTOK_BUSINESS_AUTHORIZATION_URL` in runtime secrets/config. These values are lazy and do not block API startup. Live app access and provider verification remain pending. Do not substitute Login Kit or Research API.

### Publication

- References one `Content` and one platform/account combination.
- Has an independent application status and provider result/reference.
- Stores destination-specific title, description, and tags where supported, separately from shared Content metadata.
- Initially populates destination title and description from Content; each destination can be edited independently.
- Is idempotent as required by `BR-PUB-004`.

Exact status enum, metadata schemas, and retry-attempt representation remain open.

## 4. Application Ports

```typescript
interface PlatformPublication {
  platform: SocialPlatform;
  externalPublicationId: string;
  title: string | null;
  description: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
}

interface PlatformPublicationPage {
  items: readonly PlatformPublication[];
  nextCursor: string | null;
}

interface SocialCredentialVault {
  storeCredentials(input: {
    tenantId: string;
    platform: SocialPlatform;
    accessToken: string;
    refreshToken: string | null;
    grantedScopes: readonly string[];
    expiresAt: string | null;
  }): Promise<string>;
  resolveAccessToken(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<string | null>;
  resolveAccessTokenExpiresAt(tenantId: string, credentialReference: string, platform: SocialPlatform): Promise<string | null>;
}

interface SocialPublicationReader {
  listPublications(account: SocialAccount, cursor?: string, pageSize?: 5 | 10 | 25): Promise<PlatformPublicationPage>;
}

interface PlatformCapabilityResolver {
  getCapability(platform: SocialPlatform, operation: PlatformOperation): Promise<CapabilityResult>;
}

interface VideoPublisher {
  publish(request: PublishRequest): Promise<PublicationResult>;
}
```

Provider DTOs/cursors remain inside adapters; `nextCursor` is opaque to callers. The adapter resolves tokens through `SocialCredentialVault` and never returns or logs token values. Provider-specific OAuth adapters return normalized account identities and opaque credential references; application use cases own tenant resolution, state validation, Page selection, account persistence, and credential cleanup. TikTok's OAuth adapter is implemented locally with deterministic tests; live Business API access and refresh-request verification against an approved app remain pending. Scheduling ports and their concrete provider contracts remain deferred to Phase 4.

## 5. Existing-Publication Listing (Phase 1)

1. Resolve the connected social account and verify its authorization.
2. Check the exact platform's publication-read capability.
3. Fetch one provider page using the requested supported page size and opaque cursor, then normalize records into application contracts, preserving platform and external publication identifiers.
4. Upsert the normalized page through `SocialPublicationRepository`, keyed by tenant, social account, and external publication ID. A repository failure is not reported as a successful synchronization; previously committed metadata is preserved.
5. Return pagination and partial/unsupported/failure outcomes without allowing one account's failure to hide successful results from other accounts.
6. Keep provider DTOs, cursors, and pagination semantics inside the adapter; listing existing publications does not create internal `Content`, sync comments, or call a publishing operation.

This read workflow is a prerequisite for Phase 1 community management and is separate from the Phase 4 video-publishing flow below.

## 6. Publication Flow (Phase 4)

1. Validate content readiness and media reference.
2. Validate that the selected account is connected and has required permissions.
3. Resolve capability for the exact platform operation; return an explicit unsupported/blocked result if unavailable.
4. Validate destination-specific metadata and create one independent `Publication` per destination.
5. Dispatch each eligible publication through the publication queue.
6. Worker loads the publication and invokes only that destination's platform adapter.
7. Persist each outcome independently, including provider publication identifier when returned.
8. On retry, reuse the same logical publication/idempotency identity and prevent duplicate external publication where the provider permits it.

A failure or media/metadata incompatibility for one destination must not rollback or block another destination (`BR-PUB-003`). Validate each selected destination independently; do not apply a universal intersection limit to the shared Content asset.

## 7. Scheduling and Asynchronous Processing

Publication work uses RabbitMQ as described in [Architecture](../architecture/architecture.md). The foundation queue port transports JSON job messages and requires each consumer to explicitly select `requeue` or `reject` when its handler fails. This is a broker disposition only; it does not define a retry count, backoff, dead-letter policy, or idempotency strategy. Queue consumers must safely handle repeated delivery by checking application publication identity/state before issuing external side effects. Exact broker delivery guarantees, idempotency-key strategy, retry/backoff limits, dead-letter handling, and schedule implementation are not fixed by current specifications.

A scheduled item must not be dispatched before the requested time. Whether scheduling is application-managed or provider-native is platform-specific and remains an open decision. Platform capability must be checked at dispatch time as well as request time to handle changed/revoked access.

## 8. Failure Handling

- Invalid content, unconnected account, insufficient permission, or unsupported capability: do not dispatch; return an explicit reason.
- Provider timeout/ambiguous result: do not blindly issue a duplicate publish; reconcile using provider identity/capability if available. Exact reconciliation behavior is provider-specific and TBD.
- One destination failure: persist that publication's failure without changing other destination results.
- Retry: preserve the publication record and apply the agreed retry policy; do not treat retry as a new user-requested publication.
- Revoked/expired authorization: mark the operation blocked/failed according to the final status model; do not log credentials.

## 9. Security and Observability

- Store authorization secrets only in the protected infrastructure boundary; never expose them in DTOs, logs, or domain objects.
- Validate account identity, operation capability, and permissions before external side effects.
- Emit structured logs/metrics by publication identifier, platform, operation, and outcome. Redact tokens and private provider payloads.

## 10. Verification

Apply Clean Code and TDD (Red-Green-Refactor): write or update a failing test before production changes, implement the smallest suitable change, then refactor with tests green. Every use case requires unit tests; critical user journeys require E2E coverage.

- **Unit:** capability decision, publication independence, readiness/permission checks, idempotency behavior, retry orchestration, OAuth state replay/expiry, scope/identity validation, selected-Page authorization, credential cleanup, tenant binding, and tenant-scoped disconnection.
- **Integration:** YouTube publication listing filters only the documented deleted/unavailable placeholder while preserving valid items and cursors. YouTube, Instagram Login, Facebook Login/Page-selection, and TikTok Business token boundaries use deterministic `fetch` doubles; vault tests cover encryption, expiry metadata, token rotation, and tenant/platform isolation. Disconnection verifies the account, credential, and related-data cascades in a transaction. No test calls production providers or uses actual credentials.
- **E2E:** YouTube, Instagram, Facebook, and TikTok callback routes use deterministic HTTP/application doubles; explicit Facebook Page selection, TikTok state validation, and connected-account disconnection are covered. Multi-destination publishing remains a Phase 4 journey.
- Revalidate official provider requirements before production; do not treat the existing capability matrix as a substitute for that check.

## 11. Open Technical Decisions

- TikTok Business app-generated authorization URL/configuration, live callback/state and refresh-flow verification, app access tier, and whether a future provider-side revoke action is warranted; Google/Meta live App Review and test-client access; provider revocation handling for already-connected Meta accounts.
- Per-platform media/metadata contracts and provider result reconciliation.
- Publication status model and user-visible error taxonomy.
- Application scheduler versus provider-native scheduling, timezone, edits, and cancellation.
- Queue delivery/retry/dead-letter policy and idempotency implementation.
- Provider-specific rate-limit handling and API version strategy.
