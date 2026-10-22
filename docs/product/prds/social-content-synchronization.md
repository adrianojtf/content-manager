# PRD — Social Content Synchronization

**Status:** Draft — incremental synchronization is implemented locally; provider live access and retention verification remain open.

**Tech spec:** [Technical Specification — Social Content Synchronization](../../specifications/technical-social-content-synchronization.md)

**Related PRDs:** [Social Accounts and Publishing](social-publishing.md), [Community Management](community-management.md)

## 1. Objective

Persist a tenant-scoped metadata record for each external video/publication page synchronized from a connected social account. Keep its top-level comments and the connected account owner's direct replies available locally. This data is the foundation for future statistics; metrics and dashboards are not part of this change.

## 2. User and Problem

**Primary user:** a creator operating within an authorized tenant.

The creator needs synchronized publication metadata and community activity to remain available in the application's database for later analysis, instead of existing only in provider responses or browser memory.

## 3. Phase 1 Scope

- Support the existing YouTube, Instagram professional Business/Creator, Facebook Page, and TikTok Business account scope, subject to each provider's actual authorization and data capabilities.
- Persist normalized metadata for each publication page successfully fetched through the existing provider-backed listing flow: platform and external publication ID, title, description, permalink, thumbnail URL, published time, owning tenant/account, and last successful synchronization time.
- Persist metadata only; do not download or store external video bytes and do not create an internal uploaded `Content` item.
- Keep provider pagination and the current page-size choices. Synchronize only pages the creator requests; do not scan every account publication or backfill the full history in this increment.
- Keep comments as an explicit, on-demand synchronization for one publication or the currently visible publication page. Load comments from local persistence after synchronization.
- Synchronize top-level comments and only direct replies authored by the connected account owner. Do not import replies written by other commenters or deeper reply threads.
- Persist the connected owner's direct reply details when the provider returns them and reliably identifies the author. Preserve the existing app-sent reply record separately.
- Treat reply state as `REPLIED`, `NOT_REPLIED`, or `UNKNOWN`. A third-party reply does not mean the creator replied. Use `UNKNOWN` when the provider cannot reliably attribute or enumerate the creator's replies.
- Retain publication metadata while the social account remains connected. Keep comment and creator-reply text under the existing 30-day comment retention policy; deleting an account removes its synchronized data.
- Use the synchronized metadata as a future statistics foundation only. This increment does not collect performance metrics or guarantee a complete historical publication catalog.

## 4. Requirements

### SCS-01 — Persist synchronized publication metadata

After a provider publication page is successfully fetched and normalized, persist each returned publication with its tenant and connected-account identity. Repeated synchronization of the same external publication updates its metadata and synchronization time rather than creating duplicates.

### SCS-02 — Keep external and internal content distinct

A synchronized external publication is not an uploaded `Content` item. It has no application media key, draft/ready state, or publication workflow managed by Content Management.

### SCS-03 — Synchronize incrementally

Only provider pages explicitly requested by the creator are persisted. The application preserves provider cursors for pagination and does not automatically traverse all pages, all accounts, or all historical publications.

### SCS-04 — Load persisted comments

For a selected synchronized publication, the creator can load its persisted top-level comments. Comment synchronization remains explicit and preserves platform identifiers and the existing retention behavior.

### SCS-05 — Synchronize creator-authored direct replies

When available, persist direct replies whose author is reliably identified as the owner of the connected social account. Do not persist other commenters' replies or nested conversation replies as creator responses.

### SCS-06 — Report reply state accurately

The creator can distinguish an app-sent reply from a reply detected on the platform. Mark the comment responded when either the app recorded a successful send or the provider confirmed a direct reply by the connected account owner. Show `UNKNOWN` rather than `NOT_REPLIED` when provider evidence is insufficient.

### SCS-07 — Preserve partial outcomes

A publication or comment failure for one connected account/video does not erase its last successful local data or prevent other requested accounts/videos from completing. A persistence failure must not be reported as a successful synchronization.

## 5. Acceptance Criteria

- [x] A successful publication page fetch persists all normalized items in that page with tenant, account, platform, external ID, and `lastSyncedAt`.
- [x] Synchronizing the same page repeatedly updates the same records and does not create duplicates.
- [x] Records from separate tenants or connected accounts remain isolated, including when provider external IDs collide.
- [x] The persisted publication page contains metadata only; no video bytes are downloaded or stored.
- [x] Publication listing and comment synchronization do not traverse unrequested historical pages or start background polling.
- [x] A provider listing failure preserves prior publication metadata and returns a per-account failure.
- [x] A database persistence failure is surfaced as a synchronization failure; prior committed data remains intact.
- [x] Loading a publication's comments returns persisted top-level comments and any persisted direct creator replies.
- [x] Only replies reliably attributed to the connected account owner are persisted as creator replies; replies from other authors and deeper reply threads are excluded.
- [x] `REPLIED` is set only when a direct creator reply is confirmed. `NOT_REPLIED` is used only when the provider can reliably confirm that none exists; otherwise the state is `UNKNOWN`.
- [x] A successful app-sent reply remains distinguishable from a provider-detected creator reply. The displayed effective state is responded if either source confirms a reply.
- [x] Comment and creator-reply text expires with its associated comment after 30 days; publication metadata is deleted when its social account is disconnected.
- [x] New user-facing status or error copy is localized in `pt-BR`, `en-US`, and `es-ES`.
- [x] Provider and persistence tests use deterministic doubles and do not call production social APIs.

## 6. Out of Scope

- Downloading or storing external video files.
- Full-account historical backfill, scheduled/background polling, or automatic traversal of all provider cursors.
- Importing replies from other commenters or nested reply threads.
- Collecting views, likes, reach, or other performance metrics; analytics, recommendations, and dashboards.
- Replacing provider-backed publication listing with a local-only catalog.
- Changing the existing AI evaluation, response-generation, or manual-send policy.

## 7. Dependencies

- Social Accounts and Publishing PRD and its platform-specific account authorization.
- Community Management PRD for comment workflows, explicit sync, reply-state display, and 30-day retention.
- Provider APIs and permissions that expose direct creator replies and sufficient author evidence.

## 8. Open Questions

- Which supported providers expose the connected account owner's direct reply text, external ID, and timestamp reliably under the current app access level?
- What provider terms or access-review requirements apply to retaining synchronized publication metadata and creator-reply text?
- If future statistics require a complete history, what separate backfill, rate-limit, and progress-reporting contract should be specified?
