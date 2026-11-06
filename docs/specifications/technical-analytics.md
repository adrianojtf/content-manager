# Technical Specification — Publication Analytics and Novelaria Dashboard

**Status:** Draft. Episode discovery is AI-assisted over tenant-scoped publications already imported by the application and always requires creator approval. Performance observations remain manually fed; social metric synchronization is future work.

**Product PRD:** [Publication Analytics](../product/prds/analytics.md)  
**Episode setup workflow:** [PRD](../product/prds/episode-setup-workflow.md) · [Technical specification](./technical-episode-setup-workflow.md)

**Related technical context:** [Architecture](../architecture/architecture.md), [Domain Model](../domain/domain-model.md)

## 1. Scope

Provide a creator-approved canonical episode record, manually entered platform performance observations, historical reporting, and a primary dashboard that answers the six Novelaria growth and monetization questions. Episode candidates may use already-imported publication metadata from TikTok, Instagram, Facebook, and YouTube; this flow makes no additional social API calls. Initial performance entries remain TikTok, Instagram, and Facebook. YouTube performance entry is deferred. This analytics capability does not enable TikTok publishing or API access. Automated metric collection, provider metric adapters, and queue-based metric synchronization are not required.

## 2. Architectural Placement

- **Domain:** tenant-owned episode identity, series and episode number, episode-level production economics, platform performance observations, monthly revenue, metric availability, and deterministic calculation rules.
- **Application:** list tenant-scoped imported publications, request structured episode classifications, group only deterministic identity matches, create pending suggestions, approve/reject/correct suggestions, record manual observations and revenue, and query date-bounded aggregates.
- **Ports:** publication reader/repository, JEV publication classifier, tenant-scoped episode/suggestion/observation/revenue repositories, and reporting queries. Social `MetricsReader` adapters remain future extensions.
- **Adapters:** existing publication persistence, a JEV classification adapter, analytics persistence, authenticated HTTP/presentation, and dashboard rendering. Episode classification receives normalized stored metadata and does not call social providers.

Keep domain calculations and approval rules independent of NestJS, persistence, JEV, and presentation. Tenant identity is resolved from the authenticated principal and never trusted from request payloads. JEV may classify and return suggestions; it never reads the database, calls social APIs, creates episodes, links publications, or bypasses creator approval.

## 3. Logical Data Contract

### Series

- Tenant ID, resolved server-side.
- Canonical series name and optional normalized aliases, unique within the tenant after explicit creator confirmation.
- Season mode: `SEASONAL` or `NON_SEASONAL`, selected by the creator when a series is created. AI must not decide this mode.

### Episode

- Tenant ID, resolved server-side.
- Required Series ID.
- Positive episode number and optional positive season number. `SEASONAL` series require a season number; `NON_SEASONAL` series store `NULL`.
- Episode identity is unique within its tenant by series + season mode/number + episode number. The persistence constraint must treat `NULL` season as one identity for non-seasonal series.
- Stable human-readable episode code, unique within its tenant (example `FQA-E07`); distinct from UUIDs for Content, Publication, and external provider records.
- Optional episode-level production cost as a structured BRL amount and production time as a duration.

The episode is an analytics subject and can be registered without uploading media or creating a publishing `Content` item. A future association to Content must not change the episode code.

### Episode suggestion and publication association

- A suggestion references one or more already-imported publications by their tenant-scoped composite identity: social account ID + external publication ID. Preserve platform, account, provider IDs, title/description, permalink, and publication date as evidence; do not copy provider DTOs into the domain.
- Store a deterministic fingerprint of the source metadata used for classification. Reprocessing an unchanged fingerprint is idempotent; changed metadata creates a new suggestion revision and marks an older pending revision `SUPERSEDED` without deleting its audit data.
- Classification result is `EPISODE`, `NOT_EPISODE`, or `UNCERTAIN`, with schema version, model, confidence/probabilities, and source evidence. Missing title and description produce `UNCERTAIN` without a JEV request.
- Series name, season, episode number, and optional human-readable code are suggestions only. Use provider-supported structured fields only when their contract is verified; otherwise extract only explicit identity patterns deterministically and let the creator enter or correct missing fields. Never infer season mode or identity from confidence alone.
- Represent candidate season identity as explicit season number, confirmed non-seasonal, or unknown. Missing season text is `unknown`, not `NULL`/non-seasonal; the creator may resolve it by selecting a known series and season mode.
- Persist pending suggestion groups separately from canonical Series/Episode records. After creator series/season confirmation, group publications across networks and accounts by the same tenant-scoped Series ID, season state/number, and episode number when their classifications are `EPISODE`; platform/account are not part of the grouping key. Unknown season remains ungrouped unless an existing creator-confirmed non-seasonal Series resolves it. Preserve every source publication as a distinct, selectable carousel slide in one episode review card. Do not group by similar captions, thumbnail, or model rationale alone.
- Record separate rationale variants for `pt-BR`, `en-US`, and `es-ES`; preserve successful variants and per-language failures. Identity fields and source captions are not translated. A failed/contradictory variant does not approve or mutate an episode.
- A creator decision is explicit and auditable. The sequential setup may persist a Series after its explicit confirmation; canonical Episode creation and publication linking remain gated by explicit episode-group approval. Rejection and deferral leave canonical episode/publication associations unchanged. Preserve each publication's original platform/account/external identifiers. Commit each reviewed series/season/episode group independently; one group conflict must not roll back other groups already confirmed.

