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

### Como executar localmente

Requisitos: Node.js 20.6 ou superior, npm e PostgreSQL local em execução. No terminal, na raiz do repositório:

```sh
npm ci
cp .env.example .env.local
```

Se necessário, edite `DATABASE_URL` em `.env.local` para informar usuário e senha. O valor padrão usa `localhost:5432/content_manager` e o usuário local do PostgreSQL. Crie o banco:

```sh
createdb --host=127.0.0.1 --port=5432 --username="$USER" content_manager
```

Se seu usuário PostgreSQL for `postgres`, substitua `"$USER"` por `postgres`. Aplique as migrações uma única vez, em ordem, para um banco novo:

```sh
set -e
set -a
. ./.env.local
set +a
for migration in src/infrastructure/persistence/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
```

Inicie a API e a interface CreatorDesk:

```sh
npm run start:local
```

Abra `http://127.0.0.1:3000` no navegador. O servidor fica acessível apenas nesta máquina; encerre-o com `Ctrl+C`. As configurações OAuth e as chaves dos provedores de IA são opcionais para iniciar a aplicação. Para executar a suíte automatizada (não requer serviços externos nem banco de dados de produção), use `npm test` em outro terminal.

### HTTPS local para OAuth do Instagram

O Instagram pode recusar o cadastro de callbacks HTTP. Para usar `https://localhost:3000/social/connections/instagram/callback` sem expor a API na rede, gere um certificado local com SAN para `localhost` caso ainda não tenha um (na raiz do projeto):

```sh
mkdir -p ops/local-https/certs
(umask 077; openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout ops/local-https/certs/localhost.key.pem \
  -out ops/local-https/certs/localhost.crt.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1")
```

Os arquivos em `ops/local-https/certs/` são ignorados pelo Git. O navegador deve confiar no certificado autossinado (ou ter uma exceção local) antes de completar o OAuth; não desabilite a verificação TLS global. Em `.env.local`, configure somente os caminhos e o callback, sem compartilhar credenciais:

```dotenv
PORT=3000
LOCAL_HTTPS_KEY_PATH=ops/local-https/certs/localhost.key.pem
LOCAL_HTTPS_CERT_PATH=ops/local-https/certs/localhost.crt.pem
INSTAGRAM_OAUTH_REDIRECT_URI=https://localhost:3000/social/connections/instagram/callback
```

Cadastre exatamente o mesmo callback em **Instagram Login → Business Login settings → Valid OAuth Redirect URIs**, reinicie com `npm run start:local` e abra `https://localhost:3000/` (não `http` nem `127.0.0.1`). O popup OAuth exige que interface e callback tenham a mesma origem. Antes de conectar outras redes a partir dessa interface, registre e configure os callbacks HTTPS correspondentes também. Sem os dois caminhos TLS, o servidor continua em HTTP; com apenas um, falha ao iniciar. O HTTPS local continua vinculado a `127.0.0.1`, não adiciona login de usuário e não pode ser usado simultaneamente com o proxy LAN existente, que espera HTTP em `127.0.0.1:3000`. O certificado local não substitui as aprovações da Meta.

The Phase 1 pilot uses the reserved local tenant seeded by migration 005 and binds the API to `127.0.0.1`; it needs no OIDC/Auth0 settings. `GET /social/publications` lists connected-account publications and persists metadata for each successfully fetched page; it does not backfill unrequested history or download video files. `POST /social/accounts/{accountId}/publications/{publicationId}/comments/sync` loads and stores one on-demand comment page, including only direct replies reliably attributed to the connected account owner; `GET /social/accounts/{accountId}/publications/{publicationId}/comments` returns persisted comments and creator replies. `POST /social/workflow-batches` runs sync/classify/generate in scope `comment`, `publication`, `account`, or selected `platform`, serially with an outcome per comment; `sync` cannot use a cross-platform `all` scope; `GET /social/workflow-batches/{batchOperationId}/events` returns grouped audit events. `GET /social/accounts/{accountId}/comments/{externalCommentId}/workflow` returns one comment's history; correction/edit routes append human revisions. Creator-authored response text can be saved independently at `POST /social/accounts/{accountId}/comments/{externalCommentId}/responses/manual` and revised under `/responses/manual/{responseEventId}/revisions`; neither requires comment analysis. AI generation still requires a prior comment analysis. Response evaluation is optional, manually requested at `POST /social/accounts/{accountId}/comments/{externalCommentId}/revisions/{revisionEventId}/evaluation`, and advisory; sending does not require or get blocked by its result. The per-comment `POST .../revisions/{revisionEventId}/send` action sends the exact latest saved response text. `GET/PUT /social/accounts/{accountId}/response-tone` reads or changes that account's AI-response tone profile; updates affect future AI generations only, and generated suggestion events preserve the profile used. `GET/PUT /social/accounts/{accountId}/verified-release-schedule` reads or explicitly confirms that account's weekly release schedule as response context; it is not a scheduler and never sends responses. The TypeSafe Jev evaluator is isolated behind an application port and uses the documented System One contract; live credit-backed smoke testing remains opt-in. The CreatorDesk comments frontend is served from `/` by the API and uses the same-origin routes; it shows evaluation as optional when the workflow prerequisites are met. There is no dedicated batch-send endpoint: the semi-automatic dialog invokes the existing per-comment send route sequentially only for individually approved responses after a final confirmation; it continues after individual failures, stops on provider rate limits, and never retries ambiguous attempts. Apply migrations 011–019 in order before using comment sync, comment likes, manual reply sends, reply-status fields, synchronized publication metadata, creator replies, TikTok Business accounts, account-scoped response tone settings, Preferences-managed AI credentials, or verified release schedule settings. Linked comment/audit text expires after 30 days.

