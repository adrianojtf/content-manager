# ADR-006 — Tenant Identity and Access

## Status

Accepted

## Context

The MVP is multi-tenant. Tenant isolation applies to product data, connected social accounts, and media assets. At the time of this decision, identity and authenticated request context were not implemented; IAM-02 through IAM-04 now establish identity, preference persistence, and tenant-scoped Content storage.

## Decision

- A user belongs to exactly one tenant in the MVP; tenant switching and multi-tenant memberships for one user are not supported.
- Authentication uses a managed OpenID Connect provider. The application maps an identity by the stable `(issuer, subject)` pair, not email.
- Tenant roles are `OWNER` and `MEMBER`. Each tenant has exactly one `OWNER`; Owners administer tenant settings and memberships and have member capabilities, while Members operate product workflows. Ownership must be transferred before the Owner is removed or demoted.
- A separate `PLATFORM_ADMIN` role provisions tenants and their initial owners through a web console. Platform-admin grants are controlled operationally and are not self-service. Tenant owners manage memberships for provisioned users.
- Authenticated requests derive `userId`, `tenantId`, and role from server-side identity/membership records. A client-supplied tenant ID is never an authorization source.
- Every tenant-owned persistence query, background job, connected account, publication, and media asset is scoped to the resolved tenant.

## Consequences

IAM-02/03 implement local identities, tenant memberships, platform-admin grants, and preference persistence; IAM-04 scopes Content to its tenant. Product workflows remain unavailable until their use cases are implemented. Auth0 is selected, while deployment-specific OIDC values and lifecycle/bootstrap details remain open; the application contract stays provider-neutral.