### Platform performance observation

- Episode ID and source publication identity (tenant-scoped social account ID + external publication ID), platform (`TIKTOK`, `INSTAGRAM`, or `FACEBOOK` for MVP metrics), publication date, and platform-reported duration.
- Observation time (UTC instant; ISO 8601 with explicit offset at transport boundaries).
- Optional reported values for views, likes, comments, shares, saves, reach/unique viewers, episode-attributed followers gained, profile visits, and average watch time/retention, with unit/definition metadata where it differs by platform.
- Source is manual in MVP. Missing/unavailable is distinct from zero.

### Platform audience observation

Store dated total-follower snapshots by tenant and `SocialAccount` ID; do not create a separate analytics account identity. This makes AN-02 dependent on SOC-02, which implements the tenant-scoped connected-account model. New account followers for a reporting period are calculated as the delta between valid snapshots bracketing that period; episode-attributed follower gains remain distinct and are used for episode view-to-follower conversion. Combined account totals are sums across platform accounts, not unique people.

Store dated cumulative-counter observations without overwriting prior history. The minimum identity is source publication + observation time; exact duplicate submissions for the same identity are idempotent, while a correction is an explicit update to that observation. An episode may have multiple source publications on one platform. Keep each post's observations separate and aggregate episode totals only from compatible metrics and supported deltas; do not imply unique viewers or sum counters across repeated snapshots. Manual values must retain their entered attribution/period semantics and must not be presented as verified provider measurements.

### Monthly revenue

Store optional revenue by tenant, platform, and calendar month as structured BRL amounts; persist monetary amounts as exact `NUMERIC(14,2)` values and reject inputs with more than two fractional digits rather than rounding. Missing revenue is not zero. Episode production costs/time are not duplicated across platform records. For monthly cost-versus-revenue reporting, assign each episode's production cost once to the calendar month of its earliest platform publication.

### Time and calculation rules

Observation instants are stored in UTC. Calendar reporting windows use the tenant timezone, falling back to UTC, and display localization must not change stored values. Compute cumulative-counter period totals from the closest valid observation at/before the window start and an observation in the window/end boundary; expose insufficient observation coverage as unavailable. Do not sum cumulative snapshots. Month-over-month view growth compares complete calendar months when both are complete; for an incomplete current month, compare month-to-date with the prior month through the same day number, capped at the prior month's final day. Growth is unavailable if the previous comparable period is missing or zero.

Use the MVP formulas from the PRD: engagement rate = (likes + comments + shares + saves) / views × 100; share rate = shares / views × 100; view-to-follower conversion = followers gained / views × 100. Numerator and denominator must refer to the same episode/platform/reporting period. A missing input or zero views yields unavailable rate. Cross-platform totals are sums of platform values, not unique people. Do not assert metric equivalence where platform definitions differ.

## 4. Episode Discovery, Approval, Manual Entry, and Query Flows

