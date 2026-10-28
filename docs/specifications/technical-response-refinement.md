# Technical Specification — AI Response Refinement Dataset

**Status:** Draft — not implemented. The audit trail that feeds this dataset (`comment_workflow_events` with `RESPONSE_SUGGESTION_GENERATED`, `RESPONSE_SUGGESTION_EDITED`, `MANUAL_REPLY_ATTEMPTED`, `MANUAL_REPLY_RESULT`) is implemented. The anonymized pair table, repository port, and capture use case are specified here and pending.

**Product PRD:** [AI Response Refinement Dataset](../product/prds/response-refinement.md)  
**Related specifications:** [Technical Specification — Community Management](technical-community-management.md) · [Generate Response Suggestion](comments/generate-response.md)

## 1. Scope

Persist an append-only, anonymized record every time a creator successfully sends a response that was edited from an AI-generated suggestion. The record pairs the original AI text with the exact sent text plus the metadata required to learn from the human correction. It lives outside the comment 30-day retention cascade and contains no audience personal data.

The capture reuses the existing send path: `SendManualCommentReply` already resolves the exact sent revision, its lineage root, and the linked evaluation, and records `MANUAL_REPLY_ATTEMPTED`/`MANUAL_REPLY_RESULT`. No new HTTP route, no new workflow event type, and no separate approval event are introduced — a successful `MANUAL_REPLY_RESULT` remains the sole "approved and sent" signal.

## 2. Architectural Placement

- **Domain:** `AiResponseEditPair` — an immutable record; no update or delete path.
- **Application:** `RecordResponseRefinementPair` use case invoked by `SendManualCommentReply` after a successful `MANUAL_REPLY_RESULT` is appended. The decision logic (is this lineage AI-rooted? does the sent text differ?) is application code, not adapter code.
- **Ports:** `ResponseRefinementPairRepository` — `append(pair)`, enforced idempotency on the reply-attempt identifier. Read/query ports are out of Phase 1 scope.
- **Adapters:** Postgres repository adapter plus migration `022_create_ai_response_edit_pairs`. No platform or AI-provider integration is touched.

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
| `tone_profile` | immutable suggestion `toneProfile` snapshot plus its `toneProfileSource` |
| `revision_count` | number of `RESPONSE_SUGGESTION_EDITED` events in the sent lineage |
| `last_edit_reason` | `reason` of the sent revision event when the sent version is an edit; `null` otherwise |
| `evaluation` | `payload.evaluation` of the latest `RESPONSE_EVALUATED` event for the sent revision, when one exists; `null` otherwise |
| `analysis_labels` | derived `sentiment`/`emotion`/`intent`/`topic`/`entity` labels from the effective comment analysis that parented the suggestion (corrections applied); `null` when absent |
| `manual_reply_attempt_id` | `attemptId` of the `MANUAL_REPLY_ATTEMPTED`/`MANUAL_REPLY_RESULT` pair — unique, drives idempotency |
| `recorded_at` | capture timestamp |

### Anonymization contract

The table must not store: `external_comment_id`, `external_reply_id`, external publication/thread identifiers, comment author fields, comment text, event IDs, or foreign keys to `social_comments`/`comment_workflow_events`. `manual_reply_attempt_id` is an internally generated UUID with no external meaning; it exists for idempotency, not traceability. Nothing in the record can be joined back to a comment after its expiry.

### Trigger rule

A record is appended when all of the following hold for a `MANUAL_REPLY_RESULT` with `status = SUCCEEDED`:

1. the sent version's lineage root is `RESPONSE_SUGGESTION_GENERATED` (never `MANUAL_RESPONSE_CREATED` — creator-authored text has no AI baseline to refine); and
2. `final_text` differs from `ai_text` — this is the "only on modification" gate. A lineage containing an edit that reverted to the exact AI text produces no record.

Failed, `UNSUPPORTED`, or ambiguous results produce no record, including when the platform call succeeded but the result could not be confirmed.

