# Gemini Response Generation

## Role

Gemini is the separate response-text generation provider. JEV remains responsible for comment and response evaluation; Gemini cannot evaluate/publish on its own or call social APIs.

## Initial Model and API

- Default model: `gemini-3.5-flash-lite`, the current stable Flash-Lite model selected for low-cost/high-throughput text generation.
- API: Gemini Developer API `generateContent`, using structured JSON output and the application-owned response-suggestion schema.
- The selected model is read from the persisted provider/model setting; Gemini's initial catalog entry is `gemini-3.5-flash-lite`. `GEMINI_API_KEY` is read only when generation is requested.
- Send the API key only in Google's `x-goog-api-key` request header. Never put it in URLs, logs, audit payloads, or provider-facing error messages.
- Each response request targets one comment and one explicit response language. Batch workflows, when implemented, fan out as independent per-comment generation calls/artifacts.

## Data and Free-Tier Notice

Google's current pricing documentation states that the Gemini API free tier has no input/output token charge for eligible models, and that free-tier content may be used to improve Google products. The paid tier states that submitted content is not used for product improvement. Pricing, eligibility, and quota limits can change; verify them in the project's Google AI Studio account before connecting a real creator account. Because comment and generated-response text can contain user data, the local pilot must not invoke Gemini until the operator has configured a key and accepted the applicable data-use terms.

The application sends only the selected comment, bounded JEV analysis/source context, and requested response language. Do not log prompt bodies or returned text outside the 30-day audit record already associated with the comment.

## Structured Result

The provider returns JSON containing:

- response `text`;
- requested `language`;
- intended `tone`;
- normalized `confidence` in `[0,1]`;
- `rationale`.

The adapter parses and validates all fields before returning a `ResponseSuggestion`. The application then persists the immutable AI artifact. Creator edits are separate append-only revisions. A provider result is only a suggestion and cannot send a reply.

## Configuration and Failure Handling

- Missing API key: return a stable configuration-required error only when a generation request is made; application startup remains independent of Gemini configuration.
- Network, quota/rate limit, service, safety-block, and malformed structured output failures map to stable provider errors; raw provider response bodies are not exposed.
- Use deterministic fetch doubles in tests; do not call Google's production API from unit/integration/E2E suites.

## Official References

- [Gemini 3.5 Flash-Lite model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Generate structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Generate content API](https://ai.google.dev/api/generate-content)
