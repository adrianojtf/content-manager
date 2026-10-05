# ADR-001 — Hexagonal Architecture

## Status

Accepted

## Context

The system depends on multiple social APIs and an AI evaluation provider.

## Decision

Use Hexagonal Architecture from the beginning.

## Consequences

External providers can change without forcing domain changes. Testing boundaries become explicit. New social platforms can be introduced through adapters.
