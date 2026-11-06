# PRD — Episode Setup Workflow

**Status:** Draft  
**Parent PRD:** [Publication Analytics](./analytics.md)  
**Tech spec:** [Technical Specification — Episode Setup Workflow](../../specifications/technical-episode-setup-workflow.md)

## 1. Objective

Replace the all-at-once episode review queue with a guided setup that confirms series first, seasons second, and episode candidates last. The creator should be able to synchronize eligible imported publication metadata once, resolve each level in order, and arrive at episode suggestions with the confirmed context already applied.

## 2. User and Problem

**Primary user:** a Novelaria creator reviewing imported social publications for the analytics dashboard.

The current screen mixes series selection, season mode, season number, episode identity, and source-publication decisions on every episode card. This repeats setup work and makes it difficult to establish a consistent series/season structure before approving episodes.

## 3. Product Principles

- Guide setup in the fixed order: **Series → Seasons → Episodes**.
- Automatically classify eligible imported publication metadata and prepare the next step; do not make the creator repeat the same series/season choices for every episode.
- Use explicit creator confirmation for series configuration and episode creation/linking. "Automatic" means synchronization, classification, grouping, prefill, and progression—not silent creation of canonical episodes or publication links.
- Never fetch social data from the episode setup flow. It operates only on already-imported tenant-scoped publication metadata.
- Preserve uncertainty and partial failures. Do not infer that a missing season means a non-seasonal series.

## 4. User Flow

1. **Synchronize:** on entering setup, the application idempotently evaluates newly available imported publications and refreshes the review candidates. The creator can also request a refresh. The screen reports scanned, classified, skipped, and failed items.
2. **Confirm series:** show proposed series names and supporting publication examples, alongside existing series. Hide candidates with no identified series by default so likely non-series posts do not dominate review; provide a visible control to reveal and optionally assign/add them. The creator can correct the proposed canonical name, aliases, and `SEASONAL` / `NON_SEASONAL` mode when creating a new series, map candidates to an existing series, or explicitly defer candidates. Confirmed series become available to the following step; editing existing series metadata is not part of this workflow.
3. **Confirm seasons:** show confirmed series and their proposed seasons, with the publications that support each season. The creator can confirm or correct season numbers and assign ambiguous candidates. A `NON_SEASONAL` series proceeds without a season number. A `SEASONAL` series with unknown season remains unresolved until the creator supplies a positive season number or defers the candidate.
4. **Review episodes:** show one review card per confirmed episode identity, regardless of which social networks published it. If the same episode appears on Instagram, TikTok, YouTube, Facebook, or multiple accounts, place those publication records together in a carousel inside that card. Keep the series/season/episode identity and approval action at the card level; each carousel slide shows the individual network, account, title/caption, publication date, link, and classification evidence. Keep unmatched/identity-incomplete candidates collapsed by default behind a visible control with their count. The creator can reveal them, browse slides, remove individual publications from the approval selection, correct the shared identity, reject, defer, and explicitly approve the episode group and selected publications.
5. **Progress automatically:** when every item in the current step is confirmed, assigned, or explicitly deferred, advance to the next step and load its prepared data without requiring a separate "Next" action. Preserve progress across reloads and allow returning to earlier steps to correct configuration.

The screen always shows the current step, completed steps, unresolved/deferred counts, synchronization time, and a way to retry failures. A newly imported or materially changed publication is evaluated idempotently and appears in the appropriate review step without resetting completed decisions for unchanged items.

## 5. Requirements

### ESW-01 — Ordered setup

Present the series confirmation step before seasons and seasons before episodes. Do not expose episode approval while the candidate's series/season context is unresolved.

### ESW-02 — Idempotent synchronization

On setup entry and explicit refresh, classify only tenant-scoped imported publication metadata. Reprocessing unchanged source fingerprints creates no duplicate candidate or JEV evaluation. Changed metadata creates a reviewable revision and preserves prior decisions. Report partial failures without discarding successful work.

### ESW-03 — Creator-confirmed series

The creator confirms the canonical series name, aliases, and season mode or maps the proposal to an existing series before it is used by later steps. Do not silently merge series based on similar names or AI confidence. Keep unresolved items out of downstream episode approval.

### ESW-04 — Season resolution

For seasonal series, a season is a positive integer and must be confirmed or corrected before episode review. For non-seasonal series, store no season number. Missing/ambiguous season data stays unresolved; it is never treated as seasonless automatically. Season is a grouping/configuration value, not a separate canonical domain entity in this scope.

### ESW-05 — Episode approval boundary

Use confirmed series/season context to pre-group and prefill episode candidates. No canonical episode or publication association is created until the creator explicitly approves the episode group. Rejection and deferral do not create or link records.

### ESW-06 — Resume and correct

Persist stage decisions and progress so reloads, navigation, and partial failures do not lose creator work. Revising a series or season invalidates only affected downstream candidate groupings and asks for confirmation again; it must not silently change existing canonical episodes or links.

### ESW-07 — Review cross-network publications as one episode

After series and season confirmation, group all actionable publication candidates by the same tenant-scoped confirmed Series, season state/number, and episode number. Platform, social account, caption similarity, and publication date are not part of the episode identity key. Show every publication in that group in a single episode card with a navigable carousel; do not create one episode card or canonical Episode per network. Preserve per-publication source identity and allow the creator to include or exclude each source from approval.

