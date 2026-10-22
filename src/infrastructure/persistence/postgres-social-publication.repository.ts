import type { SocialPublicationRepository, StoredSocialPublication } from '../../application/ports/social-publication-repository.port';
import type { PlatformPublication } from '../../application/ports/social-publication-reader.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';
import { SocialProviderError } from '../../application/social/social-provider-error';
import type { SocialAccount } from '../../domain/social/social-account';
import { parseSocialAccountId, type SocialAccountId } from '../../domain/social/social-account-id';

interface SocialPublicationRow extends Record<string, unknown> {
  tenant_id: string;
  social_account_id: string;
  platform: string;
  external_publication_id: string;
  title: string | null;
  description: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  published_at: Date | string | null;
  last_synced_at: Date | string;
}

const publicationColumns = 10;

export class PostgresSocialPublicationRepository implements SocialPublicationRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async upsertPage(account: SocialAccount, publications: readonly PlatformPublication[], syncedAt: string): Promise<void> {
    if (!this.isValidDate(syncedAt)) {
      throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
    }
    const publicationIds = new Set<string>();
    for (const publication of publications) {
      if (!this.isValidPublication(account, publication) || publicationIds.has(publication.externalPublicationId)) {
        throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID');
      }
      publicationIds.add(publication.externalPublicationId);
    }
    if (!publications.length) return;

    const values: unknown[] = [];
    const tuples = publications.map((publication, index) => {
      const offset = index * publicationColumns;
      values.push(
        account.tenantId,
        account.id,
        publication.platform,
        publication.externalPublicationId,
        publication.title,
        publication.description,
        publication.permalink,
        publication.thumbnailUrl,
        publication.publishedAt,
        syncedAt,
      );
      return `(${Array.from({ length: publicationColumns }, (_, column) => `$${offset + column + 1}`).join(', ')})`;
    });

    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO social_publications (
           tenant_id, social_account_id, platform, external_publication_id,
           title, description, permalink, thumbnail_url, published_at, last_synced_at
         ) VALUES ${tuples.join(', ')}
         ON CONFLICT (tenant_id, social_account_id, external_publication_id) DO UPDATE SET
           platform = EXCLUDED.platform,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           permalink = EXCLUDED.permalink,
           thumbnail_url = EXCLUDED.thumbnail_url,
           published_at = EXCLUDED.published_at,
           last_synced_at = EXCLUDED.last_synced_at`,
        values,
      );
    });
  }

  async listByAccount(tenantId: string, socialAccountId: SocialAccountId): Promise<readonly StoredSocialPublication[]> {
    const { rows } = await this.database.query<SocialPublicationRow>(
      `SELECT tenant_id, social_account_id, platform, external_publication_id,
              title, description, permalink, thumbnail_url, published_at, last_synced_at
       FROM social_publications
       WHERE tenant_id = $1 AND social_account_id = $2
       ORDER BY published_at DESC, external_publication_id`,
      [tenantId, socialAccountId],
    );
    return rows.map((row) => this.restore(row));
  }

  private isValidPublication(account: SocialAccount, publication: PlatformPublication): boolean {
    return typeof publication === 'object' && publication !== null
      && publication.platform === account.platform
      && typeof publication.externalPublicationId === 'string'
      && Boolean(publication.externalPublicationId.trim())
      && this.isOptionalText(publication.title)
      && this.isOptionalText(publication.description)
      && this.isOptionalText(publication.permalink)
      && this.isOptionalText(publication.thumbnailUrl)
      && (publication.publishedAt === null || this.isValidDate(publication.publishedAt));
  }

  private restore(row: SocialPublicationRow): StoredSocialPublication {
    return {
      tenantId: row.tenant_id,
      socialAccountId: parseSocialAccountId(row.social_account_id),
      platform: row.platform as PlatformPublication['platform'],
      externalPublicationId: row.external_publication_id,
      title: row.title,
      description: row.description,
      permalink: row.permalink,
      thumbnailUrl: row.thumbnail_url,
      publishedAt: this.toIsoString(row.published_at),
      lastSyncedAt: this.toIsoString(row.last_synced_at) as string,
    };
  }

  private isOptionalText(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
  }

  private isValidDate(value: string): boolean {
    return Number.isFinite(Date.parse(value));
  }

  private toIsoString(value: Date | string | null): string | null {
    if (value === null) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
}
