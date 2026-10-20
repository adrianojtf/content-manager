# Evaluate Comment

## Goal

Evaluate an audience comment using JEV and persist structured intelligence.

## Input

- comment text;
- content context;
- publication context;
- optional author interaction context.

## Output

- sentiment;
- emotion;
- intent;
- topic;
- entity;
- spam score normalized to `[0,1]`;
- toxicity score normalized to `[0,1]`;
- engagement value normalized to `[0,1]`;
- confidence normalized to `[0,1]`;
- provider/model, schema version, rationale, and evaluated timestamp.

## Flow

```text
Comment
  ↓
Prepare Context
  ↓
CommentEvaluator
  ↓
JevAdapter
  ↓
Validate Output
  ↓
Persist CommentAnalysis
```

## Acceptance Criteria

- [ ] Comment is evaluated through the application port.
- [ ] JEV is not accessed by the domain directly.
- [ ] Structured output is validated.
- [ ] Confidence and rationale are persisted in an immutable versioned JEV analysis.
- [ ] Invalid output does not mutate the comment state or replace a prior analysis.
- [ ] A human correction to classification labels or spam/toxicity/engagement scores is appended separately; original JEV values, confidence, and rationale remain unchanged.
- [ ] Corrected numeric scores remain within `[0,1]` and include actor source/time plus an optional reason.
