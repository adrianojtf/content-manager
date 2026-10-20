# Evaluate Response

## Goal

Optionally evaluate an exact saved AI-generated or creator-authored response version through a distinct manual action. Response evaluation is advisory only; it never sends or blocks a manually requested reply.

## Preconditions and Input

- The creator manually requests evaluation for a saved response version.
- A persisted comment analysis must exist before this evaluation action is available.
- The adapter sends original comment text, the effective persisted `CommentAnalysis` (including append-only creator corrections), and exact response text.
- Content context and creator communication-policy input remain deferred until their data contracts are defined. Provider wire DTOs remain inside the JEV adapter.

Manual response authoring and sending do not require comment analysis or response evaluation. AI response generation still requires comment analysis.

## Output

- relevance, tone, and helpfulness scores normalized to `[0,1]`;
- factual, toxicity, and hallucination risk scores normalized to `[0,1]`;
- advisory recommendation (`APPROVE`, `REVIEW`, or `REJECT`);
- confidence normalized to `[0,1]`;
- nullable rationale, provider/model, schema version, evaluated response-version ID, and timestamp.

## Decision

```text
Creator explicitly requests optional evaluation
    ↓
Validate structured output and persist immutable evaluation
    ↓
Display recommendation, risks, confidence, and rationale as advice
    ↓
Creator separately decides whether to manually send the exact saved response version
```

No recommendation blocks or triggers a send. A later edit makes the evaluation stale for the new version but does not remove it from history. The screen may recommend whether evaluation is useful based on comment content/state; deterministic criteria for that cue remain to be specified. Do not infer numeric thresholds.

## API

- `POST /social/accounts/{accountId}/comments/{externalCommentId}/revisions/{revisionEventId}/evaluation` evaluates the exact latest saved response version; the request has no body. It requires comment analysis.
- `POST /social/accounts/{accountId}/comments/{externalCommentId}/revisions/{revisionEventId}/send` accepts no body or client text, and requires neither comment analysis nor response evaluation. The action is still per comment and uses only the exact latest saved version.

## Acceptance Criteria

- [ ] Evaluation is optional, manually requested, immutable, and tied to the exact response version.
- [ ] Evaluation is unavailable until comment analysis exists; manual authoring and manual sending remain available without it.
- [ ] Invalid output is rejected; the prior evaluation and original comment-analysis artifacts are not overwritten.
- [ ] `APPROVE`, `REVIEW`, and `REJECT` are visible advisory outputs and none blocks or dispatches a manual send.
- [ ] Evaluation preserves confidence, rationale, provider/model, schema version, response-version ID, and timestamp in workflow history.
- [ ] The criteria for recommending an optional evaluation in the UI are explicit and testable when defined.
