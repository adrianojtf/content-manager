import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type {
  ResponseToneModifier,
  ResponseToneProfile,
  ResponseTonePrimary,
  ResponseToneSettingsRepository,
  StoredResponseToneProfile,
  TenantResponseToneSettingsRepository,
} from '../ports/response-tone-settings.repository.port';
import { parseSocialAccountId } from '../../domain/social/social-account-id';
import { SocialProviderError } from './social-provider-error';
import { ResponseToneSettingsError } from './response-tone-settings-error';

export const defaultResponseToneProfile: ResponseToneProfile = {
  primaryTone: 'FRIENDLY',
  modifiers: [],
  customNote: null,
};

const primaryTones: readonly ResponseTonePrimary[] = ['FRIENDLY', 'PROFESSIONAL', 'CASUAL', 'EMPATHETIC'];
const toneModifiers: readonly ResponseToneModifier[] = ['CONCISE', 'WARM', 'ENTHUSIASTIC'];

export function isValidResponseTonePrimary(value: unknown): value is ResponseTonePrimary {
  return typeof value === 'string' && primaryTones.includes(value as ResponseTonePrimary);
}

export function isValidResponseToneProfile(value: unknown): value is ResponseToneProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const profile = value as Partial<ResponseToneProfile>;
  return Object.keys(value).length === 3
    && Object.keys(value).every((key) => key === 'primaryTone' || key === 'modifiers' || key === 'customNote')
    && isValidResponseTonePrimary(profile.primaryTone)
    && Array.isArray(profile.modifiers)
    && profile.modifiers.length <= 2
    && profile.modifiers.every((modifier) => typeof modifier === 'string' && toneModifiers.includes(modifier as ResponseToneModifier))
    && new Set(profile.modifiers).size === profile.modifiers.length
    && (profile.customNote === null || (typeof profile.customNote === 'string' && profile.customNote.length <= 500));
}

export type ResponseToneProfileSource = 'ACCOUNT' | 'TENANT' | 'DEFAULT';

export interface ResolvedResponseToneProfile {
  readonly source: ResponseToneProfileSource;
  readonly profile: ResponseToneProfile;
  readonly updatedAt: string | null;
}

export function resolveResponseToneProfile(
  accountProfile: StoredResponseToneProfile | null,
  tenantProfile: StoredResponseToneProfile | null,
): ResolvedResponseToneProfile {
  const stored = accountProfile ?? tenantProfile;
  if (stored) {
    return {
      source: accountProfile ? 'ACCOUNT' : 'TENANT',
      profile: {
        primaryTone: stored.primaryTone,
        modifiers: [...stored.modifiers],
        customNote: stored.customNote,
      },
      updatedAt: stored.updatedAt,
    };
  }
  return { source: 'DEFAULT', profile: { ...defaultResponseToneProfile, modifiers: [] }, updatedAt: null };
}

export interface ResponseToneSettingsView {
  readonly profile: ResponseToneProfile;
  readonly updatedAt: string | null;
  readonly customized: boolean;
  readonly source: ResponseToneProfileSource;
}

export interface ResponseToneProfileInput {
  readonly primaryTone: string;
  readonly modifiers: readonly string[];
  readonly customNote: string | null;
}

export interface AccountResponseToneSettingsInput {
  readonly accountId: string;
}

export interface UpdateAccountResponseToneSettingsInput extends AccountResponseToneSettingsInput {
  readonly profile: ResponseToneProfileInput;
}

export class GetAccountResponseToneSettings {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly settings: ResponseToneSettingsRepository,
    private readonly tenantSettings: TenantResponseToneSettingsRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(input: AccountResponseToneSettingsInput): Promise<ResponseToneSettingsView> {
    const tenantId = await this.tenant.resolveTenantId();
    const accountId = parseSocialAccountId(input.accountId);
    if (!await this.accounts.findById(tenantId, accountId)) throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    const resolved = resolveResponseToneProfile(
      await this.settings.get(tenantId, accountId),
      await this.tenantSettings.get(tenantId),
    );
    return { ...resolved, customized: resolved.source !== 'DEFAULT' };
  }
}

export class GetTenantResponseToneSettings {
  constructor(
    private readonly tenantSettings: TenantResponseToneSettingsRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(): Promise<ResponseToneSettingsView> {
    const tenantId = await this.tenant.resolveTenantId();
    const resolved = resolveResponseToneProfile(null, await this.tenantSettings.get(tenantId));
    return { ...resolved, customized: resolved.source !== 'DEFAULT' };
  }
}

export class UpdateTenantResponseToneSettings {
  constructor(
    private readonly tenantSettings: TenantResponseToneSettingsRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(input: { readonly profile: ResponseToneProfileInput }): Promise<ResponseToneSettingsView> {
    const tenantId = await this.tenant.resolveTenantId();
    const stored = await this.tenantSettings.save(tenantId, normalizeResponseToneProfile(input.profile));
    return {
      profile: { primaryTone: stored.primaryTone, modifiers: stored.modifiers, customNote: stored.customNote },
      updatedAt: stored.updatedAt,
      customized: true,
      source: 'TENANT',
    };
  }
}

export class UpdateAccountResponseToneSettings {
  constructor(
    private readonly accounts: SocialAccountRepository,
    private readonly settings: ResponseToneSettingsRepository,
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(input: UpdateAccountResponseToneSettingsInput): Promise<ResponseToneSettingsView> {
    const tenantId = await this.tenant.resolveTenantId();
    const accountId = parseSocialAccountId(input.accountId);
    if (!await this.accounts.findById(tenantId, accountId)) throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    const stored = await this.settings.save(tenantId, accountId, normalizeResponseToneProfile(input.profile));
    return {
      profile: { primaryTone: stored.primaryTone, modifiers: stored.modifiers, customNote: stored.customNote },
      updatedAt: stored.updatedAt,
      customized: true,
      source: 'ACCOUNT',
    };
  }
}

function normalizeResponseToneProfile(value: ResponseToneProfileInput): ResponseToneProfile {
  if (!isValidResponseToneProfile(value)) throw new ResponseToneSettingsError('RESPONSE_TONE_SETTINGS_INVALID');
  return {
    primaryTone: value.primaryTone,
    modifiers: [...value.modifiers],
    customNote: value.customNote?.trim() || null,
  };
}