1. Authenticate the creator and derive tenant context from the principal.
2. List or refresh publications using the existing social-publication workflow. Episode discovery reads only normalized, tenant-scoped imported records; it does not invoke a social reader itself.
3. Evaluate publication title/description through the application JEV port. Validate the structured classification schema, confidence and evidence; preserve model/schema metadata and separate rationale variants. Treat supplied text as untrusted data, not instructions.
4. Extract identity only from verified structured provider output or explicit deterministic text patterns. Resolve a season only from an explicit season number or a creator-confirmed non-seasonal Series. After confirmation, group candidates across networks/accounts by tenant, confirmed Series ID, season state/number, and episode number. Missing, conflicting, unsupported, or uncertain identity stays ungrouped for creator review.
5. Guide review through the Series → Seasons → Episodes workflow defined in the [Episode Setup technical specification](./technical-episode-setup-workflow.md). Confirmed series configuration may be persisted during its step; no Episode or publication link is created at this stage.
6. On explicit episode-group approval, atomically create/select one tenant-unique Episode with season consistent with the previously confirmed Series mode and season assignment, then associate only the creator-approved publication identities from the carousel. Posts from multiple networks/accounts create one Episode, not one per source. If sources are approved in a later action, link them to the existing Episode. Reject duplicate/conflicting identity; preserve source publication records and audit actor, decision, model/schema, confidence, evidence, timestamps, and rationale variants.
7. Keep manual episode registration as a fallback. Record dated platform performance observations, platform-account follower totals, and monthly platform revenue through separate validated use cases; missing metrics remain unavailable.
8. Dashboard queries load one coherent reporting window and return views for the previous 7, 30, and 90 days, month-over-month views/growth, account follower totals/net-new deltas, platform breakdown/growth, rates, rankings, series trends, economics, and goal progress.
9. Display the six primary answers together: overall growth, growing platform, best series, best episode, episode follower conversion relative to views, and proximity to monetization milestones.

The monthly milestones are 1M, 3M, 5M, and 10M views; revenue milestones are BRL 1k, 3k, 5k, 10k, 20k, and 50k. Current-month progress is evaluated in tenant timezone (UTC fallback).

### Manual-entry presentation contract

- `GET /analytics/dashboard` returns one tenant-scoped reporting snapshot, with `generatedAt`, the effective reporting timezone, headline view totals for 7/30/90 days, month-over-month comparison, follower totals/deltas, platform breakdown, rankings, episode/series trends, monthly revenue/cost, and view/revenue milestone progress.
- `POST /analytics/series` creates a tenant-scoped series from `{ name, aliases, seasonMode }`.
- `POST /analytics/episodes` creates a tenant-scoped episode from `{ seriesId, seasonNumber, episodeNumber, episodeCode, productionCost, productionTimeSeconds }`.
- `PUT /analytics/episodes/{episodeId}` corrects a registered episode's `{ seasonNumber, episodeNumber, episodeCode, productionCost, productionTimeSeconds }`. The episode keeps its series; the same season-mode and tenant-unique identity/code validations apply, excluding the episode's own record. Publication links and observations follow the episode and are preserved.
- `PUT /analytics/episodes/{episodeId}/publications` corrects one publication link inside an episode from `{ socialAccountId, externalPublicationId }` plus exactly one action: `next` (`{ socialAccountId, externalPublicationId }` of an imported, currently unlinked publication on the same platform, or `null` to unlink) or `moveTo` (`{ seasonNumber, episodeNumber }` of an existing episode in the same series). Replacement is atomic, keeps the episode association, and preserves the source's recorded observations under the corrected identity. Moving reassigns the link and its observations to the target episode. Unlinking removes the link; observations recorded for that source are removed with it.
- `PUT /analytics/episodes/{episodeId}/economics` updates `{ productionCost, productionTimeSeconds }`; `null` means unavailable.
- `PUT /analytics/observations/performance` upserts one observation for an approved episode publication link from `{ episodeId, socialAccountId, externalPublicationId, observedAt, publishedAt, durationSeconds, metrics, metricDefinitions }`.
- `PUT /analytics/audience/snapshots` upserts one account total-follower snapshot from `{ socialAccountId, observedAt, totalFollowers }`.
- `PUT /analytics/revenue/monthly` upserts one `{ platform, month, amount }` BRL amount; `month` uses `YYYY-MM` and is stored as the first day of that month.
- Request bodies are allowlisted; tenant and actor are always resolved server-side. `PUT` is the explicit correction boundary for an existing manual observation identity.

## 5. Failure, Validation, and Tenant Isolation

