# PRD — AI Response Refinement Dataset

**Status:** Draft  
**Tech spec:** [Technical Specification — AI Response Refinement](../../specifications/technical-response-refinement.md) · **Related PRDs:** [Community Management](community-management.md) · [Response Refinement Analysis](response-refinement-analysis.md)

## 1. Objective

Build a persistent, de-identified dataset that captures every case where a human edited an AI-generated response before sending it. Each record pairs the original AI text with the final text the creator actually sent, plus the metadata needed to learn from the difference — so future response generation can be refined toward what creators really publish.

## 2. User and Problem

**Primary user:** the product/AI team refining response quality; indirectly the creator, who receives better suggestions over time.

Today the application already audits the full lifecycle in `comment_workflow_events` — the immutable AI suggestion (`RESPONSE_SUGGESTION_GENERATED`), every human edit (`RESPONSE_SUGGESTION_EDITED`), the exact sent text (`MANUAL_REPLY_ATTEMPTED`), and the platform result (`MANUAL_REPLY_RESULT`). However, this audit history is an operational log: it expires with the parent comment after 30 days under the retention policy, and it is keyed by comment rather than organized as a learning dataset. The signal "how humans change our AI output" is therefore deleted before it can be analyzed.

The product needs a durable record of human corrections to AI responses to measure edit distance/patterns, improve prompts and tone profiles, and eventually feed evaluation or fine-tuning pipelines.

## 3. Scope

- When a creator successfully sends a response whose lineage started from an AI suggestion and the sent text differs from the original AI text, persist one append-only record containing both texts and refinement metadata.
- The dataset excludes direct audience identifiers and comment text, but is not anonymous: it retains tenant/account scope, an internal reply-attempt correlation ID, and response texts that may themselves contain personal or identifying content.
- The dataset has its own lifecycle independent of the 30-day comment retention: records are not deleted when the source comment expires.
- Sending remains the approval boundary: pair capture starts only after the platform confirms a successful reply; the matching `MANUAL_REPLY_RESULT` event is appended afterward when possible. The existing "send = approval" model is unchanged; no separate approval event is introduced.
- Failed or ambiguous sends, sends of unedited AI text, and sends of creator-authored responses (no AI parent) produce no record.
- Recording the pair is best-effort: a dataset write failure must never fail, block, or retry an already dispatched reply.

Out of scope for this capture capability: contextual analysis using the retained source comment, a review UI, automatic prompt/tone changes based on the data, and exporting raw pairs. Contextual analysis is specified separately in [Response Refinement Analysis](response-refinement-analysis.md). Prompt/tone changes remain human-controlled.

## 4. Requirements

### RR-01 — Record edited-and-sent AI responses

After a successful manual send, when the dispatched version belongs to a lineage rooted at an AI-generated suggestion and the sent text differs from that suggestion's text, append one record pairing the original AI text with the final sent text.

### RR-02 — Preserve refinement context

Each record carries the metadata needed to interpret the edit: platform, response language, AI provider/model and prompt version, generation confidence and rationale when present, the tone profile snapshot used for generation, the number of human revisions, the optional reason from the last revision, the latest response evaluation when one exists, and derived analysis labels (sentiment/intent/topic) when a comment analysis exists. Raw comment text and direct audience identifiers are never copied. Historical rows without a prompt version are `UNKNOWN`.

### RR-03 — Minimize direct audience identifiers

The record must not store the external comment ID, comment author data, external reply ID, comment text, or any foreign key to `social_comments`/`comment_workflow_events`. Tenant/account scope, the internal attempt ID, and response texts remain confidential data; this design does not guarantee that the text contains no personal information.

### RR-04 — Independent retention

Records are append-only and are not subject to the comment 30-day cascade. No update or delete path exists in Phase 1; retention/removal policy for the dataset itself is a separate product decision.

### RR-05 — Idempotent capture

At most one record exists per manual reply attempt. Retrying or replaying the send flow for the same attempt does not create duplicates.

### RR-06 — Never affect the send path

Pair capture happens only after the social platform confirms the reply, but its write may precede persistence of the `MANUAL_REPLY_RESULT` event. Capture is best-effort: a failure never changes the send result. A persisted pair without its matching successful result event is not eligible for contextual analysis.

## 5. Acceptance Criteria

- [ ] A successful send of an edited AI suggestion appends exactly one record containing the original AI text and the exact sent text.
- [ ] A successful send of an unedited AI suggestion creates no record.
- [ ] A successful send of a creator-authored (manual) response creates no record.
- [ ] A failed, unsupported, or ambiguous send creates no record.
- [ ] The record preserves platform, language, provider/model/promptVersion, confidence/rationale, tone profile snapshot, revision count, optional last edit reason, latest response evaluation snapshot when present, and derived analysis labels when present.
- [ ] The record contains no comment author data, no external comment/reply identifiers, no comment text, and no foreign keys to comment-scoped tables; privacy classification does not call the record anonymous.
- [ ] Records persist after the source comment and its workflow events expire under the 30-day retention.
- [ ] Repeated processing of the same reply attempt produces a single record.
- [ ] A failure writing the record does not change the send outcome and leaves an observable error.
- [ ] Trilingual behavior is preserved: the recorded language is the language of the sent variant; no variant is merged or translated.

## 6. Privacy Notes

The dataset deliberately retains creator-authored and AI-generated text beyond the 30-day comment retention. A response can repeat names or other details from the source comment, so excluding the comment body and external identifiers does not guarantee that audience personal data is absent. Define retention/removal policy and disclose the de-identified response-text dataset in the privacy policy before launch.
