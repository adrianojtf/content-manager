# ADR-003 — JEV as Evaluation and Intelligence Provider

## Status

Accepted

## Context

The product differentiator is not merely publishing content. It is understanding audience interactions and using that understanding to support creator decisions.

## Decision

Use JEV primarily as an evaluator/reasoning provider for comments, responses and audience/content intelligence.

## JEV Responsibilities

- evaluate comments;
- classify sentiment, emotion, intent and topics;
- evaluate generated responses;
- identify patterns;
- produce audience insights;
- produce content recommendations.

## JEV Non-Responsibilities

- persistence;
- authorization;
- social API access;
- domain state mutation;
- deterministic business rules;
- final publication decisions.

## Consequence

JEV becomes a replaceable intelligence adapter rather than a central dependency of the domain.
