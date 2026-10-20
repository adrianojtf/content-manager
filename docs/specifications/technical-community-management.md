# Technical Specification — Community Management

**Status:** Draft. Local OAuth-backed account connection is implemented for YouTube, Instagram professional accounts, Facebook Pages, and TikTok Business, with deterministic tests. Provider live access/App Review remains pending. TikTok uses a runtime-configured app-generated authorization URL and validates `video.list`, `comment.list`, and `comment.list.manage`; the documented refresh request matches the adapter, with approved-app verification still pending. TikTok documents a distinct short-term account-token revoke endpoint, but the application does not expose or call it. Manual network/content sync, manually initiated workflow phases, 30-day retention, per-comment manual sends, and optional advisory response evaluation are decided. AI response generation requires comment analysis; creator-authored text does not. The Phase 1 creator communication policy is fixed rather than configurable: no workflow automatically generates or sends a response, JEV risk/evaluation results are advisory, and only an explicit per-comment send can dispatch a saved response after capability/authorization checks. No numeric risk threshold or account-level policy setting is introduced. Response generation is configurable between Google Gemini Flash-Lite and OpenAI GPT-6 Luna, with Gemini as the pilot default. Live JEV endpoint/auth, Gemini Free-tier data-use acceptance, and provider-specific external reply detection remain open.

**Product PRD:** [Community Management](../product/prds/community-management.md)  
**Existing use-case specifications:** [Evaluate Comment](comments/evaluate-comment.md), [Generate Response Suggestion](comments/generate-response.md), [Evaluate Response](comments/evaluate-response.md)

## 1. Scope

For Phase 1, organize comments under a social-network tab, then publication/video, then comment. Fetch comments only after an explicit manual sync action for one publication/video or all publications on one selected network; never sync all networks in one operation and do not run background polling. Normalize and tenant-scope comments, preserve provider identifiers, and retain them for 30 days after the last successful sync. Every workflow phase is initiated explicitly and does not automatically trigger the next phase. Comment analysis and AI response generation may run per comment, publication/video, or selected network, with independent per-comment results. AI response generation requires comment analysis; creator-authored response text does not. Response evaluation is optional, manually requested, and advisory. Every external reply is sent only by an explicit per-comment manual action after capability/authorization checks.

### CreatorDesk browser application

- Serve the comments application at `/` from the API origin and use the same-origin REST API; do not hardcode provider credentials or include simulated social/JEV results.
- Preserve the prototype hierarchy: network tabs, connected-account selection, publications, then expandable comments. Search and reply-state filters apply to loaded content; publication/comment loading, unavailable states, and errors reflect API responses rather than fabricated counts.
- Map manual network sync to `POST /social/workflow-batches` with `operation=sync` and the selected platform. Per-publication sync uses the publication comments sync route. Display the independent batch outcomes and never expose global cross-network sync or batch-send controls.
- Each expanded comment exposes its workflow history and available evaluation, suggestion, edit/save, optional response evaluation, and manual-send actions. Generation supplies an explicit language and is enabled only after analysis. Saving appends a creator-authored response or revision; response evaluation and sending operate on the exact latest saved version.
- Response-tone controls read/write the selected account's profile. The optional response-evaluation action is visible when comment analysis and a saved response version exist; no numeric risk cue or automatic evaluation is used.
- Show app reply state independently from external reply state. Preserve `UNKNOWN` as unknown rather than presenting it as not replied.
- Keep controls usable at narrow viewport widths and expose loading, errors, disabled reasons, and action results accessibly.

## 2. Architectural Placement

