import type { ContentRepository } from '../../application/ports/content-repository.port';
import { Content } from '../../domain/content/content';
import { ContentInvariantError } from '../../domain/content/content-invariant-error';
import { parseContentId, type ContentId } from '../../domain/content/content-id';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';

interface ContentRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  media_key: string;
  status: string;
}

export class PostgresContentRepository implements ContentRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async save(tenantId: string, content: Content): Promise<void> {
    if (content.tenantId !== tenantId) {
      throw new ContentInvariantError('CONTENT_TENANT_MISMATCH');
    }
    if (await this.updateForTenant(tenantId, content)) {
      return;
    }

    try {
      await this.database.query(
        `INSERT INTO contents (id, tenant_id, title, description, media_key, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [content.id, tenantId, content.title, content.description, content.mediaReference, content.status],
      );
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
      if (await this.updateForTenant(tenantId, content)) {
        return;
      }
      throw new ContentInvariantError('CONTENT_TENANT_MISMATCH');
    }
  }

  private async updateForTenant(tenantId: string, content: Content): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `UPDATE contents
       SET title = $3, description = $4, media_key = $5, status = $6
       WHERE tenant_id = $1 AND id = $2
       RETURNING id`,
      [tenantId, content.id, content.title, content.description, content.mediaReference, content.status],
    );
    return rows.length === 1;
  }

  async findById(tenantId: string, id: ContentId): Promise<Content | null> {
    const { rows } = await this.database.query<ContentRow>(
      'SELECT id, tenant_id, title, description, media_key, status FROM contents WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    const row = rows[0];

    return row ? Content.restore({
      id: parseContentId(row.id),
      tenantId: row.tenant_id,
      title: row.title,
      description: row.description,
      mediaReference: row.media_key,
      status: row.status,
    }) : null;
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
