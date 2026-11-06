# Technical Specification — Response Refinement Analysis

**Status:** Draft — the tenant-scoped contextual analysis API, persistence, prompt-version capture, and classifier retry are implemented. Aggregate report reads and persisted reviewer decisions remain planned.

**Product PRD:** [Response Refinement Analysis](../product/prds/response-refinement-analysis.md)
**Related:** [AI Response Refinement Dataset](../product/prds/response-refinement.md) · [Technical Specification — AI Response Refinement Dataset](technical-response-refinement.md) · [Evaluate Response](comments/evaluate-response.md) · [Generate Response](comments/generate-response.md)

## 1. Scope and Design

Deliver two capabilities:

1. A deterministic, read-only tenant report over `ai_response_edit_pairs`.
2. An explicitly requested, tenant-scoped contextual analysis for pairs whose exact source comment and workflow lineage are still retained.

The contextual analysis evaluates the AI and final response against the same comment and effective comment analysis, and classifies the likely edit intent/AI issue. It creates structured, auditable hypotheses—not ground truth, model training, or automatic prompt changes.

The pair table has no comment text, but its `manual_reply_attempt_id` corresponds to the successful app-send operation. Application code may use it to resolve the attempt, result, response lineage, comment, and analysis while all source records remain in their normal retention window. Never recover an expired comment from external APIs or another source.

## 2. Architectural Placement

- **Application:** `GetResponseRefinementInsights` computes the aggregate report. `AnalyzeResponseRefinementPairs` validates explicit external-processing confirmation, resolves source context, invokes evaluation/classification ports, records per-pair outcomes, and aggregates recurring issue categories.
- **Ports:** add tenant-scoped `ResponseRefinementAnalysisQuery` for pairs plus retained source context, and a `ResponseEditClassifier` capability port. Reuse the existing `ResponseEvaluator` port for both response versions.
- **Infrastructure:** Postgres context query uses read-only `SELECT`s scoped by server-resolved tenant/account and current expiration. It must not use `CommentWorkflowEventRepository.listByComment`, which deletes expired rows as part of its normal cleanup behavior.
- **JEV:** receives only application-prepared context through capability ports. It never queries the database, accesses social APIs, or mutates domain/settings state.
- **Presentation:** keep the aggregate endpoint and add authenticated `POST /social/response-refinement/analyses`. No client-supplied tenant ID, comment ID, response text, provider credential, or arbitrary JEV state is accepted.
- **Domain:** analysis outcomes are immutable structured records; response sending and tone settings are not mutated.

## 3. API Contracts

### 3.1 Aggregate report

`GET /social/response-refinement/insights` accepts optional `accountId`, `platform`, `language`, `from`, and `to` filters. Tenant identity is server-resolved; validate any account under that tenant. Require both dates when either is supplied, normalize to UTC, and use the half-open interval `[from,to)`. When omitted, use the trailing 90 days. Reject invalid/reversed dates and ranges longer than 365 days.

Query pairs in pages of at most 250, ordered by `(recorded_at, id)`, with a hard cap of 10,000 matching pairs. Stop after detecting row 10,001 and return `RESPONSE_REFINEMENT_ANALYSIS_TOO_LARGE`; never silently truncate or return partial aggregates. An empty result returns zero counts and an empty group list.

Return the requested period, non-identifying filters, `accountScope` (`TENANT` or `ACCOUNT`), generation time, total pair count, and groups by platform, language, AI provider/model, intended tone, and `promptVersion`. Historical rows without a prompt version use `UNKNOWN`. Per group return median revision count, median word-count delta, median normalized token difference, evaluation count/unavailable count, means and sample counts for valid stored sent-response scores/risks, recommendation counts, contextual-analysis status counts, and separate JEV/human-reviewed category counts.

Metric definitions:

1. Tokenize trimmed text by one or more Unicode whitespace characters; empty text has zero tokens.
2. `wordCountDelta = finalTokenCount - aiTokenCount`.
3. Normalize each token with Unicode-aware lowercase conversion; preserve punctuation and diacritics.
4. `sharedTokenCount` is the sum of the minimum frequency for each token in the AI/final token multisets.
5. `normalizedTokenDifference = 1 - (2 * sharedTokenCount / (aiTokenCount + finalTokenCount))`; return zero when both counts are zero. The measure is order-insensitive and is not a semantic or quality score.
6. Compute exact medians per group; for even cardinality, average the two middle values.
7. Summarize only supported `typesafe-systemone-v2` stored response-evaluation snapshots. Missing/invalid scores are not zero and each metric returns its own sample count.