- **Domain:** `Comment`, immutable versioned `CommentAnalysis`, append-only `CommentAnalysisCorrection`, `ResponseSuggestion` with immutable AI output and append-only `ResponseSuggestionRevision`, `ResponseEvaluation`, workflow-stage records, and per-comment `ManualReplyAttempt`.
- **Application:** on-demand comment sync; individual/batch classification and suggestion orchestration; response evaluation; human correction/edit; creator-visible stage history; and explicit per-comment manual-send policy.
- **Ports:** `CommentReader`, `CommentResponder`, comment/analysis/response repositories, `CommentEvaluator`, `ResponseEvaluator`, `ResponseSuggestionGenerator`, and a persisted provider/model selection service. `ConfiguredResponseSuggestionGenerator` dispatches to Google or OpenAI adapters.
- **Adapters:** platform comment/reply adapters, JEV adapter for its documented evaluation/intelligence responsibilities, persistence, RabbitMQ workers, and presentation.

The domain does not depend on social SDKs, JEV SDKs, or persistence libraries. See [Architecture](../architecture/architecture.md), [ADR-003](../architecture/decisions/ADR-003-jev-as-evaluator.md), and [ADR-004](../architecture/decisions/ADR-004-ai-human-control-boundary.md).

User-facing validation and failure responses use stable error codes and semantic translation keys through the [localization contract](../contracts/localization.md). Every response-generation request carries an explicit response language; UI locale is not used as a substitute. Do not translate comments or generated response text as a side effect of UI localization; any translation capability is a separate product behavior. See the [localization architecture](../architecture/internationalization.md).

## 3. Logical Data and Contracts

- **Comment:** normalized content associated with a tenant-owned social account and publication; retain platform, external comment/thread identifiers, author display name, text, provider-created time, and `canReply`. Persist app reply status separately from external reply status. External status is `REPLIED`, `NOT_REPLIED`, or `UNKNOWN`; adapters report `UNKNOWN` when they cannot reliably identify whether the connected creator replied. The database identity is `(tenantId, socialAccountId, externalCommentId)`; each successful sync updates `lastSyncedAt` and sets `expiresAt` to 30 days later. Expired rows are purged on each sync/read; periodic polling is out of Phase 1.
- **CommentAnalysis:** immutable structured JEV output including sentiment/emotion/intent/topic/entity, spam/toxicity/engagement scores and confidence normalized to `[0,1]`, rationale, provider/model, schema version, bounded source context, and generated timestamp.
- **CommentAnalysisCorrection:** append-only human correction of sentiment/emotion/intent/topic/entity and spam/toxicity/engagement values (scores stay in `[0,1]`). It references the original analysis; confidence, rationale, and raw JEV output cannot be edited. Record changed fields, actor source (`LOCAL_PILOT` until Phase 3), timestamp, and optional reason.
- **ResponseToneProfile:** tenant/account-scoped configuration with one primary tone (`FRIENDLY`, `PROFESSIONAL`, `CASUAL`, `EMPATHETIC`), up to two modifiers (`CONCISE`, `WARM`, `ENTHUSIASTIC`), and an optional note limited to 500 characters. The default is Friendly with no modifiers/note. It is independent from the global provider/model selector.
- **ResponseSuggestion:** immutable AI-generated text and source context associated with the original comment; generation requires a prior comment analysis. Generated provider/model, language, confidence, rationale, timestamp, and exact `ResponseToneProfile` snapshot used remain auditable.
- **CreatorAuthoredResponse:** creator-entered response text that has no AI-suggestion parent and does not require comment analysis. Every edit is append-only and preserves the exact text/version and actor source (`LOCAL_PILOT` until Phase 3).
- **ResponseSuggestionRevision:** append-only creator edit linked to its AI suggestion and prior revision, containing the exact manual text, actor source, timestamp, and optional reason. Never overwrite the AI-generated text.
- **ResponseEvaluation:** optional manually requested structured JEV output for relevance, tone, helpfulness, factual/toxicity/hallucination risks, recommendation, confidence, rationale, provider/model, and timestamp. It is advisory and never a send gate.
- **ResponseGenerationSettings:** one global pilot selector containing provider (`google` or `openai`) and an allowlisted model. API keys are never persisted or returned; they remain environment/secret-store values. `updatedByAdminUserId` is nullable until Phase 3 admin authentication is connected.
- **CommentWorkflowEvent:** append-only per-comment timeline event for sync/classification/correction/generation/creator-authored text/edit/optional response evaluation/send, with operation/batch ID, status, source, timestamp, parent artifact/event ID, and normalized structured payload. Each manually initiated phase creates auditable per-comment results. Events expire with their associated comment after 30 days and are removed by the comment-retention cascade.
- **BatchOperation:** user-initiated grouping with scope (`COMMENT`, `PUBLICATION`, `ACCOUNT`, or `PLATFORM`), requested operation, and child comment-operation IDs. `PLATFORM` is limited to the selected social network and never crosses networks. Every child completes/fails independently; batch state is derived from its children and never substitutes for detailed results. Cross-platform `all` scope is unavailable in the initial UI/API contract.
- **ManualReplyAttempt:** append-only per-comment explicit send action linked to the exact final saved response version (AI-generated/edited or creator-authored), recording actor source/time, capability check, exact text, optional response-evaluation event, external outcome/ID, and stable attempt ID. A second attempt for the same version is blocked after any recorded attempt; ambiguous outcomes require reconciliation outside the application. No batch-send operation exists.

