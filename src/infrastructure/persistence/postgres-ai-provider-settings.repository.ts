import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  AIProviderSettings,
  AIProviderSettingsRepository,
  AIProviderSettingsUpdate,
} from '../../application/ports/ai-provider-settings.repository.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';

export type AIProviderSettingsEnvironment = Readonly<Record<string, string | undefined>>;

interface SettingsRow extends Record<string, unknown> {
  ciphertext: string;
  nonce: string;
  auth_tag: string;
}

const settingsFields: readonly (keyof AIProviderSettings)[] = [
  'jevApiKey',
  'geminiApiKey',
  'geminiDataUsePolicy',
  'openaiApiKey',
];
const legacySettingsFields = [
  'jevCommentEvaluationUrl',
  'jevResponseEvaluationUrl',
  'jevApiKeyHeader',
  'jevApiKeyPrefix',
] as const;
const readableSettingsFields: readonly string[] = [...settingsFields, ...legacySettingsFields];

const emptySettings: AIProviderSettings = {
  jevApiKey: null,
  geminiApiKey: null,
  geminiDataUsePolicy: null,
  openaiApiKey: null,
};

export class PostgresAIProviderSettingsRepository implements AIProviderSettingsRepository {
  constructor(
    private readonly database: RelationalDatabase,
    private readonly environment: AIProviderSettingsEnvironment = process.env,
  ) {}

  async get(): Promise<AIProviderSettings> {
    const saved = await this.getSavedSettings();
    return {
      jevApiKey: saved.jevApiKey
        ?? this.environment.TYPESAFE_API_KEY?.trim()
        ?? this.environment.JEV_API_KEY?.trim()
        ?? null,
      geminiApiKey: saved.geminiApiKey ?? this.environment.GEMINI_API_KEY?.trim() ?? null,
      geminiDataUsePolicy: saved.geminiDataUsePolicy ?? this.environment.GEMINI_DATA_USE_POLICY?.trim() ?? null,
      openaiApiKey: saved.openaiApiKey ?? this.environment.OPENAI_API_KEY?.trim() ?? null,
    };
  }

  async save(settings: AIProviderSettingsUpdate): Promise<void> {
    const saved = await this.getSavedSettings();
    const updated = { ...saved };
    for (const field of settingsFields) {
      if (Object.hasOwn(settings, field)) {
        updated[field] = settings[field] ?? null;
      }
    }

    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), nonce);
    cipher.setAAD(this.associatedData());
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(updated), 'utf8'),
      cipher.final(),
    ]);
    await this.database.query(
      `INSERT INTO ai_provider_settings (id, ciphertext, nonce, auth_tag, updated_at)
       VALUES (1, $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE
       SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce, auth_tag = EXCLUDED.auth_tag, updated_at = NOW()`,
      [ciphertext.toString('base64'), nonce.toString('base64'), cipher.getAuthTag().toString('base64')],
    );
  }

  encryptionAvailable(): boolean {
    try {
      this.encryptionKey();
      return true;
    } catch {
      return false;
    }
  }

  private async getSavedSettings(): Promise<AIProviderSettings> {
    const { rows } = await this.database.query<SettingsRow>(
      'SELECT ciphertext, nonce, auth_tag FROM ai_provider_settings WHERE id = 1',
    );
    if (!rows[0]) return { ...emptySettings };

    try {
      const nonce = this.decodeBase64(rows[0].nonce);
      const authTag = this.decodeBase64(rows[0].auth_tag);
      const ciphertext = this.decodeBase64(rows[0].ciphertext);
      if (nonce.length !== 12 || authTag.length !== 16) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), nonce);
      decipher.setAAD(this.associatedData());
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      const decoded = JSON.parse(plaintext) as Record<string, unknown>;
      if (Object.keys(decoded).some((key) => !readableSettingsFields.includes(key))
        || Object.values(decoded).some((value) => value !== null && typeof value !== 'string')) {
        throw new Error();
      }
      const restored = {} as Record<keyof AIProviderSettings, string | null>;
      for (const field of settingsFields) {
        restored[field] = typeof decoded[field] === 'string' ? decoded[field] as string : null;
      }
      return restored;
    } catch (error) {
      if (error instanceof AIProviderSettingsPersistenceError) throw error;
      throw new AIProviderSettingsPersistenceError('AI_PROVIDER_SETTINGS_DECRYPTION_FAILED');
    }
  }

  private encryptionKey(): Buffer {
    const encoded = this.environment.SOCIAL_CREDENTIAL_ENCRYPTION_KEY?.trim();
    if (!encoded) throw new AIProviderSettingsPersistenceError('AI_PROVIDER_SETTINGS_ENCRYPTION_KEY_REQUIRED');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encoded) {
      throw new AIProviderSettingsPersistenceError('AI_PROVIDER_SETTINGS_ENCRYPTION_KEY_INVALID');
    }
    return key;
  }

  private decodeBase64(value: string): Buffer {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value) throw new Error();
    return decoded;
  }

  private associatedData(): Buffer {
    return Buffer.from('creator-desk-ai-provider-settings-v1');
  }
}

export class AIProviderSettingsPersistenceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AIProviderSettingsPersistenceError';
  }
}
