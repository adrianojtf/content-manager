# Technical Specification — Social Content Synchronization

**Status:** Implemented locally with deterministic tests. Provider-specific creator-reply availability and retention terms require verification before rollout.

**Product PRD:** [Social Content Synchronization](../product/prds/social-content-synchronization.md)

**Related technical specifications:** [Social Accounts and Publishing](technical-social-publishing.md), [Community Management](technical-community-management.md)

## 1. Scope

Persist normalized metadata for provider publication pages already fetched by the application, then extend the existing on-demand comment sync to persist only direct replies authored by the connected account owner when the provider can identify them. Publication listing remains provider-backed and paginated. This is a bounded local data foundation for future statistics, not a full-account importer or metrics pipeline.

The `GET /social/publications` flow performs an idempotent internal persistence write for each successfully fetched page. It continues to return the live provider page and opaque cursor. It does not trigger comment synchronization. Comment reads use persisted data; comment writes remain an explicit per-publication/current-visible-page action.

## 2. Architectural Placement

- **Domain:** normalized `SocialPublicationMetadata`, `PlatformComment`, and `PlatformCreatorReply` values. External provider DTOs and database row shapes do not enter the domain.
- **Application:** `ListSocialPublications` coordinates provider page retrieval and repository persistence. `SyncPublicationComments` coordinates comment and eligible creator-reply persistence. Tenant resolution, idempotency, and partial outcomes remain application responsibilities.
- **Ports:** add a `SocialPublicationRepository` for page upserts and tenant/account-scoped reads; extend the comment reader/repository contracts to represent direct creator replies separately from top-level comments.
- **Adapters:** existing platform publication/comment readers normalize provider data; PostgreSQL stores normalized records; HTTP returns stable application results. Each platform remains an independent adapter and can report limited or unknown creator-reply evidence.

Follow the modular-monolith and hexagonal boundaries. JEV does not read these tables or call the social APIs. User-facing errors and status labels use semantic localization keys in `pt-BR`, `en-US`, and `es-ES`.

## 3. Logical Data and Persistence

### Social publication metadata

Persist the normalized fields already returned by `SocialPublicationReader`:

- `tenantId`, `socialAccountId`, `platform`, and `externalPublicationId`.
- Nullable `title`, `description`, `permalink`, `thumbnailUrl`, and provider `publishedAt`.
- Required `lastSyncedAt`, set only after a successful provider read and committed repository upsert.

The record identifies an external publication, not an internal `Content` or a Phase 4 outbound `Publication`. It has no media key, draft/ready state, video bytes, or publishing status.

### Creator-authored comment replies

Represent a direct reply written by the owner of the connected account with:

- `tenantId`, `socialAccountId`, `platform`, `externalReplyId`, and `externalCommentId` for the parent top-level comment.
- Nullable reply `text` and provider `createdAt`, plus required `lastSyncedAt`.

Only normalized replies whose author is reliably identified as the connected account owner enter this collection. Replies from other commenters and deeper reply threads are not stored as creator replies. A reply may refer to a top-level comment saved by an earlier comment page; attach it only when that parent exists for the same tenant, account, and publication. If the provider confirms a creator reply but does not return its text, persist the reply state without fabricating a reply body. The existing append-only `ManualReplyAttempt` remains the audit record for replies sent by the application.

### PostgreSQL schema

Add an additive migration after the current migration head:

- `social_publications`: composite primary key `(tenant_id, social_account_id, external_publication_id)`; required platform and synchronization time; nullable normalized metadata; composite foreign key to `social_accounts (tenant_id, id)` with `ON DELETE CASCADE`.
- Index publication pages by `(tenant_id, social_account_id, published_at DESC, external_publication_id)`. Keep provider pagination cursors outside this table; they remain opaque adapter values.
- `social_comment_replies`: composite primary key `(tenant_id, social_account_id, external_reply_id)`; required parent `external_comment_id`; nullable text/provider timestamp; required `last_synced_at`; composite foreign key to the parent row in `social_comments` with `ON DELETE CASCADE`.
- Add an index for `(tenant_id, social_account_id, external_comment_id, provider_created_at)` to load a comment's direct creator replies.

