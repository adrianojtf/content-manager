# PRD — Community Management

**Status:** Draft — open product decisions are listed below.  
**Tech spec:** [Technical Specification — Community Management](../../specifications/technical-community-management.md) · **Synchronization PRD:** [Social Content Synchronization](social-content-synchronization.md) · **Refinement PRD:** [AI Response Refinement Dataset](response-refinement.md)

## 1. Objective

For the initial MVP, centralize comments from YouTube, Instagram professional accounts, Facebook Pages, and TikTok Business accounts. Let the creator analyze, generate or write, edit, optionally evaluate, and manually send responses while retaining control over every external action. TikTok support is limited to authorized Business accounts and their owned organic videos.

## 2. User and Problem

**Primary user:** a creator operating within an authorized tenant.

The creator needs a unified view of audience comments while retaining their platform origin and control over any external response.

## 3. Phase 1 Scope

- Organize the screen by social network, then publications/videos, then comments. The MVP targets YouTube, Instagram professional Business/Creator, Facebook Pages, and TikTok Business for owned organic videos; keep adapters independent. Local OAuth-backed connections exist for YouTube, Instagram, Facebook Pages, and configurable TikTok Business accounts. TikTok requires the deployment's app-generated authorization URL and OAuth settings; live app access and refresh verification remain pending. The official account-token revoke endpoint is documented but is not exposed or called by the application.
- Paginate publications independently for each connected account on the selected network, defaulting to five videos per page and allowing 10 or 25. Fetch only the selected network and current account pages; keep only those pages and their comment/workflow cache in browser memory.
- Make the main synchronization action sync only the currently visible videos, one comment page per video, and show accessible per-video and page-level progress with independent outcomes. Keep explicit per-publication sync available; do not silently sync every publication on a network or run background polling.
- When a comment sync fails, show a failure badge and an adjacent localized reason card based on the stable platform/error-code combination. Never show raw provider payloads; unknown codes use a safe generic message.
- Retain synchronized comments for 30 days from the most recent successful sync, then remove them from local storage.
- Show each network tab's unanswered-comment badge from persisted data — comments with no app reply and `NOT_REPLIED` external status — loaded on every screen load and refreshed after syncs, sends, and workflow batches. Keep the counts in memory only. The statistics cards show tenant-wide totals across all connected platforms from the same summary.
- Synchronize comments automatically for the currently visible videos after publications load — on the initial screen, on every network tab switch, when returning to the comments screen, and after a successful publication page navigation — with the same sequential per-video flow and progress reporting as the manual page sync, which remains available for on-demand refreshes.
- Normalize comments into the common domain model while preserving external identifiers.
- Classify comments with JEV manually per comment, publication/video, or selected network; each operation returns independent per-comment outcomes and preserves partial failures. Standalone phases are explicitly initiated; the semi-automatic per-video action is an explicit composite request for analysis-if-needed followed by generation.
- Require JEV comment analysis before AI response generation. Creator-authored response text does not require comment analysis.
- Add a per-video “resposta semi-automática” action that explicitly synchronizes every comment page for only that video, then queues comments with a successful sync outcome that are confirmed as unanswered. Failed-page leftovers and `UNKNOWN` reply status are not treated as unanswered.
- In the dialog, let the creator explicitly evaluate/generate per-comment suggestions, review comment and response side by side, choose one of the three language variants, and override the primary tone per comment without changing the saved account profile.
- Provide per-row, selected-row, and all-row approval. Approval is review-only for the current dialog session: it never sends externally. Save human edits as append-only revisions before marking those rows approved. After review, provide one explicit “send all approved” action scoped to the current video; it sends only approved, saved, reply-capable versions through the existing per-comment route.
- Keep a response text editor on each expanded comment. AI-generated suggestions remain editable and auditable; creator-authored text is also auditable. Neither generation path sends externally.
- Show an explicit hollow-heart control only for comments whose connected platform supports liking. Clicking it sends a per-comment `LIKE`; a successful action fills the heart red, and clicking again sends `UNLIKE`. Like state is persisted separately from external reply state; no batch or automated likes are allowed.
- Make response evaluation a separate, optional, manually requested JEV action. It requires an existing comment analysis and is advisory only; it never blocks or sends a reply.
- Require an explicit manual send action for every external reply: the existing per-comment action or a final confirmation to send all individually approved rows in the semi-automatic dialog. The latter sends sequentially, reports each outcome, continues after individual failures, and stops when the platform rate-limits requests. Automatic or background sending is out of scope.
- Use a fixed Phase 1 communication policy rather than creator-configurable policy settings: no background or implicit generation/sending, spam/toxicity and JEV response evaluations remain advisory, and only explicit sends of saved responses dispatch after capability/authorization checks. The per-video composite generation action never sends; the separate send-all action requires prior row approval and final confirmation. Do not infer numeric risk thresholds or add randomized timing to disguise automation.
- Show each comment's workflow stages and audit history, including original AI suggestion, edited/manual text, comment analysis, optional response evaluation, and creator corrections.
- Persist whether the app sent a reply. During synchronization, persist only direct replies authored by the connected account owner when the provider reliably identifies them; do not import replies from other commenters or deeper reply threads. Show app-sent and provider-detected creator replies separately; otherwise show external reply state as unknown, not as “not replied”. Send only where the platform supports replies and the connected account is authorized.
- Implement the comments screen from the CreatorDesk prototype as a responsive browser client. It must use API data only and present loading, empty, unsupported, and error states without illustrative social metrics or simulated actions.
- Show the optional response-evaluation action once comment analysis and a saved response version are available. The action is not conditional on guessed risk thresholds and its result never controls manual send.