### Optional LAN access through Nginx

The API stays bound to `127.0.0.1`. On Linux, an optional Nginx container can listen on the LAN and proxy requests to that loopback API. The proxy is separate from the API, so it can be started and stopped independently:

1. Choose a stable LAN hostname that resolves to this machine on the other device(s), and create a TLS certificate whose Subject Alternative Name includes that hostname. The certificate must be trusted by the client browser. Place the full chain at `ops/lan-proxy/certs/fullchain.pem` and the private key at `ops/lan-proxy/certs/privkey.pem`; these files are ignored by Git.
2. Copy `ops/lan-proxy/.env.example` to `ops/lan-proxy/.env`. Set `LAN_PUBLIC_HOST` to the chosen hostname and `LAN_ALLOWED_CIDR` to the trusted Wi-Fi subnet. Defaults reflect the current host address (`192.168.15.9`) and its common `/24` subnet; adjust them if the network differs.
3. Start or stop the proxy:

   ```sh
   docker compose --env-file ops/lan-proxy/.env -f ops/lan-proxy/compose.yaml up -d
   docker compose --env-file ops/lan-proxy/.env -f ops/lan-proxy/compose.yaml down
   ```

   The HTTPS address is `https://<LAN_PUBLIC_HOST>:8443`; HTTP on port `8080` redirects there. The Compose service uses Linux host networking and forwards the original path/query to `127.0.0.1:3000`. Restrict these listener ports in the host firewall as well as in Nginx's CIDR allowlist.
4. For each social provider, register the exact HTTPS callback URL and set the matching runtime redirect URI, for example `https://<LAN_PUBLIC_HOST>:8443/social/connections/youtube/callback`. Repeat for Instagram, Facebook, and TikTok; TikTok's configured authorization URL must also contain its matching callback. Nginx preserves the path/query and does not rewrite provider `redirect_uri` values. A provider may reject a private hostname/IP or local certificate; use a provider-accepted HTTPS hostname/certificate if so.

This is only social-provider OAuth; the pilot has no end-user login. Anyone on the allowed subnet can use the unauthenticated API, so only enable the proxy on a trusted network. Keep the API running as one process during each OAuth flow because its state is held in memory.

If PostgreSQL authentication needs a password, use your local `.pgpass` or configure it in your ignored `.env.local`; do not commit credentials.

When connecting social accounts, add `SOCIAL_CREDENTIAL_ENCRYPTION_KEY` to the local secret store or `.env.local`. Generate a 32-byte base64 key with `openssl rand -base64 32`. The key is read only when credentials are stored or resolved, so it is not required for API startup; losing/changing it makes stored credentials unreadable.

Provider OAuth settings are read only when a connection request runs; missing IDs/secrets do not block API startup. Keep all client secrets in the local secret store or ignored `.env.local`, never in the database or API DTOs. `.env.example` lists variable names and local callback paths only.

