# PRD — Publication Analytics

**Status:** Draft — MVP product decisions are defined; implementation and platform metric/API capabilities remain subject to verification.  
**Tech spec:** [Technical Specification — Publication Analytics](../../specifications/technical-analytics.md)

**Episode setup workflow:** [PRD](./episode-setup-workflow.md) · [Technical specification](../../specifications/technical-episode-setup-workflow.md)

## 1. Objective

Phase 2 delivers Novelaria a simple dashboard that makes it possible to assess growth and identify effective series and episodes within 10 seconds. Episode identity starts from AI-assisted suggestions over already-imported social publications, with creator approval before an episode is created or publications are linked. Performance observations remain manually fed; the workflow does not add social API calls.

## 2. User and Problem

**Primary user:** a Novelaria creator using the controlled single-creator pilot in Phase 2, protected by the Phase 1 pilot login; public multi-tenant access and tenant administration wait for Phase 3.

The creator needs one record per episode, with separate performance data for each platform, to understand overall growth, platform contribution, audience conversion, production economics, and progress toward monthly goals.

## 3. MVP Scope

- Suggest episode candidates from already-imported TikTok, Instagram, Facebook, and YouTube publication titles/descriptions. YouTube is a discovery source only; its performance entry remains future work.
- Maintain a tenant-scoped series record with a canonical name, aliases, and a season mode (`SEASONAL` or `NON_SEASONAL`). Every canonical episode belongs to exactly one series.
- Let JEV classify whether a publication appears to be an episode. Extract possible series, season, episode number, and code only through a verified structured provider contract; otherwise parse explicit identity patterns deterministically and let the creator supply or correct missing fields. A missing season is unknown, not seasonless. Group only candidates with matching normalized series identity, season mode/number, and episode number.
- Review candidates in the sequential [Episode Setup Workflow](./episode-setup-workflow.md): confirm series configuration, then season assignments, then episode groups. The creator can edit identity, remove publications, reject, or defer. Synchronize/classify already-imported metadata and advance automatically when a step's decisions are resolved; series configuration and final episode approval remain creator-confirmed. Retain manual registration as a fallback.
- Let the creator manually create a Series and manually register an Episode. During manual episode registration, the creator may select one already-imported, not-yet-linked publication per social network; each network is an independent optional source and the selected thumbnail appears on that network's tile.
- Record a separate publication/performance entry for each TikTok, Instagram, or Facebook post linked to that shared episode; one episode may have multiple posts on the same platform.
- Manually enter and retain dated performance observations, including metrics that are unavailable on some platforms.
- Capture episode-level production cost and time, and monthly revenue by platform when monetization begins.
- Provide a prioritized dashboard, episode/series rankings, trends, and progress toward the agreed monthly view and revenue milestones.
- Keep platform-specific definitions visible; manual analytics recording does not imply publishing or API integration support for that platform.

## 4. Requirements

### AN-01 — Register a shared episode identity

Maintain one tenant-scoped Series record with a canonical name, optional aliases, and season mode (`SEASONAL` or `NON_SEASONAL`). Each tenant-scoped Episode belongs to exactly one Series, has a positive episode number, and has a stable unique code (for example `FQA-S02-E07`). A seasonal series requires a positive season number on every episode; a non-seasonal series stores no season number. Episode identity is `(series, season number, episode number)` and is unique within the tenant. The code identifies the same episode across platforms and is distinct from any content, publication, or provider ID. A series/episode may be created by the creator or from an explicitly approved suggestion; AI classification alone never creates or merges records. Platform publication links and performance entries refer to the canonical episode; episode-level production cost and time are recorded once, not once per platform.

### AN-01a — Suggest episode identity from imported publications

Evaluate normalized title/description metadata from publications already imported by the application. JEV returns a schema-validated episode/not-episode/uncertain classification with confidence and probabilities. The application preserves source text as evidence and records localized rationale variants from deterministic templates. Suggested series name, season, episode number, and optional human-readable code may be returned only through a verified structured provider contract; otherwise, extract only explicit identity patterns deterministically and let the creator fill or correct the fields. A season is known only when explicitly identified or resolved from a confirmed `NON_SEASONAL` series; missing season metadata remains unknown. Group suggestions only when normalized series identity, season mode/number, and episode number match. Preserve each platform's external publication identifier and do not call social APIs from the JEV flow.

