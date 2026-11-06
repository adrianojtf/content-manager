# PRD — Comment Workflow Performance (Evaluation and Semi-Automatic Response Generation)

**Status:** Draft
**Tech spec:** [Technical Specification — Comment Workflow Performance](../../specifications/technical-comment-workflow-performance.md) · **Parent PRD:** [Community Management](community-management.md)

## 1. Objective

Reduce the wall-clock time of the semi-automatic per-video response flow (comment analysis followed by trilingual suggestion generation) and of the standalone `classify`/`generate` batch operations, so that a publication with 1,000+ comments completes within an acceptable interactive timeframe instead of blocking the creator for a very long, serial run.

## 2. User and Problem

**Primary user:** a creator operating within an authorized tenant.

Today every comment is processed strictly one after another: each comment requires one JEV analysis call and then three suggestion-generation calls (one per language), all sequential. With 1,000 comments this means roughly 4,000 serialized remote calls, making the semi-automatic dialog feel frozen and discouraging use on large videos. Partial progress is only visible after each item finishes; the creator cannot tell how long the batch will take or stop it cleanly.

## 3. Scope

### In scope

- Bounded-concurrency execution of per-comment evaluation and per-language suggestion generation inside the existing batch use case, preserving per-comment independent outcomes and partial failures.
- A configurable concurrency limit (deployment-level setting, not per-request) with a safe default, applied uniformly to JEV and response-generation provider calls.
- Rate-limit awareness: when the intelligence provider responds `429`, the executor honors backoff and reduces effective concurrency instead of hammering the provider; on repeated rate limiting the batch degrades to slower progress rather than failing all remaining items.
- Progress reporting: the batch result and workflow events expose completed/total counts so the UI can show meaningful progress and an estimated trajectory.
- Optional batch cancellation: an explicit cancel request stops scheduling new items; already-started items finish or fail individually and remain auditable.
- Skipping work that is already done: the semi-automatic "analysis-if-needed" phase reuses a successful prior `COMMENT_ANALYSIS_CREATED` instead of re-evaluating unchanged comments (existing behavior, must be preserved under concurrency).

### Out of scope

- Combining multiple comments into a single AI call or artifact (each JEV/generator call and audit record remains per comment — existing rule COM: "bulk mode never combines comments").
- Auto-sending, changing approval/review semantics, or any change to the automation boundary.
- Changing the TypeSafe request shape, question set, or normalized output contract.
- Background/polling synchronization of comments.
- Provider-side batch endpoints (not available today; revisit if JEV adds one).

## 4. Requirements

1. Per-comment work items (`classify` or `generate`) execute through a bounded worker pool with a configurable limit (default: 8 in-flight items). Order of completion may differ from input order; results are returned keyed to their comment and remain independently reported.
2. Inside `generate`, the three language variants may run concurrently per comment, still recording per-language success/failure independently. Partial language failures remain explicit (`PARTIAL` + `failedLanguages`).
3. Concurrency is bounded separately from provider rate limits. `INTELLIGENCE_PROVIDER_RATE_LIMITED` (HTTP 429) triggers a documented exponential-backoff retry for that item with a capped retry count; retries do not count as new work items for ordering purposes.
4. The executor is deterministic and I/O-bound: parallelism is implemented via async concurrency (worker-pool over promises), not `worker_threads`, since every per-item cost is a remote HTTP call and event handling, not CPU work.
5. Batch status semantics are unchanged: `SUCCEEDED`, `PARTIAL`, `FAILED` derived from per-item outcomes. Concurrency must not merge, reorder, or drop audit events; each comment keeps its own `COMMENT_ANALYSIS_CREATED`/suggestion events with the shared `batchOperationId`.
6. Cancellation, when requested, prevents new items from starting and marks unstarted items with a stable `CANCELLED`-class outcome; started items complete normally.
7. Database reads (comment listing per scope) are unaffected in contract; large scopes must not load more into memory than before without a documented bound, or must be chunked with a documented page size.
8. Performance acceptance is measurable: with a stubbed provider at fixed latency, a 1,000-comment `classify` batch completes in roughly `ceil(1000 / concurrency) × latency + overhead`, verified by an automated test with a deterministic clock/fake provider.

## 5. Success Metrics

- Semi-automatic run on 1,000 comments completes at least ~6–8× faster than the serial baseline at the default concurrency, without increasing the per-item failure rate.
- No audit event loss, duplication, or misattribution under concurrency.
- Provider `429` responses result in backoff/degradation, not batch collapse.

## 6. Non-Functional Requirements

- Concurrency limits are configuration-driven and documented; defaults are conservative relative to provider rate limits.
- The executor must not create unbounded promises: peak in-flight requests ≤ configured limit at all times.
- Memory: processing a 10,000-comment scope must not grow heap usage beyond a documented bound (chunked reading if needed).
- All existing auditability rules (append-only events, per-language variants, partial-failure preservation) remain intact.

## 7. Open Questions

- Should the concurrency limit be a deployment env var only, or also exposed per AI-provider settings record?
- Is cancellation required in the first iteration, or is progress reporting sufficient for the pilot?
- Should account-level and platform-level batches use a lower concurrency than publication-level to protect provider quotas?
