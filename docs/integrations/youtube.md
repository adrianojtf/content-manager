# YouTube Integration

## Priority

P0

## Capabilities

- account connection;
- video upload;
- publication;
- metrics;
- comments;
- replies.

## Phase 1 Account Connection

Local OAuth uses one-time `state` and PKCE S256, requests `youtube.readonly` by default, and adds `youtube.force-ssl` only for an explicit reply opt-in. Access/refresh tokens and granted scopes are encrypted in the tenant-scoped credential vault; expired access tokens refresh through the provider's refresh grant. The client configuration is lazy and does not block API startup. Live Google OAuth verification/test-client approval remains pending.

## AI Flow

```text
YouTube
  ↓
Comments
  ↓
Normalize
  ↓
CommentEvaluator
  ↓
JEV
  ↓
CommentAnalysis
```

## Adapter Rule

YouTube API DTOs must remain inside infrastructure.