If a group is partially approved, only selected publications are linked; unselected publications remain pending and can later be linked to the same canonical Episode without creating a duplicate. Conflicting episode codes or identities must be surfaced as a conflict for correction, not merged into a carousel group.

### ESW-08 — Keep unidentified candidates out of the default review

Hide series proposals without an identified name and unmatched episode candidates by default. Show a localized, accessible reveal control with a candidate count so the creator can opt in to reviewing and assigning them. Hiding is a presentation-only choice: it must not reject, defer, delete, or omit candidates from synchronization/persistence.

Keep the creator's Series catalog and manual Episode entry available on the Episodes screen independently of AI recommendations. Recommendations remain available in a secondary panel that starts collapsed; opening or closing it does not change any suggestion or setup decision.

Present Series in a paginated list. Selecting a Series opens a dedicated detail view with a back action and an unpaginated list of its saved Episodes as cards. Each card shows the season and episode number plus identifying details from every linked publication, including platform/account, title, full description, and publication date where available. A "suggest episodes" action opens a modal with all unassigned pending episode suggestions, without pagination; the creator selects the correct candidates and adds them to the Series. This assignment only confirms the suggested Series mapping; season confirmation and explicit episode approval are still required before canonical Episodes or publication links are created.

Show mapped suggestions separately from saved Episodes in the Series detail view with source descriptions and identifying metadata. Group these suggestions by social platform and order each platform's publications by date, oldest first. Extract explicit episode numbers from publication titles/descriptions during evaluation. If the number is unavailable after extraction, let the creator enter it on the candidate before selecting it. Keep candidates with unresolved season unselectable, and keep the selection count/add button pinned to the bottom while scrolling. Generate any canonical episode code internally. Adding selected candidates is explicit episode approval.

### ESW-09 — Resolve named seasons without hard-coded series rules

Named arcs (e.g. `Obsidiana: O Legado`) are not resolved by deterministic, series-specific rules. They surface as regular suggestions and are mapped to a canonical series through the episode identity cascade — JEV extraction against the tenant series catalog — or through creator-confirmed series aliases. An arc title never implies a season number or a separate Series by itself; the creator still confirms the series mapping, seasonal mode, and season in the normal setup steps.

## 6. Acceptance Criteria

- [ ] The setup presents only the current step in the order Series → Seasons → Episodes, with visible progress and counts.
- [ ] Initial synchronization and explicit refresh use only already-imported tenant-scoped records; no social API is called from this workflow.
- [ ] Unchanged imports are idempotent; changed source metadata creates a reviewable revision while prior decisions remain auditable.
- [ ] Series require creator confirmation of canonical name and season mode; similar names are not automatically merged.
- [ ] Seasonal candidates require a confirmed positive season number before episode review; non-seasonal candidates carry no season number; unknown seasons remain unresolved.
- [ ] Episode numbers are extracted from explicit title/description markers during evaluation; creators confirm/add by episode number without entering an episode code.
- [ ] The next step loads automatically when the current step has no unresolved items; reload preserves completed decisions and current progress.
- [ ] Episode groups are prefilled from confirmed context, remain editable, and require explicit creator approval before canonical episodes/publication links are written.
- [ ] Publications from different social networks with the same confirmed series, season, and episode number appear together in one episode card carousel, independent of platform/account. The carousel exposes each publication's provenance and supports accessible previous/next navigation.
- [ ] Approving a cross-network group creates at most one canonical Episode and links only selected source publications, preserving each platform, account, and external publication ID. Excluded sources remain pending; a later approval links them to the existing Episode rather than creating a duplicate.
- [ ] Conflicting series/season/episode identity or incompatible episode codes are not silently grouped; the creator must resolve the conflict before approval.
- [ ] Unidentified series proposals and unmatched episode candidates are hidden by default behind accessible, localized reveal controls with accurate counts; revealing them allows normal assignment/review without changing their persisted decision state.
- [ ] Creator-created series remain listed on the Episodes screen, manual episode entry is available at every recommendation stage, and recommendations start collapsed without affecting their persisted state.
- [ ] Series use a paginated list; selecting one opens a detail view with a back action and all its saved Episodes, while the suggestion modal shows all candidates without pagination and only maps creator-selected suggestions to the Series.
- [ ] Named arcs resolve without series-specific deterministic rules: `Obsidiana: O Legado` can be mapped to Series `Obsidiana` via the JEV catalog extraction or a creator-confirmed alias, and the creator confirms the mapping and season before episode approval.
- [ ] A conflict or failed item does not block confirmation of independent items; errors are visible with retry or defer actions.
- [ ] All new interface copy has semantic catalog entries in `pt-BR`, `en-US`, and `es-ES`; loading, empty, partial-failure, and error states work with light and dark themes.

## 7. Out of Scope

- Fetching or backfilling publications from social providers.
- Creating a separate Season domain entity or season-level analytics.
- Automatically approving episode suggestions, creating episodes, or linking publications based only on JEV output.
- Background/scheduled synchronization independent of opening or refreshing the setup flow.
- Changes to performance metrics, dashboard calculations, or publication APIs.

## 8. Dependencies

- Existing tenant-scoped social publication persistence and episode classification/review.
- Existing Series/Episode repositories, explicit approval use cases, and localization catalogs.
- JEV remains a classification/intelligence provider only; see the project AI and authorization boundaries.