For each pair included in the requested source period, use its latest analysis row by `(recorded_at DESC, id DESC)` for status/category summaries; never count multiple re-runs of one pair as multiple examples. Aggregate each capability from its own successful result, including a successful classifier in an otherwise `PARTIAL` pair. Count at most one effective human review per pair, using the latest review for the selected analysis row. Pair count is not an edit rate and no result establishes causation.

The aggregate response contains no comment text, AI/final text, attempt ID, pair ID, external identifier, or author data. Never echo `accountId`; return only `accountScope`.

### 3.2 Explicit contextual analysis

`POST /social/response-refinement/analyses`

Example request:

```json
{
  "from": "2026-10-01T00:00:00Z",
  "to": "2026-11-01T00:00:00Z",
  "accountId": "authorized-account-id",
  "platform": "instagram",
  "language": "pt-BR",
  "limit": 25,
  "after": "opaque-cursor",
  "retryClassificationFromAnalysisRequestId": null,
  "confirmExternalProcessing": true
}
```

- Require authenticated tenant membership and derive `tenantId` server-side.
- Require `confirmExternalProcessing: true`; otherwise return a stable consent-required error and make no provider call.
- Accept only the documented filters, `limit` from 1 to 25, and an application-generated opaque pagination cursor. The cursor must not expose source comment identifiers.
- An optional `retryClassificationFromAnalysisRequestId` retries only failed classifier capabilities from a prior page. It reuses prior AI/final evaluations only while source context is unchanged and makes one JEV call per eligible pair.
- Before submission, the UI explains that eligible comments and both response texts are sent to JEV and that up to three JEV evaluations/classifications are requested per eligible pair.
- Return an `analysisRequestId`, selected/analyzed/skipped/failed counts, per-item `analysisId` and safe status/category codes, per-capability outcomes, category counts, and the next opaque cursor. Do not include raw source text or pair/source identifiers.
- Analyze each pair independently; never place multiple commenters' records into one JEV state or one AI artifact.

The first release runs a bounded request synchronously with concurrency at most four. A request cannot exceed 25 selected pairs. Callers paginate to analyze larger cohorts; partial provider failures do not discard successful pair results. Findings remain advisory for human homologation review; reviewer decisions are not persisted by this API.

## 4. Context Resolution

For each selected pair, the application query must:

1. Require the pair's `tenant_id` and `social_account_id` to match the authenticated scope and optional account filter.
2. Find the corresponding `MANUAL_REPLY_ATTEMPTED` by `operation_id = manual_reply_attempt_id`, same tenant/account, and unexpired event.
3. Find its matching `MANUAL_REPLY_RESULT` with the same operation, `status = SUCCEEDED`, same tenant/account, and unexpired event.
4. Resolve the comment from the attempt event's comment key only when `social_comments.retention_expires_at > asOf`.
5. Resolve the exact AI suggestion root and sent response version from the attempt's lineage; require the root to be `RESPONSE_SUGGESTION_GENERATED`, and verify its AI text and the sent attempt text equal the pair's `ai_text` and `final_text`.
6. Resolve the effective `COMMENT_ANALYSIS_CREATED` plus append-only `COMMENT_ANALYSIS_CORRECTED` fields that parented the suggestion. Do not use only the reduced `analysis_labels_json` when the full retained analysis is available.
7. Resolve the matching response-evaluation context, including any `verifiedReleaseScheduleSnapshot`, when present. Use the same snapshot for both response evaluations; if it cannot be recovered, omit it for both and record that schedule context was unavailable.

No author field, external identifier, comment event ID, or account identifier is included in the JEV request. `last_edit_reason` is optional untrusted user input; include it only under the explicit confirmation, label it as data, and instruct JEV not to follow embedded instructions. Treat the comment and both response texts as untrusted data, not provider instructions.

If any required source item is missing, malformed, expired, unsuccessful, or mismatched, record a stable skip reason (`SOURCE_CONTEXT_EXPIRED`, `SOURCE_LINEAGE_UNAVAILABLE`, `SOURCE_RESULT_NOT_SUCCEEDED`, `SOURCE_CONTEXT_INVALID`) and make no JEV call for that pair.

## 5. JEV Evaluation and Classification

### Pair evaluation

