# Technical Specification — AI Response Refinement Dataset

**Status:** Draft — pair capture and provider-specific prompt-version capture are implemented; contextual analysis is specified separately.

**Product PRD:** [AI Response Refinement Dataset](../product/prds/response-refinement.md)  
**Related specifications:** [Technical Specification — Community Management](technical-community-management.md) · [Generate Response Suggestion](comments/generate-response.md) · [Response Refinement Analysis](technical-response-refinement-analysis.md)

## 1. Scope

Persist an append-only, de-identified record when a creator's edited AI suggestion is successfully sent. The record pairs the original AI text with the exact sent text plus refinement metadata. It lives outside the comment 30-day retention cascade, but tenant/account IDs and response text remain confidential and may contain identifying details.

The capture reuses the existing send path: `SendManualCommentReply` resolves the exact sent revision, its lineage root, and the linked evaluation, and records `MANUAL_REPLY_ATTEMPTED`/`MANUAL_REPLY_RESULT`. Pair capture itself adds no route or workflow event and no separate approval event; contextual analysis uses separate routes specified in [Response Refinement Analysis](technical-response-refinement-analysis.md).

## 2. Architectural Placement

- **Domain:** `AiResponseEditPair` — an immutable record; no update or delete path.
- **Application:** `RecordResponseRefinementPair` is invoked by `SendManualCommentReply` after the social responder confirms success and before the successful `MANUAL_REPLY_RESULT` event is appended. The decision logic (is this lineage AI-rooted? does the sent text differ?) is application code, not adapter code.
- **Ports:** `ResponseRefinementPairRepository` — `append(pair)`, enforced idempotency on the reply-attempt identifier. Read/query ports are out of Phase 1 scope.
- **Adapters:** Postgres repository adapter plus migration `022_create_ai_response_edit_pairs`; prompt-version capture is an additive generator/event contract change. No social-platform integration is changed.

The domain record does not depend on persistence libraries. The capture is best-effort inside the send orchestration; it never changes the send result.

## 3. Logical Data and Contracts

### AiResponseEditPair

Append-only record written once per successful manual reply attempt that edited an AI suggestion.

| Field | Source |
|---|---|
| `id` | generated UUID |
| `tenant_id`, `social_account_id` | send context (creator scoping; not audience data) |
| `platform` | connected account platform |
| `language` | `language` of the sent suggestion lineage (`pt-BR`, `en-US`, or `es-ES`) |
| `ai_text` | `payload.text` of the lineage root `RESPONSE_SUGGESTION_GENERATED` event |
| `final_text` | `payload.text` of the sent version event |
| `ai_provider`, `ai_model`, `ai_confidence`, `ai_rationale`, `intended_tone` | suggestion payload fields; `ai_rationale` nullable |
| `prompt_version` | provider-specific prompt-template version on new suggestions; historical rows are `UNKNOWN` |
| `tone_profile` | immutable suggestion `toneProfile` snapshot plus its `toneProfileSource` |
| `revision_count` | number of `RESPONSE_SUGGESTION_EDITED` events in the sent lineage |
| `last_edit_reason` | `reason` of the sent revision event when the sent version is an edit; `null` otherwise |
| `evaluation` | `payload.evaluation` of the latest `RESPONSE_EVALUATED` event for the sent revision, when one exists; `null` otherwise |
| `analysis_labels` | derived `sentiment`/`emotion`/`intent`/`topic`/`entity` labels from the effective comment analysis that parented the suggestion (corrections applied); `null` when absent |
| `manual_reply_attempt_id` | `attemptId` of the `MANUAL_REPLY_ATTEMPTED`/`MANUAL_REPLY_RESULT` pair — unique, drives idempotency |
| `recorded_at` | capture timestamp |

### Data minimization and source-retention boundary

The table must not store: `external_comment_id`, `external_reply_id`, external publication/thread identifiers, comment author fields, comment text, event IDs, or foreign keys to `social_comments`/`comment_workflow_events`. Tenant/account identifiers, the internal `manual_reply_attempt_id`, and response texts are still confidential data; the table is de-identified, not anonymous.

The attempt ID is used for idempotency and may resolve source context only through a tenant/account-scoped application query that enforces the comment and workflow-event expiration fields. Contextual analysis must not use this correlation after expiration or bypass retention. A source comment is never copied into the pair or analysis record.

### Capture and analysis eligibility

