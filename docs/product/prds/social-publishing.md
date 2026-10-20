# PRD — Social Accounts and Publishing

**Status:** Draft — local YouTube, Instagram Login, Facebook Page, and configurable TikTok Business OAuth connection flows are implemented. Live provider access/App Review and TikTok refresh verification remain pending. TikTok documents a short-term account-token revoke endpoint, but this application does not expose or call it. Phase 4 metadata, media limits, and retry policy remain open.  
**Tech spec:** [Technical Specification — Social Accounts and Publishing](../../specifications/technical-social-publishing.md)

## 1. Objective

For Phase 1, let the creator connect supported social accounts and list existing publications for community management. Video upload and publishing are deferred to Phase 4; connected accounts remain necessary in Phase 1 to read platform data and send manually approved replies.

## 2. User and Problem

**Primary user:** a creator using the controlled single-creator pilot in Phase 1.

The creator wants to view existing publications and their comments from connected accounts. Preparing and publishing new video content is deferred to Phase 4.

## 3. Platform Scope by Phase

Active MVP comment/read/reply targets include YouTube, Instagram professional Business/Creator accounts, managed Facebook Pages, and TikTok Business accounts for owned organic videos. Local HTTP connection is implemented for YouTube, Instagram, Facebook Pages, and configurable TikTok Business account OAuth. TikTok requires the app-generated authorization URL/runtime credentials; local tests do not prove live app access or verify the refresh payload against an approved app. Provider live access approvals remain separate from local implementation; video publishing remains Phase 4.

