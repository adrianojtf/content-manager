import type { SocialAccountRepository } from '../ports/social-account-repository.port';
import type { PilotTenantContext } from '../ports/pilot-tenant-context.port';
import type {
  ResponseToneModifier,
  ResponseToneProfile,
  ResponseTonePrimary,
  ResponseToneSettingsRepository,
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

export function isValidResponseToneProfile(value: unknown): value is ResponseToneProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const profile = value as Partial<ResponseToneProfile>;
  return Object.keys(value).length === 3
    && Object.keys(value).every((key) => key === 'primaryTone' || key === 'modifiers' || key === 'customNote')
    && typeof profile.primaryTone === 'string'
    && primaryTones.includes(profile.primaryTone as ResponseTonePrimary)
    && Array.isArray(profile.modifiers)
    && profile.modifiers.length <= 2
    && profile.modifiers.every((modifier) => typeof modifier === 'string' && toneModifiers.includes(modifier as ResponseToneModifier))
    && new Set(profile.modifiers).size === profile.modifiers.length
    && (profile.customNote === null || (typeof profile.customNote === 'string' && profile.customNote.length <= 500));
}

export interface ResponseToneSettingsView {
  readonly profile: ResponseToneProfile;
  readonly updatedAt: string | null;
  readonly customized: boolean;
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
    private readonly tenant: PilotTenantContext,
  ) {}

  async execute(input: AccountResponseToneSettingsInput): Promise<ResponseToneSettingsView> {
    const tenantId = await this.tenant.resolveTenantId();
    const accountId = parseSocialAccountId(input.accountId);
    if (!await this.accounts.findById(tenantId, accountId)) throw new SocialProviderError('SOCIAL_ACCOUNT_NOT_FOUND');
    const stored = await this.settings.get(tenantId, accountId);
    return stored
      ? { profile: { primaryTone: stored.primaryTone, modifiers: stored.modifiers, customNote: stored.customNote }, updatedAt: stored.updatedAt, customized: true }
      : { profile: defaultResponseToneProfile, updatedAt: null, customized: false };
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
    const profile = this.normalizeProfile(input.profile);
    const stored = await this.settings.save(tenantId, accountId, profile);
    return {
      profile: { primaryTone: stored.primaryTone, modifiers: stored.modifiers, customNote: stored.customNote },
      updatedAt: stored.updatedAt,
      customized: true,
    };
  }

  private normalizeProfile(value: ResponseToneProfileInput): ResponseToneProfile {
    if (!isValidResponseToneProfile(value)) throw new ResponseToneSettingsError('RESPONSE_TONE_SETTINGS_INVALID');
    return {
      primaryTone: value.primaryTone,
      modifiers: [...value.modifiers],
      customNote: value.customNote?.trim() || null,
    };
  }
}