## 4. Requirements

### CO-01 — Synchronize and normalize comments

The application imports top-level comments available from a publication's platform, preserves external identifiers, and associates each comment with its publication. Direct replies authored by the connected account owner are synchronized separately when the provider can reliably identify them; other commenters' replies and deeper reply threads are not imported.

### CO-02 — Evaluate comments

The application prepares context and invokes TypeSafe Jev through an application port. Structured sentiment/intent/topic and risk signals are schema-validated and confidence evidence is retained. Explicit continuation requests are counted as audience demand and contribute to estimated engagement potential even when the comment is brief. Invalid output must not mutate comment state.

### CO-03 — Generate response suggestions

After manually evaluating a comment with JEV, the creator can request AI response suggestions in Portuguese (`pt-BR`), English (`en-US`), and Spanish (`es-ES`) in one action, using the effective tone profile for that comment's account — an account-specific profile when one is saved, otherwise the tenant-global profile, otherwise the Friendly default — or a validated one-time primary-tone override for that comment. Each language is an independent editable suggestion. The profile has one primary tone, up to two tone modifiers, and an optional short note. A per-comment override inherits the effective modifiers/note and does not change saved settings at either scope. Gemini Flash-Lite is the initial text-generation provider. Suggestions are not external actions. The creator may instead write a manual response without running comment analysis; tone settings do not rewrite manual text.

### CO-04 — Evaluate response suggestions

The creator may request a separate JEV evaluation of a response revision. It is optional, requires an existing JEV analysis of the comment, and is advisory only: its recommendation or risk scores never block an explicit manual send.

### CO-05 — Preserve creator control

Every standalone workflow phase is initiated by an explicit creator action; completing one phase never starts another automatically. The semi-automatic per-video action explicitly requests the analysis-if-needed and generation sequence for that video's confirmed unanswered comments. The creator may type a response without comment analysis or generate an editable suggestion after comment analysis. Every external reply requires explicit creator action: an individual send or a separate, finally confirmed send-all action after each included row has been approved. Automatic publication is out of scope. JEV recommendations are advisory and cannot trigger or prevent a manual send.

### CO-06 — Manually send supported replies

The creator can explicitly send the exact latest saved response for one comment, or separately confirm sending all individually approved, saved, reply-capable rows in the semi-automatic dialog. The send-all action invokes the existing per-comment route sequentially, reports each outcome, continues after an individual failure, and stops when the platform rate-limits requests. Response evaluation is optional and advisory, not a send prerequisite. The application rechecks platform capability and connected-account authorization for every send and records each attempt before dispatch. Unsupported operations return an explicit result; ambiguous or previously attempted revisions are not retried automatically; no background or AI-triggered send is permitted.

### CO-09 — Like supported comments

