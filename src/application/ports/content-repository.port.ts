import type { Content } from '../../domain/content/content';
import type { ContentId } from '../../domain/content/content-id';

export interface ContentRepository {
  save(tenantId: string, content: Content): Promise<void>;
  findById(tenantId: string, id: ContentId): Promise<Content | null>;
}
