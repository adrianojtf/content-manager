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
