# OpenAI GPT-6 Luna Response Generation

## Role

OpenAI is an optional response-text provider selected through the pilot's provider/model setting. JEV remains responsible for comment/response evaluation and is not replaced by this adapter.

## Model and API

- Initial model ID: `gpt-6-luna`.
- Endpoint: OpenAI Responses API `POST https://api.openai.com/v1/responses`.
- Use structured JSON output for `text`, `intendedTone`, `confidence`, and `rationale`.
- Set `store: false`, use `reasoning.effort: none` for the initial concise suggestion workflow, and cap output tokens.
- The model is chosen from the server allowlist; the browser/API caller cannot supply an arbitrary model on each generation request.
- API key: `OPENAI_API_KEY`, read only when generation runs, sent in the `Authorization: Bearer` header, never stored in PostgreSQL or returned to the settings API.

## Model Selection

The local pilot setting allows `google/gemini-3.5-flash-lite` or `openai/gpt-6-luna`. `GET/PUT /ai/response-generation/settings` reads/updates only the provider and model. It is a single global pilot setting with a nullable `updated_by_admin_user_id` placeholder for Phase 3; settings must remain loopback-only until an admin guard is installed.

## Billing and Data

GPT-6 Luna is billed by input/output token use and does not have the Gemini Free-tier option. The application sends one selected comment, bounded JEV analysis, and explicit response language only after an explicit generation request. Do not log prompt content, API keys, or raw provider error bodies.

## Validation and Failures

The adapter validates structured output independently of the provider's schema enforcement. Refusals, malformed output, rate limits, authentication/configuration errors, and provider outages become stable application error codes. The generated text is an advisory artifact; it cannot send a reply.

## Official References

- [GPT-6 Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Responses API structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Responses API migration/request format](https://developers.openai.com/api/docs/guides/migrate-to-responses)
