# Technical Specification — Episode Setup Workflow

**Status:** Draft  
**Product PRD:** [Episode Setup Workflow](../product/prds/episode-setup-workflow.md)  
**Parent technical specification:** [Publication Analytics](./technical-analytics.md)

## 1. Scope

Implement an ordered review workflow over existing tenant-scoped imported publication metadata: confirm series configuration, confirm season assignments, then review and explicitly approve episode groups. Synchronization means idempotent classification of already-imported records, not social-provider fetching. The workflow automates classification, grouping, prefill, and progression; it does not automatically create canonical episodes or publication links.

## 2. Architectural Placement

- **Domain:** existing Series/Episode identity rules and normalized review decisions; no Season entity is introduced.
- **Application:** setup orchestration, idempotent refresh, step eligibility/progression, confirmation validation, and calls to existing series/episode use cases.
- **Ports:** existing publication, social-account, and episode-review ports, extended with tenant-scoped workflow-decision persistence.
- **Adapters:** authenticated HTTP controller, PostgreSQL migration/repository, and episode setup presentation module.

JEV receives only normalized metadata through the existing classifier port. It does not access persistence or social APIs and cannot mutate Series, Episodes, suggestions, or publication links. Resolve tenant and actor from the authenticated principal; never accept them from request bodies.

## 3. Workflow State and Persistence

Add migration `025` after migration `024`, creating `analytics_episode_setup_decisions`, keyed by `(tenant_id, suggestion_id)`. Add a composite unique constraint on `(tenant_id, id)` to `analytics_episode_suggestions` if one is not already provided by the deployed schema. The decision row references its suggestion and any selected Series through tenant-scoped composite foreign keys. Persist:

- `tenant_id` and source suggestion/publication identity.
- Series decision outcome: `CONFIRMED`, `DEFERRED`, or `NOT_EPISODE`; `series_id` is required only for `CONFIRMED`.
- Season decision outcome: `CONFIRMED_NUMBERED`, `NOT_REQUIRED`, or `DEFERRED`; a positive `season_number` is required only for `CONFIRMED_NUMBERED`.
- Confirmation actor and timestamps for series and season decisions.
- Existing suggestion status, source fingerprint, classification/evidence, and episode approval audit.

For a seasonal Series, only `CONFIRMED_NUMBERED` with a positive season number unblocks episode review. For a creator-confirmed non-seasonal Series, set `NOT_REQUIRED`; do not store a season number. Constrain combinations so a confirmed numbered season cannot lack a series, and a non-seasonal mapping cannot carry a season number. All reads/writes use tenant scope. Preserve earlier decision history when a source fingerprint changes; a changed candidate must be reviewed as a new revision rather than overwriting a prior creator decision. A season is a confirmed number associated with a series; do not create a season table/entity in this increment.

### Derived stage

The application derives the current stage from eligible suggestions and persisted decisions:

1. `SERIES` while any eligible candidate has no series decision.
2. `SEASONS` after all eligible candidates have a series decision, while any candidate assigned to a seasonal series lacks a confirmed positive season or explicit defer decision.
3. `EPISODES` after series and season decisions are complete. Candidates group only by exact confirmed series, season state/number, and episode number.
4. `COMPLETE` when no actionable pending episode groups remain. Deferred and `NOT_EPISODE` items remain visible in counts/history and do not block progress.

Existing creator-created Series records are already confirmed choices but do not implicitly assign a candidate to them. New source records discovered during refresh enter the appropriate step without resetting decisions for unchanged candidates. The server is authoritative for stage and readiness; the client cannot skip a step by submitting an episode approval directly.

## 4. Application Contracts

Expose workflow-specific use cases, keeping HTTP DTOs in the presentation adapter:

- `GetEpisodeSetup`: returns current stage, completed-stage flags, series proposals/options, season proposals, episode groups where eligible, unresolved/deferred counts, and last synchronization outcome.
- `SynchronizeEpisodeSetup`: reuses the existing suggestion-refresh orchestration over stored publications; returns scanned/classified/skipped counts and per-account/publication failures.
- `ConfirmEpisodeSetupSeries`: validates and persists the creator's canonical-series selection/configuration for a bounded set of candidates.
- `ConfirmEpisodeSetupSeasons`: validates a positive season assignment for seasonal candidates, or confirms the no-season state only for a creator-confirmed non-seasonal series.
- Existing `ApproveEpisodeSuggestionGroup` remains the only operation that creates/links an episode group. It must validate persisted series/season confirmations and the selected source identities before atomic approval.
- Existing reject/defer operations remain available for actionable suggestions and must preserve their decision audit.

Suggested HTTP surface under the authenticated `/analytics/episodes/setup` route:

- `GET /analytics/episodes/setup`
- `POST /analytics/episodes/setup/synchronize`
- `POST /analytics/episodes/setup/series/confirm`
- `POST /analytics/episodes/setup/seasons/confirm`

