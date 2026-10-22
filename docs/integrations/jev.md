# TypeSafe Jev Integration

## 1. Role

Jev is TypeSafe's System One decision model. It evaluates a supplied state against typed questions and returns structured answers. It is not a chat/text-generation model and does not call social APIs. Gemini/OpenAI remain the separate text-generation providers.

## 2. Primary Use Cases

### Comment Evaluation

State supplied by the current adapter:

```json
{
  "comment": { "text": "Original comment text" },
  "publication": {
    "platform": "youtube",
    "externalPublicationId": "external-publication-id"
  }
}
```

The `questions` map asks TypeSafe Choice questions for sentiment, emotion, intent, and topic; Noul questions for spam, toxicity, whether answering requires facts absent from the state, and explicit requests for continuation; and a five-level Score question for estimated engagement potential. Choice/Score evidence retains the selected value, probabilities, and confidence. Noul's value is the probability that the answer is yes.

The initial controlled taxonomies are:

- sentiment: `POSITIVE`, `NEUTRAL`, `NEGATIVE`;
- emotion: `JOY`, `CURIOSITY`, `FRUSTRATION`, `SADNESS`, `ANGER`, `SURPRISE`, `NEUTRAL`, `OTHER`;
- intent: `QUESTION`, `PRAISE`, `COMPLAINT`, `SUGGESTION`, `CONTENT_REQUEST`, `REACTION`, `OTHER`;
- topic: `CHARACTER`, `STORY`, `CONTENT`, `PRODUCTION`, `COMMUNITY`, `PLATFORM`, `OTHER`.

Engagement is an estimated potential derived from comment text, not an observed platform metric. TypeSafe's five ordered Score levels produce a raw range `[0,4]`; the adapter normalizes it to `[0,1]` while retaining the raw score, legend, probabilities, and confidence. An explicit request for another part/episode is an engagement signal even when the comment is short; it is separately counted through the Noul `requests_continuation` question and normalized as `continuationRequestProbability` for statistics and response context. No observed likes/replies are included in the current state.

TypeSafe does not extract arbitrary entity text or generate rationale. The current adapter sets `entity` and `rationale` to `null`. The immutable analysis event stores normalized fields, per-question evidence, returned model ID, internal schema version, token usage, and timestamp. Human corrections remain separate append-only events and do not overwrite original TypeSafe evidence.

### Response Evaluation

The state contains the original comment, effective persisted comment analysis (including append-only creator corrections), and exact saved response text. The questions are independent: Score for relevance, tone, and helpfulness; Noul for factual, toxicity, and hallucination risk; and Choice for `APPROVE`, `REVIEW`, or `REJECT`. Score results are normalized to `[0,1]`; Noul results are already probabilities in that range.

`publishRecommendation` is evaluated independently from the other answers and is advisory only. It cannot trigger or block the creator's separate per-comment manual send. TypeSafe does not return rationale text, so the stored `rationale` is `null`.

### Audience Intelligence

Future audience-intelligence workflows may send aggregated state such as:

- comment classifications;
- metric snapshots;
- content metadata;
- historical performance.

Typed Jev questions can classify or score:

- recurring topic categories;
- audience question/complaint rates;
- estimated engagement-potential distributions.

Any narrative insight or free-text content recommendation must be composed by a separate text-generation capability or by deterministic application logic; TypeSafe answers are not prose.

### Content Recommendation

The following is an application-generated example, not a TypeSafe response. TypeSafe does not return free-text recommendations; the application may derive a structured recommendation from typed answers or use a separate generator for narrative wording.

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

The application prepares and sends the complete state. Jev has no direct database or social-provider access.

JEV never directly queries:

- PostgreSQL;
- social APIs;
- RabbitMQ;
- object storage.

## 4. Adapter

```text
Application use case
    ↓
CommentEvaluator / ResponseEvaluator port
    ↓
TypeSafe System One adapter
    ↓
POST https://api.typesafe.ai/v1/systemone
```

## 5. HTTP Contract and Configuration

TypeSafe exposes one evaluation endpoint; the application does not create separate comment/response APIs or require custom URLs:

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

Each request body has `model`, `state`, and `questions`. The pilot uses `model: "jev-latest"`. Comment classification and response evaluation use the same endpoint with different states and question maps. Responses contain `model`, nested `answers`, and `usage`; each answer's fields depend on its question type. See the [TypeSafe API reference](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), and [Noul](https://docs.typesafe.ai/primitives/noul).

Preferences stores one write-only API key; reads return only a configured flag. Saved credentials are encrypted with `SOCIAL_CREDENTIAL_ENCRYPTION_KEY`. Runtime configuration prefers saved credentials, then `TYPESAFE_API_KEY`, with `JEV_API_KEY` retained as a legacy fallback. The API URL, model, auth header, and prefix are not user-configurable in the direct TypeSafe integration. Credentials are resolved lazily when an evaluation executes.

## 6. Validation and Error Handling

The application validates:

- the TypeSafe response envelope and each required question answer;
- Choice values/probabilities/confidence against the configured taxonomy;
- Score values, rubric bounds, probabilities, and confidence before normalization;
- Noul probabilities in `[0,1]`;
- non-negative usage counters when supplied;
- response recommendation membership in `APPROVE`, `REVIEW`, or `REJECT`.

Invalid output must not append a successful analysis/evaluation or replace prior artifacts. TypeSafe 401 maps to authorization failure, 429 to rate limiting, 529/5xx to provider unavailability, and invalid request/answer payloads to stable provider errors. The HTTP boundary is exercised with deterministic mocks; live TypeSafe calls are opt-in because they consume account credits.
