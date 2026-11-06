# PRD — Response Refinement Analysis

**Status:** Draft

**Tech spec:** [Technical Specification — Response Refinement Analysis](../../specifications/technical-response-refinement-analysis.md)
**Related:** [AI Response Refinement Dataset](response-refinement.md) · [Community Management](community-management.md)

## 1. Objective

Use successfully edited AI-response records together with their still-retained source comments to identify recurring weaknesses in response generation and handling. Compare the AI suggestion and the exact user-edited response against the same comment context, then turn recurring, evidence-backed findings into hypotheses for controlled prompt or process improvements.

The analysis is advisory. It does not modify prompts, settings, response text, or social state. A proposed prompt change must be reviewed and pass the existing deterministic response-evaluation suite before release.

## 2. User and Problem

**Primary users:** an authenticated creator and an authorized customer-service/homologation expert reviewing refinement evidence.

`ai_response_edit_pairs` stores the original AI text, the final text sent by the creator, and a `manual_reply_attempt_id`. It does not store the original comment. While the comment and workflow events remain within retention, that attempt ID can be used inside the application to resolve the matching successful send and source comment. After comment retention expires, only the pair remains; the application must not reconstruct or retain the comment from another source.

The pair alone shows that the creator changed the response, but not what the commenter asked or whether the change improved accuracy, relevance, safety, or tone. It also does not store the editor's user identity, so it cannot independently verify that every row came from the homologation expert. The product needs a contextual comparison of the three texts—comment, AI response, and sent user edit—plus structured JEV signals and expert review to identify patterns without treating model output as truth.

## 3. Scope

### In scope

- Keep the deterministic, tenant-scoped aggregate report over edit pairs.
- Add an explicit, user-requested contextual analysis for pairs whose original comment, successful send event, and effective comment analysis are still retained.
- For each eligible pair, assess the original AI response and final sent response against the same comment and effective analysis; classify the edit and likely AI response issue with structured JEV output.
- Aggregate issue categories and score/risk deltas by platform, language, provider/model, tone, and prompt version.
- Track a version identifier for the response-generation prompt on future suggestions and edit pairs; label historical records as `UNKNOWN`.
- Surface recurring patterns as prompt/process hypotheses for human review and controlled regression testing.
- Let an authorized customer-service/homologation expert accept, reject, or correct analysis hypotheses without overwriting the original JEV result.

### Out of scope

- Automatically changing system prompts, tone settings, generated responses, or publishing/sending content.
- Contextual analysis after the source comment/workflow history has expired.
- Persisting or extending retention of comment text in the refinement dataset or analysis artifacts.
- Training/fine-tuning a model, sharing examples across tenants, or exporting raw examples.
- Treating JEV classifications or evaluations as a correctness oracle.

## 4. Product Requirements

### RRA-01 — Tenant authorization

Every report and analysis request is scoped to the authenticated tenant. Tenant IDs and source comment identifiers are never accepted as authorization inputs from the client.

### RRA-02 — Deterministic aggregate report

The report returns pair counts, edit metrics, stored final-response evaluation summaries, and provider/model/tone/language/platform/prompt-version breakdowns. Its existing period and sample-selection limitations remain visible.

### RRA-03 — Resolve the three-way context safely

Contextual analysis is eligible only when the application can resolve, under the same tenant and social account:

1. a successful `MANUAL_REPLY_RESULT` for the pair's `manual_reply_attempt_id`;
2. its corresponding `MANUAL_REPLY_ATTEMPTED` event and AI suggestion lineage;
3. the source comment and effective persisted comment analysis, including creator corrections; and
4. the exact AI text and final text already stored in the pair.

Use the source comment only while its comment and workflow-event retention is active. Never infer or substitute an expired comment.

### RRA-04 — Explicit external analysis

JEV receives the comment text, effective comment-analysis fields, AI response, final response, and optional edit reason only after an authorized user explicitly requests contextual analysis and confirms that these texts will be sent to JEV. Do not send commenter identity, external IDs, account IDs, publication IDs, credentials, or unrelated workflow history.

### RRA-05 — Fair response comparison

Evaluate the AI and final response independently against the exact same comment and effective analysis. Preserve relevance, tone, helpfulness, factual/toxicity/hallucination risks, confidence/signals, recommendation, provider/model, schema version, and usage when available. Report per-field deltas (`final - AI`) and recommendation transitions; do not collapse conflicting dimensions into an unqualified “improved” label.

### RRA-06 — Structured edit diagnosis

For each pair, JEV returns schema-validated structured fields:

- `editCategory`: `FACTUAL_CORRECTION`, `RELEVANCE`, `TONE`, `CLARITY`, `LENGTH`, `PERSONALIZATION`, `SAFETY`, `OTHER`, or `UNCLEAR`;
- `observedAiIssue`: `UNSUPPORTED_CLAIM`, `MISREAD_COMMENT`, `INCOMPLETE_ANSWER`, `TONE_MISMATCH`, `TOO_VERBOSE`, `TOO_BRIEF`, `SAFETY_RISK`, `NO_CLEAR_ISSUE`, or `INDETERMINATE`;
- confidence and one `evidenceSource` code from `COMMENT`, `AI_RESPONSE`, `FINAL_RESPONSE`, or, when present, `CREATOR_EDIT_REASON`.