Every proposed group is pending until a creator reviews it. The creator can approve the group, remove individual publications, correct the proposed identity, reject it, or leave it pending. Approval creates one canonical episode or links the publications to an existing episode. A rejected, uncertain, conflicting, or incomplete suggestion cannot mutate episode records. Persist an auditable record of the model/schema version, confidence, rationale variants, source publication IDs, creator decision, actor, and timestamps.

After series and season confirmation, publications from different social networks and accounts that identify the same series/season/episode appear together in one review card. The card presents its source publications in a carousel so the creator can inspect and select them before approving one shared episode.

The creator-facing setup order and progression behavior are specified in [Episode Setup Workflow](./episode-setup-workflow.md). A confirmed Series may be saved at the series step; canonical Episodes and publication links remain blocked until explicit episode-group approval.

### AN-01b — Register episodes manually with imported publications

The creator can manually create a Series and an Episode without relying on suggestions. In the manual Episode form, the creator can select no more than one already-imported, not-yet-linked publication per network (Instagram, TikTok, YouTube, Facebook). Each network has its own add/select control and preview tile. Publication choice is optional and must not call a social provider. Creating the Episode and all selected links is one explicit, atomic creator action; an unselected publication remains unchanged.

Repeated synchronization of unchanged publication metadata must not create duplicate suggestions or repeat JEV evaluation. Changed metadata creates a new review candidate while preserving the prior decision history. Each series/season/episode group is confirmed independently so a conflict in one group does not block other reviewed groups.

Episode suggestions are an AI-generated project artifact: store separate auditable rationale variants in Portuguese, English, and Spanish, preserving partial per-language failures. The normalized identity fields are not translated.

### AN-02 — Manually record platform performance

For each approved publication linked to an episode, manually record publication date, duration, views, likes, comments, shares, saves, reach/unique viewers when available, episode-attributed followers gained, profile visits, and average watch time/retention when available. Each observation identifies the source publication and has an observation date/time. An episode can have multiple linked publications on one platform; report their supported values separately and aggregate only according to platform-compatible definitions. Separately record dated total-follower snapshots for each platform account to support total and net-new follower reporting. Missing or unsupported values must not be represented as zero. MVP performance platforms are TikTok, Instagram, and Facebook; YouTube performance entry is deferred. No social metric API synchronization is required for this MVP.

### AN-03 — Preserve history and report time windows

Retain dated observations so growth can be calculated without overwriting prior values. For cumulative counters such as views and followers, period totals are calculated from observation deltas within the selected reporting window; if the observations needed to calculate a window are missing, show the metric as unavailable rather than treating it as zero. Calendar reporting uses the tenant timezone, falling back to UTC.

### AN-04 — Answer the six dashboard questions

The primary dashboard presents, in one view, whether views are growing; which platform is growing; the best-performing series; the best-performing episode; whether follower gains are proportional to views; and progress toward monetization goals. It includes total views for the last 7, 30, and 90 days; month-over-month views and growth; total and new followers; platform-separated views and growth; engagement, share, and view-to-follower conversion rates; episode and series rankings; series trends; and monthly goal progress.

### AN-05 — Show production economics and monetization

Record production cost and production time once per episode. Allow monthly revenue to be recorded per platform when available, and show revenue by platform and costs versus revenue. For monthly cost comparison, attribute an episode's production cost once to the calendar month of its earliest platform publication. Monetary values are structured amounts in BRL for the initial Novelaria dashboard; unknown revenue remains unavailable, not zero.

### AN-06 — Define calculation behavior

