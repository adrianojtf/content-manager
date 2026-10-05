# Evaluate Response

## Goal

Use JEV to evaluate an AI-generated response before it can be automatically published.

## Input

- original comment;
- suggested response;
- CommentAnalysis;
- content context;
- creator communication policy.

## Output

- relevance;
- tone;
- helpfulness;
- factual risk;
- toxicity risk;
- hallucination risk;
- publish recommendation;
- confidence;
- rationale.

## Decision

```text
Evaluation
    ↓
Confidence / Risk Rules
    ├── APPROVE
    ├── REVIEW
    └── REJECT
```

## Acceptance Criteria

- [ ] Response is evaluated before automatic publication.
- [ ] High-risk response cannot be auto-published.
- [ ] Evaluation is persisted.
- [ ] Rationale is visible to the creator.
