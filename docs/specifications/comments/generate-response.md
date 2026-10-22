# Generate Response Suggestion

## Goal

Generate a suggested response to an audience comment through the separately configured Gemini or OpenAI text provider. TypeSafe Jev does not generate reply text; its structured comment-analysis signals provide advisory context for the text provider.

## Input

- original comment;
- platform identifier;
- effective persisted `CommentAnalysis`, including TypeSafe per-question probabilities, confidences, and risk/engagement signals when available;
- no usage counters or provider credentials; human-corrected top-level analysis values are authoritative while TypeSafe evidence retains the original model distribution;
- effective response tone profile resolved in the order account → tenant-global → Friendly default (primary tone, up to two modifiers, optional note), with an optional `toneOverride` containing only an allowlisted primary-tone value for an individual comment. The application loads the effective profile — the complete account profile when the account has one (a full replacement, never merged with the global profile), otherwise the tenant-global profile, otherwise the Friendly default — and merges only the override primary tone; clients cannot override the effective modifiers/note or update settings through generation;
- no caller-supplied response language; every explicit generation request produces one independent variant each in `pt-BR`, `en-US`, and `es-ES`, independent of UI locale.

Publication content metadata and a configurable creator communication policy are not part of the current text-provider request. `engagementValue` is an estimated discussion potential from comment text, not observed likes/replies; risk and missing-fact probabilities are guidance, not automatic generation/send gates.

## Output

- three immutable AI-generated response variants, one per supported language;
- intended tone and language on each variant;
- immutable snapshot of the exact effective tone profile or one-time override used for this generation, including the scope that supplied it (`ACCOUNT`, `TENANT`, or `DEFAULT`);
- confidence and rationale when supported by the generator;
- generator/provider, model, source comment/analysis revision, and generation timestamp.

JEV is not the response-text generator. A generation request calls the selected text provider once per supported language (three provider calls total) and appends a separate immutable suggestion artifact for each successful variant. Provider quota and billing therefore apply to each language call. Failures are recorded per language; successful variants remain available when another language fails. Batch generation preserves these per-comment, per-language outcomes.

## Rules

- Do not promise facts not present in context.
- Use TypeSafe labels and probabilities as advisory evidence alongside the original comment. Do not treat a probability as certainty or the engagement estimate as a platform metric.
- If the signals indicate that a useful reply needs facts absent from the supplied context, avoid inventing those facts; use a cautious acknowledgement or ask a clarifying question.
- Toxic/spam signals never trigger generation or sending. In the controlled Phase 1 pilot, an explicit creator request may still generate a suggestion after comment analysis; there is no automatic action or numeric risk threshold.
- Preserve the original comment and generated response.
- Creator edits append a revision linked to the generated artifact; never overwrite AI text.
- Regeneration creates a new immutable AI artifact, leaving prior AI/manual revisions auditable.
- Tone profile changes at either scope affect only future AI generation; they do not rewrite existing suggestions or creator-authored text.
- A saved account tone profile is a complete replacement of the tenant-global profile for that account only; modifiers and the note are never merged between scopes, and the global profile remains unchanged for other accounts.
- A one-time per-comment tone override is the highest-priority layer: it changes only the primary tone for that generation request, preserves the effective profile's modifiers/note, does not mutate saved settings, and is retained in each language variant's audit snapshot.
- Treat tone settings as style preferences only; they cannot override factuality, respectful communication, platform capability, or explicit manual-send rules.
- An edited revision must be evaluated separately before manual send.

## Acceptance Criteria

- [x] Each explicit generation request produces separately auditable `pt-BR`, `en-US`, and `es-ES` variants with comment association, source context, provider/model, language, confidence/rationale, timestamp, and exact tone profile snapshot.
- [x] A failure in one language does not discard successful variants in the same request; each failed language has its own stable failure event.
- [x] The creator can switch between variants, edit/save one variant independently, and explicitly send only the currently selected saved version.
- [ ] A tenant-global tone profile is configured through `GET/PUT /social/settings/response-tone` and applies to every account without its own profile; an unset global profile falls back to Friendly.
- [ ] Tone profile is configured per connected social account through `GET/PUT /social/accounts/{accountId}/response-tone`; the account `GET` returns the effective profile plus its source (`ACCOUNT`, `TENANT`, or `DEFAULT`), and a saved account profile fully replaces the global profile for that account only.
- [ ] Tone profile supports one primary tone, up to two distinct modifiers, and an optional note of at most 500 characters; invalid presets/duplicates/overflow are rejected at both scopes.
- [ ] A valid one-time primary-tone override is applied only to the requested comment, inherits the effective profile's modifiers/note, is snapshotted in each successful/failed language event together with its source, and does not mutate the saved account or global profile.
- [ ] Tone configuration affects new AI generations only; manual text and prior suggestions remain unchanged.
- [ ] AI-generated text is immutable and clearly marked as a suggestion, not a sent response.
- [ ] Each manual edit appends a revision with exact text, actor source, and timestamp; AI output remains visible.
- [ ] Batch generation preserves separate artifacts and statuses per comment.
- [ ] Only the exact revision that was evaluated can be selected for a manual send attempt.