For the MVP, engagement rate is `(likes + comments + shares + saves) / views × 100`; share rate is `shares / views × 100`; and view-to-follower conversion is `episode-attributed followers gained / views × 100`. Each numerator and denominator must use the same platform, episode, and reporting period. A rate is unavailable when its inputs are missing or views are zero. Month-over-month growth is `(current comparable-period views - previous comparable-period views) / previous comparable-period views × 100`: compare complete calendar months when both are complete, and compare month-to-date with the prior month through the same day number for an incomplete current month (capped at the prior month's final day). It is unavailable when the prior comparable period is missing or zero. Cross-platform totals are sums of reported platform values and must not be labeled as unique people.

### AN-07 — Track monthly milestones

Show monthly view milestones of 1M, 3M, 5M, and 10M views, and monthly revenue milestones of R$1k, R$3k, R$5k, R$10k, R$20k, and R$50k. Progress uses the current calendar month in the tenant timezone (UTC fallback), and distinguishes achieved, next, and not-yet-reached milestones.

## 5. Acceptance Criteria

- [ ] Series are tenant-scoped records with canonical name, aliases, and season mode; every canonical episode references exactly one series. Seasonal series require positive season numbers; non-seasonal series have no season number.
- [ ] Existing TikTok, Instagram, Facebook, and YouTube publications can produce episode/not-episode/uncertain suggestions with schema-validated classification, confidence, rationale, evidence, and separate Portuguese, English, and Spanish rationale variants; missing metadata remains uncertain. Identity fields are extracted only by verified structured provider output or explicit deterministic patterns.
- [ ] Candidate groups are formed only from matching normalized series identity, season mode/number, and episode number. Missing season metadata remains unknown and is not grouped as seasonless unless the creator selects a confirmed non-seasonal series. A creator can inspect and correct each group, remove individual publications, approve, reject, or defer it.
- [ ] Setup proceeds through Series → Seasons → Episodes, automatically classifying already-imported metadata, preparing the next step, and advancing after current-step decisions resolve. Series configuration requires creator confirmation; no canonical episode or publication link is created before explicit episode-group approval.
- [ ] The creator can manually create a Series and register an Episode. For each supported network the creator can select at most one previously imported, unlinked publication through a picker modal; the selected thumbnail and source remain visible on that network's tile.
- [ ] Manual episode creation with selected publications creates one Episode and its selected publication links atomically; omitted networks remain unlinked. The picker reads only local imported records and never fetches social data.
- [ ] Publications from different networks/accounts with the same confirmed series, season, and episode identity appear in one carousel card and are reviewed as one episode group; platform/account differences do not create duplicate Episodes.
- [ ] Re-syncing unchanged metadata is idempotent; changed metadata preserves previous suggestion decisions and creates a new review candidate. Each reviewed group can be confirmed independently.
- [ ] A tenant can manually register a series and season-aware episode as a fallback, then associate multiple distinct TikTok, Instagram, and Facebook publications with it without duplicating the episode; each observation retains its source publication identity.
- [ ] Episode production cost and time are stored once; revenue is recorded by platform and calendar month as structured BRL amounts.
- [ ] Manual performance observations include an observation time and distinguish missing/unavailable metrics from measured zero; dated per-platform-account follower snapshots support total and net-new follower reporting.
- [ ] The dashboard presents all six decision answers and the listed 7/30/90-day, monthly, platform, ranking, series-trend, conversion, economics, and milestone views in its primary view; at least 4 of 5 representative creators can answer all six questions within 10 seconds each, without assistance, in a task-based usability check.
- [ ] Time-window totals and growth are calculated from dated observations; insufficient history is displayed as unavailable rather than fabricated as zero.
- [ ] Engagement, share, conversion, growth, and milestone calculations follow AN-06 and AN-07, including zero/missing-denominator behavior.
- [ ] Cross-platform sums are identified as sums across platform accounts, not unique audience members; platform-specific metrics are not implied to be equivalent.
- [ ] Episode discovery uses already-imported publication metadata and performs no additional social API calls. Manual analytics observations work without social API credentials; automated metric synchronization and YouTube performance entry are not required for this MVP.

## 6. Out of Scope

- Automated metric collection or synchronization from social APIs in the initial dashboard MVP.
- YouTube performance entry in the initial Novelaria dashboard; YouTube publication metadata is used only for episode discovery.
- TikTok publishing or API integration by virtue of supporting manual analytics entry.
- Advertising analytics, paid campaign attribution, predictive analytics, or causal claims.
- Automated episode production-time/cost capture.

## 7. Dependencies

- Tenant identity and authorization for episode and analytics data.
- Localization/reporting timezone context.
- Episode suggestions depend on already-imported, tenant-scoped social publications and the JEV intelligence boundary.
- Future YouTube and social API metric support requires separately verified platform capabilities and permissions.

## 8. Open Questions

- What is the dashboard's exact manual observation cadence and retention policy?
- Which source/attribution label should be captured for follower metrics on each platform?
- Should ranking default to the current month or a user-selected reporting window?
- Should the Episodes screen show rejected suggestions again, and for how long should unapproved suggestions be retained?
- Which explicit caption/title patterns and aliases should the deterministic parser support for season and episode identity?
