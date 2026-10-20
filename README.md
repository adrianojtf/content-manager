# Social Video Hub — SDD Starter v2

Private multi-tenant MVP for centralized video publishing, analytics, comments and AI-assisted audience intelligence.

## Core Concept

JEV is not the application's generic AI layer.

JEV is the initial **evaluation and reasoning provider** for:

- comment classification;
- audience reaction analysis;
- response evaluation;
- recurring topic detection;
- audience insights;
- content recommendations.

The application remains responsible for deterministic business rules, permissions, platform capabilities and external side effects.

## Architecture

- Next.js
- NestJS
- TypeScript
- PostgreSQL
- RabbitMQ
- Redis
- S3-compatible object storage
- Hexagonal Architecture
- Modular Monolith
- JEV through an `IntelligenceProvider` port

## Adapter Configuration and Tests

Infrastructure adapters receive configuration at the composition boundary: PostgreSQL uses `pg` pool configuration (normally from `DATABASE_URL`), RabbitMQ connects with `RABBITMQ_URL`, and S3 storage uses a bucket, region, and optional compatible-service endpoint. Auth0 is selected for IAM-07. Set `OIDC_ISSUER` to the exact issuer from Auth0 OIDC Discovery, `OIDC_AUDIENCE` to the registered API identifier, and `OIDC_JWKS_URI` to Discovery's `jwks_uri`; the API expects an access token for that audience, not an ID token, and currently allows `RS256`. The OIDC verifier requires HTTPS outside localhost tests and never logs bearer tokens. The Next.js console will use server-only Auth0 settings (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, and `APP_BASE_URL`) when IAM-06 is implemented. Store client/session secrets, AWS credentials, and connection strings in environment variables or a secret manager; never commit them. See [Auth0 OIDC Discovery](https://auth0.com/docs/get-started/applications/configure-applications-with-oidc-discovery), [JWT access-token validation](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens), and the [Next.js SDK setup](https://auth0.com/docs/quickstart/webapp/nextjs).

`npm test` builds the application and test support, then runs architecture, adapter-integration, and E2E harness tests with deterministic doubles; it does not require or contact production services. The E2E journeys are test-only and exercise Nest HTTP-to-application-to-persistence composition, including authenticated tenant isolation and localization resolution, not production content features. Each RabbitMQ consumer must explicitly choose `requeue` or `reject` on handler failure. Retry limits, backoff, dead-lettering, schemas for other capabilities, migration deployment, and destination-specific media validation remain open decisions in the technical specifications.

## Auth0/OIDC setup guide

For a Portuguese, field-by-field explanation of Auth0 configuration, Discovery metadata, callback/logout URLs, secrets, and initial platform-admin bootstrap, see the [Auth0/OIDC setup guide](docs/auth0-oidc-setup.md).

## Local PostgreSQL

