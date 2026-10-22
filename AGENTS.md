# SDD Development Rules

## Specification First

- Read the relevant specification before implementation.
- Do not implement undocumented behavior.
- Update specifications when behavior changes.
- Acceptance criteria must remain testable.

## Clean Code and TDD

- Use clear names, small cohesive units, and explicit boundaries; avoid duplication and speculative abstractions.
- For every new or changed behavior, write or update the relevant tests before production code and follow Red-Green-Refactor.
- Refactor only while preserving behavior and keeping the relevant test suite green.

## Architecture

- Follow Hexagonal Architecture.
- Keep domain independent from infrastructure.
- Use application use cases for orchestration.
- Keep external DTOs inside adapters.
- Avoid premature microservices.

## Frontend Appearance

- Every screen and UI state must be compatible with both light and dark themes.
- Use theme tokens for surfaces, text, borders, and interactive states; avoid hard-coded colors that assume a light background.
- Verify new or changed UI in both themes, including forms, loading, empty, and error states where applicable.
- Preserve readable contrast, visible focus indicators, and form-control color schemes in both themes.

## Social Integrations

- Each platform is an independent adapter.
- Never assume capability parity.
- Normalize external data.
- Preserve external identifiers.
- Handle partial failure.

## JEV

JEV is an intelligence provider.

### Allowed

- Comment evaluation.
- Response evaluation.
- Audience insight generation.
- Content recommendation generation.

### Forbidden

- Direct database access.
- Direct social API access.
- Direct domain mutation.
- Bypassing authorization.
- Bypassing deterministic business rules.

### AI Output

- Must be structured.
- Must be schema-validated.
- Must preserve confidence.
- Must preserve rationale when applicable.
- Must be auditable.

## Automation Boundary

Never auto-publish an AI response solely because JEV recommends it.

The application must evaluate:

- platform capability;
- creator policy;
- confidence;
- risk;
- response evaluation.

## Testing

- Every use case requires unit tests; add or update them test-first for each behavior change.
- Every external integration boundary requires integration tests.
- Critical user journeys require end-to-end (E2E) tests that exercise the application flow across relevant layers.
- E2E tests must use deterministic test doubles for external services unless a separately controlled sandbox test is explicitly required; they must not rely on production services.
- AI workflows require deterministic validation around the AI output; do not use live model output as the sole test oracle.

## Trilingual Content

- User-facing interface text must have semantic catalog entries in `pt-BR`, `en-US`, and `es-ES`; catalog parity is enforced by tests.
- The interface locale is selected independently from generated content and persisted locally until authenticated locale preferences are wired.
- Every AI-generated project artifact (response suggestions, audience insights, content recommendations) must produce separate, auditable variants in Portuguese, English, and Spanish. Preserve partial successes and record failures per language; never combine variants into one sendable message.
- User-facing interface copy must be cataloged in all three locales. Project specifications remain in their canonical authoring language unless a localized document is explicitly requested.
