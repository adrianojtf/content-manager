# PRD — Community Management

**Status:** Draft — open product decisions are listed below.  
**Tech spec:** [Technical Specification — Community Management](../../specifications/technical-community-management.md)

## 1. Objective

For the initial MVP, centralize comments from YouTube, Instagram professional accounts, Facebook Pages, and TikTok Business accounts. Let the creator analyze, generate or write, edit, optionally evaluate, and manually send responses while retaining control over every external action. TikTok support is limited to authorized Business accounts and their owned organic videos.

## 2. User and Problem

**Primary user:** a creator operating within an authorized tenant.

The creator needs a unified view of audience comments while retaining their platform origin and control over any external response.

## 3. Phase 1 Scope

- Organize the screen by social network, then publications/videos, then comments. The MVP targets YouTube, Instagram professional Business/Creator, Facebook Pages, and TikTok Business for owned organic videos; keep adapters independent. Local OAuth-backed connections exist for YouTube, Instagram, Facebook Pages, and configurable TikTok Business accounts. TikTok requires the deployment's app-generated authorization URL and OAuth settings; live app access and refresh verification remain pending. The official account-token revoke endpoint is documented but is not exposed or called by the application.
- Allow manual comment sync at publication/video scope or across all accessible publications for one selected supported network; do not run a global all-network sync or background polling.
- Retain synchronized comments for 30 days from the most recent successful sync, then remove them from local storage.
- Normalize comments into the common domain model while preserving external identifiers.
- Classify comments with JEV manually per comment, publication/video, or selected network; each operation returns independent per-comment outcomes and preserves partial failures. Each phase is explicitly initiated; one phase never automatically starts the next.
- Require JEV comment analysis before AI response generation. Creator-authored response text does not require comment analysis.
- Keep a response text editor on each expanded comment. AI-generated suggestions remain editable and auditable; creator-authored text is also auditable. Neither generation path sends externally.
- Make response evaluation a separate, optional, manually requested JEV action. It requires an existing comment analysis and is advisory only; it never blocks or sends a reply.
- Require one explicit manual send action per comment/revision; batch operations never send replies. Automatic or background sending is out of scope.
- Use a fixed Phase 1 communication policy rather than creator-configurable policy settings: no automatic generation or sending, spam/toxicity and JEV response evaluations remain advisory, and only explicit per-comment sends dispatch a saved response after capability/authorization checks. Do not infer numeric risk thresholds.
- Show each comment's workflow stages and audit history, including original AI suggestion, edited/manual text, comment analysis, optional response evaluation, and creator corrections.
- Persist whether the app sent a reply. Where the platform can reliably identify an external creator reply, show that separately; otherwise show the external reply state as unknown, not as “not replied”. Send only where the platform supports replies and the connected account is authorized.
- Implement the comments screen from the CreatorDesk prototype as a responsive browser client. It must use API data only and present loading, empty, unsupported, and error states without illustrative social metrics or simulated actions.
- Show the optional response-evaluation action once comment analysis and a saved response version are available. The action is not conditional on guessed risk thresholds and its result never controls manual send.

## 4. Requirements

### CO-01 — Synchronize and normalize comments

The application imports comments available from a publication's platform, preserves the external comment identifier, and associates each comment with its publication.

### CO-02 — Evaluate comments

The application prepares context and invokes the intelligence provider through an application port. Structured output is schema-validated and confidence is retained. Invalid output must not mutate comment state.

### CO-03 — Generate response suggestions

After manually evaluating a comment with JEV, the creator can request an AI response suggestion in an explicit language and an account-specific tone profile. The profile has one primary tone, up to two tone modifiers, and an optional short note; the default is Friendly. Gemini Flash-Lite is the initial text-generation provider. The suggestion remains editable and is not itself an external action. The creator may instead write a manual response without running comment analysis; tone settings do not rewrite manual text.

### CO-04 — Evaluate response suggestions

The creator may request a separate JEV evaluation of a response revision. It is optional, requires an existing JEV analysis of the comment, and is advisory only: its recommendation or risk scores never block an explicit manual send.

### CO-05 — Preserve creator control

Every workflow phase is initiated by an explicit creator action; completing one phase never starts another automatically. The creator may type a response without comment analysis or generate an editable suggestion after comment analysis. Every external reply requires a distinct manual per-comment send action. Automatic publication is out of scope. JEV recommendations are advisory and cannot trigger or prevent a manual send.

