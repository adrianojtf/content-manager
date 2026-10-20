import type {
  TenantLocalizationPreferences,
  TenantLocalizationPreferencesRepository,
} from '../../application/ports/localization-preferences.repository.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';

interface TenantPreferencesRow extends Record<string, unknown> {
  default_locale: string | null;
  timezone: string | null;
  currency: string;
}

export class PostgresTenantLocalizationPreferencesRepository implements TenantLocalizationPreferencesRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async findByTenantId(tenantId: string): Promise<TenantLocalizationPreferences | null> {
    const { rows } = await this.database.query<TenantPreferencesRow>(
      'SELECT default_locale, timezone, currency FROM tenants WHERE id = $1',
      [tenantId],
    );
    const row = rows[0];

    return row ? {
      defaultLocale: row.default_locale,
      timezone: row.timezone,
      currency: row.currency,
    } : null;
  }

  async saveForTenant(tenantId: string, preferences: TenantLocalizationPreferences): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `UPDATE tenants
       SET default_locale = $2, timezone = $3, currency = $4
       WHERE id = $1
       RETURNING id`,
      [tenantId, preferences.defaultLocale, preferences.timezone, preferences.currency],
    );
    return rows.length === 1;
  }
}
