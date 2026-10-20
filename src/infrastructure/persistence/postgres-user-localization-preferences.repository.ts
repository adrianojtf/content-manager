import type {
  UserLocalizationPreferences,
  UserLocalizationPreferencesRepository,
} from '../../application/ports/localization-preferences.repository.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';

interface UserPreferencesRow extends Record<string, unknown> {
  locale: string | null;
  timezone: string | null;
}

export class PostgresUserLocalizationPreferencesRepository implements UserLocalizationPreferencesRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async findByUserId(tenantId: string, userId: string): Promise<UserLocalizationPreferences | null> {
    const { rows } = await this.database.query<UserPreferencesRow>(
      `SELECT users.locale, users.timezone
       FROM users
       INNER JOIN tenant_memberships ON tenant_memberships.user_id = users.id
       WHERE tenant_memberships.tenant_id = $1 AND users.id = $2`,
      [tenantId, userId],
    );
    const row = rows[0];

    return row ? { locale: row.locale, timezone: row.timezone } : null;
  }

  async saveForUser(tenantId: string, userId: string, preferences: UserLocalizationPreferences): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `UPDATE users
       SET locale = $3, timezone = $4
       WHERE id = $2
         AND id IN (SELECT user_id FROM tenant_memberships WHERE tenant_id = $1)
       RETURNING id`,
      [tenantId, userId, preferences.locale, preferences.timezone],
    );
    return rows.length === 1;
  }
}