Pair capture is attempted only after the social responder confirms success, and only when the sent version's lineage root is `RESPONSE_SUGGESTION_GENERATED` and `final_text` differs from `ai_text`. A creator-authored response or an edit that reverted to the original AI text produces no pair.

Contextual analysis later requires the still-retained matching `MANUAL_REPLY_RESULT` with `status = SUCCEEDED`. Failed, `UNSUPPORTED`, or ambiguous platform outcomes do not trigger pair capture. Since the pair write precedes the success-result event append in the send orchestration, an event-persistence failure can leave a pair row; it is not evidence of a confirmed send and must be excluded from contextual analysis.

### Idempotency

`manual_reply_attempt_id` is unique; a second append for the same attempt is a no-op. Because a reply attempt can be recorded at most once per revision, at most one pair exists per sent version.

### Retention

No `expires_at`; rows are unaffected by the comment retention cascade. Dataset retention/deletion policy is an open product decision, not implemented in Phase 1.

## 4. Flow

1. `SendManualCommentReply` appends `MANUAL_REPLY_ATTEMPTED`, then the platform call succeeds and `markRepliedByApp` is attempted.
2. Before appending `MANUAL_REPLY_RESULT`, the application evaluates whether the sent revision has an AI suggestion root and whether its text differs from the original AI text. The pair is captured only when both conditions hold. New suggestion prompt versions are copied into the pair.
3. Resolve revision count and last edit reason from `RESPONSE_SUGGESTION_EDITED` events in the lineage; evaluation from a `RESPONSE_EVALUATED` event linked to the exact sent revision; and analysis labels from its effective comment-analysis chain with corrections applied.
4. `ResponseRefinementPairRepository.append` persists the pair best-effort.
5. The application appends `MANUAL_REPLY_RESULT` with `status = SUCCEEDED` and `refinementPairPersisted`. If this result event cannot be persisted after the platform call and pair capture, the pair may exist without a successful result event; contextual analysis must skip it because success cannot be verified.
6. Pair-write failure is caught, logged, and surfaced as `refinementPairPersisted: false`; it never changes the already-dispatched send result.

Batch send-all reuses the per-comment route serially, so each successful edited send captures its own pair with no additional orchestration.

## 5. Error Scenarios

- **Missing or malformed lineage payloads** (e.g., `originalSuggestionEventId` not resolving): skip capture, mark `refinementPairPersisted: false`; never throw into the send result.
- **Duplicate append for the same attempt**: repository treats the unique violation as a successful no-op.
- **Database failure during append**: logged and flagged on the result event payload; the already-sent reply is unaffected and is not retried.
- **Analysis deleted or absent**: `analysis_labels` is `null`; the pair is still recorded.
- **No evaluation for the sent revision**: `evaluation` is `null`; the pair is still recorded.

## 6. Testing

- **Unit (test-first):** trigger rule matrix — AI-rooted+edited → record; AI-rooted unedited → none; manual response → none; failed/unsupported/ambiguous result → none; edit-reverted-to-AI-text → none; idempotent re-append. Payload mapping including tone snapshot, revision count, last reason, evaluation, and corrected analysis labels. Best-effort failure leaves send success intact.
- **Integration:** migration 022 applies; Postgres adapter round-trips all fields; unique constraint on `manual_reply_attempt_id` holds; rows persist after `social_comments`/`comment_workflow_events` expiry deletes; data-minimization contract — no comment-scoped columns or foreign keys exist.
- **E2E:** edit → save revision → send → verify exactly one de-identified pair with both texts; unchanged send → zero pairs; deterministic social/JEV doubles only.

## 7. Observability

- `refinementPairPersisted` boolean on successful `MANUAL_REPLY_RESULT` payloads.
- Log warning on capture failure with tenant/account and attempt ID — never pair contents.
- Optional counter metric for captured pairs per platform/language.

## 8. Security Considerations

- The record holds creator-authored and AI-generated text that can repeat information from a comment — treat as tenant-confidential data and potentially personal data.
- No provider credentials, commenter identity, or external identifiers may be written; enforce via the append port contract and integration tests, not by convention.
- Privacy policy and retention/removal policy must disclose this de-identified post-retention response-text dataset before external launch.

## 9. Open Questions

- Retention/removal policy and creator-initiated purge for the dataset itself (tenant/account deletion should cascade pair and analysis data).
- Whether analysis labels should include corrected-only signals vs. the full effective label set — specified above as the effective set; confirm during implementation.
- Whether new capture records should preserve the original editor's authenticated identity; existing records cannot be attributed to a particular user.
