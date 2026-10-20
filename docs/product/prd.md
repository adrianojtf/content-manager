# MVP PRD

## 1. Objective

Deliver the product incrementally, starting with a focused creator workflow: list existing publications and their comments from connected social platforms, generate and edit suggested replies, and let the creator send each reply manually. Dashboard, product-user authentication, video publishing, and any streaming product are later phases.

## 2. MVP Capabilities

The first MVP is a controlled, single-creator pilot without public multi-tenant access or product-user login. Social account authorization remains required: each supported platform must be connected through its own approved authorization flow so the application can read publications/comments and send replies. This defers product-user authentication, not platform OAuth, access-token protection, or platform permission checks. Tenant identity and isolation contracts remain the target for the later authentication phase; the pilot must not be exposed as a public multi-user service.

### Publications and Community — Phase 1

- Connect supported social accounts using platform authorization.
- List existing publications and their comments where the platform permits.
- Generate a suggested response to a comment.
- Let the creator edit the suggestion before sending.
- Require an explicit manual send action for every response; no automatic replies.
- Report unsupported capabilities and per-platform failures without implying feature parity.

### Dashboard — Phase 2

- Build the manually fed Novelaria dashboard described in the [Analytics PRD](prds/analytics.md).
- Keep analytics entry separate from social API synchronization unless a later scope explicitly adds it.

### Product-user Authentication — Phase 3

- Add managed OIDC login, tenant membership, administration, and tenant isolation for a multi-user service.
- Authentication and access control must be completed before opening the product to multiple users or tenants.

### Video Publishing — Phase 4

- Upload video and manage content metadata.
- Publish to independently supported platforms and track each publication result.
- Scheduling, retry, and multi-platform publishing are included only after platform-specific capabilities and policies are verified.

### Future Exploration — Vertical-Drama Streaming

- After consolidating the preceding product phases, evaluate the feasibility of a vertical-drama streaming platform.
- Potential creator subscriptions may apply to a channel, playlist, or series/novel; this is discovery only, not committed MVP scope.

### Future Capability — Audience Intelligence

After the core phases are consolidated and separately prioritized, JEV may evaluate comments to identify:

- sentiment;
- emotion;
- intent;
- topic;
- character/theme;
- questions;
- requests;
- complaints;
- spam;
- toxicity;
- recurring patterns;
- engagement opportunities.

### Future Capability — Content Intelligence

When separately prioritized, aggregate comment analysis and performance data to produce:

- audience insights;
- recurring themes;
- content opportunities;
- recommendations for future episodes/videos;
- potential issues;
- engagement opportunities.

## 3. AI Safety Boundary

The MVP must distinguish:

```text
AI Analysis
    ↓
AI Recommendation
    ↓
Deterministic Decision Rules
    ↓
External Action
```

JEV must not directly publish comments or modify social accounts.

## 4. Platform Scope by Phase

- The active MVP targets YouTube, Instagram professional Business/Creator accounts, Facebook Pages managed by the authorizing user, and TikTok Business accounts for comment workflows. Each platform must pass its own account, permission, access-tier, and operation-capability checks; TikTok scope is owned organic videos only.
- TikTok comment integration is limited to authorized TikTok Business accounts and owned organic videos, subject to current API access/permission verification. TikTok video publishing remains out of scope; manual TikTok analytics entry belongs to Phase 2.
- Video publishing capabilities are Phase 4, not part of the Phase 1 reply workflow.

Platform capabilities are independent. Validate each operation against current official requirements and never assume capability parity. The analytics PRD separately defines the platform scope for the manually fed Phase 2 dashboard.

## 5. Capability PRDs

- [Content Management](prds/content-management.md) — [Tech spec](../specifications/technical-content-management.md)
- [Social Accounts and Publishing](prds/social-publishing.md) — [Tech spec](../specifications/technical-social-publishing.md)
- [Publication Analytics](prds/analytics.md) — [Tech spec](../specifications/technical-analytics.md)
- [Community Management](prds/community-management.md) — [Tech spec](../specifications/technical-community-management.md)
- [Audience and Content Intelligence](prds/audience-intelligence.md) — [Tech spec](../specifications/technical-audience-intelligence.md)
- [MVP implementation backlog (epics and tasks)](implementation-backlog.md)

## 6. Non-Goals

For Phase 1, exclude:

- product-user login, public multi-user access, and tenant administration;
- dashboards and analytics;
- video upload and publishing;
- automatic reply sending;
- billing, microservices, Kubernetes, advanced RBAC, full video editing, and advertising management.

A future vertical-drama streaming service, including subscriptions for channels, playlists, or series, remains exploratory and is not committed scope.

## 7. Success Criteria

For Phase 1, the creator can:

1. Connect a supported social account with the platform's approved authorization flow.
2. View the account's existing publications and available comments.
3. Generate a suggested response to a comment.
4. Edit the suggestion and see the final text before sending.
5. Manually send the response with an explicit action and see success, failure, or unsupported status.

No response is sent automatically. Dashboard/analytics, user login, and video publishing are delivered only in their later phases.