The normalized `PlatformComment` carries `platform`, `externalCommentId`, `externalThreadId`, `externalPublicationId`, nullable `authorDisplayName`, nullable `text`, nullable ISO `createdAt`, `canReply`, and platform reply-state evidence. The application separately persists whether it sent a reply; adapters normalize external creator-reply state as `REPLIED`, `NOT_REPLIED`, or `UNKNOWN`. `CommentPage` carries the comment list and an opaque `nextCursor`; provider cursors/DTOs remain inside adapters. `CommentReader.getComments(account, publicationId, cursor?)` returns a normalized page. `CommentResponder.reply(account, comment, editedText)` returns the external reply identifier. Replies must check `canReply` and the exact platform capability before making a write request; tokens are resolved from the credential vault inside infrastructure and never enter response DTOs/logs.

## 4. Comment Ingestion and Evaluation Flow

1. The creator requests an on-demand comment sync for one listed publication/video or all publications on one selected social network; network sync never crosses networks and periodic polling is out of Phase 1.
2. Resolve each applicable social account within the fixed pilot tenant and check read-comment capability/authorization.
3. Fetch provider pages through `CommentReader`, preserving the provider cursor for subsequent requests.
4. Normalize each comment and upsert idempotently by `(tenantId, socialAccountId, externalCommentId)`; refresh its 30-day expiry only when successfully observed.
5. Remove expired rows for that tenant during sync, then return only the normalized page and opaque next cursor. A failed provider read must not alter stored comments.
6. Comment analysis/evaluation is a separate COM-06 workflow and never changes sync success semantics.

Comment reads and sync requests delete rows whose 30-day `expiresAt` has passed before returning or writing data; no background polling/cleanup worker is required for the local pilot.

### Per-comment workflow stages and batch actions