- Reject duplicate episode codes within a tenant; the same code may exist in another tenant without revealing that tenant's record.
- Reject zero/negative season or episode numbers. A seasonal Series requires a season number; a non-seasonal Series forbids one. A candidate with unknown season cannot be silently saved as seasonless.
- Episode number uniqueness is scoped to Series and season; publication links to one episode are tenant-scoped and unique by account + external publication identity.
- Reads and writes always include principal-derived tenant ID; cross-tenant IDs must not expose or mutate data.
- Reject invalid dates, negative counters/cost/time, invalid platform values, and malformed money values; do not silently coerce missing values to zero.
- Reject approval for cross-tenant source publications, source identities that no longer resolve, conflicting duplicate episode codes, and suggestions whose required identity fields remain missing. Do not reveal cross-tenant existence.
- Suggestion refresh is idempotent by source fingerprint; changed source metadata supersedes only older pending suggestions and preserves all prior decision/audit records.
- Treat creator approval as the only transition that creates an episode or links a publication. Rejection/deferral and JEV failures have no domain side effects.
- JEV failure, rate limiting, invalid schema, low/absent confidence, or partial language failures remain reviewable/auditable outcomes; never fall back to inferred identity or fabricate confidence.
- Preserve earlier observations when a new observation is added. A correction to an existing observation must target its identity and remain auditable according to repository conventions.
- If a reporting window cannot be computed from observations, return an explicit unavailable/incomplete-coverage state; do not fabricate growth or rates.
- Revenue and production cost are separate values; costs are not inferred from time and revenue is not inferred from platform metrics.

## 6. Dashboard Presentation Contract

The primary dashboard must prioritize the six questions over detailed tables, and the six answers plus headline metrics and goal progress must be visible in its first view without requiring navigation. In a task-based usability check, at least 4 of 5 representative creators must answer all six questions within 10 seconds each, without assistance. Rankings and trend views support a selectable reporting window; default ranking window is an open product decision. Every aggregate indicates its window and platform scope. Distinguish zero, unavailable, incomplete history, and not-yet-monetized. Label follower totals as the sum of platform account figures, not unique people. Surface the next and achieved monthly goal milestones.

Dashboard queries use UTC until a tenant reporting timezone is available. The first ranking window is 30 days; the response also includes rankings for 7 and 90 days so the interface can offer those choices without another query. A metric is unavailable when no source data exists, and incomplete when at least one contributing linked publication/account lacks the observations needed to calculate it. Do not present partial aggregates as complete totals. The response preserves that status alongside nullable values; zero remains a valid measured value.

## 7. Security and Observability

Enforce tenant authorization at use-case and repository boundaries. Avoid exposing cross-tenant episode/publication existence through validation errors. Record actor, tenant, source publication identities, model/schema, confidence, decision, episode, platform, observation time, and outcome for audit; do not log secrets or unnecessary raw request data. Label imported metadata and manual metrics by source; never present a JEV suggestion as provider-verified data.

## 8. Verification

Apply Clean Code and TDD (Red-Green-Refactor). Every use case requires unit tests; critical journeys require E2E coverage using deterministic persistence/authentication test doubles.

- **Unit:** candidate schema validation, classification/confidence handling, deterministic season/episode identity extraction and grouping, seasonal/non-seasonal invariants, approval/rejection/deferral, tenant-unique series/episode codes, formulas and zero/missing denominator behavior, period aggregation and incomplete-history handling, account follower deltas, ranking, series trends, BRL revenue/cost and milestone progress.
- **Integration:** tenant-scoped Series/Episode/publication association and candidate persistence; source ID preservation, duplicate suggestion idempotency, atomic approval, rollback on conflict, seasonal uniqueness constraints, localized rationale partial failures, and manual observation/revenue persistence. JEV adapter tests use deterministic HTTP doubles.
- **E2E:** import deterministic publications for supported discovery platforms, create suggestions with a JEV test double, verify same-episode posts from different networks appear in one carousel and explicit approval creates one Episode with preserved per-platform source IDs, then add manual performance observations and verify dashboard results. Exercise cross-tenant denial, JEV failure, uncertain/missing metadata, missing metrics, incomplete time coverage, follower conversion, costs/revenue, and milestones. No production social APIs or live model output.

## 9. Open Technical Decisions

- Manual observation cadence, retention, audit detail, and correction policy.
- Exact source/attribution labels and platform-specific follower metric definitions.
- Default ranking window and tie-breaking behavior.
- Whether the configured JEV provider supports arbitrary structured series/season/code extraction; until verified, only deterministic explicit-pattern extraction is permitted and the creator supplies/corrects other fields.
- Classification confidence threshold and refresh behavior when an imported publication's title/description changes.
- Suggestion retention, rejection reappearance, and how a later changed classification is audited.
- Exact platform-specific definitions/units for reach, retention, average watch time, and follower attribution.
- Future provider metric adapters, including YouTube, require verified official capabilities and a separately approved scope.
