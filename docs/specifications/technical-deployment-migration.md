# Technical Specification — Two-Phase Deployment and Cloud Migration

**Status:** Accepted deployment direction. The initial VM provider, cloud provider, region, production SLO, and managed-service selection remain open.

- **Product source:** [MVP PRD](../product/prd.md)
- **Architecture:** [Architecture](../architecture/architecture.md) · [ADR-002 — Modular Monolith](../architecture/decisions/ADR-002-modular-monolith.md)
- **Decision:** [ADR-007 — Two-Phase Deployment and Cloud Portability](../architecture/decisions/ADR-007-deployment-portability.md)

## 1. Goals

- Deploy the existing NestJS application and PostgreSQL on a single Linux VM using Docker Compose for a restricted pilot.
- Keep business rules independent of the host and cloud provider so the same containerized application can move to managed cloud compute later.
- Define the data, security, operations, and rollback work required for each migration phase.
- Do not expose the current unauthenticated pilot as a public multi-tenant service.

## 2. Non-Goals

- High availability or horizontal scaling in Phase 1.
- Selecting AWS, GCP, Azure, or another provider for Phase 2.
- Introducing Kubernetes, microservices, a queue broker, or Redis before workload requirements justify them.
- Automatically applying SQL migrations at application startup.
- Changing social-provider, AI, publication, or response-sending behavior.

## 3. Phase 1 — Docker on a Single VM

### 3.1 Runtime

- Build the NestJS HTTP application as an OCI-compatible Docker image. The image contains production dependencies, compiled `dist/` output, and the static `web/` assets required by `mountCreatorDeskFrontend`.
- Run the application as a non-root user. Do not include `.env` files, certificates, API keys, OAuth secrets, database credentials, or encryption keys in the image or build context.
- `HOST` is configurable at runtime. Its default remains `127.0.0.1` for local use; the VM container sets it to `0.0.0.0` on the private Docker network.
- `PORT` remains configurable. The application port is exposed only to the reverse-proxy and database networks; the host publishes HTTP/HTTPS only through the reverse proxy.
- The API container is stateless. Local files are not an application data store. OAuth flow state remains a known limitation until it is moved to shared persistence.

### 3.2 Compose topology

The Phase 1 Compose deployment contains:

- `app`: the NestJS application and static CreatorDesk UI;
- `postgres`: a separate PostgreSQL container with a named persistent volume and a health check;
- `caddy`: HTTPS termination and reverse proxy to `app`.

PostgreSQL has no published host port. It is reachable only on the private Compose database network. Caddy can reach the API but not PostgreSQL. The VM firewall restricts inbound access to the reverse-proxy ports and operator access.

The pilot has one VM and one PostgreSQL failure domain. A host, disk, or zone failure can make both application and database unavailable. This limitation must be communicated to pilot operators and is not an availability guarantee.

### 3.3 Access and secrets

- Phase 1 is limited to a trusted pilot audience through a VPN, source-IP allowlist, or equivalent access boundary. Caddy provides TLS but does not provide product-user authentication.
- Product-user authentication and tenant authorization must be integrated before the product is exposed as a public multi-tenant service, as required by the PRD.
- Runtime configuration is supplied from files outside the repository with restrictive host permissions or an equivalent host secret mechanism. Secrets are not passed as Docker build arguments.
- PostgreSQL data backups are encrypted and stored off the VM. The credential-encryption key is recovered separately and must never be bundled with database backups.
- Operators verify backup restoration before relying on the deployment for creator or tenant data.

### 3.4 Database and release operations

- PostgreSQL data is stored in a named volume, not in the writable layer of either container.
- SQL migrations remain explicit, ordered deployment steps. Application startup does not run them automatically.
- Before a schema-changing release, operators take and verify a database backup and confirm that the release can be rolled back or that a forward-fix plan exists.
- The released application image is tagged immutably. Deployment records the image tag, migration range, and rollback image.

## 4. Phase 2 — Managed Cloud Services

Phase 2 keeps the modular monolith and chooses one cloud provider for each deployment. The same OCI packaging is reused; Docker Compose is replaced by provider-specific deployment configuration.

The target service categories are:

| Capability | GCP example | AWS example |
| --- | --- | --- |
| Container runtime | Cloud Run | ECS/Fargate |
| PostgreSQL | Cloud SQL | RDS for PostgreSQL |
| Object storage | Cloud Storage | S3 |
| Secrets and key management | Secret Manager and Cloud KMS | Secrets Manager and KMS |
| Logs and metrics | Cloud Logging/Monitoring | CloudWatch |
| Asynchronous work, when specified | Cloud Tasks or Pub/Sub | SQS or a managed RabbitMQ service |

The provider is not selected by this specification. Region, cost, data residency, SLO, RTO/RPO, service limits, and operational skills are resolved in a separate provider ADR before provisioning.

### 4.1 Application boundaries

- Cloud SDKs and provider-specific resource identifiers stay in infrastructure adapters and deployment configuration; domain and application contracts remain provider-neutral.
- PostgreSQL remains the relational engine. Provider-specific database extensions or SQL are introduced only through an ADR and migration plan.
- The Auth0/OIDC application contract remains independent of the hosting provider.
- Object-storage references persisted by the application are logical keys, not provider credentials or public URLs.
- The API scales horizontally only after in-memory request/OAuth state has been externalized and database connection budgets are bounded.
- A worker may be deployed separately from the same codebase and image when asynchronous workload specifications are accepted. It is not automatically a separate microservice.
- Queue selection and delivery guarantees are defined in a separate job-processing specification before a broker is introduced.

### 4.2 Migration procedure

1. Select the cloud, region, access model, production SLO, RTO/RPO, and monthly cost envelope.
2. Provision isolated environments and network boundaries with reviewed infrastructure as code.
3. Publish an immutable application image and provide runtime configuration through the cloud secret mechanism and workload identity.
4. Restore a Phase 1 database backup into managed PostgreSQL; verify schema, row counts, tenant isolation, credential decryption, and application smoke tests.
5. Copy object data if Phase 1 stored any media outside PostgreSQL, preserving keys and access controls.
6. Update DNS/TLS and registered social-provider OAuth callback URLs. Reconfigure provider credentials and rotate keys where required.
7. Freeze writes or use a separately approved replication/cutover method, switch traffic, and monitor the release.
8. Keep the Phase 1 deployment and verified backup available until the rollback window closes. Define how writes made after cutover are reconciled before rollback.

## 5. Verification and Acceptance Criteria

### Phase 1

- A production image builds from the repository without copying local environment files, certificates, or secrets.
- The application serves both its HTTP routes and static frontend from the image.
- The local default bind remains loopback-only; the Compose runtime explicitly binds the application inside the container network.
- Compose configuration has health checks for PostgreSQL and the application; PostgreSQL is not published to the host.
- The database volume survives container replacement, and the documented off-host backup can be restored.
- Pilot access restrictions are verified before enabling the public DNS route.
- Product-user authentication remains a release gate for public multi-tenant access.

### Phase 2

- The application deploys from a versioned image without requiring a provider-specific domain or database type in the domain/application layers.
- Cloud-specific adapters pass the same port contract tests as the Phase 1 adapters.
- Managed PostgreSQL backup/restore and application rollback have been rehearsed in the target region.
- Secret delivery, key rotation/recovery, OAuth callback URLs, and tenant-isolation smoke tests are verified before traffic cutover.
- A second cloud is not provisioned solely to claim portability; portability is verified through adapter contracts, documented data migration, and a tested restore/cutover plan.
