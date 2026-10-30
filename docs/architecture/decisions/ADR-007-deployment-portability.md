# ADR-007 — Two-Phase Deployment and Cloud Portability

## Status

Accepted for the deployment direction. VM provider, cloud provider, region, SLO, and managed-service selection remain open.

## Context

The product needs a low-cost, low-operations path for a restricted pilot while preserving a practical route to horizontally scalable managed cloud services. Hexagonal architecture provides adapter boundaries, but it does not remove operational or data migration work.

## Decision

1. **Phase 1:** run the existing modular monolith on one Linux VM with Docker Compose. The Compose topology uses a reverse proxy, one API container, and a separate PostgreSQL container with persistent storage. PostgreSQL is private to the Compose network; backups are encrypted and stored off-host.
2. Keep the application image OCI-compatible and the application stateless. Use explicit environment configuration, standard PostgreSQL, logical object references, and provider-neutral application ports.
3. Phase 1 requires a custom domain, a trusted HTTPS certificate, Auth0 OIDC login federated through Google, and an explicitly provisioned pilot identity. VPN/source-IP restrictions are defense-in-depth, not a substitute for application authentication. TLS at the reverse proxy is not authentication.
4. The Phase 1 application maps the Auth0 `(issuer, subject)` to a local identity and pilot-tenant membership. The BFF validates Auth0-issued tokens to establish a server-side session; API routes authorize the server-resolved principal and do not trust Google tokens or caller-supplied tenant IDs.
5. Public multi-tenant access, self-service registration, tenant administration, and platform-admin provisioning remain blocked until the Phase 3 identity/administration journeys pass.
6. **Phase 2:** migrate to managed cloud compute, PostgreSQL, secrets/key management, observability, and object storage as needed. Select one provider and region through a separate ADR based on cost, geography, SLO, RTO/RPO, and team capability.
7. Preserve the modular monolith. A worker may be deployed independently from the same codebase when asynchronous workflows are specified. Do not introduce microservices, Kubernetes, Redis, or a broker solely for portability.
8. Provider-specific adapters and infrastructure are allowed. The goal is a small, testable application change and a rehearsed data migration—not zero provider-specific configuration or active-active multi-cloud.

## Consequences

- Phase 1 is a single failure domain and has no horizontal scaling or high-availability guarantee. Its Auth0 login and API authorization must be implemented before any remote deployment.
- A managed-cloud migration still requires database and object-data transfer, secret/key handling, IAM/network configuration, OAuth callback updates, and a traffic cutover/rollback plan.
- Cloud-provider selection and provider-specific infrastructure as code are deferred until region, workload, cost, and availability requirements are defined.
- Existing cloud-specific adapters remain isolated in infrastructure; each alternative adapter must satisfy the same application contract tests.
