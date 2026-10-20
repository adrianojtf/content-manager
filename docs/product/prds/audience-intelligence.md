# PRD — Audience and Content Intelligence

**Status:** Draft — open product decisions are listed below.  
**Tech spec:** [Technical Specification — Audience and Content Intelligence](../../specifications/technical-audience-intelligence.md)

## 1. Objective

Turn analyzed audience reactions and publication performance into evidence-backed insights and advisory recommendations that help the creator decide what to do next.

## 2. User and Problem

**Primary user:** a creator operating within an authorized tenant.

The creator needs to recognize recurring audience patterns and understand what evidence supports a possible content action.

## 3. MVP Scope

- Generate audience insights from analyzed comments, metric snapshots, content metadata, and historical context.
- Generate content recommendations from audience and performance evidence.
- Preserve evidence period, confidence, rationale, and the distinction between observations and inference.
- Let the creator accept or reject a recommendation without automatically changing content or publishing.

## 4. Requirements

### AI-01 — Generate audience insights

The application provides prepared aggregate context to the intelligence provider through an application port. Possible insights include recurring topics, character/theme mentions, common questions, complaints, engagement opportunities, and audience expectations.

### AI-02 — Make evidence auditable

Each generated insight identifies its evidence period, supporting evidence, and confidence, and distinguishes observed data from provider inference.

### AI-03 — Generate content recommendations

Recommendations may propose future content actions and must include rationale, supporting evidence, and confidence.

### AI-04 — Preserve advisory status

Recommendations are advisory. The creator may accept or reject them; generation alone does not mutate content, publish content, or execute an external action.

### AI-05 — Validate provider output

The application validates structured provider output and required fields. Invalid output does not mutate domain state.

## 5. Acceptance Criteria

- [ ] An insight includes a defined evidence period and references the aggregate input used to derive it.
- [ ] Manually entered Novelaria episode metrics are included only when explicitly and tenant-safely associated with the target Content; their source, platform, and evidence period are preserved, and no association is inferred from an episode code or title.
- [ ] An insight distinguishes observed evidence from inference and retains confidence.
- [ ] A recommendation includes actionable text, rationale, evidence, and confidence.
- [ ] Provider output is schema-validated before persistence.
- [ ] Invalid output is rejected without domain mutation and is available for operational diagnosis without exposing secrets.
- [ ] The creator can accept or reject a recommendation, and the decision is persisted.
- [ ] Accepting a recommendation does not itself publish or modify social content unless a separate, explicitly authorized application workflow is invoked.
- [ ] JEV receives only application-prepared context and cannot directly query storage or social APIs.

## 6. Out of Scope

- Automatic execution of recommendations.
- Unsupported causal claims about why a publication performed a certain way.
- JEV ownership of business rules, persistence, authorization, or social side effects.

## 7. Dependencies

- Community Management PRD.
- Publication Analytics PRD.
- JEV integration and structured-output validation.

## 8. Open Questions

- What minimum evidence volume is required before generating an insight?
- Which evidence periods and historical comparison windows should the creator be able to select?
- How should conflicting, sparse, or low-confidence evidence be presented?
- How are prompt/provider versions and regeneration history exposed to the creator?
