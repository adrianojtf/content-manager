# Evaluate Response

## Goal

Optionally evaluate an exact saved AI-generated or creator-authored response version through a distinct manual action. TypeSafe Jev returns structured judgments; the result is advisory and never sends or blocks a manually requested reply.

## Preconditions and Input

- The creator manually requests evaluation for a saved response version.
- A persisted comment analysis must exist before this action is available.
- The adapter sends the original comment text, effective persisted `CommentAnalysis` (including append-only creator corrections), and exact response text as the TypeSafe `state`.
- The configured communication policy and observed platform metrics are not available in this state.

Manual response authoring and sending do not require comment analysis or response evaluation. AI response generation still requires comment analysis.

## TypeSafe questions and output

- `relevance`, `tone`, and `helpfulness`: Score questions with five ordered levels, normalized from `[0,4]` to `[0,1]`;
- `factualRisk`, `toxicityRisk`, and `hallucinationRisk`: Noul probabilities in `[0,1]`;
- `publishRecommendation`: Choice among `APPROVE`, `REVIEW`, and `REJECT`, evaluated independently against the supplied state and its own criteria;
- per-question confidence/probabilities where provided by Choice/Score, conservative aggregate confidence, returned model ID, token usage, internal schema version, response-version ID, and timestamp.

TypeSafe does not generate rationale text. Store `rationale: null`. Because questions are evaluated independently, the recommendation question must not assume it can read the other answers; it evaluates the comment, analysis, and exact response in `state`.

## Decision

```text
Creator explicitly requests optional evaluation
    ↓
TypeSafe adapter sends state + typed questions
    ↓
Validate answers, normalize scores, append immutable evaluation
    ↓
Display metrics and recommendation as advice
    ↓
Creator separately decides whether to manually send the exact saved version
```

No recommendation blocks or triggers a send. A later edit makes the evaluation stale for the new version but does not remove it from history. Do not infer an automatic risk threshold from the scores.

## API

- `POST /social/accounts/{accountId}/comments/{externalCommentId}/revisions/{revisionEventId}/evaluation` evaluates the exact latest saved version in the selected response lineage; the request has no body. It requires comment analysis. A different language variant does not make the selected version stale, while a newer generation in the same language or a later edit does.
- `POST /social/accounts/{accountId}/comments/{externalCommentId}/revisions/{revisionEventId}/send` accepts no body or client text, and requires neither comment analysis nor response evaluation. The action is still per comment and uses only the exact latest saved version in the selected response lineage. Changed editor text is appended as a revision before the send; other language variants do not supersede it.

## Acceptance Criteria

- [ ] Evaluation is optional, manually requested, immutable, and tied to the exact response version.
- [ ] Evaluation is unavailable until comment analysis exists; manual authoring and manual sending remain available without it.
- [ ] The adapter sends the documented TypeSafe request and maps/validates nested typed answers.
- [ ] Per-question confidence/probabilities and usage metadata are retained; risk probabilities and normalized scores remain in `[0,1]`.
- [ ] Invalid output is rejected; the prior evaluation and original comment-analysis artifacts are not overwritten.
- [ ] `APPROVE`, `REVIEW`, and `REJECT` are visible advisory outputs and none blocks or dispatches a manual send.
- [ ] Evaluation preserves provider/model, schema version, response-version ID, usage, and timestamp in workflow history; rationale is `null`.
