import type { ResponseToneModifier, ResponseTonePrimary, ResponseToneProfile, StoredResponseToneProfile, TenantResponseToneSettingsRepository } from '../../application/ports/response-tone-settings.repository.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';

interface TenantResponseToneSettingsRow extends Record<string, unknown> {
  primary_tone: string;
  modifiers_json: string;
  custom_note: string | null;
  updated_at: Date | string;
}

const primaryTones = new Set<ResponseTonePrimary>(['FRIENDLY', 'PROFESSIONAL', 'CASUAL', 'EMPATHETIC']);
const modifiers = new Set<ResponseToneModifier>(['CONCISE', 'WARM', 'ENTHUSIASTIC']);

export class PostgresTenantResponseToneSettingsRepository implements TenantResponseToneSettingsRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async get(tenantId: string): Promise<StoredResponseToneProfile | null> {
    const { rows } = await this.database.query<TenantResponseToneSettingsRow>(
      `SELECT primary_tone, modifiers_json, custom_note, updated_at
       FROM tenant_response_tone_settings WHERE tenant_id = $1`,
      [tenantId],
    );
    return rows[0] ? this.restore(rows[0]) : null;
  }

  async save(tenantId: string, profile: ResponseToneProfile): Promise<StoredResponseToneProfile> {
    const { rows } = await this.database.query<TenantResponseToneSettingsRow>(
      `INSERT INTO tenant_response_tone_settings (tenant_id, primary_tone, modifiers_json, custom_note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id) DO UPDATE
       SET primary_tone = EXCLUDED.primary_tone, modifiers_json = EXCLUDED.modifiers_json,
           custom_note = EXCLUDED.custom_note, updated_at = NOW()
       RETURNING primary_tone, modifiers_json, custom_note, updated_at`,
      [tenantId, profile.primaryTone, JSON.stringify(profile.modifiers), profile.customNote],
    );
    if (!rows[0]) throw new Error('RESPONSE_TONE_SETTINGS_WRITE_FAILED');
    return this.restore(rows[0]);
  }

  private restore(row: TenantResponseToneSettingsRow): StoredResponseToneProfile {
    let parsedModifiers: unknown;
    try {
      parsedModifiers = JSON.parse(row.modifiers_json);
    } catch {
      throw new Error('RESPONSE_TONE_SETTINGS_DATA_INVALID');
    }
    if (!primaryTones.has(row.primary_tone as ResponseTonePrimary) || !Array.isArray(parsedModifiers)
      || parsedModifiers.length > 2
      || parsedModifiers.some((modifier) => typeof modifier !== 'string' || !modifiers.has(modifier as ResponseToneModifier))
      || new Set(parsedModifiers).size !== parsedModifiers.length
      || (row.custom_note !== null && (typeof row.custom_note !== 'string' || row.custom_note.length > 500))) {
      throw new Error('RESPONSE_TONE_SETTINGS_DATA_INVALID');
    }
    return {
      primaryTone: row.primary_tone as ResponseTonePrimary,
      modifiers: parsedModifiers as ResponseToneModifier[],
      customNote: row.custom_note,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