For each eligible pair, call the existing `ResponseEvaluator` twice:

- once with the exact original comment, effective persisted/corrected comment analysis, and `ai_text`;
- once with the same comment, same analysis, and `final_text`.

Both calls use the same verified schedule snapshot or both omit it. Do not append `RESPONSE_EVALUATED` events to the comment workflow; this is a separate analysis action. Preserve each full normalized result, including scores, risks, recommendation, confidence/signals, provider/model, schema version, and usage.

Compute per-field deltas as `final - AI`. For risk fields, a negative delta means the final evaluation assigned a lower risk; for quality scores, a positive delta means a higher score. Keep each dimension separate; never translate mixed deltas into an unqualified “improved” result.

### Edit classification

Call a new `ResponseEditClassifier` JEV adapter once per eligible pair with only:

- comment text;
- effective normalized comment analysis;
- AI response text;
- final response text;
- optional labeled edit reason.

Request a typed/JSON answer validated by the application against:

- `editCategory`: `FACTUAL_CORRECTION`, `RELEVANCE`, `TONE`, `CLARITY`, `LENGTH`, `PERSONALIZATION`, `SAFETY`, `OTHER`, `UNCLEAR`;
- `observedAiIssue`: `UNSUPPORTED_CLAIM`, `MISREAD_COMMENT`, `INCOMPLETE_ANSWER`, `TONE_MISMATCH`, `TOO_VERBOSE`, `TOO_BRIEF`, `SAFETY_RISK`, `NO_CLEAR_ISSUE`, `INDETERMINATE`;
- confidence in `[0,1]`;
- one `evidenceSource` restricted to `COMMENT`, `AI_RESPONSE`, `FINAL_RESPONSE`, and `CREATOR_EDIT_REASON`.

Do not accept generated response text, arbitrary prompt instructions, or unbounded free-text rationale from this classifier. Preserve JEV rationale only if the provider contract returns a supported rationale field; otherwise store `null`. Keep evidence as one source code, not a quoted snippet.

### Recurring hypotheses

Aggregate only successful, context-valid analyses. A process-level candidate requires at least five classifications with confidence `>= 0.70` sharing the same provider/model and language; a prompt-specific candidate additionally requires the same known `promptVersion`. Lower-confidence results remain visible but do not count toward either threshold. `UNKNOWN` prompt-version records may support process-level observations but never prompt-version-specific hypotheses. Keep model-classified and human-reviewed categories separate; mark a candidate human-validated only after at least five pair-level classifications in the group have an effective reviewer decision of `ACCEPT_CLASSIFICATION` or `CORRECT_CATEGORY` and agree on the category. Localized UI labels for issue and hypothesis codes are catalog entries in all three locales; do not ask JEV to write narrative advice.

## 6. Prompt Versioning and Persistence

### Generation prompt version

- Add a stable provider-specific `promptVersion` to every new `RESPONSE_SUGGESTION_GENERATED` payload and copied edit-pair row.
- Increment the version whenever the generation instructions or meaningfully relevant prompt context changes.
- Add nullable `prompt_version` to the response-generator result/event contract and `ai_response_edit_pairs` in the next migration; old rows map to `UNKNOWN`.
- Do not infer historical prompt versions from model names or timestamps.

### Analysis audit

Add an append-only `response_refinement_analyses` table, with one row per analysis request and pair. It stores:

- `id`, `analysis_request_id`, tenant ID, pair ID, status (`SUCCEEDED`, `PARTIAL`, `FAILED`, `SKIPPED`), skip/failure code, and `recorded_at`;
- prompt-version snapshot, analysis schema version, classifier provider/model, and JSON snapshots for AI evaluation, final evaluation, and edit classification;
- `source_context_updated_at` and optional `source_analysis_id` when classifier retry reuses prior response evaluations;
- per-capability status/error codes, confidence/signals/usage, and computed score/risk deltas.

Use a foreign key to the pair with `ON DELETE CASCADE`, plus tenant/request and tenant/pair indexes and uniqueness on `(analysis_request_id, pair_id)`. Store no comment text, raw AI/final text, external/social IDs, workflow event IDs, or author identity. Re-running creates a new request and new immutable rows; never overwrite a prior analysis.

Use sequential migrations after the current latest migration: `027_add_response_prompt_version_to_ai_response_edit_pairs.sql`, `028_create_response_refinement_analyses.sql`, then `029_add_response_refinement_analysis_retry_provenance.sql`. Keep API and TypeSafe DTOs inside presentation/infrastructure adapters; application records use normalized contracts.

