# ADR-008 — Phase 1 Authenticated Browser Session

## Status

Accepted design recommendation. Runtime implementation remains pending IAM-08.

## Context

The remote Docker pilot must authenticate the creator with Auth0, federating Google, while retaining the current same-origin CreatorDesk and supporting social-provider OAuth redirects. A browser-held bearer token or an edge-only password gate does not provide the required server-resolved user and tenant context.

## Decision

- Implement a same-origin, server-side BFF/session in the existing NestJS application. Do not add a separate Next.js service solely for Phase 1 login.
- Use Auth0 OpenID Connect authorization-code flow with PKCE. Google is an Auth0 federated connection; the application accepts Auth0-issued identity/access tokens only.
- Provision the pilot identity explicitly by the immutable `(issuer, subject)` pair and map it to the local pilot user and tenant membership. Do not auto-register users or authorize by email alone.
- Give the browser an opaque session cookie with `Secure`, `HttpOnly`, and `SameSite=Lax`. Store session state server-side with expiration and revocation; do not store OIDC tokens in browser `localStorage`.
- Protect state-changing cookie-authenticated requests against CSRF. Resolve the application principal and tenant from the server-side session and local identity records.
- Bind each social-provider OAuth flow to the authenticated user and tenant with single-use, expiring state. The callback returns through the same HTTPS origin and must not bypass the authenticated browser session.
- Keep VPN/source-IP restrictions as defense-in-depth. Caddy terminates TLS but is not the authentication or authorization boundary.
- Public registration, tenant switching, tenant administration, and `PLATFORM_ADMIN` provisioning remain Phase 3 scope.

## Consequences

- IAM-08 must implement the BFF/session routes, server-side session persistence, API guards, login/logout UI, CSRF controls, and social-callback binding before the remote VM pilot.
- The exact Auth0 callback/logout paths are registered only after the routes and chosen maintained OIDC library are implemented.
- Session state must be shared across API instances before horizontal scaling. PostgreSQL is the Phase 1 store; a later cloud deployment can keep it on managed PostgreSQL.
- This decision does not make the current HTTP composition authenticated. The Docker VM deployment remains blocked until IAM-08 tests pass.
