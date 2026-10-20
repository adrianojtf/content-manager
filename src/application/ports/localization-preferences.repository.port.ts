export interface TenantLocalizationPreferences {
  readonly defaultLocale: string | null;
  readonly timezone: string | null;
  readonly currency: string;
}

export interface UserLocalizationPreferences {
  readonly locale: string | null;
  readonly timezone: string | null;
}

export interface TenantLocalizationPreferencesRepository {
  findByTenantId(tenantId: string): Promise<TenantLocalizationPreferences | null>;
  saveForTenant(tenantId: string, preferences: TenantLocalizationPreferences): Promise<boolean>;
}

export interface UserLocalizationPreferencesRepository {
  findByUserId(tenantId: string, userId: string): Promise<UserLocalizationPreferences | null>;
  saveForUser(tenantId: string, userId: string, preferences: UserLocalizationPreferences): Promise<boolean>;
}