All queries and writes include the server-resolved tenant and connected-account scope. Publication metadata remains until account disconnection. Creator-reply rows are removed with their parent comment; comments and associated reply text retain the existing 30-day expiry behavior.

## 4. Application Contracts

The normalized publication contract remains provider-neutral:

```typescript
interface SocialPublicationMetadata {
  tenantId: string;
  socialAccountId: string;
  platform: SocialPlatform;
  externalPublicationId: string;
  title: string | null;
  description: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  lastSyncedAt: string;
}

interface PlatformCreatorReply {
  platform: SocialPlatform;
  externalReplyId: string;
  externalCommentId: string;
  externalPublicationId: string;
  text: string | null;
  createdAt: string | null;
}
```

`PlatformCommentPage` keeps its current top-level `items` and opaque `nextCursor`, and adds a normalized collection of direct creator replies. Each root `PlatformComment` continues to carry `externalReplyStatus` as `REPLIED`, `NOT_REPLIED`, or `UNKNOWN`; `StoredPlatformComment.appReplied` remains independent.

## 5. Synchronization Flows

### Publication metadata

1. Resolve the tenant and list only connected accounts in the requested platform/account scope.
2. Fetch one provider page with the existing supported page size (`5`, `10`, or `25`) and opaque cursor.
3. Normalize the response and validate every external publication ID and optional field before persistence.
4. Upsert the normalized page in one repository transaction, keyed by tenant, social account, and external publication ID. Re-fetching a page updates the same rows.
5. Return the live page and provider cursor only after persistence succeeds. A persistence failure is a per-account synchronization failure with a stable application error; prior committed metadata is preserved.
6. Do not delete records merely because they are absent from the current page: pagination is partial and does not prove a publication was removed.

Only provider pages explicitly requested by the creator are saved. A page navigation or refresh does not traverse subsequent cursors automatically. Consequently, the local publication catalog is intentionally incomplete until those pages are requested.

### Comments and creator replies

1. Keep the existing explicit comment-sync boundaries: one publication or the currently visible publication page, one provider comment page per video, and explicit cursor continuation.
2. Normalize the top-level comment page. Normalize only direct replies authored by the connected account owner where the provider supplies reliable authorship evidence.
3. Upsert comments and creator replies idempotently in a bounded transaction. A reply may refer to a root comment from an earlier cursor page; persist it only when that parent exists for the same tenant, account, and publication, and update the parent's confirmed reply state.
4. Use a batched/set-based database upsert for each fetched page; do not issue one database round trip per comment or reply.
5. A provider request failure does not replace the last successfully stored page. If reply evidence is absent, incomplete, or cannot be attributed, keep valid root comments and preserve the creator-reply state as `UNKNOWN`; do not add an unbounded secondary read per comment.
6. `GET /social/accounts/{accountId}/publications/{publicationId}/comments` returns persisted top-level comments and their persisted direct creator replies. It never fetches replies from other authors during a database read.
7. Expired comment rows and their creator-reply rows are removed under the existing 30-day policy. Publication metadata is removed by the connected-account cascade.

### Reply-state rules

- Set external `REPLIED` only when the provider confirms a direct reply by the connected account owner.
- Set external `NOT_REPLIED` only when the provider can reliably establish that no direct creator reply exists for that comment. On Instagram Login, an omitted `replies` edge with no nested reply for that comment in the same page reliably means no replies exist, because the provider only returns the edge when there is content.
- Use external `UNKNOWN` if author attribution or reply-list completeness is unavailable — including an Instagram `replies` edge that is present but malformed or paginated, or omitted while a nested reply referencing the comment exists in the stream. A non-zero generic reply count is not proof of a creator reply. A confirmed creator reply found while paging comments updates the stored parent comment even when that root comment was synchronized on an earlier page.
- Never overwrite `appReplied` from provider data. The application reports the comment as responded when `appReplied` is true or external status is `REPLIED`, while preserving which source confirmed it.
- An externally detected reply with a known external ID is upserted by that ID. If the same ID is also present in a successful app-send audit, present it once and retain the audit event as the source of the app-send details.

