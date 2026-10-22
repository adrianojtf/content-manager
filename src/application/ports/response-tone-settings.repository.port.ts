export type ResponseTonePrimary = 'FRIENDLY' | 'PROFESSIONAL' | 'CASUAL' | 'EMPATHETIC';
export type ResponseToneModifier = 'CONCISE' | 'WARM' | 'ENTHUSIASTIC';

export interface ResponseToneProfile {
  readonly primaryTone: ResponseTonePrimary;
  readonly modifiers: readonly ResponseToneModifier[];
  readonly customNote: string | null;
}

export interface StoredResponseToneProfile extends ResponseToneProfile {
  readonly updatedAt: string;
}

export interface ResponseToneSettingsRepository {
  get(tenantId: string, socialAccountId: string): Promise<StoredResponseToneProfile | null>;
  save(tenantId: string, socialAccountId: string, profile: ResponseToneProfile): Promise<StoredResponseToneProfile>;
}

export interface TenantResponseToneSettingsRepository {
  get(tenantId: string): Promise<StoredResponseToneProfile | null>;
  save(tenantId: string, profile: ResponseToneProfile): Promise<StoredResponseToneProfile>;
}
