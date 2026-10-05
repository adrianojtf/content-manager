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
- spam score;
- toxicity score;
- engagement value;
- confidence.

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
- [ ] Confidence is persisted.
- [ ] Invalid output does not mutate the comment state.
