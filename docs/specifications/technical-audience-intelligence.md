# Technical Specification — Audience and Content Intelligence

**Status:** Draft. Evidence thresholds, query windows, and audit-retention policy remain undecided.

**Product PRD:** [Audience and Content Intelligence](../product/prds/audience-intelligence.md)  
**Existing use-case specifications:** [Generate Audience Insight](intelligence/generate-audience-insight.md), [Generate Content Recommendation](intelligence/generate-content-recommendation.md)

## 1. Scope

Generate auditable audience insights and advisory content recommendations from application-prepared comment analyses, metric snapshots, content metadata, and historical context. Persist validated structured results and creator accept/reject decisions. Generation does not directly mutate content or execute social actions.

## 2. Architectural Placement

- **Domain:** `AudienceInsight`, `ContentRecommendation`, and auditable `IntelligenceAnalysis` artifacts.
- **Application:** context assembly, evidence-period selection, use-case orchestration, schema validation, persistence, and recommendation decisions.
- **Ports:** `AudienceInsightGenerator`, `ContentRecommendationGenerator`, repositories/query ports for comments/analyses/metrics/content, and audit persistence.
- **Adapters:** JEV adapter, persistence, async work via RabbitMQ, and presentation.

JEV is invoked only through capability-oriented application ports. It receives prepared context and has no direct persistence or social API access. See [Architecture](../architecture/architecture.md), [JEV Integration](../integrations/jev.md), [ADR-003](../architecture/decisions/ADR-003-jev-as-evaluator.md), and [ADR-004](../architecture/decisions/ADR-004-ai-human-control-boundary.md).

UI locale and generated insight/recommendation language are separate concerns. Every explicit insight or recommendation generation produces independent `pt-BR`, `en-US`, and `es-ES` variants using the same validated evidence context. Store each variant's language, provider/model, confidence, rationale, and provenance; partial language failures do not discard successful variants. UI localization never mutates evidence or generated artifacts. UI labels and errors use the [localization contract](../contracts/localization.md). See the [localization architecture](../architecture/internationalization.md).

## 3. Input and Output Contracts

### Prepared input

The application assembles content metadata, relevant normalized comment analyses, metric observations, historical comparison, and an explicit evidence period. The exact query window, minimum evidence volume, and context-size policy remain open. Existing Publication-associated `MetricSnapshot` records remain valid evidence. A Novelaria analytics `Episode` may exist without a `Content` or `Publication`; do not correlate it by matching titles or episode codes. Include its manually entered observations in content-scoped intelligence only when an explicit, tenant-authorized Episode-to-Content association exists. Preserve the manual source, platform, observation time, and evidence period. If there is no explicit association, omit those observations from that content's intelligence context.

### AudienceInsight

Persist at minimum the associated content/context, evidence period, structured insight, supporting evidence, distinction between observation and inference, confidence, provider, and creation time. Preserve the analysis execution/audit relationship.

### ContentRecommendation

Persist actionable recommendation text, rationale, supporting evidence, confidence, provider/analysis context, and creator decision when present. Recommendation remains advisory until a separate application workflow is explicitly invoked.

Exact provider DTOs remain inside the JEV adapter; application/domain models use normalized schemas validated before persistence.

## 4. Generation Flow

1. Receive a request for an insight or recommendation for the relevant content/evidence period.
2. Application queries stored content metadata, metric snapshots, and analyzed comments through repository/query ports.
3. Build and record a bounded, auditable context; distinguish measured evidence from derived summaries.
4. Invoke `AudienceInsightGenerator` or `ContentRecommendationGenerator` through the application port, directly or via the configured async workflow.
5. Validate schema, required evidence, confidence range, rationale, and allowed output structure.
6. Persist the `IntelligenceAnalysis` and associated insight/recommendation atomically at the application boundary; invalid provider output must not mutate domain state.
7. Return the persisted artifact and supporting evidence to presentation.
8. For a recommendation, persist creator accept/reject as an application/domain decision; do not automatically edit content or publish.

Aggregate intelligence work is listed as asynchronous in the architecture. Exact request-response behavior and regeneration semantics remain to be decided.

## 5. Evidence and Decision Rules

- Every aggregate insight identifies the evidence period and supporting evidence.
- Each generated insight and recommendation has independent Portuguese, English, and Spanish text variants, with per-language provider provenance and confidence.
- Failure to generate one language variant does not discard other validated variants; the failure is recorded by language.
- Metric evidence preserves whether it was entered manually or imported from a provider, its platform, and observation time; do not treat manually entered values as provider-verified.
- Novelaria Episode metrics enter content-scoped context only through an explicit tenant-authorized Content association; never infer a link from episode code or title.
- Distinguish observations derived from stored data from provider inferences.
- Preserve provider confidence and rationale; do not convert confidence into a deterministic truth claim.
- Recommendations must include evidence and rationale, and acceptance/rejection does not itself cause an external side effect.
- Low-volume, conflicting, or low-confidence evidence handling must be governed by deterministic application policy once thresholds are decided.

## 6. Failure Handling

- Missing required data/unsupported evidence window: return an explicit application result; do not manufacture evidence.
- Provider timeout/failure: do not persist a partial insight/recommendation as complete; record an auditable failure outcome without secrets.
- Invalid schema, missing rationale/evidence/confidence, or out-of-range confidence: reject before domain mutation.
- Duplicate async delivery: prevent duplicate artifacts according to a regeneration/request identity still to be defined; do not overwrite prior analyses silently.
- Partial context source failure: behavior (fail request versus generate with labeled partial context) is an open product/technical decision.

## 7. Security and Observability

- Pass only application-prepared, minimum-required context to JEV.
- Do not include credentials, direct database handles, or raw external API access in provider requests.
- Persist provider/model or prompt version where available and non-secret, evidence period, result, confidence, rationale, and timestamp for auditability.
- Emit structured outcome/latency/failure metrics with internal analysis identifiers; redact secrets and sensitive user data.

## 8. Verification

Apply Clean Code and TDD (Red-Green-Refactor): write or update a failing test before production changes, implement the smallest suitable change, then refactor with tests green. Every use case requires unit tests; critical user journeys require E2E coverage.

- **Unit:** context assembly and evidence-period selection, manual/provider provenance, explicit Episode-to-Content association enforcement, observation-versus-inference validation, confidence/schema validation, decision persistence, and no-side-effect behavior.
- **Integration:** JEV adapter contract and schema validation; repositories for analysis/insight/recommendation and evidence references; RabbitMQ workflow if used.
- **E2E:** insight with recurring evidence; recommendation with rationale/evidence/confidence; invalid provider output leaves state unchanged; creator rejection/acceptance persists without publication or content mutation; unlinked Novelaria episodes are excluded from content-scoped context and explicitly linked observations retain source/platform/evidence provenance. Use deterministic JEV test doubles and fixtures, not live model output.
- Use deterministic fixtures and evaluation matrices; JEV output itself is not a test oracle. See [Test Strategy](../validation/test-strategy.md).

## 9. Open Technical Decisions

- Minimum sample size, evidence windows, historical comparison rules, and partial-context behavior.
- Context-size limits, summarization method, and provenance granularity.
- Provider/model/prompt version representation and regeneration semantics.
- Atomicity and consistency strategy for analysis plus insight/recommendation persistence.
- Audit, evidence, and provider-request retention/privacy policy.
- How provider latency, rate limits, and asynchronous completion are exposed to the creator.
