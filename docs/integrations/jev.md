# JEV Integration

## 1. Role

JEV is the initial provider for comment evaluation, response evaluation and audience/content intelligence. It does not generate response text or make social API calls; response text uses a separate provider capability.

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

All numeric comment scores (`spamScore`, `toxicityScore`, `engagementValue`, and `confidence`) are normalized to `[0,1]`. The application persists this JEV artifact immutably. Creator corrections to classification labels or the first three scores are separate audit records; they never change JEV confidence, rationale, or original output.

### Response Evaluation

Input:

- original comment text;
- exact saved final response revision;
- effective persisted CommentAnalysis (including append-only creator corrections).

Content context and creator communication policy are not sent in the current pilot adapter because their contracts are not yet defined; no second comment-classification call is made.

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

The evaluation is optional and manually requested. Its recommendation and risk/confidence scores are advisory only: none can trigger or block the creator's separate per-comment manual send.

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

## 5. Initial HTTP Adapter Contract

The repository does not contain JEV endpoint/authentication details. The comment adapter accepts `JEV_COMMENT_EVALUATION_URL` as a complete HTTPS (or localhost test) endpoint. The separate response adapter accepts `JEV_RESPONSE_EVALUATION_URL`; it sends the comment, effective persisted `CommentAnalysis`, and exact saved response text, and expects the structured Response Evaluation fields above. Neither adapter guesses a provider host/path. Both attach provenance, validate normalized output, and are separated by application ports so provider wire contracts do not enter use cases.

`JEV_API_KEY` is optional and shared by these adapters. If provided, it is sent only in a configurable header (`JEV_API_KEY_HEADER`, default `Authorization`; `JEV_API_KEY_PREFIX`, default `Bearer`). Endpoint and credentials are read lazily when an evaluation executes, not at application startup. Live integration remains unverified until the operator supplies each actual URL and confirms the request/auth/schema contract.

## 6. Validation

The application validates:

- schema;
- required fields;
- confidence range;
- allowed classifications;
- response risk;
- recommendation structure.

Invalid output must not mutate domain state.
