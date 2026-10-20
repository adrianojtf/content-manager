# Technical Specification — Publication Analytics and Novelaria Dashboard

**Status:** Draft. The initial Novelaria dashboard is a tenant-scoped, manually fed MVP. Social API synchronization and YouTube dashboard entry are future work.

**Product PRD:** [Publication Analytics](../product/prds/analytics.md)  
**Related technical context:** [Architecture](../architecture/architecture.md), [Domain Model](../domain/domain-model.md)

## 1. Scope

Provide one canonical episode record, manually entered platform performance observations, historical reporting, and a primary dashboard that answers the six Novelaria growth and monetization questions. Initial platform entries are TikTok, Instagram, and Facebook. This analytics-only manual support does not enable TikTok publishing or API access. YouTube is deferred for this dashboard MVP. Automated API metrics, provider adapters, and queue-based synchronization are not required.

## 2. Architectural Placement

- **Domain:** tenant-owned episode identity, series and episode number, episode-level production economics, platform performance observations, monthly revenue, metric availability, and deterministic calculation rules.
- **Application:** create/update episode, record manual observations and revenue, query date-bounded aggregates, rankings, series trends, and milestone progress.
- **Ports:** tenant-scoped episode/observation/revenue repositories and reporting queries. Social `MetricsReader` adapters are future extensions, not an MVP dependency.
- **Adapters:** persistence, authenticated HTTP/presentation, and dashboard rendering. No social SDK, provider API, queue worker, or live service is called by this MVP.

Keep domain calculations independent of NestJS, persistence, and presentation. Tenant identity is resolved from the authenticated principal and never trusted from request payloads.

## 3. Logical Data Contract

### Episode

- Tenant ID, resolved server-side.
- Stable human-readable episode code, unique within its tenant (example `FQA-E07`); distinct from UUIDs for Content, Publication, and external provider records.
- Series name/identity and episode number.
- Optional episode-level production cost as a structured BRL amount and production time as a duration.

The episode is an analytics subject and can be registered without uploading media or creating a publishing `Content` item. A future association to Content must not change the episode code.

### Platform performance observation

- Episode ID, platform (`TIKTOK`, `INSTAGRAM`, or `FACEBOOK` in MVP), publication date, and platform-reported duration.
- Observation time (UTC instant; ISO 8601 with explicit offset at transport boundaries).
- Optional reported values for views, likes, comments, shares, saves, reach/unique viewers, episode-attributed followers gained, profile visits, and average watch time/retention, with unit/definition metadata where it differs by platform.
- Source is manual in MVP. Missing/unavailable is distinct from zero.

### Platform audience observation

Store dated total-follower snapshots by tenant and `SocialAccount` ID; do not create a separate analytics account identity. This makes AN-02 dependent on SOC-02, which implements the tenant-scoped connected-account model. New account followers for a reporting period are calculated as the delta between valid snapshots bracketing that period; episode-attributed follower gains remain distinct and are used for episode view-to-follower conversion. Combined account totals are sums across platform accounts, not unique people.

Store dated cumulative-counter observations without overwriting prior history. The minimum identity is episode + platform + observation time; exact duplicate submissions for the same identity are idempotent, while a correction is an explicit update to that observation. Multiple publication records for one episode/platform remain an open product decision. Manual values must retain their entered attribution/period semantics and must not be presented as verified provider measurements.

### Monthly revenue

Store optional revenue by tenant, platform, and calendar month as structured BRL amounts; persist monetary amounts as exact `NUMERIC(14,2)` values and reject inputs with more than two fractional digits rather than rounding. Missing revenue is not zero. Episode production costs/time are not duplicated across platform records. For monthly cost-versus-revenue reporting, assign each episode's production cost once to the calendar month of its earliest platform publication.

### Time and calculation rules

Observation instants are stored in UTC. Calendar reporting windows use the tenant timezone, falling back to UTC, and display localization must not change stored values. Compute cumulative-counter period totals from the closest valid observation at/before the window start and an observation in the window/end boundary; expose insufficient observation coverage as unavailable. Do not sum cumulative snapshots. Month-over-month view growth compares complete calendar months when both are complete; for an incomplete current month, compare month-to-date with the prior month through the same day number, capped at the prior month's final day. Growth is unavailable if the previous comparable period is missing or zero.

