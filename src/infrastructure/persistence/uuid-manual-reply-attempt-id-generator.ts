import { randomUUID } from 'node:crypto';
import type { ManualReplyAttemptIdGenerator } from '../../application/ports/manual-reply-attempt-id-generator.port';

export class UuidManualReplyAttemptIdGenerator implements ManualReplyAttemptIdGenerator {
  generate(): string {
    return randomUUID();
  }
}