These are model inferences, not verified causes or statements that the human edit is correct.

### RRA-07 — Prompt/process versioning and hypotheses

New AI suggestions and captured pairs include a stable `promptVersion` identifying the exact provider-specific system/developer prompt template. Historical pairs without this value use `UNKNOWN`; do not infer a version from dates.

A process-level hypothesis requires at least five context-valid analyses with classification confidence of at least `0.70` sharing a category within the same provider/model and response language. A prompt-specific hypothesis additionally requires a known, identical `promptVersion`; historical `UNKNOWN` records can inform process hypotheses but never identify which prompt version to change. A human reviews the supporting evidence and decides whether to change the prompt or process. Any change is tested against a curated deterministic evaluation set before release.

### RRA-08 — Expired or partial data

Pairs without valid retained source context are counted as `SOURCE_CONTEXT_EXPIRED` or another stable skip reason and receive no JEV call. One pair's provider/schema failure does not discard other results. Report analyzed, skipped, and failed counts separately.

### RRA-09 — Expert validation

JEV's per-pair classification remains an unverified model inference. An authorized customer-service/homologation expert reviews the classifications and score/risk changes before using them to propose a prompt/process adjustment. A repeated edit alone is not verified ground truth.

### RRA-10 — No raw text in stored analysis/report

Do not copy comment text or raw AI/final response text into analysis artifacts, aggregate responses, or logs. Raw context is used only in the tenant-scoped application query and explicitly approved JEV request. Persist pair linkage, structured findings, evaluation snapshots, confidence/provenance, and safe evidence codes.

### RRA-11 — Human-controlled improvements

Findings produce hypotheses only. No analysis result changes a prompt, tone profile, response suggestion, evaluation gate, or send decision. UI labels and category descriptions are static localized copy in `pt-BR`, `en-US`, and `es-ES`; do not use JEV as a prose generator.

## 5. Success Measures

- The application can explain which issue categories recur for each versioned generation prompt and language.
- AI and final texts are assessed against identical context, and all score/risk deltas remain independently inspectable.
- Expired, missing, or cross-tenant context is never sent to JEV.
- Each request makes only the explicitly authorized provider calls and reports partial outcomes accurately.
- Human prompt/process changes are validated with deterministic regression examples before release.

## 6. Privacy and Data Quality

The pair dataset is de-identified, not anonymous. Contextual analysis temporarily reuses comment text that is still retained under the existing 30-day comment/workflow policy; the request explicitly sends that text to JEV. Analysis must not copy comment text or add a comment/event identifier; source resolution is attempted only through the existing pair lineage and only while the application retention checks pass. Privacy disclosure and provider-processing approval are prerequisites before enabling this capability outside controlled homologation.

## 7. Acceptance Criteria

- [ ] Aggregate reports remain tenant-scoped and return no raw text or source IDs.
- [ ] Context resolution requires a matching successful send, attempt lineage, AI suggestion root, and currently retained comment/analysis in the same tenant/account.
- [ ] Missing, expired, malformed, or cross-tenant context causes a stable skip and no JEV request.
- [ ] The JEV request contains only the three response-context fields plus allowlisted effective analysis and optional edit reason; it excludes identifiers and credentials.
- [ ] AI and final responses are evaluated with the exact same comment and effective analysis, and their scores, risks, confidence/signals, recommendations, provider/model, schema, and usage are preserved.
- [ ] Edit categories and issue codes are allowlisted and schema-validated; confidence is retained; invalid output is recorded as a per-pair failure.
- [ ] Partial provider failures preserve completed pair analyses and identify each failed/skipped pair without storing raw text.
- [ ] New suggestions/pairs preserve `promptVersion`; old pairs are explicitly `UNKNOWN`.
- [ ] Process-level hypotheses require at least five context-valid analyzed pairs with classification confidence of at least `0.70` within one provider/model and response language; prompt-specific hypotheses additionally require a known matching `promptVersion`. Historical `UNKNOWN` rows never support prompt-version attribution, and lower-confidence results do not count toward either threshold.
- [ ] The analysis output labels JEV classifications and score differences as advisory; no code marks a pattern human-validated or applies a prompt change automatically.
- [ ] Reports do not attribute edits to a specific user unless a separately authorized actor-identity field is added to capture; existing rows are not attributed by inference.
- [ ] No finding automatically changes prompts/settings or sends a reply; prompt changes must pass deterministic regression tests using synthetic or separately approved/de-identified fixtures, not copied live comments.
- [ ] Consent, labels, categories, loading/empty/expired/error states, and reviewer actions are localized in `pt-BR`, `en-US`, and `es-ES`.
- [ ] Any displayed generated project artifact has separate auditable `pt-BR`, `en-US`, and `es-ES` variants; this release uses localized static labels rather than generated narrative.

## 8. Open Questions

- Which tenant role may authorize sending retained comment/response text to JEV?
- Which authenticated role may adjudicate findings, and should homologation reviewer identity be captured for new edits?
- What explicit privacy disclosure/consent and deployment-level kill switch are required before enabling contextual analysis?
- What retention and creator-initiated deletion policy applies to the underlying AI/final text pairs and derived analyses?
- Should analyses be available to creators, internal homologation operators, or both, with separate authorization?
