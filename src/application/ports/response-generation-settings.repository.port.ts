export type ResponseGenerationProvider = 'google' | 'openai';

export interface ResponseGenerationSettings {
  readonly provider: ResponseGenerationProvider;
  readonly model: string;
  readonly updatedAt: string | null;
  readonly updatedByAdminUserId: string | null;
}

export interface ResponseGenerationSettingsRepository {
  get(): Promise<ResponseGenerationSettings | null>;
  save(provider: ResponseGenerationProvider, model: string, updatedByAdminUserId?: string | null): Promise<ResponseGenerationSettings>;
}