### Idempotency

`manual_reply_attempt_id` is unique; a second append for the same attempt is a no-op. Because a reply attempt can be recorded at most once per revision, at most one pair exists per sent version.

### Retention

No `expires_at`; rows are unaffected by the comment retention cascade. Dataset retention/deletion policy is an open product decision, not implemented in Phase 1.

## 4. Flow

1. `SendManualCommentReply` completes its existing flow: the platform reply succeeds, `markRepliedByApp` is attempted, and a `SUCCEEDED` `MANUAL_REPLY_RESULT` is appended.
2. Still inside the use case, the application evaluates the trigger rule against the already-loaded workflow history: resolve the sent version's root event (`responseVersionRootId` semantics); if the root is an AI suggestion and the texts differ, build the pair.
3. Refinement context is resolved from the same history: revision count and last edit reason from `RESPONSE_SUGGESTION_EDITED` events of that lineage; evaluation snapshot from the `RESPONSE_EVALUATED` event linked to the sent revision (`payload.revisionEventId`); analysis labels from the suggestion's `parentEventId` analysis chain with `COMMENT_ANALYSIS_CORRECTED` fields applied over the original `COMMENT_ANALYSIS_CREATED` values.
4. `ResponseRefinementPairRepository.append` persists the record.
5. Any failure in steps 2–4 is caught, logged, and surfaced as `refinementPairPersisted: false` on the `MANUAL_REPLY_RESULT` payload (same pattern as `appReplyStatusPersisted`); the send still returns success.

Batch send-all reuses the per-comment route serially, so each successful edited send captures its own pair with no additional orchestration.

## 5. Error Scenarios

- **Missing or malformed lineage payloads** (e.g., `originalSuggestionEventId` not resolving): skip capture, mark `refinementPairPersisted: false`; never throw into the send result.
- **Duplicate append for the same attempt**: repository treats the unique violation as a successful no-op.
- **Database failure during append**: logged and flagged on the result event payload; the already-sent reply is unaffected and is not retried.
- **Analysis deleted or absent**: `analysis_labels` is `null`; the pair is still recorded.
- **No evaluation for the sent revision**: `evaluation` is `null`; the pair is still recorded.

## 6. Testing

- **Unit (test-first):** trigger rule matrix — AI-rooted+edited → record; AI-rooted unedited → none; manual response → none; failed/unsupported/ambiguous result → none; edit-reverted-to-AI-text → none; idempotent re-append. Payload mapping including tone snapshot, revision count, last reason, evaluation, and corrected analysis labels. Best-effort failure leaves send success intact.
- **Integration:** migration 022 applies; Postgres adapter round-trips all fields; unique constraint on `manual_reply_attempt_id` holds; rows persist after `social_comments`/`comment_workflow_events` expiry deletes; anonymization contract — no comment-scoped columns or foreign keys exist.
- **E2E:** edit → save revision → send → verify exactly one anonymized pair with both texts; unchanged send → zero pairs; deterministic social/JEV doubles only.

## 7. Observability

- `refinementPairPersisted` boolean on successful `MANUAL_REPLY_RESULT` payloads.
- Log warning on capture failure with tenant/account and attempt ID — never pair contents.
- Optional counter metric for captured pairs per platform/language.

## 8. Security Considerations

- The record holds creator-authored and AI-generated text — treat as tenant-confidential data with the same access posture as other tenant tables.
- No provider credentials, commenter identity, or external identifiers may be written; enforce via the append port contract and integration tests, not by convention.
- Privacy policy wording must disclose the anonymized post-retention refinement dataset before external launch.

## 9. Open Questions

- Retention/removal policy and creator-initiated purge for the dataset itself (Phase 3 tenant deletion should cascade `tenant_id`).
- Whether analysis labels should include corrected-only signals vs. the full effective label set — specified above as the effective set; confirm during implementation.
- Whether a future read surface (export, review UI, or JEV feedback input) is required; none is specified in Phase 1.
