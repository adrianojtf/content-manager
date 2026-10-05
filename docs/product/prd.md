# MVP PRD

## 1. Objective

Build a private creator platform that centralizes video publication, performance data, comments and AI-assisted audience intelligence.

## 2. MVP Capabilities

### Content

- Upload video.
- Manage metadata.
- Maintain draft/ready states.
- Store media references.

### Publishing

- Connect social accounts.
- Select target platforms.
- Configure platform-specific metadata.
- Publish.
- Schedule.
- Track independent publication status.
- Retry failed publications.

### Analytics

- Collect available metrics.
- Store historical snapshots.
- Compare publications and platforms.
- Correlate performance with audience reactions.

### Community

- Synchronize comments.
- Centralize comments.
- Classify comments.
- Suggest responses.
- Evaluate suggested responses.
- Allow manual approval.
- Publish responses where supported.

### Audience Intelligence

JEV should evaluate comments to identify:

- sentiment;
- emotion;
- intent;
- topic;
- character/theme;
- questions;
- requests;
- complaints;
- spam;
- toxicity;
- recurring patterns;
- engagement opportunities.

### Content Intelligence

Aggregate comment analysis and performance data to produce:

- audience insights;
- recurring themes;
- content opportunities;
- recommendations for future episodes/videos;
- potential issues;
- engagement opportunities.

## 3. AI Safety Boundary

The MVP must distinguish:

```text
AI Analysis
    ↓
AI Recommendation
    ↓
Deterministic Decision Rules
    ↓
External Action
```

JEV must not directly publish comments or modify social accounts.

## 4. Initial Platform Priority

1. YouTube
2. Instagram
3. Facebook Pages
4. TikTok

TikTok community/analytics capabilities remain subject to exact API access and approval.

## 5. Non-Goals

Initially exclude:

- billing;
- multi-tenancy;
- microservices;
- Kubernetes;
- advanced RBAC;
- full video editing;
- advertising management.

## 6. Success Criteria

The creator can:

1. Publish one video to multiple supported platforms.
2. Centralize performance metrics.
3. Centralize comments.
4. Analyze comments with JEV.
5. See audience patterns.
6. Generate a response suggestion.
7. Have JEV evaluate the response.
8. Approve or reject it.
9. Generate actionable content recommendations.
