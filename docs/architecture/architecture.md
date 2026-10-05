# Architecture

## 1. Architectural Style

Hexagonal Architecture with a Modular Monolith deployment model.

## 2. High-Level Architecture

```mermaid
flowchart TB
    UI[Next.js]
    API[NestJS API]

    APP[Application / Use Cases]
    DOMAIN[Domain]

    PORTS[Ports]

    DB[(PostgreSQL)]
    MQ[RabbitMQ]
    CACHE[(Redis)]
    STORAGE[Object Storage]

    SOCIAL[Social Adapters]
    JEV[JEV Adapter]

    UI --> API
    API --> APP
    APP --> DOMAIN
    APP --> PORTS

    PORTS --> DB
    PORTS --> MQ
    PORTS --> CACHE
    PORTS --> STORAGE
    PORTS --> SOCIAL
    PORTS --> JEV
```

## 3. Dependency Rule

The domain must not depend on:

- NestJS;
- ORM;
- PostgreSQL;
- RabbitMQ;
- Redis;
- object storage;
- social SDKs;
- JEV SDK.

## 4. Suggested Structure

```text
src/
├── domain/
│   ├── content/
│   ├── publication/
│   ├── social-account/
│   ├── metrics/
│   ├── comment/
│   ├── response/
│   └── intelligence/
│       ├── analysis/
│       ├── audience-insight/
│       └── recommendation/
│
├── application/
│   ├── content/
│   ├── publication/
│   ├── analytics/
│   ├── comments/
│   ├── responses/
│   └── intelligence/
│
├── infrastructure/
│   ├── persistence/
│   ├── messaging/
│   ├── storage/
│   ├── social/
│   └── intelligence/
│       └── jev/
│
└── presentation/
    └── http/
```

## 5. Intelligence Ports

The application should expose capability-oriented ports.

```typescript
interface CommentEvaluator {
  evaluate(input: CommentEvaluationInput): Promise<CommentAnalysis>;
}

interface ResponseEvaluator {
  evaluate(input: ResponseEvaluationInput): Promise<ResponseEvaluation>;
}

interface AudienceInsightGenerator {
  generate(input: AudienceInsightInput): Promise<AudienceInsightResult>;
}

interface ContentRecommendationGenerator {
  generate(input: ContentRecommendationInput): Promise<ContentRecommendationResult>;
}
```

JEV can implement these capabilities behind adapters.

## 6. Social Ports

```typescript
interface VideoPublisher {
  publish(request: PublishRequest): Promise<PublicationResult>;
}

interface MetricsReader {
  getMetrics(id: string): Promise<VideoMetrics>;
}

interface CommentReader {
  getComments(id: string): Promise<CommentPage>;
}

interface CommentResponder {
  reply(id: string, message: string): Promise<CommentReply>;
}
```

## 7. Async Processing

Use RabbitMQ for:

- publication;
- metric synchronization;
- comment synchronization;
- comment evaluation;
- response evaluation;
- aggregate intelligence.

## 8. Core Flow

```text
Social API
    ↓
Comment Ingestion
    ↓
Normalized Comment
    ↓
CommentEvaluator
    ↓
JEV Adapter
    ↓
CommentAnalysis
    ↓
Response / Insight / Decision
```