Copy `.env.example` to `.env.local` and adjust `DATABASE_URL` if your local PostgreSQL role requires a username or password. The default URL targets `localhost:5432/content_manager` and uses the local PostgreSQL role selected by `pg`. Start the API with `npm run start:local`; startup checks the connection with `SELECT 1`, and shutdown closes the pool. Migrations are not applied automatically. The Phase 1 pilot uses the reserved local tenant seeded by migration 005 and binds the API to `127.0.0.1`; it needs no OIDC/Auth0 settings. `GET /social/publications` lists connected-account publications; it is empty until an account is connected. `POST /social/accounts/{accountId}/publications/{publicationId}/comments/sync` loads and stores one on-demand comment page; `GET /social/accounts/{accountId}/publications/{publicationId}/comments` returns its persisted comment/reply statuses. `POST /social/workflow-batches` runs sync/classify/generate in scope `comment`, `publication`, `account`, or selected `platform`, serially with an outcome per comment; `sync` cannot use a cross-platform `all` scope; `GET /social/workflow-batches/{batchOperationId}/events` returns grouped audit events. `GET /social/accounts/{accountId}/comments/{externalCommentId}/workflow` returns one comment's history; correction/edit routes append human revisions. Creator-authored response text can be saved independently at `POST /social/accounts/{accountId}/comments/{externalCommentId}/responses/manual` and revised under `/responses/manual/{responseEventId}/revisions`; neither requires comment analysis. AI generation still requires a prior comment analysis. Response evaluation is optional, manually requested at `POST /social/accounts/{accountId}/comments/{externalCommentId}/revisions/{revisionEventId}/evaluation`, and advisory; sending does not require or get blocked by its result. The per-comment `POST .../revisions/{revisionEventId}/send` action sends the exact latest saved response text. `GET/PUT /social/accounts/{accountId}/response-tone` reads or changes that account's AI-response tone profile; updates affect future AI generations only, and generated suggestion events preserve the profile used. The JEV response evaluator is isolated behind a port and reads `JEV_RESPONSE_EVALUATION_URL` lazily; live JEV endpoint/auth/schema remains unverified/open. The CreatorDesk comments frontend is served from `/` by the API and uses the same-origin routes; it shows evaluation as optional when the workflow prerequisites are met. There is no batch-send operation; ambiguous attempts are not retried and the version cannot be sent again. Apply migrations 011–015 before using manual reply sends, reply-status fields, TikTok Business accounts, or account-scoped response tone settings. Linked comment/audit text expires after 30 days.

Create the database if it does not exist:

```sh
createdb --host=127.0.0.1 --port=5432 --username="$USER" content_manager
```

If your PostgreSQL role is `postgres`, use `--username=postgres` instead. For a fresh database, apply the SQL migrations once, in order:

```sh
set -e
set -a
. ./.env.local
set +a
for migration in src/infrastructure/persistence/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
```

If authentication needs a password, use your local `.pgpass` or configure it in your ignored `.env.local`; do not commit credentials.

When connecting social accounts, add `SOCIAL_CREDENTIAL_ENCRYPTION_KEY` to the local secret store or `.env.local`. Generate a 32-byte base64 key with `openssl rand -base64 32`. The key is read only when credentials are stored or resolved, so it is not required for API startup; losing/changing it makes stored credentials unreadable.

Provider OAuth settings are read only when a connection request runs; missing IDs/secrets do not block API startup. Keep all client secrets in the local secret store or ignored `.env.local`, never in the database or API DTOs. `.env.example` lists variable names and local callback paths only.

