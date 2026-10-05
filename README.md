# Social Video Hub — SDD Starter v2

Private MVP for centralized video publishing, analytics, comments and AI-assisted audience intelligence.

## Core Concept

JEV is not the application's generic AI layer.

JEV is the initial **evaluation and reasoning provider** for:

- comment classification;
- audience reaction analysis;
- response evaluation;
- recurring topic detection;
- audience insights;
- content recommendations.

The application remains responsible for deterministic business rules, permissions, platform capabilities and external side effects.

## Architecture

- Next.js
- NestJS
- TypeScript
- PostgreSQL
- RabbitMQ
- Redis
- S3-compatible object storage
- Hexagonal Architecture
- Modular Monolith
- JEV through an `IntelligenceProvider` port

## Product Loop

```text
Publish
   ↓
Collect Metrics + Comments
   ↓
Evaluate with JEV
   ↓
Classify Audience
   ↓
Generate / Suggest Response
   ↓
Evaluate Response with JEV
   ↓
Approve / Reject / Review
   ↓
Publish Response
   ↓
Aggregate Audience Insights
   ↓
Recommend Future Content Actions
```

## Initial Development Slice

1. Create Content
2. Connect YouTube
3. Publish Content
4. Synchronize Metrics
5. Synchronize Comments
6. Analyze Comments with JEV
7. Generate Response Suggestion
8. Evaluate Response with JEV
9. Generate Audience Insights
10. Generate Content Recommendations
