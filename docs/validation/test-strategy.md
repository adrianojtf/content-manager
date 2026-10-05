# Test Strategy

## Completion Model

```text
SPEC
  ↓
IMPLEMENTATION
  ↓
UNIT TEST
  ↓
INTEGRATION TEST
  ↓
FUNCTIONAL TEST
  ↓
AI EVALUATION
  ↓
DONE
```

## AI-Specific Validation

For JEV features, validate:

- schema correctness;
- classification consistency;
- confidence handling;
- invalid output handling;
- risk thresholds;
- deterministic decision rules;
- auditability.

## Important Principle

JEV output is not treated as a test oracle by default.

The system must validate AI output against schemas and deterministic constraints. Human review remains available for uncertain or high-impact decisions.

## Functional Scenarios

Critical flows should cover:

1. Positive comment.
2. Question.
3. Complaint.
4. Spam.
5. Toxic comment.
6. Ambiguous comment.
7. Low-confidence evaluation.
8. Good response suggestion.
9. Unsafe response suggestion.
10. Audience insight from recurring comments.
