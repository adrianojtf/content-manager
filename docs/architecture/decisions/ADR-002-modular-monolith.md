# ADR-002 — Modular Monolith

## Status

Accepted

## Context

The MVP is a private multi-tenant product. It requires tenant isolation while retaining a single deployable modular monolith.

## Decision

Use a modular monolith with strict module boundaries.

## Consequence

The project avoids premature distributed-system complexity while preserving extraction paths if scale later justifies services.
