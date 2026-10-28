# Docker VM Pilot Runbook

This runbook deploys the current modular monolith on one Linux VM. It is for a restricted pilot, not a public multi-tenant production launch.

## 1. Prepare the VM

- Create a supported Linux VM with Docker Engine and the Docker Compose plugin.
- Point the chosen DNS name to the VM before requesting a certificate.
- Restrict SSH to operator access. Configure ingress so the required ACME challenge can reach Caddy on port 80 while application traffic on port 443 remains behind the trusted access boundary. If the selected access boundary blocks HTTP-01 validation or renewal, select and test a compatible DNS challenge or managed access-proxy approach before deployment. Do not expose PostgreSQL.
- Create `/etc/content-manager/` and copy the four `ops/docker-vm-*.env.example` files there as `compose.env`, `app.env`, `postgres.env`, and `caddy.env`.
- Replace all example values. Use a URL-safe random database password in both `app.env` and `postgres.env`; copy any required social-provider variables from the root `.env.example` into `app.env`. Store the credential-encryption key separately from database backups.
- Set the environment files to owner-only read/write access. Keep them outside the repository.

## 2. Validate and start

Run these commands from the repository root on the VM:

```sh
docker compose --env-file /etc/content-manager/compose.env -f ops/docker-vm.compose.yaml config --quiet
docker compose --env-file /etc/content-manager/compose.env -f ops/docker-vm.compose.yaml build app
docker compose --env-file /etc/content-manager/compose.env -f ops/docker-vm.compose.yaml up -d postgres
```

Before the first application start, apply the ordered SQL migrations once. The repository has no migration-history runner, so check the deployment record and run one unapplied migration at a time. Replace the placeholder below with the next verified migration; do not rerun an already-applied migration:

```sh
MIGRATION=src/infrastructure/persistence/migrations/REPLACE_WITH_NEXT_UNAPPLIED.sql
test -f "$MIGRATION"
docker compose --env-file /etc/content-manager/compose.env -f ops/docker-vm.compose.yaml \
  exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$MIGRATION"
```

Record each successful migration before applying the next. The application does not run migrations at startup.

After migrations:

```sh
docker compose --env-file /etc/content-manager/compose.env -f ops/docker-vm.compose.yaml build app
docker compose --env-file /etc/content-manager/compose.env -f ops/docker-vm.compose.yaml up -d
docker compose --env-file /etc/content-manager/compose.env -f ops/docker-vm.compose.yaml ps
docker compose --env-file /etc/content-manager/compose.env -f ops/docker-vm.compose.yaml logs --tail=100 app caddy postgres
```

The first command uses the repository Dockerfile. For later releases, record the Git revision and resulting image tag; use the same immutable tag for rollback. The reverse proxy needs working DNS and outbound access to the certificate authority.

## 3. Access and OAuth

- Caddy terminates TLS and forwards requests to the private API container. Caddy does not authenticate users.
- Keep the trusted-network firewall rule in place. The application still uses the local pilot tenant and does not have product-user authentication wired into the production HTTP composition.
- Test each social-provider OAuth round-trip from a browser connected to the allowed network. The provider redirects the browser to the registered callback URL.
- The application binds to `0.0.0.0` only inside the Docker network in this Compose deployment. The API port is not published on the VM host.
- OAuth state is currently process-local. A VM restart can invalidate an in-progress authorization flow; complete or restart such a flow after maintenance.

## 4. Backups and recovery

- Back up PostgreSQL using `pg_dump` or an approved physical-backup procedure, encrypt the backup, and transfer it off the VM. A VM disk snapshot alone is not a verified database backup.
- Keep the `SOCIAL_CREDENTIAL_ENCRYPTION_KEY` recovery material separately in a restricted secret store. Without the matching key, encrypted social credentials cannot be decrypted after restore.
- Record backup time, database migration range, application image tag, and key version.
- Perform a restore rehearsal before storing important creator or tenant data.
- A VM or local disk failure takes down the API and database together. Restore to a replacement VM and validate the database, credentials, DNS/TLS, and provider callbacks before reopening access.

## 5. Release and rollback

1. Back up the database and record the current image tag.
2. Review and apply only the new ordered SQL migrations.
3. Build and start the new image; verify container health, the UI, database connectivity, and one controlled provider workflow.
4. If the release fails, restore the previous image only when the schema remains backward-compatible. If a migration is not backward-compatible, follow its documented forward-recovery plan; do not assume that rolling back the container reverses the database.
5. Keep the VM, off-host backup, encryption key, image tag, and DNS values available until the rollback window closes.

## 6. Phase 2 cloud migration inputs

Do not treat this single-host Compose deployment as the cloud architecture. Before provisioning managed cloud services, decide the provider and region, public-access/authentication model, availability target, RTO/RPO, connection budget, and data-retention requirements. Then rehearse PostgreSQL restore/cutover, copy object data if present, reconfigure secrets and OAuth callback URLs, and test rollback.