- **YouTube:** configure `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, and `YOUTUBE_OAUTH_REDIRECT_URI`. Use `GET /social/connections/youtube/authorize` and `/callback`; `enableReplies=true` explicitly requests the broader `youtube.force-ssl` scope. State/PKCE and encrypted token refresh are implemented. Google OAuth verification/test-client approval is still needed for live accounts.
- **Instagram:** configure `INSTAGRAM_OAUTH_CLIENT_ID`, `INSTAGRAM_OAUTH_CLIENT_SECRET`, `INSTAGRAM_OAUTH_REDIRECT_URI`, and `META_GRAPH_API_VERSION`. Use `GET /social/connections/instagram/authorize` and `/callback`. This uses Instagram Login, `instagram_business_basic` and `instagram_business_manage_comments`, and provider-specific long-lived token refresh. Meta live access/App Review remains pending.
- **Facebook Pages:** configure `FACEBOOK_OAUTH_CLIENT_ID`, `FACEBOOK_OAUTH_CLIENT_SECRET`, `FACEBOOK_OAUTH_REDIRECT_URI`, and `META_GRAPH_API_VERSION`. Use `GET /social/connections/facebook/authorize` and `/callback`, then `POST /social/connections/facebook/select` with the callback's `selectionId` and one listed `pageId`. The flow never connects multiple Pages implicitly and stores only the selected Page token. Meta live access/App Review remains pending.
- **TikTok Business:** local OAuth routes are `GET /social/connections/tiktok/authorize` and `/callback`. Configure `TIKTOK_BUSINESS_CLIENT_ID`, `TIKTOK_BUSINESS_CLIENT_SECRET`, `TIKTOK_BUSINESS_REDIRECT_URI`, and the app-generated `TIKTOK_BUSINESS_AUTHORIZATION_URL`; `TIKTOK_BUSINESS_STATE_PARAMETER` defaults to `state`. Tokens/scopes are stored only in the encrypted vault. The documented account-token refresh contract matches the local request, but live app access/refresh verification remains pending. TikTok documents account-token revocation at `/tt_user/oauth2/revoke/`; this app does not expose or call it and never substitutes advertiser-token `/oauth2/revoke_token/`. TikTok for Developers Login Kit and Research API are not substitutes. See the [TikTok integration contract status](docs/integrations/tiktok.md).

## Intelligence Providers

Jev uses TypeSafe System One through the single endpoint `POST https://api.typesafe.ai/v1/systemone`; the application sends a `model`, `state`, and typed `questions` and maps the structured `answers`. There are no separate comment/response URLs or configurable auth-header fields. Preferences stores one write-only TypeSafe/Jev API key; `GET /ai/provider-access` returns key-presence flags only and `PUT` never returns secrets. Runtime configuration prefers `TYPESAFE_API_KEY` and keeps `JEV_API_KEY` as a legacy fallback.

Response suggestions can use Gemini or OpenAI. `GET /ai/response-generation/settings` returns the active provider/model and allowlisted choices; `PUT` accepts only `{ "provider": "google"|"openai", "model": "..." }`. API keys are stored separately from the model selector. These local, unauthenticated settings endpoints are available only while the API is bound to `127.0.0.1`.

Preferences lets the local operator set the TypeSafe/Jev API key, Gemini/OpenAI API keys, and the Gemini data-use policy; text-generation model choice is persisted through `GET/PUT /ai/response-generation/settings`. API keys use write-only password inputs and are encrypted in PostgreSQL with `SOCIAL_CREDENTIAL_ENCRYPTION_KEY`; key values are never returned to the browser. Environment variables remain fallback values. The comments interface has complete `pt-BR`, `en-US`, and `es-ES` catalogs; select the interface language in Preferences. Every requested AI response suggestion creates a separately selectable variant in all three languages. Google's Free tier may use submitted content to improve Google products; OpenAI GPT-6 Luna is billed by token. Verify current pricing/data terms before sending real comment or response text. Provider configuration remains optional at application startup.

## CreatorDesk Comments Frontend

The API serves the CreatorDesk comments interface from `web/` at `/` on the same loopback origin. It uses the community API routes directly: publication listing and cursor pagination (5 videos per account by default, with 10/25 choices), page-scoped on-demand comment sync, per-comment classification/generation, account response tone, append-only response revisions, optional response evaluation, explicit per-comment send, and a separately confirmed send-all action in the semi-automatic video dialog for individually approved rows. The main sync control processes only visible videos sequentially and reports per-video progress/outcomes; failures show localized explanations based on platform and stable error code, with a generic fallback. It never silently starts a whole-network sync. The frontend does not include sample social content or fake provider results; it presents loading, empty, unsupported, and error states from the API. All interface text is cataloged in `pt-BR`, `en-US`, and `es-ES`; authenticated user/tenant locale resolution remains deferred to FND-04. AI response suggestions are generated separately in all three languages, and the creator reviews/selects one variant before editing or sending. Profile settings list and connect accounts, require explicit Facebook Page selection, and provide a confirmed local disconnect action that removes account-scoped data and credentials without revoking the provider grant. OAuth credentials remain in server runtime configuration and are never entered in the UI.

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
Generate Separate pt-BR, en-US, and es-ES Suggestions with Gemini or OpenAI
   ↓
Creator Reviews and Edits (AI and manual revisions retained)
   ↓
Evaluate the Final Revision with JEV
   ↓
Creator Sends Individually or Confirms Sending Approved Replies
```

Sync/classify/generate batches track independent per-comment outcomes and never send replies. The semi-automatic dialog has a separate send-all action: it requires per-row approval and final confirmation, calls the existing per-comment route sequentially, continues after individual failures, and stops on a platform rate limit. Analytics/dashboard and video publishing remain later roadmap phases.

## Current Community API Slice

1. Connect supported social accounts through their independent OAuth API flows.
2. List existing publications and on-demand comments across supported networks.
3. Classify a selected comment through JEV and generate separate Portuguese, English, and Spanish response suggestions.
4. Review append-only workflow history, correct JEV labels/scores, and save manual or edited response revisions.
5. Optionally evaluate the final saved revision and send it individually or through the separately confirmed send-all action for individually approved replies; evaluation remains advisory.
