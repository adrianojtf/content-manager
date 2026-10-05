# Generate Response Suggestion

## Goal

Generate a suggested response to an audience comment.

## Input

- original comment;
- CommentAnalysis;
- content context;
- creator communication policy.

## Output

- suggested response;
- intended tone;
- confidence.

## Rules

- Do not promise facts not present in context.
- Do not answer toxic/spam content automatically.
- Preserve the original comment and generated response.

## Acceptance Criteria

- [ ] Response is associated with the comment.
- [ ] Response is marked as a suggestion.
- [ ] Response can be manually edited.