Episode approval/rejection can continue using the existing review endpoints if the controller verifies setup readiness. Request bodies are allowlisted, bounded in size, and contain suggestion IDs plus creator decisions only; tenant and actor are server-resolved.

## 5. Processing and Progression

1. On screen entry, load saved decisions and run the existing idempotent refresh over stored publication metadata; expose an explicit refresh action as well. The refresh scans stored records and skips unchanged fingerprints. Do not call a social publication reader from this workflow.
2. Refresh uses source fingerprints: skip linked or unchanged sources, classify changed/new metadata through the existing classifier, and save successes independently. Return partial failures instead of failing the entire batch.
3. Present only decisions relevant to the current stage. Series suggestions may be mapped to an existing tenant-owned series or confirmed as a new series with creator-supplied canonical name, aliases, and season mode. Never auto-merge canonical series. Existing Series metadata is not edited by this workflow.
4. After valid series decisions commit, recompute the stage. Seasonal candidates require a positive season confirmation/correction. For a non-seasonal Series, the creator's explicit mode confirmation permits `NOT_REQUIRED`. Unknown or conflicting seasons stay out of episode approval until assigned; explicitly deferred candidates remain out of the actionable flow.
5. Once all actionable series/season decisions are complete, automatically render the episode step with exact deterministic groups and prefilled identity. Group across platforms and accounts; individual source publications remain selectable/removable. The creator explicitly approves each group.
6. Approve each episode group atomically using existing repository transaction boundaries. Validate that all selected source candidates have confirmed matching series/season/episode identity, remain pending, belong to the authenticated tenant, and still resolve to imported source records. Create the canonical Episode once and link only the selected publication identities after that explicit approval. If the Episode already exists, link approved pending sources to it rather than creating a duplicate.
7. Recompute stage after every successful confirmation/decision. A failure leaves earlier committed independent decisions intact and the failed items retryable.

Stage progression is automatic; it must not require a second "Next" click. The client may navigate to completed steps for correction. Editing a confirmed series season mode or a season assignment marks only affected pending groups for re-review. Existing canonical episodes and links are never silently rewritten.

### Named season aliases

Use a narrow deterministic alias rule for the documented `Obsidiana` series: a title/header matching `Obsidiana: O Legado` or the explicit `#ObsidianaOLegado` tag yields canonical `seriesName = "Obsidiana"` and a proposed numbered season `2`. `#Obsidiana` plus `#OLegado` is the same explicit signal. Do not interpret arbitrary subtitles as season names or infer a seasonal mode from this rule. A plain `Obsidiana` header identifies only the series; season remains unknown unless an explicit `1ª temporada` label is present. Keep the source text as evidence and require the normal creator confirmation before episode approval.

### Unidentified candidate visibility

For the `SERIES` stage, keep proposals with no non-empty `suggestedName` out of the default card list. Return them in the same response with counts so the presentation can reveal them on creator request. For the `EPISODES` stage, keep the `unmatched` collection available to the client but collapsed by default; reveal it only after an explicit toggle. This is presentation state only and must not update suggestion status or setup decisions. After reveal, the creator can use the existing assignment, defer, reject, correction, or approval paths.

### Cross-platform episode grouping and carousel

After creator confirmation of the Series and season, derive each actionable candidate's canonical grouping key as:

`tenantId + confirmedSeriesId + seasonIdentity + episodeNumber`

`seasonIdentity` is the confirmed positive season number for `SEASONAL` series and the explicit seasonless marker for `NON_SEASONAL` series. Do not include platform, social account, publication ID, caption, or publication date in this key. Do not group on unconfirmed series names, unknown seasons, or episode numbers inferred only from similarity. This lets equivalent posts from different networks and multiple accounts resolve to the same episode group while keeping every source publication distinct.

Render each group as one episode review card. Keep shared identity fields, publication count, selection summary, and the approve action outside the carousel. Each slide represents exactly one imported publication and exposes its platform/account, title and description, permalink where valid, published date, classification/confidence, and rationale. Provide previous/next controls, current position (for example, `2 of 4`), keyboard and touch navigation, visible focus, and an accessible announcement when the active slide changes. The carousel is only a review presentation; it does not change group identity or publication data.

Selecting/removing a slide changes only whether that source is included in the current approval request. It must not delete the imported publication or silently reject/defer its suggestion. A partial approval creates or resolves one canonical Episode and links only selected sources. Unselected sources remain pending and must reappear in review; when the canonical Episode already exists, subsequent approval links them to that Episode. A source already linked to an Episode is excluded from new pending groups.

If candidate source identities resolve to different confirmed Series, seasons, or episode numbers, keep them in separate groups. If the same proposed key contains conflicting non-empty episode codes or other incompatible identity evidence, surface the conflict for creator correction instead of silently combining sources. Do not fail or hide unrelated valid groups.

### Manual Series and Episode registration

Keep manual creation available independently from AI suggestions:

