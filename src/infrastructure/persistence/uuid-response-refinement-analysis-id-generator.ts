import { randomUUID } from 'node:crypto';
import type { ResponseRefinementAnalysisIdGenerator } from '../../application/ports/response-refinement-analysis.repository.port';

export class UuidResponseRefinementAnalysisIdGenerator implements ResponseRefinementAnalysisIdGenerator {
  generate(): string {
    return randomUUID();
  }
}
