# Test Strategy

## Completion Model

```text
SPEC
  ↓
WRITE FAILING TEST (RED)
  ↓
IMPLEMENT MINIMUM CHANGE (GREEN)
  ↓
REFACTOR (KEEP TESTS GREEN)
  ↓
UNIT TESTS
  ↓
INTEGRATION TESTS
  ↓
E2E TESTS
  ↓
AI EVALUATION
  ↓
DONE
```

## Test Requirements

- Apply TDD to new behavior and bug fixes: add or update a failing test before production code, make it pass with the smallest suitable change, then refactor while keeping tests green.
- Every application use case requires unit tests for its behavior and relevant domain rules.
- Every external integration boundary requires integration tests.
- Critical user journeys require E2E tests across the relevant presentation, application, and persistence flow.
- E2E and integration tests must use deterministic external-service test doubles by default; do not depend on production APIs or nondeterministic AI output.
- E2E tests complement, and do not replace, unit and integration tests.
- Follow Clean Code: keep tests and production code readable, cohesive, and free of unnecessary duplication or speculative abstractions.

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