Phase 1 provider baseline (subject to each platform's authorization and access tier):

- **YouTube:** the authenticated channel's uploads and video comments; replies only where the provider reports the thread is replyable. Reply authorization requires Google's `youtube.force-ssl` scope, which is broader than read-only access.
- **Instagram:** local connection uses Instagram Login for professional Business/Creator accounts and media owned by that account. It requests `instagram_business_basic` and `instagram_business_manage_comments`; personal consumer accounts are unsupported. Live Meta access/App Review is pending.
- **Facebook Pages:** local connection authorizes the user, verifies `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, and `pages_manage_engagement`, lists managed Pages, and requires an explicit Page selection before storing a Page-scoped token. Personal profile timelines are unsupported. Live Meta access/App Review is pending.
- **TikTok:** local connection uses the app-generated TikTok Business account authorization URL supplied at runtime, verifies one-time state, exchanges the callback code, and checks `video.list`, `comment.list`, and `comment.list.manage` before connecting the returned `open_id`. The official token-response example includes those scope names. The documented refresh request matches the local adapter; approved-app verification remains pending. TikTok documents `/tt_user/oauth2/revoke/` for short-term account tokens, but the application does not expose or call it; do not use the advertiser-token revoke endpoint. TikTok for Developers Login Kit is not a substitute.

Provider API support does not itself grant the application access. Meta Standard/Advanced Access and Google OAuth verification may be required depending on whether the connected account is an app/test role or an external creator. Capability is evaluated per platform and operation; support on one platform does not imply support on another. See the [Platform Capability Matrix](../../integrations/platform-capabilities.md) for provider references and current verification status.

## 4. Requirements

### SP-00 — List existing publications

The creator can request a normalized list of existing publications from a connected account for use in the Phase 1 community workflow. Preserve platform and external publication identifiers, pagination/cursor semantics inside the adapter boundary, and explicit partial/unsupported/failure outcomes. This read capability does not create, upload, schedule, or publish content.

### SP-01 — Connect social accounts

The creator can authorize supported platform accounts for the controlled Phase 1 pilot. Each provider uses its own authorization/callback contract; state is single-use and callbacks expose no provider tokens. The application validates identity and required grants before enabling each operation and protects credentials in the encrypted vault. Facebook Pages require explicit selection of one returned Page. TikTok uses the app-generated Business authorization URL and runtime settings; live app access and refresh-payload verification remain pending. Missing OAuth settings do not block startup; an explicit connection attempt fails with a stable error. Tenant-based multi-user access is deferred to Phase 3.

### SP-02 — Select publication destinations and metadata (Phase 4)

The creator selects one or more connected platform/account destinations for a Content item. The interface then presents a separate metadata section for each selected destination. Destination title, description, and tags where supported are independent from the shared Content title and description; destination title and description are initially populated from Content and remain independently editable.

### SP-03 — Validate before publication (Phase 4)

Before dispatch, the application validates Content, connected account, and media/metadata capability separately for each selected destination. An unsupported destination receives an explicit blocked result; it does not prevent other eligible destinations from proceeding.

### SP-04 — Publish independently (Phase 4)

The application creates and dispatches an independent Publication for each platform/account destination. Failure on one destination does not roll back or block a successful publication on another.

### SP-05 — Track publication status (Phase 4)

The creator can inspect the status and result of each individual publication.

### SP-06 — Schedule publication (Phase 4)

The creator can request publication at a future time where supported by the application and target platform. The scheduling contract and platform-specific limitations must be made explicit before implementation.

### SP-07 — Retry failed publication (Phase 4)

A failed publication can be retried without creating an unintended duplicate external publication. Publication operations are idempotent.

## 5. Acceptance Criteria

- [ ] The creator can list existing publications from each connected account, retaining platform/external identifiers and seeing pagination and per-account partial/unsupported/failure outcomes.
- [ ] Listing existing publications does not upload, create, schedule, or publish content.
- [ ] The application rejects or blocks an operation when the account type, permissions, or platform capability is insufficient, and reports the reason.
- [ ] YouTube, Instagram, Facebook, and TikTok OAuth callbacks validate a single-use, expiring state; token exchange, scope, identity, vault, and persistence failures map to stable errors and do not expose tokens.
- [ ] Instagram uses its own professional-account Login flow and documented scopes; Facebook connects only the explicitly selected managed Page and stores its Page-scoped token.
- [ ] Missing OAuth configuration does not prevent API startup; only the corresponding explicit connect request fails.
- [ ] Account connection performs only authorization/token/identity/Page reads; it never sends a reply, publishes, or performs another social write.
- [x] TikTok Business local OAuth is configured with an app-generated authorization URL, validates one-time state, exchanges the account code, requires `video.list`, `comment.list`, and `comment.list.manage`, and stores `open_id` and credentials in the tenant-scoped encrypted vault; deterministic tests do not call TikTok.
- [ ] Verify the refresh flow against an approved TikTok Business app before live rollout. Keep remote revocation out of the application until its disconnect behavior is specified; if implemented, use the documented short-term account-token endpoint, never the advertiser-token revoke endpoint. Login Kit and Research API are not substitutes.
- [ ] Local OAuth test coverage uses deterministic HTTP doubles and does not establish that provider app access or live approval has been granted.
- [ ] Selecting destinations presents separate title, description, and supported-tags fields for each; editing one destination does not change another or shared Content metadata.
- [ ] Each selected destination receives its own Publication record and status.
- [ ] A media/metadata incompatibility or failure on one destination does not change the result of another destination.
- [ ] Retrying the same publication operation does not create a duplicate publication.
- [ ] Platform-specific media and metadata requirements are verified against current official requirements before production release.
- [ ] A scheduled publication is not dispatched before its requested schedule time.
- [ ] TikTok Business comment read/reply remains limited to owned organic videos and is not enabled until its Business API access and permissions are verified.

## 6. Out of Scope

- Advertising management.
- TikTok video publishing before its separate Phase 4 capability verification.
- Project-based destination presets in the MVP.
- Assuming equivalent publishing, scheduling, or metadata capabilities across platforms.

## 7. Dependencies

- Content Management PRD.
- Platform adapters and current platform capability matrix.
- Secure social account authorization and permission handling.

## 8. Open Questions

- Which title, description, and tag fields are supported and required for each destination, and what are their validation limits?
- What media limits and format checks apply to each supported platform operation?
- Does scheduling use one application-level scheduler, native platform scheduling, or vary by platform?
- Which timezone is used for creator-entered schedule times, and can a schedule be edited or cancelled?
- What retry policy and user-visible recovery actions are required?
- Before production, which Google/Meta app-review and live account approvals have been granted, and what provider-specific revocation/reconnect policy is used after user consent is withdrawn?
- For TikTok Business, which app-generated authorization URL and registered redirect URI will be set in runtime configuration, and when can the refresh flow be verified against an approved test app? What user-facing disconnect behavior should use TikTok's documented short-term account-token revoke endpoint?
