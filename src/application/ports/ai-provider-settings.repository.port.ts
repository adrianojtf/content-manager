export interface AIProviderSettings {
  readonly jevApiKey: string | null;
  readonly geminiApiKey: string | null;
  readonly geminiDataUsePolicy: string | null;
  readonly openaiApiKey: string | null;
}

export type AIProviderSettingsUpdate = Partial<AIProviderSettings>;

export interface AIProviderSettingsRepository {
  get(): Promise<AIProviderSettings>;
  save(settings: AIProviderSettingsUpdate): Promise<void>;
  encryptionAvailable(): boolean;
}
