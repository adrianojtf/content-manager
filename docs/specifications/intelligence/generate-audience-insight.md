# Generate Audience Insight

## Goal

Aggregate analyzed comments and performance data to identify meaningful audience patterns.

Every explicit generation request produces separate Portuguese (`pt-BR`), English (`en-US`), and Spanish (`es-ES`) insight variants from the same prepared evidence. Each variant is independently validated and audited; partial failures preserve successful variants.

## Input

- content;
- metric snapshots;
- comment analyses;
- historical comparison.

## Possible Insights

- recurring topics;
- character mentions;
- common questions;
- negative trends;
- engagement opportunities;
- audience expectations.

## Example

```text
27% of comments mention João.
Comments mentioning João receive above-average engagement.
```

## Acceptance Criteria

- [ ] Evidence period is defined.
- [ ] Insight includes supporting evidence.
- [ ] Insight distinguishes observed data from inference.
- [ ] Confidence is persisted.
- [ ] The insight has independently generated and validated text variants in `pt-BR`, `en-US`, and `es-ES`, each linked to the same evidence period and source context.
- [ ] A failed language variant does not discard successful variants and is recorded with its language and stable error code.