Use the MVP formulas from the PRD: engagement rate = (likes + comments + shares + saves) / views × 100; share rate = shares / views × 100; view-to-follower conversion = followers gained / views × 100. Numerator and denominator must refer to the same episode/platform/reporting period. A missing input or zero views yields unavailable rate. Cross-platform totals are sums of platform values, not unique people. Do not assert metric equivalence where platform definitions differ.

## 4. Manual Entry and Query Flows

1. Authenticate the creator and derive tenant context from the principal.
2. Create or update one episode using a tenant-unique episode code, series, episode number, and optional episode-level production cost/time.
3. Record a dated platform performance observation against that episode; validate platform and numeric/unit constraints while retaining missing values as unavailable.
4. Record dated platform-account follower totals and monthly platform revenue when available.
5. Dashboard queries load one coherent reporting window and return views for the previous 7, 30, and 90 days, month-over-month views/growth, account follower totals/net-new deltas, platform breakdown/growth, rates, rankings, series trends, economics, and goal progress.
6. Display the six primary answers together: overall growth, growing platform, best series, best episode, episode follower conversion relative to views, and proximity to monetization milestones.

The monthly milestones are 1M, 3M, 5M, and 10M views; revenue milestones are BRL 1k, 3k, 5k, 10k, 20k, and 50k. Current-month progress is evaluated in tenant timezone (UTC fallback).

## 5. Failure, Validation, and Tenant Isolation

- Reject duplicate episode codes within a tenant; the same code may exist in another tenant without revealing that tenant's record.
- Reads and writes always include principal-derived tenant ID; cross-tenant IDs must not expose or mutate data.
- Reject invalid dates, negative counters/cost/time, invalid platform values, and malformed money values; do not silently coerce missing values to zero.
- Preserve earlier observations when a new observation is added. A correction to an existing observation must target its identity and remain auditable according to repository conventions.
- If a reporting window cannot be computed from observations, return an explicit unavailable/incomplete-coverage state; do not fabricate growth or rates.
- Revenue and production cost are separate values; costs are not inferred from time and revenue is not inferred from platform metrics.

## 6. Dashboard Presentation Contract

The primary dashboard must prioritize the six questions over detailed tables, and the six answers plus headline metrics and goal progress must be visible in its first view without requiring navigation. In a task-based usability check, at least 4 of 5 representative creators must answer all six questions within 10 seconds each, without assistance. Rankings and trend views support a selectable reporting window; default ranking window is an open product decision. Every aggregate indicates its window and platform scope. Distinguish zero, unavailable, incomplete history, and not-yet-monetized. Label follower totals as the sum of platform account figures, not unique people. Surface the next and achieved monthly goal milestones.

## 7. Security and Observability

Enforce tenant authorization at use-case and repository boundaries. Avoid exposing cross-tenant episode existence through validation errors. Record actor, tenant, episode, platform, observation time, and outcome for auditable manual changes; do not log secrets or unnecessary raw request data. Manual entries are creator-provided and must be labeled as such.

## 8. Verification

Apply Clean Code and TDD (Red-Green-Refactor). Every use case requires unit tests; critical journeys require E2E coverage using deterministic persistence/authentication test doubles.

- **Unit:** tenant-unique episode codes, formulas and zero/missing denominator behavior, period aggregation and incomplete-history handling, account follower deltas, ranking, series trends, BRL revenue/cost and milestone progress.
- **Integration:** tenant-scoped persistence for episodes, platform observations, account follower snapshots, and revenue; duplicate observation identity and correction behavior.
- **E2E:** create one episode, add observations for each MVP platform and platform-account follower snapshots, and verify the dashboard sums and separates data; exercise cross-tenant denial, missing metrics, incomplete time coverage, follower conversion, costs/revenue, and monthly milestones. No production social APIs or live model output.

## 9. Open Technical Decisions

- Manual observation cadence, retention, audit detail, and correction policy.
- Whether one episode can have multiple publications on the same platform and how those are ranked/aggregated.
- Exact source/attribution labels and platform-specific follower metric definitions.
- Default ranking window and tie-breaking behavior.
- Exact platform-specific definitions/units for reach, retention, average watch time, and follower attribution.
- Future provider metric adapters, including YouTube, require verified official capabilities and a separately approved scope.
