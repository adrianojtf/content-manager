import { randomUUID } from 'node:crypto';
import type { BatchOperationIdGenerator } from '../../application/ports/batch-operation-id-generator.port';

export class UuidBatchOperationIdGenerator implements BatchOperationIdGenerator {
  generate(): string {
    return randomUUID();
  }
}
