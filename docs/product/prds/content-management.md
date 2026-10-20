# PRD — Content Management

**Status:** Draft — tenant-scoped persistence is implemented; the upload/create use case and orphan-reconciliation execution remain technical work.  
**Tech spec:** [Technical Specification — Content Management](../../specifications/technical-content-management.md)

## 1. Objective

Allow the creator to create and maintain a logical video content item that can be published independently to supported social accounts.

## 2. User and Problem

**Primary user:** a creator operating within an authorized tenant.

The creator needs one place to register a video and its editorial metadata before preparing platform-specific publications.

## 3. MVP Scope

- Stream-upload a video and create a logical content item for it.
- Require editorial title and description on the Content item.
- Associate a media reference returned after successful object storage.
- Keep the content in a draft or ready state with creator-controlled transitions.
- Keep destination-specific title, description, and tags on each Publication, separate from Content metadata.

## 4. Requirements

### CM-01 — Upload and create content

The creator can stream-upload a video declared as `video/*`, up to 5 GB (5,000,000,000 bytes), and create a content item with a stable identifier and a media reference returned by successful storage. The upload is not resumable and does not import external URLs. Content has no global duration, codec, or resolution limit; those are validated for each publication destination.

### CM-02 — Maintain metadata

Content has required, non-empty editorial title and description. Each selected publication destination has its own title, description, and tags where supported; those values are initially copied from Content and can be edited independently.

### CM-03 — Manage readiness

New Content starts in draft. The creator can manually move it between draft and ready. Editing editorial metadata does not change readiness; only an explicit creator action changes state. A content item without a media reference returned from successful storage cannot be ready or published.

### CM-04 — Preserve media reference

The application stores a reference to the media asset; it does not require full video editing as part of this capability.

## 5. Acceptance Criteria

- [ ] Upload accepts a declared `video/*` media type up to 5 GB (5,000,000,000 bytes) using a direct, non-resumable stream; external URL import is not supported.
- [ ] Content title and description are required and non-empty after trimming; Content metadata is independent from destination metadata.
- [ ] A successful storage result supplies the media key considered valid by Content Management; codec, duration, resolution, and platform eligibility are not globally inferred by Content Management.
- [ ] Creating Content returns a stable identifier and starts in draft.
- [ ] Content belongs to the authenticated tenant; tenantId is resolved server-side, never supplied by the client.
- [ ] The creator can manually transition draft to ready and ready back to draft; editorial metadata edits preserve readiness, and ready requires a valid stored media reference.
- [ ] Each selected destination has independent title, description, tags where supported, and media/capability validation; one incompatible destination does not prevent other destinations from being processed.
- [ ] If content persistence fails after storage succeeds, report failure and leave the stored object for later reconciliation; do not synchronously delete it.
- [ ] Content without a valid media reference or ready state cannot proceed to publication.

## 6. Out of Scope

- Resumable uploads and external URL import.
- Global codec, duration, resolution, or cross-platform media intersection validation.
- Full video editing.
- Billing and advanced RBAC.

## 7. Dependencies

- Media storage/reference mechanism.
- Publication capability validation.

## 8. Open Questions

- SQL migration deployment/rollback process and explicit tenant mapping for any records predating IAM-04.
- How the later orphan-reconciliation process discovers and resolves stored objects whose Content persistence failed.
- Exact media constraints and required metadata fields for each platform operation; these are owned by the Social Publishing PRD and SOC-01.
