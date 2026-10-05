# Publish Content

## Goal

Publish Content independently to one or more social platforms.

## Flow

1. Validate content.
2. Validate connected account.
3. Validate platform capability.
4. Create Publication.
5. Dispatch publication job.
6. Execute platform adapter.
7. Persist result.

## Acceptance Criteria

- [ ] Publications are independent.
- [ ] One platform failure does not rollback another.
- [ ] Publication is idempotent.
- [ ] Retry is supported.
