# Create Content

## Goal

Create a logical content item that can later be published independently to selected platforms.

## Input

- Editorial title and description.
- A streamed video declared as `video/*`, no larger than 5 GB (5,000,000,000 bytes).
- Authenticated tenant context; tenant ID is resolved server-side and is not part of client input.

## Flow

1. Validate required metadata, declared media type, and byte limit.
2. Stream the video to object storage using the non-resumable upload path.
3. Treat the returned media key as the valid media reference.
4. Persist Content with a stable identifier and draft state.
5. Return the content identifier and media reference.

## Acceptance Criteria

- [ ] Title and description are required and non-empty after trimming.
- [ ] External URL import and resumable upload are not supported.
- [ ] Media reference is mandatory and is considered valid only after successful storage returns its key.
- [ ] Uploads accept declared `video/*` media types up to 5 GB (5,000,000,000 bytes); platform-specific codec, duration, resolution, and metadata limits are evaluated per Publication.
- [ ] Content receives a stable identifier and starts in draft.
- [ ] The creator can manually move Content between draft and ready; ready and publication both require a valid stored media reference.
- [ ] A storage failure does not persist Content; persistence failure after successful storage reports failure and leaves the object for later reconciliation, without synchronous deletion.
- [ ] Destination-specific title, description, and tags are independent publication metadata and do not overwrite Content's editorial metadata.
- [ ] Content stores the authenticated tenant ID; a client-supplied tenant ID is never used to scope persistence.
