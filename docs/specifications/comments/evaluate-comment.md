# Evaluate Comment

## Goal

Evaluate a persisted audience comment through the application-owned `CommentEvaluator` port and store normalized TypeSafe Jev signals for response generation and later statistics.

## Input to the application port

- original comment text;
- platform and external publication ID.

The TypeSafe state contains those values only. It does not include author identity or observed like/reply counts. `engagementValue` therefore means estimated engagement potential from comment content, not measured platform engagement.

## TypeSafe request

The infrastructure adapter sends `POST https://api.typesafe.ai/v1/systemone` with model `jev-latest`, a structured `state`, and independent typed questions:

- `sentiment`: Choice among `POSITIVE`, `NEUTRAL`, `NEGATIVE`;
- `emotion`: Choice among `JOY`, `CURIOSITY`, `FRUSTRATION`, `SADNESS`, `ANGER`, `SURPRISE`, `NEUTRAL`, `OTHER`;
- `intent`: Choice among `QUESTION`, `PRAISE`, `COMPLAINT`, `SUGGESTION`, `CONTENT_REQUEST`, `REACTION`, `OTHER`;
- `topic`: Choice among `CHARACTER`, `STORY`, `CONTENT`, `PRODUCTION`, `COMMUNITY`, `PLATFORM`, `OTHER`;
- `spam` and `toxicity`: Noul probabilities in `[0,1]`;
- `engagement`: a five-level ordered Score, normalized from `[0,4]` to `[0,1]`. Explicit interest in more content/another part is a strong engagement signal; short wording alone must not lower the score.
- `needs_external_facts`: a Noul probability that answering requires information absent from the supplied state;
- `requests_continuation`: a Noul probability that the comment explicitly requests another part, episode, or continuation.

`requests_continuation` is retained separately for statistics and response-generation context; it is not a send trigger.

All questions are evaluated independently against the same state. Instructions and criteria must not depend on answers from other questions in the same request.

## Normalized output

- selected values for sentiment, emotion, intent, and topic;
- per-Choice confidence and probability distribution;
- `spamScore` and `toxicityScore` from the respective Noul probabilities;
- normalized estimated `engagementValue`, plus the raw Score, rubric legend, probabilities, and confidence;
- `needsExternalFacts` and `continuationRequestProbability`;
- a conservative aggregate `confidence` equal to the lowest confidence among Choice/Score answers. Per-question confidence remains the primary evidence; Noul's probability is itself the answer and has no separate confidence;
- provider, returned model ID, internal schema version, optional token usage, and evaluated timestamp.

TypeSafe does not return free-text rationale or arbitrary entity extraction. `rationale` and `entity` are persisted as `null` unless a future data contract supplies them.

## Flow

```text
Persisted comment
  ↓
CommentEvaluator application port
  ↓
TypeSafe System One adapter: state + typed questions
  ↓
Validate answers and normalize scores/evidence
  ↓
Append immutable COMMENT_ANALYSIS_CREATED event
```

## Acceptance Criteria

- [ ] Comment evaluation uses the application port; the domain never calls TypeSafe directly.
- [ ] The adapter sends the documented TypeSafe request shape and maps nested `answers` into the application result.
- [ ] Choice values, probabilities, confidences, Score rubric, Noul probabilities, model, and token usage are validated and retained.
- [ ] Engagement is explicitly labeled/stored as an estimate, not as an observed social metric.
- [ ] Explicit requests for another part/episode are classified as `CONTENT_REQUEST` and a `requests_continuation` Noul signal. They contribute positively to estimated engagement; brevity alone is not a low-engagement criterion.
- [ ] Invalid output does not replace a prior analysis; a failure is recorded separately.
- [ ] A human correction remains append-only and does not rewrite the original TypeSafe evidence.
- [ ] Corrections to score fields remain within `[0,1]` and include actor source/time plus an optional reason.
- [ ] Generated replies receive the effective human-corrected labels plus the original TypeSafe evidence as advisory context.