- `POST /analytics/series` creates a creator-confirmed Series with a canonical name, aliases, and season mode.
- `GET /analytics/episodes/manual/publications?platform={platform}` returns only tenant-scoped publications already stored locally and not linked to any Episode. It must not call a platform adapter.
- `POST /analytics/episodes/manual` accepts the Series ID, season/episode identity, episode code, optional economics, and zero to four selected `{ socialAccountId, externalPublicationId }` sources. The source platform is resolved from storage, not trusted from the client.

The manual episode screen renders one tile for Instagram, TikTok, YouTube, and Facebook. An empty tile shows an add control below the network icon/name; clicking it opens a modal with imported, unlinked publications for that network. Selecting an item closes the modal and keeps its thumbnail/title visible in the tile. The creator may replace or remove the selection before saving. The manual MVP permits at most one selected publication per platform per episode.

The application validates that each source exists in the resolved tenant, matches its stored platform/account, is not already linked, and that no platform is selected more than once. Create the Episode and all selected `analytics_episode_publication_links` in one repository transaction. A stale/already-linked source or identity/code conflict rolls back the entire create. A successful manual link marks any matching pending suggestion approved with the Episode ID so the source cannot reappear in the suggestion queue. An empty publication selection is valid and creates an unlinked manual Episode.

## 6. Validation and Failure Handling

- A seasonal series requires a positive integer season number; a non-seasonal series forbids one. Unknown is distinct from non-seasonal.
- Reject cross-tenant or unknown series/suggestion IDs without revealing their existence.
- Prevent approval when any selected source lacks confirmed series/season context or its source record no longer exists.
- Enforce that every source in one approval command resolves to the same tenant, confirmed Series, season identity, and episode number; platform/account differences are allowed and remain preserved on each publication link.
- Enforce one canonical Episode per confirmed identity. A later approval for additional sources resolves the existing Episode and creates only missing links; conflicting source identities or already-linked-to-another-episode records fail without partial writes.
- Manual episode creation accepts at most one source per platform and links only locally stored, tenant-owned, currently unlinked publications. Episode creation and all selected links are atomic.
- Name conflicts, duplicate identities, invalid season assignments, and stale candidate revisions return stable application error codes; do not partially create an episode or links.
- JEV, publication metadata, and per-item persistence failures remain isolated. Successful classifications/decisions are retained; failed items show retryable status.
- Repeated synchronization is idempotent. A refresh does not delete candidates because a source is absent from a partial import.
- Rejection, deferral, and `NOT_EPISODE` decisions do not create canonical Episodes or publication associations.

## 7. Security, Localization, and Observability

- Enforce tenant scoping in use cases and repository reads/writes, including setup decisions and referenced Series IDs.
- Do not log publication descriptions, raw AI payloads, credentials, or tokens. Record tenant, source identity, stage, action, actor, counts, safe failure code, and timestamps.
- Use semantic interface keys for all labels, progress, confirmation, unresolved, empty, loading, and error states. Provide `pt-BR`, `en-US`, and `es-ES` catalog parity. Respect existing theme tokens, contrast, keyboard focus, and light/dark behavior.
- Preserve existing AI audit fields, rationale variants, confidence, evidence, schema/model version, and partial language failures.

## 8. Verification

Follow Red-Green-Refactor. Add tests before production changes.

- **Unit:** derived stage and progression; series mapping/creation validation; seasonal, non-seasonal, unknown, and conflicting season decisions; cross-platform grouping by confirmed identity with platform/account excluded from the key; source-fingerprint idempotency; changed metadata revisions; manual publication eligibility and source/platform validation; independent failures; approval blocked until setup confirmations exist; partial approval; and explicit final approval.
- **Integration:** migration constraints, tenant-scoped decision persistence, foreign-key behavior, decision history on changed fingerprints, one canonical Episode for multiple platform/account sources, additional-source linking to an existing Episode, available-publication filtering, and atomic manual episode/link rollback on conflicts.
- **E2E:** deterministic imported publications flow through synchronize → confirm series → confirm seasons → episode review → explicit approval; assert same-episode posts from different networks appear in one carousel, selected links are preserved, and later sources link to the same Episode. Exercise manual Series/Episode creation, each platform picker, thumbnail previews, and atomic creation with empty/partial/full source selection. Verify the picker makes no social API call; include partial failures, tenant isolation, light/dark UI coverage, and all three locale catalogs. Use deterministic doubles, never live social APIs or model output.
- **Presentation:** test unidentified series and unmatched episode candidates are initially hidden, reveal controls expose correct counts and candidates, and toggling does not submit a decision. Test one card per confirmed identity group, carousel content/navigation, manual network tiles, picker modal selection/removal/empty/loading/error states, thumbnail previews, responsive behavior, keyboard access, visible focus, and accessible announcements.

## 9. Open Decisions

- Exact retry affordance and retention duration for deferred/unresolved setup decisions.
- Whether creator-marked non-episode items should reuse the existing suggestion status or remain a separate setup decision.
- Episode identity extraction is planned to evolve into a verified cascade (deterministic → JEV verification → LLM extraction with series catalog → learned patterns); see [Episode Identity Extraction Cascade](./technical-episode-identity-cascade.md).