- The screen is organized by social network, publication/video, then comments. A manual refresh on one publication syncs that publication; a manual refresh at network level syncs all accessible publications on that network only. No operation syncs all networks or runs in the background.
- The creator manually requests comment analysis or AI response generation per comment, per publication/video, or for selected items on one network. Network-level execution is serial and returns independent per-comment results; failures do not cancel or hide other outcomes. Each phase requires a separate creator request; no next phase is automatically chained. There is no send batch operation.
- Bulk mode never combines comments into a single AI artifact. Each JEV/generator call and audit record remains per comment.
- `GET /social/accounts/{accountId}/publications/{publicationId}/comments` returns the persisted comment list and app/external reply states for the selected content.
- Each collapsed comment shows its text and reply state; expanding it exposes the relevant manual actions and results. Track `SYNCED`, `CLASSIFIED`, `CORRECTED`, `SUGGESTED`, `MANUALLY_AUTHORED`, `REVISION_EDITED`, optional `EVALUATED`, and `SENT` as applicable, with per-operation status, source, timestamp, and stable failure code.
- Persist app reply state independently from external reply state. External reply status is `REPLIED`, `NOT_REPLIED`, or `UNKNOWN`; adapters must report `UNKNOWN` where the platform cannot reliably identify the connected creator's own reply. Do not infer creator reply status from a non-zero count of any replies.
- Preserve the original JEV `CommentAnalysis` including confidence/rationale. Creator corrections may change sentiment/emotion/intent/topic/entity labels and spam/toxicity/engagement scores in `[0,1]` only; persist an append-only correction with actor source, timestamp, corrected fields, and optional reason. Never rewrite the original analysis or confidence/rationale.
- AI response generation is available only after comment analysis. Creator-authored response text is independent of comment analysis. Keep AI output immutable; creator-authored response roots and all later edits are separately append-only and auditable.
- Response evaluation is a separate optional manual action and requires comment analysis. It evaluates the latest saved response version; any later edit makes earlier evaluation stale for display/decision context but does not erase it. Its output is advisory only, including `REJECT`; it never blocks an explicit manual send.
- `POST /social/accounts/{accountId}/comments/{externalCommentId}/revisions/{revisionEventId}/send` accepts no body or caller-supplied text. It sends only the exact latest saved AI-generated/edited or creator-authored version, rechecks reply capability/authorization, appends an `IN_PROGRESS` attempt before calling the platform, and stores a separate result event. Any prior attempt for that version blocks another attempt, including ambiguous outcomes.

## 5. Response Suggestion and Decision Flow

1. For AI generation, require an existing comment analysis, load the tone profile for the connected social account (or the Friendly default), and invoke the configured `ResponseSuggestionGenerator` only after the creator explicitly requests generation. Snapshot the profile on the immutable suggestion event.
2. For creator-authored text, allow direct entry without comment analysis and persist it as a distinct manual response version.
3. Let the creator edit either response kind; each save appends an exact-text version and never overwrites prior AI or creator text.
4. If a comment analysis exists, the creator may manually request a response evaluation for the exact latest version. Validate and append the structured JEV result; do not run it automatically on generation or edit.
5. Display evaluation recommendation, risks, confidence, and rationale as advisory information. `APPROVE`, `REVIEW`, or `REJECT` never dispatches or blocks a manual send.
6. Only after the creator explicitly invokes per-comment send, validate platform reply capability and account authorization again, then invoke `CommentResponder` with the exact latest saved text; append the attempt before dispatch and persist/display the external result.

Every Phase 1 external response requires an explicit manual send action. Spam/toxicity scores and response-evaluation results do not trigger actions or block an explicit send; the creator remains responsible for the final text. No automatic reply, configurable communication-policy schema, or numeric risk threshold is part of this controlled pilot. The frontend shows the optional response-evaluation action when its documented preconditions are met; it does not infer a risk threshold.

### Response-generation model selection

- The local pilot exposes `GET/PUT /ai/response-generation/settings` for a global provider/model selector. The initial catalog is Google `gemini-3.5-flash-lite` and OpenAI `gpt-6-luna`; Gemini is seeded as the default.
- Updates accept only an allowlisted `provider` and `model`; API keys are not accepted by the endpoint or stored in PostgreSQL. The selector is unauthenticated only while bound to loopback; Phase 3 must protect it with the platform-admin principal and populate `updatedByAdminUserId`.
- `ConfiguredResponseSuggestionGenerator` reads the persisted selection per request and dispatches to the corresponding provider adapter. API keys are read lazily from `GEMINI_API_KEY` or `OPENAI_API_KEY` when the selected generator is invoked.
- Gemini Free-tier use also requires `GEMINI_DATA_USE_POLICY=free-tier-acknowledged`; alternatively select `paid-tier`. This records operator policy acknowledgement, not provider account verification.

### Account-scoped response tone configuration

