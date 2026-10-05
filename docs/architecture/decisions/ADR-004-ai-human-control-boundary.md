# ADR-004 — AI Human-Control Boundary

## Status

Accepted

## Decision

AI output is advisory by default.

Automatic execution requires:

1. valid platform capability;
2. valid application policy;
3. sufficient confidence;
4. acceptable risk;
5. explicit creator configuration.

Otherwise the result enters manual review.

## Consequence

The system can progressively automate without allowing an AI provider to bypass application rules.
