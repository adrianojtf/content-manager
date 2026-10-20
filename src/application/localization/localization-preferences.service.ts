import type { AuthenticatedPrincipal } from '../identity/authenticated-principal';
import type { LocalizationPort } from '../ports/localization.port';
import type {
  TenantLocalizationPreferences,
  TenantLocalizationPreferencesRepository,
  UserLocalizationPreferences,
  UserLocalizationPreferencesRepository,
} from '../ports/localization-preferences.repository.port';
import { canonicalSupportedLocale, isValidTimezone } from './locale-resolution';

export type LocalizationPreferenceErrorCode =
  | 'LOCALE_UNSUPPORTED'
  | 'TIMEZONE_INVALID'
  | 'CURRENCY_REQUIRED'
  | 'CURRENCY_INVALID'
  | 'TENANT_CONTEXT_REQUIRED'
  | 'TENANT_OWNER_REQUIRED'
  | 'TENANT_NOT_FOUND'
  | 'USER_NOT_IN_TENANT';

export class LocalizationPreferenceError extends Error {
  constructor(readonly code: LocalizationPreferenceErrorCode) {
    super(code);
    this.name = 'LocalizationPreferenceError';
  }
}

export function validateTenantLocalizationPreferences(
  preferences: TenantLocalizationPreferences,
  localization: LocalizationPort,
): TenantLocalizationPreferences {
  return {
    defaultLocale: validateLocale(preferences.defaultLocale, localization),
    timezone: validateTimezone(preferences.timezone),
    currency: validateCurrency(preferences.currency),
  };
}

export function validateUserLocalizationPreferences(
  preferences: UserLocalizationPreferences,
  localization: LocalizationPort,
): UserLocalizationPreferences {
  return {
    locale: validateLocale(preferences.locale, localization),
    timezone: validateTimezone(preferences.timezone),
  };
}

export class LocalizationPreferencesService {
  constructor(
    private readonly tenantPreferences: TenantLocalizationPreferencesRepository,
    private readonly userPreferences: UserLocalizationPreferencesRepository,
    private readonly localization: LocalizationPort,
  ) {}

  async findTenantPreferences(principal: AuthenticatedPrincipal): Promise<TenantLocalizationPreferences> {
    const tenant = this.requireTenantContext(principal);
    const preferences = await this.tenantPreferences.findByTenantId(tenant.tenantId);
    if (!preferences) {
      throw new LocalizationPreferenceError('TENANT_NOT_FOUND');
    }
    return preferences;
  }

  async updateTenantPreferences(
    principal: AuthenticatedPrincipal,
    preferences: TenantLocalizationPreferences,
  ): Promise<TenantLocalizationPreferences> {
    const tenant = this.requireTenantContext(principal);
    if (tenant.tenantRole !== 'OWNER') {
      throw new LocalizationPreferenceError('TENANT_OWNER_REQUIRED');
    }
    const validated = validateTenantLocalizationPreferences(preferences, this.localization);
    if (!await this.tenantPreferences.saveForTenant(tenant.tenantId, validated)) {
      throw new LocalizationPreferenceError('TENANT_NOT_FOUND');
    }
    return validated;
  }

  async findUserPreferences(principal: AuthenticatedPrincipal): Promise<UserLocalizationPreferences> {
    const tenant = this.requireTenantContext(principal);
    const preferences = await this.userPreferences.findByUserId(tenant.tenantId, tenant.userId);
    if (!preferences) {
      throw new LocalizationPreferenceError('USER_NOT_IN_TENANT');
    }
    return preferences;
  }

  async updateUserPreferences(
    principal: AuthenticatedPrincipal,
    preferences: UserLocalizationPreferences,
  ): Promise<UserLocalizationPreferences> {
    const tenant = this.requireTenantContext(principal);
    const validated = validateUserLocalizationPreferences(preferences, this.localization);
    if (!await this.userPreferences.saveForUser(tenant.tenantId, tenant.userId, validated)) {
      throw new LocalizationPreferenceError('USER_NOT_IN_TENANT');
    }
    return validated;
  }

  private requireTenantContext(principal: AuthenticatedPrincipal): Extract<AuthenticatedPrincipal, { kind: 'tenant-user' }> {
    if (principal.kind !== 'tenant-user') {
      throw new LocalizationPreferenceError('TENANT_CONTEXT_REQUIRED');
    }
    return principal;
  }
}

function validateLocale(value: string | null, localization: LocalizationPort): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new LocalizationPreferenceError('LOCALE_UNSUPPORTED');
  }
  const locale = canonicalSupportedLocale(value, localization.getSupportedLocales());
  if (!locale) {
    throw new LocalizationPreferenceError('LOCALE_UNSUPPORTED');
  }
  return locale;
}

function validateTimezone(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new LocalizationPreferenceError('TIMEZONE_INVALID');
  }
  const timezone = value.trim();
  if (!isValidTimezone(timezone)) {
    throw new LocalizationPreferenceError('TIMEZONE_INVALID');
  }
  return timezone;
}

function validateCurrency(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    throw new LocalizationPreferenceError('CURRENCY_REQUIRED');
  }
  if (typeof value !== 'string') {
    throw new LocalizationPreferenceError('CURRENCY_INVALID');
  }
  const currency = value.trim().toUpperCase();
  if (!currency) {
    throw new LocalizationPreferenceError('CURRENCY_REQUIRED');
  }
  if (!Intl.supportedValuesOf('currency').includes(currency)) {
    throw new LocalizationPreferenceError('CURRENCY_INVALID');
  }
  return currency;
}
