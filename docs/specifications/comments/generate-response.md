# Generate Response Suggestion

## Goal

Generate a suggested response to an audience comment through the separate Gemini API provider. The initial model is `gemini-3.5-flash-lite` (configurable with `GEMINI_MODEL`). JEV remains evaluation-only.

## Input

- original comment;
- CommentAnalysis;
- content context;
- creator communication policy;
- per-account response tone profile (primary tone, up to two modifiers, optional note; Friendly default);
- explicit requested response language (independent of UI locale).

## Output

- immutable AI-generated response text;
- intended tone and response language;
- immutable snapshot of the requested account tone profile used for this generation;
- confidence and rationale when supported by the generator;
- generator/provider, model, source comment/analysis revision, and generation timestamp.

JEV is not the response-text generator. Batch generation creates an independent suggestion artifact for each comment and returns per-comment success/failure.

## Rules

- Do not promise facts not present in context.
- Toxic/spam signals never trigger generation or sending. In the controlled Phase 1 pilot, an explicit creator request may still generate a suggestion after comment analysis; there is no automatic action or numeric risk threshold.
- Preserve the original comment and generated response.
- Creator edits append a revision linked to the generated artifact; never overwrite AI text.
- Regeneration creates a new immutable AI artifact, leaving prior AI/manual revisions auditable.
- Tone profile changes affect only future AI generation; they do not rewrite existing suggestions or creator-authored text.
- Treat tone settings as style preferences only; they cannot override factuality, respectful communication, platform capability, or explicit manual-send rules.
- An edited revision must be evaluated separately before manual send.

## Acceptance Criteria

- [ ] Generated suggestion stores comment association, source context, provider/model, language, confidence/rationale, timestamp, and exact tone profile snapshot.
- [ ] Tone profile is configured per connected social account through `GET/PUT /social/accounts/{accountId}/response-tone`; an unset profile defaults to Friendly.
- [ ] Tone profile supports one primary tone, up to two distinct modifiers, and an optional note of at most 500 characters; invalid presets/duplicates/overflow are rejected.
- [ ] Tone configuration affects new AI generations only; manual text and prior suggestions remain unchanged.
- [ ] AI-generated text is immutable and clearly marked as a suggestion, not a sent response.
- [ ] Each manual edit appends a revision with exact text, actor source, and timestamp; AI output remains visible.
- [ ] Batch generation preserves separate artifacts and statuses per comment.
- [ ] Only the exact revision that was evaluated can be selected for a manual send attempt.