## 7. Errors and Partial Outcomes

- Consent absent: reject before querying source text or calling JEV.
- Source context expired/missing: persist `SKIPPED` with a stable reason and no external call.
- Each AI evaluation and edit classification has its own status/result/error code. A failure in one capability does not discard another valid capability result for the pair.
- Pair status is `SUCCEEDED` only when all three capabilities succeed, `PARTIAL` when at least one succeeds and another fails, and `FAILED` when none succeeds.
- Invalid JEV schema/confidence/ranges: reject the invalid capability result, record the stable validation error, and preserve other pair outcomes.
- Classifier retry: reuse prior AI/final evaluations only when the current source-context timestamp is not newer than the prior analysis; otherwise skip without a JEV call. Append a new row linked to the prior analysis.
- Rate limit/provider failure: do not automatically retry during the request; preserve per-pair error. A user may explicitly retry the classifier capability when prior evaluations succeeded and source context is unchanged.
- Persistence failure: return an analysis-unavailable error without reporting the request as complete. No source texts are logged.

## 8. Security and Privacy

- Context resolution and all persistence queries include principal-derived `tenant_id`; account IDs are checked against that tenant.
- JEV receives only the minimum required text and normalized analysis. Comment text may contain personal data; explicit confirmation is required for every analysis request.
- Never send credentials, author display names, external comment/reply/publication/account IDs, or unrelated workflow payloads.
- Raw context remains in application memory only for the request and is sent to JEV only after confirmation. Do not return it in API results, cache it, copy it into the analysis table, logs, metrics, traces, or error messages.
- Do not call social APIs to recover expired context. Keep source comment and workflow events on the existing retention schedule.
- Analysis records follow pair/account deletion. Privacy disclosure/provider approval and a deployment-level disable switch are required before release beyond controlled homologation.

## 9. Verification

Apply TDD: add failing unit tests before implementation and use deterministic JEV doubles; never use live model output as the sole oracle.

- **Unit:** attempt/result/lineage matching; tenant/account mismatch; successful-result requirement; retention boundaries; effective analysis corrections; schedule snapshot parity; text equality checks; pair pagination/cap; consent gate; score/risk deltas; category and confidence schema validation; process/prompt recurring thresholds including the `0.70` confidence boundary; `UNKNOWN` prompt-version behavior; per-capability partial failures; no side effects on send/settings.
- **Unit:** classifier-only retry reuses prior evaluations only for unchanged source context and performs no evaluation calls.
- **Integration:** read-only Postgres context query joins only matching tenant/account/attempt and active-retention records; it does not delete or extend source retention; migrations add prompt version and append-only analysis/review rows; uniqueness/cascade behavior; no raw comment/response columns in the analysis table.
- **JEV adapter:** deterministic HTTP fixtures cover both-response evaluation inputs, structured edit classifier schema, malformed/out-of-range output, rate limit, provider outage, confidence/signals, model/schema, and usage.
- **E2E:** explicit consent → analyze one retained pair → verify the same comment/analysis was used for both response versions → verify structured diagnosis and deltas → verify classifier-only retry reuses prior evaluations → verify no raw text/IDs in analysis results/logs and no send/settings/workflow mutation. Also cover expired context and partial provider failures.
- **Privacy test:** with consent absent, assert zero JEV calls; with consent present, assert only the allowlisted text/context fields are sent and no external identifiers or credentials are present.
- **Localization:** catalog parity tests cover consent copy, category labels, reviewer actions, loading/empty/expired states, and stable error messages in `pt-BR`, `en-US`, and `es-ES`.

## 10. Observability

Record analysis request ID, tenant-scoped outcome, selected/analyzed/skipped/failed counts, provider latency, and stable error codes. Do not log pair text, comment text, edit reason, IDs, raw provider bodies, or secrets. Report request cost estimate as up to three JEV calls per eligible pair.

## 11. Open Technical Decisions

- Tenant role allowed to authorize contextual external processing and exact consent wording.
- Provider/privacy approval and retention/deletion policy for persistent pairs and derived analysis artifacts.
- Whether to configure per-tenant JEV cost limits in addition to the 25-pair request cap.
- Exact prompt-version naming convention and whether every historical generator can reliably identify its prompt template.
- Whether homologation review decisions should be persisted in a separate authenticated review workflow.