The creator can explicitly like or unlike a comment only when the platform adapter reports the capability. The interface uses an outline heart while not liked and a filled red heart after a successful like. Persist app-owned like state separately from provider-observed data. In Phase 1, expose likes on Facebook Pages and TikTok Business; do not expose the control on YouTube or the current Instagram Login integration. Likes are always per-comment manual actions; no batch or AI-triggered likes are permitted.

### CO-07 — Run per-comment and batch workflow stages

The creator can manually sync comments for one publication/video or the currently visible publication page, and request JEV classification or response generation per comment, publication/video, or selected network. The same visible-page sync also starts automatically after publications load — on the initial screen, on network tab switches, and when returning to the comments screen. Page synchronization includes only videos visible after account selection and filters, processes one comment page per video, and reports progress and independent outcomes. A failed video does not erase or block completed results for others. The per-video semi-automatic reply action is an explicit composite request: it syncs every comment page for only that video, includes only successfully synced comments with `appReplied === false` and external reply status `NOT_REPLIED`, then evaluates comments without a successful analysis and generates three independent language variants per comment. This explicit action may chain those two stages; no other workflow phase is chained automatically. Sending remains a separate explicit action and can include only individually approved, saved responses.

### CO-08 — Preserve AI and human audit history

For every classification, AI suggestion, creator-authored response, and edit, retain immutable source text/provenance and append-only versions. Editing a generated response appends a human-edited revision linked to the original suggestion; it never overwrites the generated text. Creator-authored responses have no fabricated AI-suggestion parent. TypeSafe/Jev per-question probabilities, confidence, usage, and raw evidence are immutable; its free-text rationale is unavailable and stored as `null`. A human may append corrected sentiment/emotion/intent/topic labels and spam/toxicity/estimated-engagement values in the normalized `[0,1]` range. Store each correction separately from the original analysis with actor source, timestamp, changed fields, and optional reason. The UI displays both effective labels and original signal evidence. Audit artifacts containing comment/response text expire with the associated comment after 30 days.

## 5. Acceptance Criteria

