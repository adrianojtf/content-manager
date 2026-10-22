# Generate Content Recommendation

## Goal

Transform audience insights and performance context into actionable recommendations for future content.

Every explicit generation request produces separate Portuguese (`pt-BR`), English (`en-US`), and Spanish (`es-ES`) recommendation variants from the same evidence. Each variant is independently validated and auditable; partial failures preserve successful variants.

## Example

```text
Observation:
27% of comments mention João.

Recommendation:
Increase João's participation in the next episode.

Rationale:
The character generates disproportionate audience engagement.
```

## Rules

- Recommendation must include evidence.
- Recommendation must include confidence.
- Recommendation is advisory unless explicitly approved.

## Acceptance Criteria

- [ ] Recommendation is persisted.
- [ ] Evidence is persisted.
- [ ] Confidence is persisted.
- [ ] Creator can accept/reject the recommendation.
- [ ] Recommendation text, rationale, and confidence are available as independently generated `pt-BR`, `en-US`, and `es-ES` variants with shared evidence provenance.
- [ ] A failed language variant does not discard successful variants and is recorded with its language and stable error code.