- **YouTube:** configure `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, and `YOUTUBE_OAUTH_REDIRECT_URI`. Use `GET /social/connections/youtube/authorize` and `/callback`; `enableReplies=true` explicitly requests the broader `youtube.force-ssl` scope. State/PKCE and encrypted token refresh are implemented. Google OAuth verification/test-client approval is still needed for live accounts.
- **Instagram:** configure `INSTAGRAM_OAUTH_CLIENT_ID`, `INSTAGRAM_OAUTH_CLIENT_SECRET`, `INSTAGRAM_OAUTH_REDIRECT_URI`, and `META_GRAPH_API_VERSION`. Use `GET /social/connections/instagram/authorize` and `/callback`. This uses Instagram Login, `instagram_business_basic` and `instagram_business_manage_comments`, and provider-specific long-lived token refresh. Meta live access/App Review remains pending.
- **Facebook Pages:** configure `FACEBOOK_OAUTH_CLIENT_ID`, `FACEBOOK_OAUTH_CLIENT_SECRET`, `FACEBOOK_OAUTH_REDIRECT_URI`, and `META_GRAPH_API_VERSION`. Use `GET /social/connections/facebook/authorize` and `/callback`, then `POST /social/connections/facebook/select` with the callback's `selectionId` and one listed `pageId`. The flow never connects multiple Pages implicitly and stores only the selected Page token. Meta live access/App Review remains pending.
- **TikTok Business:** local OAuth routes are `GET /social/connections/tiktok/authorize` and `/callback`. Configure `TIKTOK_BUSINESS_CLIENT_ID`, `TIKTOK_BUSINESS_CLIENT_SECRET`, `TIKTOK_BUSINESS_REDIRECT_URI`, and the app-generated `TIKTOK_BUSINESS_AUTHORIZATION_URL`; `TIKTOK_BUSINESS_STATE_PARAMETER` defaults to `state`. Tokens/scopes are stored only in the encrypted vault. The documented account-token refresh contract matches the local request, but live app access/refresh verification remains pending. TikTok documents account-token revocation at `/tt_user/oauth2/revoke/`; this app does not expose or call it and never substitutes advertiser-token `/oauth2/revoke_token/`. TikTok for Developers Login Kit and Research API are not substitutes. See the [TikTok integration contract status](docs/integrations/tiktok.md).

## Intelligence Providers

Comment classification uses `JEV_COMMENT_EVALUATION_URL` as the complete HTTPS endpoint. Optionally set `JEV_API_KEY`; the default auth scheme is `Authorization: Bearer`, configurable with `JEV_API_KEY_HEADER` and `JEV_API_KEY_PREFIX`. JEV settings are read only when classification is requested; the actual JEV endpoint/auth contract must be supplied and verified before live calls.

Response suggestions can use Gemini or OpenAI. `GET /ai/response-generation/settings` returns the active provider/model and allowlisted choices; `PUT` accepts only `{ "provider": "google"|"openai", "model": "..." }`. The pilot setting is global; API keys are never stored in this setting and the future `updated_by_admin_user_id` association is reserved for Phase 3. These local, unauthenticated settings endpoints are available only while the API is bound to `127.0.0.1`.

The selector currently offers `google/gemini-3.5-flash-lite` and `openai/gpt-6-luna`; model choice is persisted by `GET/PUT /ai/response-generation/settings`. Gemini requires `GEMINI_API_KEY` and an explicit `GEMINI_DATA_USE_POLICY=free-tier-acknowledged` or `paid-tier`. Google's Free tier currently charges no input/output token fees for eligible models but may use submitted content to improve Google products. OpenAI requires `OPENAI_API_KEY` and GPT-6 Luna is billed by token, not free. Verify current pricing/data terms before sending real comment or response text. Provider keys are read only on an explicit generation request; neither provider configuration is required for API startup. The global provider/model selector remains API-only; the CreatorDesk comments frontend does not change it.

## CreatorDesk Comments Frontend

The API serves the CreatorDesk comments interface from `web/` at `/` on the same loopback origin. It uses the community API routes directly: publication listing and pagination, on-demand comment sync, per-comment classification/generation, account response tone, append-only response revisions, optional response evaluation, and explicit per-comment send. Network batches show their independent outcomes and never send replies. The frontend does not include sample social content or fake provider results; it presents loading, empty, unsupported, and failure states from the API. User-facing copy uses semantic keys with the current `pt-BR` catalog; authenticated user/tenant locale resolution remains deferred to FND-04. The screen operates on accounts already connected through the OAuth API; social account authorization and Facebook Page selection remain outside this screen.

## Phase 1 Community Workflow

```text
List Existing Publications
   ↓
Creator Requests Comment Sync (one video or selected/all)
   ↓
Classify Each Comment with JEV (one, one video, or selected/all)
   ↓
Optionally Correct JEV Labels/Scores (append-only audit)
   ↓
Generate One Gemini Flash-Lite Suggestion per Comment
   ↓
Creator Reviews and Edits (AI and manual revisions retained)
   ↓
Evaluate the Final Revision with JEV
   ↓
Creator Manually Sends Each Reply Separately
```

Every batch action tracks independent per-comment outcomes. A batch never sends replies. Analytics/dashboard and video publishing remain later roadmap phases.

## Current Community API Slice

1. Connect supported social accounts through their independent OAuth API flows.
2. List existing publications and on-demand comments across supported networks.
3. Classify a selected comment through JEV and request a response suggestion in an explicit language.
4. Review append-only workflow history, correct JEV labels/scores, and save manual or edited response revisions.
5. Optionally evaluate the final saved revision and manually send it per comment; evaluation remains advisory.