- [ ] On-demand imported comments preserve platform/external IDs and associate with the correct account/publication.
- [x] A synchronized creator reply is a direct reply to a top-level comment and is attributed to the connected account owner; replies by other authors and deeper reply threads are not stored as creator replies.
- [x] A comment is externally `REPLIED` only when a creator-authored reply is confirmed, `NOT_REPLIED` only when the provider reliably confirms none exists, and otherwise `UNKNOWN`; an app-sent reply remains a separate source and still counts as responded in the UI.
- [ ] Persisted comment text/author metadata expires 30 days after the most recent successful sync and expired comments are removed on subsequent synchronization/cleanup.
- [ ] Platform-specific comment data is normalized before entering application/domain workflows.
- [ ] Valid comment analysis stores structured fields, confidence, provider, and an auditable result.
- [ ] Invalid or schema-incompatible analysis output does not change comment state.
- [ ] A generated response is stored as a suggestion and can be edited before a creator decision.
- [ ] High-risk, toxic, or low-confidence response evaluations cannot result in automatic publication.
- [ ] Single-comment, per-publication, and selected-network requests create independent per-comment stage/results; a network request never syncs another network, and partial failures do not hide successful results.
- [x] Publication pagination defaults to five videos per connected account, allows 10 and 25, passes page size to provider adapters, uses opaque cursors, and replaces prior-page publication/comment data in browser memory.
- [x] The main sync action requests comments only for videos on the current visible page, processes one comment page per video, and announces progress/results accessibly; it does not call the whole-network sync route.
- [ ] The same visible-page sync runs automatically after publications load on the initial screen, on network tab switches, when returning to the comments screen, and after a successful publication page navigation — only when the publication load succeeded, while keeping the manual page-sync control for on-demand refreshes.
- [x] A failed video displays a localized reason for its platform/error code beside its failure badge; an unknown code falls back to safe generic copy, and raw provider data is never shown.
- [ ] Each collapsed comment shows its text and reply state; expanding it shows available manual actions and results for sync, comment analysis, generation, optional response evaluation, and send.
- [ ] The original AI-generated response remains immutable; each human edit is appended with timestamp/source and both AI and final manual text are visible in the audit history.
- [ ] A human TypeSafe/Jev correction appends changed labels and/or spam/toxicity/estimated-engagement values in `[0,1]` as a separate record; original probabilities/confidences remain unchanged, and both versions plus timestamp/source are visible.
- [ ] Each network tab badge shows the persisted unanswered-comment count for that platform and refreshes on screen load and after comment syncs, reply sends, and workflow batches; statistics cards sum the same persisted counts across all platforms, and none of these counters require a comment sync first.
- [ ] Standalone workflow phases are manually initiated and record per-comment outcomes. The semi-automatic action explicitly initiates its documented analysis-if-needed and generation sequence, with independent partial results.
- [ ] AI response generation requires an existing comment analysis; creator-authored response text does not.
- [ ] The per-video semi-automatic action synchronizes only that video's comment pages and queues successfully synced, confirmed unanswered comments; it excludes app-replied, externally replied, stale rows from failed pages, and `UNKNOWN` comments.
- [ ] One explicit dialog action evaluates only comments missing a successful analysis, then generates separate `pt-BR`, `en-US`, and `es-ES` suggestions per queued comment; failures remain isolated by comment/language.
- [ ] A tenant-global tone profile can be configured as the default for all accounts; each connected account may save its own complete tone profile that fully replaces the global one for that account only (never merged). Profiles contain one primary tone (`FRIENDLY`, `PROFESSIONAL`, `CASUAL`, `EMPATHETIC`), up to two modifiers (`CONCISE`, `WARM`, `ENTHUSIASTIC`), and an optional note capped at 500 characters; with no account or global profile, the default is Friendly.
- [ ] A validated one-time primary-tone override applies only to the requested comment's future generation, inherits the effective profile's modifiers/note, is included in the generation audit snapshot, and does not mutate the saved account or global profile.
- [ ] The dialog shows each comment beside one selected language variant, supports per-row/selected/all review approval, and approval never calls an external send route.
- [ ] Saving an edited suggestion appends a human revision linked to the immutable original AI suggestion; the generated and edited texts remain visible in the history.
- [ ] Tone changes apply only to future AI generations; each generated suggestion audits the exact tone profile used, and manual response text is unaffected.
- [ ] Every external response requires deliberate creator action for the exact latest saved version in the selected response lineage; changed editor text is saved as a revision before dispatch. In the semi-automatic dialog, “send all approved” requires a separate final confirmation, sends only approved/saved/capable rows sequentially via the per-comment route, continues after individual failures, stops on a platform rate limit, reports partial outcomes, and never retries an attempted or ambiguous revision.
- [ ] Response evaluation is optional, requires prior comment analysis, is visible as advisory, and never blocks manual send regardless of recommendation.
- [ ] The app's send status is persisted. External reply state is reported as replied/not replied only when reliably supported by the platform; otherwise it is shown as unknown.
- [ ] Platform reply capability and connected-account authorization are checked before sending, and the result is shown to the creator.
- [ ] An ambiguous or previously attempted revision cannot be automatically retried.
- [ ] A platform without reply capability produces an explicit unsupported result and no external request.
- [ ] A platform-supported comment like/unlike is a per-comment explicit API action; its heart state changes only after success and is retained after reload. Unsupported platforms do not render the control.
- [x] The browser client lists connected accounts/publications, searches and filters loaded comments, and maps sync/classify/generate/edit/evaluate/send controls to their documented API routes without using fabricated provider data.
- [x] The optional response-evaluation control appears only when its prerequisites are met; every send requires explicit confirmation and transmits only the saved revision ID, never client text.

## 6. Out of Scope

- JEV direct access to social APIs, persistence, or domain mutation.
- Publishing a response solely because an AI provider recommends it.
- Assuming comment or reply capability parity across platforms.

## 7. Dependencies

- Social Accounts and Publishing PRD.
- Platform capability matrix and current permissions.
- JEV integration and AI validation strategy.
- Creator communication policy.

## 8. Open Questions

- Which representation or display labels should be used for provider-specific comment moderation states?
- Should later phases add creator-configurable communication-policy settings? Phase 1 uses the fixed manual-only policy above.
- Which publication-specific topic/entity taxonomy should be added when normalized content context and candidate entities are available? TypeSafe Choice requires bounded options and does not extract arbitrary entity text.
- Does the operator accept Google's Free-tier data-use terms for creator comment/response text, or should Gemini use a paid tier before live generation?
- What final-text confirmation and user-visible delivery details are required for each platform's manual send flow?
- What comment fields may be displayed and retained under each platform's terms?