- `GET/PUT /social/accounts/{accountId}/response-tone` reads or updates the tone profile for one tenant-owned connected account; it does not change the global provider/model selector.
- Profile values: one primary tone (`FRIENDLY`, `PROFESSIONAL`, `CASUAL`, `EMPATHETIC`), up to two distinct modifiers (`CONCISE`, `WARM`, `ENTHUSIASTIC`), and an optional creator note of at most 500 characters. The unset default is `FRIENDLY` with no modifiers or note.
- Scope settings by `(tenantId, socialAccountId)`. Validate account ownership before read/write. Store no provider secrets in this configuration.
- Every generation request supplies this profile to the selected AI provider and snapshots the exact profile in its append-only suggestion event, so later setting changes never rewrite history.
- Tone is a style preference only. Manual response text is untouched, generation remains explicit and requires comment analysis, and tone never authorizes send or overrides factuality/platform/manual-send rules.

## 6. Asynchronous Work and Failure Handling

Phase 1 comment reads are initiated on demand and persist normalized pages synchronously; the upsert is idempotent so a retry does not duplicate comments. RabbitMQ may be used for separate comment/response evaluation workflows, not required to render a fetched comment page.

- Read unsupported or revoked access: return an explicit result and do not call the provider.
- Social/JEV timeout: retain existing state and surface retryable/non-retryable failure according to a policy still to be defined.
- Invalid structured AI output: reject the analysis/evaluation; do not mutate the associated domain entity.
- Unsupported reply operation: persist/report unsupported; make no external reply request.
- Ambiguous reply result: persist the ambiguous outcome and do not retry automatically; a prior attempt blocks another send for the same revision. Provider reconciliation/idempotency support is platform-specific and remains TBD.
- JEV response-evaluation endpoint/auth contract: configured separately from comment evaluation; the application port is independent, but the live provider contract must be verified before use.
- Spam/toxic signals never trigger generation or sending. A creator may explicitly request a suggestion after comment analysis; the signals remain part of the analysis context and do not automatically block a deliberate manual send.

## 7. Security, Privacy, and Observability

- JEV receives only application-prepared context; it cannot query the database, social APIs, RabbitMQ, or object storage.
- Minimize author context sent to JEV and retain only data required by product policy/platform terms.
- Never log access tokens or unredacted secrets. Restrict provider payload logging and preserve audit data for analysis/evaluation decisions.
- Trace sync/evaluation/reply operations by internal comment, publication, and analysis identifiers, with provider and outcome categories.

## 8. Verification

Apply Clean Code and TDD (Red-Green-Refactor): write or update a failing test before production changes, implement the smallest suitable change, then refactor with tests green. Every use case requires unit tests; critical user journeys require E2E coverage.

- **Unit:** normalization/identity, analysis schema and versioning, invalid-output non-mutation, creator-policy/risk decision, and capability gating.
- **Integration:** per-platform comment and reply adapters; JEV request/response schema boundary; repository persistence; RabbitMQ consumers.
- **E2E:** positive/question/complaint/spam/toxic/ambiguous/low-confidence comments; editable response suggestion; safe approval/rejection; unsupported reply creates no provider call; high-risk response cannot auto-publish. Use deterministic social/JEV test doubles, not production services or live model output.
- AI outputs are validated deterministically and are not treated as a test oracle; follow [Test Strategy](../validation/test-strategy.md) and [AI Evaluation Matrix](../validation/ai-evaluation-matrix.md).

## 9. Open Technical Decisions

- Per-platform read/reply capabilities, account scopes, provider terms for retained/displayed fields, pagination, and batch rate/concurrency limits.
- Comment and reply idempotency keys and provider reconciliation behavior.
- Live JEV response-evaluation URL/auth/schema verification; Gemini Free-tier data-use acknowledgement for real comment/response text.
- Any future creator-configurable communication-policy schema; Phase 1 uses the fixed manual-only policy and response evaluation remains advisory.
- Exact network-level sync scope/API contract and platform-specific ability to identify the connected creator's external replies; show `UNKNOWN` where it cannot be verified.
- Final-text confirmation and user-visible delivery/reconciliation details per platform; an ambiguous send cannot be automatically retried.
