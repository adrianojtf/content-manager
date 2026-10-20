# PRD — Publication Analytics

**Status:** Draft — MVP product decisions are defined; implementation and platform metric/API capabilities remain subject to verification.  
**Tech spec:** [Technical Specification — Publication Analytics](../../specifications/technical-analytics.md)

## 1. Objective

Phase 2 delivers Novelaria a simple dashboard that makes it possible to assess growth and identify effective series and episodes within 10 seconds. This dashboard phase follows the Phase 1 publication/community workflow and is manually fed; it does not depend on social APIs.

## 2. User and Problem

**Primary user:** a Novelaria creator using the controlled single-creator pilot in Phase 2; public multi-tenant access waits for Phase 3 product-user authentication.

The creator needs one record per episode, with separate performance data for each platform, to understand overall growth, platform contribution, audience conversion, production economics, and progress toward monthly goals.

## 3. MVP Scope

- Manually register each episode once with a stable, human-readable ID such as `FQA-E07`, its series, and episode number.
- Record a publication/performance entry for TikTok, Instagram, or Facebook against that shared episode. YouTube is a future addition to this dashboard.
- Manually enter and retain dated performance observations, including metrics that are unavailable on some platforms.
- Capture episode-level production cost and time, and monthly revenue by platform when monetization begins.
- Provide a prioritized dashboard, episode/series rankings, trends, and progress toward the agreed monthly view and revenue milestones.
- Keep platform-specific definitions visible; manual analytics recording does not imply publishing or API integration support for that platform.

## 4. Requirements

### AN-01 — Register a shared episode identity

Create one tenant-scoped episode record containing a series name, episode number, and stable unique code (for example `FQA-E07`). The code identifies the same episode across platforms and is distinct from any content, publication, or provider ID. Platform performance entries refer to this episode; episode-level production cost and time are recorded once, not once per platform.

### AN-02 — Manually record platform performance

For each episode and platform, manually record publication date, duration, views, likes, comments, shares, saves, reach/unique viewers when available, episode-attributed followers gained, profile visits, and average watch time/retention when available. Each observation has an observation date/time. Separately record dated total-follower snapshots for each platform account to support total and net-new follower reporting. Missing or unsupported values must not be represented as zero. MVP platforms are TikTok, Instagram, and Facebook; YouTube is deferred. No social API synchronization is required for this MVP.

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

- [ ] A tenant can register one episode with a unique code, series, and episode number, then associate separate TikTok, Instagram, and Facebook performance records with it without duplicating the episode.
- [ ] Episode production cost and time are stored once; revenue is recorded by platform and calendar month as structured BRL amounts.
- [ ] Manual performance observations include an observation time and distinguish missing/unavailable metrics from measured zero; dated per-platform-account follower snapshots support total and net-new follower reporting.
- [ ] The dashboard presents all six decision answers and the listed 7/30/90-day, monthly, platform, ranking, series-trend, conversion, economics, and milestone views in its primary view; at least 4 of 5 representative creators can answer all six questions within 10 seconds each, without assistance, in a task-based usability check.
- [ ] Time-window totals and growth are calculated from dated observations; insufficient history is displayed as unavailable rather than fabricated as zero.
- [ ] Engagement, share, conversion, growth, and milestone calculations follow AN-06 and AN-07, including zero/missing-denominator behavior.
- [ ] Cross-platform sums are identified as sums across platform accounts, not unique audience members; platform-specific metrics are not implied to be equivalent.
- [ ] The initial manual workflow works without social API credentials or API calls; YouTube entry and automated synchronization are not required for this MVP.

## 6. Out of Scope

- Automated metric collection or synchronization from social APIs in the initial dashboard MVP.
- YouTube performance entry in the initial Novelaria dashboard; it is a future addition.
- TikTok publishing or API integration by virtue of supporting manual analytics entry.
- Advertising analytics, paid campaign attribution, predictive analytics, or causal claims.
- Automated episode production-time/cost capture.

## 7. Dependencies

- Tenant identity and authorization for episode and analytics data.
- Localization/reporting timezone context.
- Future YouTube and social API metric support requires separately verified platform capabilities and permissions.

## 8. Open Questions

- What is the dashboard's exact manual observation cadence and retention policy?
- Can an episode have multiple publications on the same platform, and if so, how should they be ranked and aggregated?
- Which source/attribution label should be captured for follower metrics on each platform?
- Should ranking default to the current month or a user-selected reporting window?
