# Technical Specification — Comment Workflow Performance

**PRD:** [Comment Workflow Performance](../product/prds/comment-workflow-performance.md)
**Related specs:** [Evaluate Comment](comments/evaluate-comment.md) · [Evaluate Response](comments/evaluate-response.md) · [Generate Response](comments/generate-response.md) · [Community Management](technical-community-management.md)

## 1. Problem Analysis

Current serial paths:

- `RunCommentWorkflowBatch.processComments` iterates `comments` with `for...of` + `await`; each item performs one `EvaluateComment` or `GenerateCommentResponseSuggestion` call before the next starts.
- `GenerateCommentResponseSuggestion` iterates `generatedResponseLanguages` (`pt-BR`, `en-US`, `es-ES`) serially — up to 3 sequential provider calls per comment.

For `N` comments: `classify` = `N` serial calls; semi-automatic (analysis + generate) ≈ `4N` serial remote calls. At ~1 s average provider latency, 1,000 comments ≈ 4,000 s serial vs ≈ 500 s at concurrency 8.

The workload is I/O-bound (HTTP to TypeSafe System One and to the configured suggestion provider). True multithreading (`worker_threads`) adds no benefit; bounded async concurrency is the correct mechanism.

## 2. Design

### 2.1 Concurrency executor (application layer)

Introduce a small internal utility — e.g. `runWithConcurrency(items, limit, worker)` — that:

- keeps at most `limit` workers active, each pulling the next item only after finishing the current one (worker-pool, not `Promise.all` over mapped chunks, so peak in-flight is always ≤ `limit`);
- preserves input order in the returned results array even though completion order differs;
- never rejects: per-item errors are caught by the existing per-comment `try/catch` and mapped to `FAILED`/`UNSUPPORTED` items exactly as today;
- carries the shared `batchOperationId` unchanged into every item.

`processComments` replaces its serial loop with this executor for both `classify` and `generate` operations. Per-item logic (including `isUnsupported`/`errorCode` mapping) is unchanged.

### 2.2 Semi-automatic dialog concurrency (frontend)

`generateSemiAutomaticReplies` (`web/bulk-replies.mjs`) previously processed comments strictly serially, issuing ~5 sequential HTTP calls per comment (`getWorkflow` → `classify` → `getWorkflow` → `generateResponse` → `getWorkflow`). It now runs rows through the same bounded worker-pool pattern with `concurrency` parameter (default `defaultSemiAutomaticConcurrency = 6`, matching the typical browser per-origin connection cap). Row order, per-row status, progress callbacks (`loading-history`/`evaluating`/`generating`/`completed`), and isolated failures are unchanged; completion order may differ from input order.

### 2.3 Per-language concurrency inside generation

Inside `GenerateCommentResponseSuggestion`, the loop over `generatedResponseLanguages` uses the same executor with a small fixed limit (3, i.e. all languages in parallel). Each language keeps its own `try/catch` → `recordSuggestion`/`recordSuggestionFailure` path, so `PARTIAL` + `failedLanguages` semantics and append-only events are preserved.

### 2.4 Rate-limit and retry policy

- On `INTELLIGENCE_PROVIDER_RATE_LIMITED`, the item retries with exponential backoff (e.g. base 1 s, factor 2, jitter, max 3 attempts, max delay 10 s). Backoff sleeps occupy the worker slot — they do not spawn extra in-flight calls.
- Retries happen inside the worker; other workers continue. After the retry cap, the item reports `FAILED` with the existing error code — no change to result semantics.
- Non-rate-limit failures are not retried (unchanged behavior; no automated retry of failed/ambiguous attempts elsewhere in the system either).

### 2.5 Configuration

- `COMMENT_WORKFLOW_CONCURRENCY` env var (integer, default `8`, min `1`, max `32`) read at adapter/bootstrap level and injected into `RunCommentWorkflowBatch`; out-of-range or missing values fall back to the default.
- The limit is a deployment concern, not request input — callers cannot raise it per batch.

### 2.6 Progress and cancellation

- `ListCommentWorkflowBatchEvents` already exposes per-item events; the UI derives `completed/total` from event count vs. known scope size. If the UI needs explicit totals, persist a batch-level `COMMENT_WORKFLOW_BATCH_STARTED` event carrying `totalItems` once the comment list is loaded (new event type, append-only).
- Cancellation (if in iteration scope): a `cancelBatch(batchOperationId)` record checked between item pulls; unstarted items are emitted as results with status `FAILED` + `errorCode: 'COMMENT_WORKFLOW_CANCELLED'`. Started items finish normally. The per-item API is unchanged — no abort of in-flight HTTP required for v1.

### 2.7 Alternatives considered

- **`worker_threads` / true multithreading:** rejected — work is I/O-bound; threads add serialization overhead for port objects and complicate testing with no latency gain.
- **Provider-side batch endpoint:** not available in the TypeSafe System One contract (`POST /v1/systemone` is single-state). Revisit if JEV adds one; also forbidden by the rule that bulk mode never combines comments into one AI artifact.
- **RabbitMQ job-queue fan-out (`JobQueue` port):** viable for a later phase (durable, resumable batches); heavier than needed for the interactive semi-automatic dialog and introduces worker-deployment complexity. Documented as a future option.
- **HTTP keep-alive/agent reuse:** cheap complementary win — configure a shared `fetch`/agent with keep-alive to avoid TCP/TLS setup per call; does not change the design.
- **Analysis reuse:** keep existing "analysis-if-needed" behavior — comments with a successful prior analysis skip evaluation, reducing call volume before concurrency even applies.

## 3. Data and Contract Changes

- No change to TypeSafe request shape, normalized outputs, event payloads, or REST routes.
- Optional new event type `COMMENT_WORKFLOW_BATCH_STARTED { totalItems }` and new error code `COMMENT_WORKFLOW_CANCELLED` — additive only.
- `CommentWorkflowBatchResult` unchanged; `results` order matches input comment order.

## 4. Failure and Partial-Failure Semantics

- Per-item failures, `UNSUPPORTED` mapping, `PARTIAL` language failures, and batch `SUCCEEDED`/`PARTIAL`/`FAILED` derivation are identical to the serial implementation — verified by reusing existing batch tests under concurrency `>1`.
- A worker crash (unexpected throw) marks only its item failed; remaining items continue.

## 5. Testing

- Unit: executor returns results in input order; never exceeds the configured in-flight limit (asserted with an instrumented fake worker tracking peak concurrency).
- Unit: `classify` and `generate` batches produce identical item outcomes at concurrency 1 vs. 8 against deterministic provider doubles.
- Unit: language-level concurrency preserves per-language `PARTIAL`/`failedLanguages` results.
- Unit: injected `429` triggers bounded backoff then success/failure; non-429 errors are not retried.
- Performance regression test: fake provider with fixed artificial latency; assert wall-clock bound ≈ `ceil(N/limit) × latency` for N=1,000 using a fake clock.
- E2E: semi-automatic flow on a multi-page comment set uses deterministic doubles; verifies audit-event parity with the serial baseline.

## 6. Observability

- Log batch start/end with `batchOperationId`, operation, scope, total, concurrency, and duration.
- Count provider `429`s and retries per batch (metrics or event counters).

## 7. Security and Boundaries

- No new external calls, credentials, or authorization changes. JEV remains behind the `CommentEvaluator`/`ResponseEvaluator` ports; the executor lives in the application layer and never bypasses use cases.
