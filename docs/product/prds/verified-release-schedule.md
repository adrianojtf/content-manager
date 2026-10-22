# PRD - Verified Release Schedule Context

**Status:** V1 implemented with tenant-global defaults; daylight-saving guidance remains open.
**Tech spec:** [Technical Specification - Verified Release Schedule Context](../../specifications/technical-verified-release-schedule.md)
**Related product spec:** [Community Management](community-management.md)

## 1. Objective

Let a creator explicitly confirm the weekly release days and local time once per tenant as a global default, and optionally override it per connected social account. Use the effective schedule as factual context for manually requested response suggestions and optional response evaluation.

"Verified" means explicitly saved and confirmed by the creator. It does not mean independently checked against a platform, publication history, or calendar service.

This feature adds context to the existing manual comment workflow. It is not a scheduler: it does not schedule or publish content, schedule responses, or send a response.

## 2. User and Problem

**Primary user:** a creator operating within an authorized tenant and managing comments for one or more connected social accounts.

Creators receive comments asking about release days, frequency, or whether content will continue. They need response suggestions to use the cadence they actually confirmed, without treating an old reply, a request for another part, or an AI suggestion as proof of a schedule.

## 3. V1 Scope and Product Rules

- Store one weekly schedule per tenant as the global default, plus at most one override schedule per connected social account. There is no series- or publication-level override in v1.
- The effective schedule resolves in the order account → global → unconfigured. Any saved account schedule — including an explicitly disabled one — replaces the global default for that account only; a disabled account schedule wins over an active global one. Accounts without their own row inherit the global default.
- The settings panel offers an account scope and a global scope. When exactly one connected account is available on the selected network, select it automatically for account-scoped settings. When multiple accounts are available, the creator must select one; the all-accounts view cannot edit account-scoped settings but can edit the global default. The account scope shows whether the selected account inherits the global schedule or uses its own override.
- A creator selects one or more days of the week, a 24-hour local time, and an IANA time-zone identifier. The selected weekdays and time refer to that same time zone. The new-schedule form initially selects `America/Sao_Paulo`; the creator can change it.
- The time-zone selector lists IANA identifiers supported by the browser runtime; `America/Sao_Paulo` is initially selected and the creator can choose another. The selected identifier is preserved, never inferred from the browser or host.
- The selected time zone is stored and sent with the local time. It is never inferred from the interface language, application host, browser, or presumed creator location.
- A schedule becomes usable context only after an explicit creator save/confirmation succeeds. Unsaved form values and an initial time-zone selection are not verified facts.
- Disabling a saved schedule preserves its days, time, and time zone for later editing, but those values are not sent as model facts. An empty day list is permitted only while the schedule is disabled.
- V1 has no schedule-delete/clear operation; a saved schedule can be disabled.
- Without a saved schedule, or with a saved schedule whose `enabled` field is `false`, a model must not assert release days or times. It may suggest cautious wording for creator review.
- A request such as "Part 2" signals interest in continuation. By itself, it does not confirm that content will continue or establish a release day or time.
- A confirmed schedule may be supplied as structured context to the configured Gemini or OpenAI response generator. TypeSafe may receive it for a manually requested response evaluation when an active schedule exists.
- Schedule context should be mentioned only when relevant to a comment about release timing, frequency, or continuation. Unrelated comments should not receive an unnecessary schedule reference.
- The account's response-tone profile remains a separate setting. The existing manual response, review, and send policy remains unchanged.
- Existing comments, sent replies, suggestions, and audit logs are not sources from which to create, confirm, or fill a schedule. Promoting an old message to a verified fact is outside v1.

## 4. User Journey

1. The creator opens the release-schedule settings and chooses the global scope to set a tenant-wide default, or selects a connected social account to manage that account's override. The account view shows whether the account inherits the global schedule or uses its own.
2. The creator selects weekly days, enters a local time, reviews the selected IANA time zone, and explicitly saves/confirms the schedule. The UI labels the schedule as unconfirmed until the save succeeds.
3. The creator can disable a saved schedule at either scope. A disabled schedule remains saved configuration, but it is not available to response generation or schedule-consistency evaluation; a disabled account schedule suppresses an active global default for that account.
4. In the existing comment workflow, the creator manually requests response generation after the required comment analysis. The application resolves the effective schedule for that comment's account (account row, else global row, else unconfigured) and generates independent `pt-BR`, `en-US`, and `es-ES` suggestions.
5. The creator reviews and may edit a suggestion. If desired, the creator separately requests the existing optional response evaluation. Any schedule-consistency result is advice only.
6. The creator continues to use the existing explicit per-comment manual send action. Schedule configuration, generated context, and evaluation results never send or block a response.
7. A later schedule edit affects new suggestions. Previously generated suggestions and their recorded schedule snapshots remain unchanged.

## 5. Interface States