### CO-06 — Manually send supported replies

The creator explicitly sends the exact final saved response text for one comment at a time. Response evaluation is optional and advisory, not a send prerequisite. The application rechecks platform capability and connected-account authorization at send time and records the attempt before dispatch. Unsupported operations return an explicit result; ambiguous or previously attempted revisions are not retried automatically; no background, batch, or AI-triggered send is permitted.

### CO-07 — Run per-comment and batch workflow stages

The creator can manually sync comments for one publication/video or all publications in one selected social network, and request JEV classification or response generation per comment, publication/video, or selected network. Every request is explicit and has independent per-comment outcomes; a failure for one comment does not erase or block completed results for others. Network-level actions never include other networks. Sending remains a separate per-comment manual action.

### CO-08 — Preserve AI and human audit history

For every classification, AI suggestion, creator-authored response, and edit, retain immutable source text/provenance and append-only versions. Editing a generated response appends a human-edited revision linked to the original suggestion; it never overwrites the generated text. Creator-authored responses have no fabricated AI-suggestion parent. JEV confidence, rationale, and raw output are immutable. A human may append corrected sentiment/emotion/intent/topic/entity labels and spam/toxicity/engagement scores in the normalized `[0,1]` range. Store each correction separately from the original analysis with actor source, timestamp, changed fields, and optional reason. The UI displays both AI and human versions. Audit artifacts containing comment/response text expire with the associated comment after 30 days.

## 5. Acceptance Criteria

- [ ] On-demand imported comments preserve platform/external IDs and associate with the correct account/publication.
- [ ] Persisted comment text/author metadata expires 30 days after the most recent successful sync and expired comments are removed on subsequent synchronization/cleanup.
- [ ] Platform-specific comment data is normalized before entering application/domain workflows.
- [ ] Valid comment analysis stores structured fields, confidence, provider, and an auditable result.
- [ ] Invalid or schema-incompatible analysis output does not change comment state.
- [ ] A generated response is stored as a suggestion and can be edited before a creator decision.
- [ ] High-risk, toxic, or low-confidence response evaluations cannot result in automatic publication.
- [ ] Single-comment, per-publication, and selected-network requests create independent per-comment stage/results; a network request never syncs another network, and partial failures do not hide successful results.
- [ ] Each collapsed comment shows its text and reply state; expanding it shows available manual actions and results for sync, comment analysis, generation, optional response evaluation, and send.
- [ ] The original AI-generated response remains immutable; each human edit is appended with timestamp/source and both AI and final manual text are visible in the audit history.
- [ ] A human JEV correction appends changed labels and/or spam/toxicity/engagement scores in `[0,1]` as a separate record; original output, confidence, and rationale remain unchanged, and both versions plus timestamp/source are visible.
- [ ] Every phase is manually initiated, does not automatically trigger the next phase, and records its per-comment outcome.
- [ ] AI response generation requires an existing comment analysis; creator-authored response text does not.
- [ ] Each connected account has its own tone profile: one primary tone (`FRIENDLY`, `PROFESSIONAL`, `CASUAL`, `EMPATHETIC`), up to two modifiers (`CONCISE`, `WARM`, `ENTHUSIASTIC`), and an optional note capped at 500 characters; an unset profile defaults to Friendly.
- [ ] Tone changes apply only to future AI generations; each generated suggestion audits the exact tone profile used, and manual response text is unaffected.
- [ ] Every external response requires an individual deliberate manual send action for the exact latest saved text; batch operations never send replies.
- [ ] Response evaluation is optional, requires prior comment analysis, is visible as advisory, and never blocks manual send regardless of recommendation.
- [ ] The app's send status is persisted. External reply state is reported as replied/not replied only when reliably supported by the platform; otherwise it is shown as unknown.
- [ ] Platform reply capability and connected-account authorization are checked before sending, and the result is shown to the creator.
- [ ] An ambiguous or previously attempted revision cannot be automatically retried.
- [ ] A platform without reply capability produces an explicit unsupported result and no external request.
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
- Which JEV endpoint/authentication contract will be used for live comment and response evaluation? The response evaluator uses a separate application port and endpoint setting; its provider contract is not yet live-verified.
- Does the operator accept Google's Free-tier data-use terms for creator comment/response text, or should Gemini use a paid tier before live generation?
- What final-text confirmation and user-visible delivery details are required for each platform's manual send flow?
- What comment fields may be displayed and retained under each platform's terms?