## 6. Performance and Limits

- Keep publication retrieval paginated at the existing `5`, `10`, and `25` item sizes. Metadata writes are limited to the returned page.
- Keep comment synchronization on demand and bounded to the current visible page; the browser continues processing its visible videos sequentially and reports per-video progress/outcomes.
- Prefer creator-reply evidence included in the provider's comment response. Do not add an unbounded per-comment provider request pattern. If a platform requires additional reads, the adapter must document and test their call bound, pagination, and rate-limit behavior; otherwise report reply state as `UNKNOWN`.
- Batch database upserts per provider page. Do not perform a full historical backfill synchronously.
- A future full-history import must be separately specified as asynchronous work with checkpoints, rate limiting, resumability, progress, and partial-failure reporting.
- Persisting metadata does not by itself reduce provider calls: publication listing remains provider-backed in this increment. The database is the durable source for future statistics, not a local-only listing cache.

## 7. Failure Handling

- Provider authorization, permission, rate-limit, unavailable, invalid-response, and unsupported outcomes remain independent per account/video and use stable error codes.
- A provider page failure preserves existing records and does not advance `lastSyncedAt`.
- A repository failure rolls back the page transaction and must not be presented as a successful sync.
- A publication absent from a partial page is not deleted or marked unavailable.
- If the provider cannot identify the connected account owner in a reply, do not persist the reply as creator-authored or infer a replied state.
- A partially available creator-reply result does not invalidate the successfully normalized top-level comments.

## 8. Security, Privacy, and Observability

- Resolve `tenantId` server-side. Scope database identity and all reads/writes by tenant and connected social account.
- Persist normalized provider fields only; do not retain raw provider payloads, access tokens, or video bytes.
- Respect account disconnection cascades and 30-day comment/reply-text expiry. Verify provider terms and data-retention requirements before production use.
- Record synchronization time, platform, account/publication identifiers, page sizes, item counts, duration, and outcome. Do not log comment/reply bodies or secrets.
- Do not send social data directly to JEV. Any later intelligence workflow must use its existing authorized application ports and separate specifications.

## 9. Verification

Use deterministic social-provider and database doubles; no tests call production APIs. The implementation follows Red-Green-Refactor.

- **Unit:** publication normalization, per-page persistence, tenant/account scoping, stable identity, idempotent upsert, cursor preservation, reply-author matching, tri-state reply status, partial failures, and retention.
- **Integration:** PostgreSQL composite keys, foreign-key cascades, batched upsert transaction rollback, duplicate external IDs, and account disconnect cleanup; provider adapters for each platform's supported owner-reply evidence.
- **E2E:** provider page retrieval persists metadata; repeat sync updates the same rows; current-page comment sync persists only top-level comments and direct connected-owner replies; comments/replies load from persistence; provider or persistence failure does not falsely report success; account disconnect removes synchronized rows.
- **Performance checks:** verify database query count is bounded by pages, not individual records, and provider calls do not grow without a documented per-page bound.

## 10. Open Technical Decisions

- Verify provider-specific endpoints/fields that expose creator-authored direct replies, author identity, reply pagination, and live access requirements for YouTube, Instagram, Facebook Pages, and TikTok Business.
- Verify retention/display terms for publication metadata, comment text, and creator-reply text for each provider.
- Determine whether future analytics requires a complete publication-history backfill; this increment intentionally stores only pages the creator has synchronized.
