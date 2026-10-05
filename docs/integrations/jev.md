# JEV Integration

## 1. Role

JEV is the initial provider for comment evaluation, response evaluation and audience/content intelligence.

## 2. Primary Use Cases

### Comment Evaluation

Input:

- comment;
- content metadata;
- publication/platform;
- optional author interaction context.

Output:

```json
{
  "sentiment": "POSITIVE",
  "emotion": "SURPRISE",
  "intent": "REACTION",
  "topic": "CHARACTER",
  "entity": "JOAO",
  "spamScore": 0.01,
  "toxicityScore": 0.01,
  "engagementValue": 0.82,
  "confidence": 0.94
}
```

### Response Evaluation

Input:

- original comment;
- generated response;
- content context;
- creator communication policy.

Output:

```json
{
  "relevance": 0.97,
  "tone": 0.94,
  "helpfulness": 0.81,
  "factualRisk": 0.02,
  "toxicityRisk": 0.01,
  "hallucinationRisk": 0.01,
  "publishRecommendation": "APPROVE",
  "confidence": 0.95,
  "rationale": "Response directly addresses the viewer's question."
}
```

### Audience Intelligence

JEV receives aggregated context such as:

- comment classifications;
- metric snapshots;
- content metadata;
- historical performance.

It can identify:

- recurring topics;
- characters/themes;
- audience questions;
- complaints;
- engagement opportunities;
- content opportunities.

### Content Recommendation

Example:

```json
{
  "type": "CONTENT",
  "priority": "HIGH",
  "action": "Increase the participation of João in the next episode.",
  "evidence": [
    "27% of analyzed comments mention João",
    "Comments mentioning João have above-average engagement"
  ],
  "confidence": 0.88
}
```

## 3. Context Boundary

The application prepares context.

JEV never directly queries:

- PostgreSQL;
- social APIs;
- RabbitMQ;
- object storage.

## 4. Adapter

```text
Application
    ↓
CommentEvaluator / ResponseEvaluator / InsightGenerator
    ↓
JevAdapter
    ↓
JEV
```

## 5. Validation

The application validates:

- schema;
- required fields;
- confidence range;
- allowed classifications;
- response risk;
- recommendation structure.

Invalid output must not mutate domain state.
