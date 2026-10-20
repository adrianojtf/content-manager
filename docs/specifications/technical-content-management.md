# Technical Specification — Content Management

**Status:** IAM-04 tenant-scoped Content persistence is implemented. CMS-03 upload/create remains blocked on IAM-07 runtime OIDC configuration; orphan-reconciliation implementation remains open.

**Product PRD:** [Content Management](../product/prds/content-management.md)  
**Existing use-case specification:** [Create Content](content/create-content.md)

## 1. Scope

Implement video upload and creation of a logical `Content` item with editorial metadata, a valid media reference, and draft/ready state. Content owns shared editorial metadata and media references, not destination-specific publication metadata or social API calls.

## 2. Architectural Placement

- **Domain:** `Content` identity and tenant ownership, editorial metadata, draft/ready state, and the invariant that a publishable content item has a valid media reference.
- **Application:** upload/create orchestration, validation, state transitions, and persistence coordination.
- **Ports:** media storage and content repository.
- **Adapters:** S3-compatible object storage, persistence, and HTTP presentation. Provider DTOs and storage implementation details remain outside the domain.

Follow the modular-monolith and hexagonal boundaries in [Architecture](../architecture/architecture.md), [ADR-001](../architecture/decisions/ADR-001-hexagonal-architecture.md), and [ADR-002](../architecture/decisions/ADR-002-modular-monolith.md). User-facing validation outcomes use stable application error codes and semantic message keys; translation belongs to presentation and must not change domain validation behavior. Follow the [localization architecture](../architecture/internationalization.md) and [contract](../contracts/localization.md).

## 3. Logical Data

### Content

- Stable application identifier.
- Required owning `tenantId`, derived from the authenticated principal by application code; it is not accepted from client input.
- Required editorial title and description; each must be non-empty after trimming. No shared character cap is imposed by Content Management.
- Draft/ready state.
- Reference to the stored media asset, represented by the storage-returned object key.

The database stores the logical media reference and editorial metadata. Video bytes are stored through the object-storage adapter, not in the domain model or relational row. Destination-specific title, description, tags, and media eligibility belong to each independent Publication and are specified in [Social Publishing](technical-social-publishing.md).

### Initial PostgreSQL schema

The initial `src/infrastructure/persistence/migrations/001_create_contents.sql` defines `id UUID PRIMARY KEY`, required editorial fields/media key, and `draft`/`ready` status checks. IAM-04 adds required `tenant_id UUID REFERENCES tenants(id)` and a tenant index in `src/infrastructure/persistence/migrations/004_scope_contents_to_tenant.sql`. Repository reads filter by both `tenant_id` and Content ID; writes require the principal-derived tenant ID and reject a conflicting tenant even when the Content ID is known. No automatic tenant backfill is performed: if deployment data exists in the legacy table, it must be explicitly mapped before applying the `NOT NULL` migration. The migration runner/rollback procedure remains open; no ORM is used.

## 4. Application Contracts

```typescript
interface MediaUploadInput {
  key: string;
  body: AsyncIterable<Uint8Array> | Uint8Array;
  contentType?: string;
}

interface MediaReference {
  key: string;
}

interface MediaStorage {
  store(input: MediaUploadInput): Promise<MediaReference>;
}

interface ContentRepository {
  save(tenantId: string, content: Content): Promise<void>;
  findById(tenantId: string, id: ContentId): Promise<Content | null>;
}
```

The storage port receives a stream or byte array and returns a provider-neutral key after successful storage. Bucket and credentials remain in infrastructure configuration. A storage success and returned key are the validity check for Content Management; the content flow does not perform a `HEAD` request or inspect codec, duration, or resolution.

## 5. Flow

The `tenantId` is taken from the authenticated principal by application code. It is not an upload DTO field, and a client-supplied tenant ID is never an authorization source.

1. Receive video bytes, declared `video/*` content type, title, and description through the presentation adapter.
2. Reject absent/empty metadata, a non-video declared media type, or an upload exceeding 5 GB (5,000,000,000 bytes).
3. Stream the bytes directly through the media-storage port using a non-resumable upload; external URL import is not supported.
4. Treat the returned media key as a valid reference and create Content in draft state with a stable identifier.
5. Persist Content through the repository port and return the content identifier and outcome.
6. Allow the creator to manually transition draft to ready or ready back to draft. Editorial metadata changes preserve the current state; only an explicit creator action changes readiness. A transition to ready and any publication request require the valid stored media reference.
7. Validate media and metadata constraints separately for each selected destination in the publication workflow; a blocked destination does not block other destinations.

The 5 GB limit matches the maximum single S3 `PutObject` operation; larger files require a separately specified multipart protocol. No global duration, codec, resolution, or cross-platform intersection rule is applied to a Content master.

## 6. Failure Handling

- Invalid or absent media reference: reject readiness/publication eligibility; do not create publishable Content.
- Tenant scope mismatch: cross-tenant reads return no Content; a write using another tenant's known Content ID is rejected without modifying the original record.
- Invalid metadata, non-video declared content type, or upload over the byte limit: reject before storage with a stable application error code.
- Storage failure: return an application failure and do not persist Content claiming a successful media reference.
- Persistence failure after storage: report failure and leave the stored object for later reconciliation; do not synchronously delete it. The reconciliation mechanism is not part of this task.
- A media or metadata incompatibility for one publication destination blocks only that destination according to the verified platform policy; other destinations remain independent.

## 7. Security and Privacy

- Keep storage credentials and signed access mechanisms in infrastructure/configuration, not in domain entities or logs.
- Do not expose raw provider credentials in media references returned to presentation clients.
- Tenant authorization is required at the application boundary. IAM-04 now scopes every Content repository read/write to the authenticated principal's tenant; the client cannot provide or override that tenant ID.
- Do not log raw media bytes or content; avoid treating client-declared MIME type as proof of codec/container suitability for a destination.

## 8. Observability

Record upload/create outcome, content identifier where available, and failure category. Do not log access tokens, secrets, or raw media contents.

## 9. Verification

Apply Clean Code and TDD (Red-Green-Refactor): write or update a failing test before production changes, implement the smallest suitable change, then refactor with tests green. Every use case requires unit tests; critical user journeys require E2E coverage.

- **Unit:** required metadata, media-reference invariant, draft/ready transitions, and application orchestration with storage/repository ports.
- **Integration:** object-storage adapter writes and returns a usable media key; Content persistence tests prove same-tenant reads/writes and cross-tenant denial; size and declared media-type validation.
- **E2E:** valid streamed upload creates draft Content; missing/invalid media is rejected; storage and persistence failures do not create publishable Content. Use deterministic storage test doubles, not production services.

## 10. Open Technical Decisions

- Deployment and rollback procedure for versioned SQL migrations; IAM-04 defines tenant scoping, and any pre-existing Content rows require explicit tenant mapping before migration 004.
- Mechanism and cadence for orphan reconciliation after persistence failure.
- Byte-level video format inspection, if needed independently of destination-specific validation.
- Exact platform-specific media and metadata requirements; finalize and verify them in SOC-01.
