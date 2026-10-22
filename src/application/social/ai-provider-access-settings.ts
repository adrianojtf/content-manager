import type {
  AIProviderSettings,
  AIProviderSettingsRepository,
  AIProviderSettingsUpdate,
} from '../ports/ai-provider-settings.repository.port';

export interface AIProviderAccessStatus {
  readonly storageReady: boolean;
  readonly jev: { readonly apiKeyConfigured: boolean };
  readonly textGeneration: {
    readonly google: {
      readonly credentialsConfigured: boolean;
      readonly dataUsePolicy: string | null;
      readonly dataUsePolicyConfigured: boolean;
    };
    readonly openai: { readonly credentialsConfigured: boolean };
  };
}

export class AIProviderSettingsError extends Error {
  constructor(readonly code: 'AI_PROVIDER_SETTINGS_INVALID' | 'AI_PROVIDER_SETTINGS_ENCRYPTION_KEY_REQUIRED' | 'AI_PROVIDER_SETTINGS_ENCRYPTION_KEY_INVALID') {
    super(code);
    this.name = 'AIProviderSettingsError';
  }
}

const configurableFields = new Set<keyof AIProviderSettings>([
  'jevApiKey',
  'geminiApiKey',
  'geminiDataUsePolicy',
  'openaiApiKey',
]);
const secretFields = new Set<keyof AIProviderSettings>(['jevApiKey', 'geminiApiKey', 'openaiApiKey']);

export class GetAIProviderAccessStatus {
  constructor(private readonly settings: AIProviderSettingsRepository) {}

  async execute(): Promise<AIProviderAccessStatus> {
    const current = await this.settings.get();
    const policy = current.geminiDataUsePolicy;
    return {
      storageReady: this.settings.encryptionAvailable(),
      jev: { apiKeyConfigured: isConfigured(current.jevApiKey) },
      textGeneration: {
        google: {
          credentialsConfigured: isConfigured(current.geminiApiKey),
          dataUsePolicy: policy,
          dataUsePolicyConfigured: policy === 'free-tier-acknowledged' || policy === 'paid-tier',
        },
        openai: { credentialsConfigured: isConfigured(current.openaiApiKey) },
      },
    };
  }
}

export class UpdateAIProviderAccessSettings {
  constructor(private readonly settings: AIProviderSettingsRepository) {}

  async execute(input: unknown): Promise<void> {
    const normalized = this.validate(input);
    if (Object.keys(normalized).length === 0) return;
    if (!this.settings.encryptionAvailable()) {
      throw new AIProviderSettingsError('AI_PROVIDER_SETTINGS_ENCRYPTION_KEY_REQUIRED');
    }
    await this.settings.save(normalized);
  }

  private validate(input: unknown): AIProviderSettingsUpdate {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new AIProviderSettingsError('AI_PROVIDER_SETTINGS_INVALID');
    }
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some((key) => !configurableFields.has(key as keyof AIProviderSettings))) {
      throw new AIProviderSettingsError('AI_PROVIDER_SETTINGS_INVALID');
    }

    const normalized: Partial<Record<keyof AIProviderSettings, string | null>> = {};
    for (const [key, raw] of Object.entries(value)) {
      const field = key as keyof AIProviderSettings;
      if (raw === null) {
        normalized[field] = null;
        continue;
      }
      if (typeof raw !== 'string' || raw.length > 4096) {
        throw new AIProviderSettingsError('AI_PROVIDER_SETTINGS_INVALID');
      }
      const trimmed = raw.trim();
      if (secretFields.has(field) && !trimmed) continue;
      if (secretFields.has(field) && /[\u0000-\u001f\u007f]/.test(raw)) {
        throw new AIProviderSettingsError('AI_PROVIDER_SETTINGS_INVALID');
      }
      if (field === 'geminiDataUsePolicy') {
        if (trimmed && trimmed !== 'free-tier-acknowledged' && trimmed !== 'paid-tier') {
          throw new AIProviderSettingsError('AI_PROVIDER_SETTINGS_INVALID');
        }
        normalized[field] = trimmed || null;
      } else {
        normalized[field] = trimmed;
      }
    }
    return normalized as AIProviderSettingsUpdate;
  }

}

function isConfigured(value: string | null): boolean {
  return Boolean(value?.trim());
}
