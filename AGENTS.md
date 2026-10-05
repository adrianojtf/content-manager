# SDD Development Rules

## Specification First

- Read the relevant specification before implementation.
- Do not implement undocumented behavior.
- Update specifications when behavior changes.
- Acceptance criteria must remain testable.

## Architecture

- Follow Hexagonal Architecture.
- Keep domain independent from infrastructure.
- Use application use cases for orchestration.
- Keep external DTOs inside adapters.
- Avoid premature microservices.

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

Every use case requires unit tests.

Every external integration boundary requires integration tests.

Critical user journeys require functional scenarios.

AI workflows require deterministic validation around the AI output.
