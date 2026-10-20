import type {
  ResponseGenerationProvider,
  ResponseGenerationSettings,
  ResponseGenerationSettingsRepository,
} from '../../application/ports/response-generation-settings.repository.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';

interface SettingsRow extends Record<string, unknown> {
  provider: ResponseGenerationProvider;
  model: string;
  updated_at: Date | string | null;
  updated_by_admin_user_id: string | null;
}

export class PostgresResponseGenerationSettingsRepository implements ResponseGenerationSettingsRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async get(): Promise<ResponseGenerationSettings | null> {
    const { rows } = await this.database.query<SettingsRow>(
      `SELECT provider, model, updated_at, updated_by_admin_user_id
       FROM ai_response_generation_settings WHERE id = 1`,
    );
    return rows[0] ? this.restore(rows[0]) : null;
  }

  async save(provider: ResponseGenerationProvider, model: string, updatedByAdminUserId: string | null = null): Promise<ResponseGenerationSettings> {
    const { rows } = await this.database.query<SettingsRow>(
      `UPDATE ai_response_generation_settings
       SET provider = $1, model = $2, updated_at = NOW(), updated_by_admin_user_id = $3
       WHERE id = 1
       RETURNING provider, model, updated_at, updated_by_admin_user_id`,
      [provider, model, updatedByAdminUserId],
    );
    if (!rows[0]) {
      throw new Error('RESPONSE_GENERATION_SETTINGS_NOT_CONFIGURED');
    }
    return this.restore(rows[0]);
  }

  private restore(row: SettingsRow): ResponseGenerationSettings {
    return {
      provider: row.provider,
      model: row.model,
      updatedAt: row.updated_at === null ? null : (row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)).toISOString(),
      updatedByAdminUserId: row.updated_by_admin_user_id,
    };
  }
}