| State | Required behavior |
| --- | --- |
| Loading | Show that the selected scope's schedule is being loaded. Do not present a guessed schedule as saved. |
| No specific account selected | Keep account-scoped schedule/tone writes unavailable; when only one account is available, select it automatically. The global scope stays editable without an account selection. |
| Inherited | In the account scope, show when the displayed schedule is the inherited global default rather than an account override. Saving in the account scope writes an account override, not the global row. |
| Unconfigured | Show that no schedule has been confirmed. The new-schedule form initially selects `America/Sao_Paulo` with `enabled` off, no selected days, and no local time. These values are unsaved and are not sent as factual context. |
| Editing | Show local form changes as unconfirmed. Until a successful save, response workflows continue to use only the previously persisted schedule, if any. |
| Active and confirmed | Show the saved days, local time, IANA time zone, and confirmation/update status. |
| Disabled | Show that the stored schedule is disabled and is not used as a factual claim by generation or evaluation. |
| Saving | Prevent the UI from implying confirmation before the API confirms the write. |
| Saved | A successful save collapses the settings panel; the localized toast confirms the write. A failed save keeps the panel open with the error. |
| Validation error | Identify invalid day/time/time-zone input without replacing the last saved schedule. |
| Load/save error | Show a stable, localized error and allow retry. A failed save must not be displayed as confirmed. |
| Evaluation without an active schedule | Keep the existing evaluation available when its existing preconditions are met. Do not display a fabricated schedule-consistency score; indicate that schedule consistency was not evaluated. |
| Evaluation with an active schedule | Display the optional structured schedule-consistency signal as advisory information, separate from the existing response recommendation. |

The editor and all loading, empty, disabled, success, and error states must work in both light and dark themes, preserve visible keyboard focus and readable contrast, and remain usable at narrow viewport widths. User-facing strings require semantic catalog entries in `pt-BR`, `en-US`, and `es-ES`. Interface locale remains independently selected and locally persisted under the existing behavior; it is not used to choose the schedule time zone or generated response language.

## 6. Functional Requirements

### VRS-01 - Account-scoped weekly configuration

The creator can read and update one schedule for a tenant-owned connected social account, and separately read and update one tenant-wide default schedule. Each configuration contains:

- `enabled`: whether the confirmed schedule is active context;
- `daysOfWeek`: selected values from `MONDAY` through `SUNDAY`;
- `localTime`: local wall-clock time in `HH:mm` format;
- `timeZone`: an IANA time-zone identifier;
- `version`, `updatedAt`, and `confirmedAt`: server-maintained provenance returned with persisted configuration.

Changing one account's schedule must not change any other account's configuration or the global default; changing the global default affects only accounts without their own saved schedule. The account-scoped read returns the effective schedule with its source (`ACCOUNT`, `TENANT`, or unconfigured) so the interface can distinguish an override from an inherited default.

### VRS-02 - Explicit confirmation and source of truth

Only a successfully saved, explicitly confirmed schedule is eligible as factual context. A new form's initial time-zone selection, unsaved edits, comment text, sent messages, previous AI suggestions, and workflow history must not populate or confirm a schedule.

### VRS-03 - Safe generation context

For a manually requested response generation, resolve schedule context using the connected account that owns the comment. Supply the time and its IANA time zone together. If there is no schedule or it is disabled, the generator must not receive inactive day/time facts as usable schedule claims and must be instructed not to assert days or times. The generator may produce a cautious suggestion for creator review.

An explicit continuation request is not evidence of a schedule. If the comment is not about release timing, frequency, or continuation, the response should not mention the schedule without a relevant reason.

### VRS-04 - Independent, auditable language variants

Generation continues to produce separate `pt-BR`, `en-US`, and `es-ES` variants. Each successful variant records its own immutable snapshot of the schedule context used. A change to the saved schedule affects future generation only; it does not rewrite old suggestions or snapshots. Partial language failures do not discard successful variants.

### VRS-05 - Consultative response evaluation

When a confirmed schedule is active, a manually requested TypeSafe response evaluation may include a typed Noul `schedule_consistency` question. Its result is structured evidence only; it does not create an explanation, alter an automatic policy, block manual sending, or trigger a send. The evaluation record identifies the schedule snapshot used.

When no schedule is configured or the saved schedule is disabled, omit the schedule-consistency question and signal while retaining all existing evaluation behavior.

### VRS-06 - Preserve manual workflow boundaries

Schedule configuration does not change tone settings, comment-analysis preconditions, response editing/history, the optional/manual nature of evaluation, platform capability checks, or the explicit per-comment manual-send policy. No schedule or AI result initiates another workflow stage automatically.

## 7. Non-Functional Requirements

- **Isolation:** every schedule read, write, generation lookup, and evaluation lookup is scoped by the resolved tenant, plus the connected social account where applicable. A client cannot supply or override a tenant ID or schedule context on a settings, generation, or evaluation request.
- **Factuality:** the exact local time and IANA time zone travel together. No conversion to a presumed creator time zone, host time zone, UI locale, or UTC schedule is performed.
- **Auditability:** persisted settings expose a version and timestamps; each suggestion variant and applicable evaluation records the immutable context snapshot used.
- **Privacy:** send only the active schedule facts needed for the associated comment workflow to the configured text provider or, for a manually requested evaluation, TypeSafe. Do not expose provider credentials, add social API calls, or infer facts from retained conversation history.
- **Reliability:** failures are reported using stable error codes. A failed update does not overwrite the last saved schedule. Language outcomes remain independent.
- **Accessibility and localization:** status and validation are perceivable without color alone, controls are keyboard accessible, and user-facing text is available in all three supported interface locales.
- **Verification:** unit, integration, and E2E tests use deterministic repository/provider doubles. Routine tests do not call Gemini, OpenAI, TypeSafe, social networks, or consume provider credits.

## 8. Privacy and Data Handling

The schedule is creator-provided configuration and may disclose publishing habits and a chosen time zone. It is scoped to the tenant (global default) or the connected account (override). Gemini/OpenAI receive the effective schedule only through that account's manually requested suggestion workflow; TypeSafe receives it only through a manually requested response evaluation when an active effective schedule exists. Social platform adapters do not receive it.

Do not log raw provider requests or credentials. Do not include a schedule from one account in another account's prompt or evaluation. Schedule snapshots stored with comment workflow artifacts follow the existing comment-workflow retention policy. Account-level schedule configuration remains for the connected-account lifetime and is removed with that account; the global default is removed with the tenant.

## 9. Acceptance Criteria

- [x] A new account returns no persisted schedule. The editor may initially select `America/Sao_Paulo`, but neither that unsaved value nor any other form value is sent as verified context before a successful explicit save.
- [x] Saving a valid configuration returns the selected days, `localTime`, and `timeZone`, with server-maintained `version`, `updatedAt`, and `confirmedAt`; the confirmation state is not shown before the save succeeds.
- [x] The default selected IANA time zone is `America/Sao_Paulo`, can be edited, and is not inferred from interface language, host, browser, or creator location.
- [x] The time-zone selector offers the runtime's supported IANA identifiers and preserves the selected identifier with the local time.
- [x] An unconfigured form starts disabled with no selected days and no local time; those empty editor values do not create a schedule.
- [x] Two accounts in the same tenant can retain different schedules; a request for one account never reads or sends the other account's schedule.
- [x] A tenant-global schedule is saved and read through `GET/PUT /social/settings/verified-release-schedule`; it becomes the effective schedule for every account without its own row, and its writes never accept a caller-supplied tenant ID.
- [x] An account with no saved schedule inherits the global schedule; an account with a saved schedule uses only its own row; a disabled account schedule remains effective even when the global schedule is active.
- [x] A single connected account is selected automatically for its settings; with multiple accounts, a specific account must be selected before editing.
- [x] With no schedule or a disabled schedule, deterministic provider-request tests show no usable release-day/time facts, and generation instructions prohibit asserting them. A cautious suggestion remains a reviewable suggestion, not a sent response.
- [x] A comment such as "Part 2" does not create or fill a schedule, even when prior responses or workflow history exist.
- [x] For a relevant comment with an active schedule, captured Gemini and OpenAI requests contain the exact selected days, `localTime`, and matching IANA `timeZone`. For an unrelated comment, the request instructions prohibit gratuitous schedule references.
- [x] One generation request preserves independent `pt-BR`, `en-US`, and `es-ES` artifacts. Each artifact has its own schedule snapshot, and a failure for one language leaves other successful variants and their snapshots intact.
- [x] Updating the schedule creates a later version for new suggestions and does not alter prior suggestion text or snapshots.
- [x] A manual evaluation with an active schedule sends a typed `schedule_consistency` Noul question, validates its probability, stores the used schedule snapshot, and returns no explanatory text for that signal.
- [x] Without an active schedule, response evaluation still follows its existing preconditions and questions, and no `schedule_consistency` question, signal, or fabricated score is present.
- [x] A schedule-consistency result does not change the existing recommendation, manual-send prerequisites, or external send behavior. No response is sent unless the creator explicitly invokes the existing per-comment send action.
- [x] All schedule UI states are usable in light and dark themes, have semantic catalog entries in `pt-BR`, `en-US`, and `es-ES`, and are covered by deterministic tests that do not consume external credits.

## 10. Out of Scope

- Scheduling, queueing, or automatically publishing content.
- Scheduling, automatically generating, or automatically sending comment responses.
- Configuration per content series, publication, or individual post.
- Deriving or confirming schedule facts from comments, reply history, suggestions, workflow logs, or platform content.
- Automatically choosing a time zone from locale, device, host, IP address, or presumed creator location.
- Promoting an old sent message or AI suggestion into a verified schedule.
- Changing the response-tone profile, comment-analysis rules, review policy, platform capability checks, or manual-send policy.
- A calendar integration, next-release calculation, or platform-side schedule verification.

## 11. Risks and Open Decisions

- **Creator input can become stale:** show the saved version and confirmation time; only a new explicit save changes future context.
- **Time-zone misunderstanding:** store and transmit the IANA identifier with the local time; the UI must label the time as local to that zone.
- **Model may ignore instructions:** suggestions remain review-only, and response evaluation is advisory; neither can send or block a reply.
- **Continuation may be mistaken for a promise:** "Part 2" is demand evidence, not schedule confirmation.
- **Open - daylight-saving interpretation:** confirm how the creator-facing copy should explain recurring local times in zones with daylight-saving transitions. V1 does not calculate release instants.
