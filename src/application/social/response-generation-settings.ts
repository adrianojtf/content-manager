import type {
  ResponseGenerationProvider,
  ResponseGenerationSettings,
  ResponseGenerationSettingsRepository,
} from '../ports/response-generation-settings.repository.port';
import type { GeneratedResponseSuggestion, ResponseSuggestionGenerator } from '../ports/response-suggestion-generator.port';
import { ResponseGenerationSettingsError } from './response-generation-settings-error';

export interface ResponseGenerationModelOption {
  readonly provider: ResponseGenerationProvider;
  readonly model: string;
  readonly displayName: string;
}

export interface ResponseGenerationSettingsView {
  readonly active: ResponseGenerationSettings;
  readonly models: readonly ResponseGenerationModelOption[];
}

export interface UpdateResponseGenerationSettingsInput {
  readonly provider: string;
  readonly model: string;
}

export const responseGenerationModels: readonly ResponseGenerationModelOption[] = [
  { provider: 'google', model: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' },
  { provider: 'openai', model: 'gpt-6-luna', displayName: 'GPT-6 Luna' },
];

export class GetResponseGenerationSettings {
  constructor(private readonly settings: ResponseGenerationSettingsRepository) {}

  async execute(): Promise<ResponseGenerationSettingsView> {
    const active = await this.settings.get();
    if (!active) {
      throw new ResponseGenerationSettingsError('RESPONSE_GENERATION_SETTINGS_NOT_CONFIGURED');
    }
    return { active, models: responseGenerationModels };
  }
}

export class UpdateResponseGenerationSettings {
  constructor(private readonly settings: ResponseGenerationSettingsRepository) {}

  async execute(input: UpdateResponseGenerationSettingsInput): Promise<ResponseGenerationSettings> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)
      || Object.keys(input).length !== 2 || Object.keys(input).some((key) => key !== 'provider' && key !== 'model')
      || typeof input.provider !== 'string' || typeof input.model !== 'string'
      || !responseGenerationModels.some((option) => option.provider === input.provider && option.model === input.model)) {
      throw new ResponseGenerationSettingsError('RESPONSE_GENERATION_SETTINGS_INVALID');
    }
    return this.settings.save(input.provider as ResponseGenerationProvider, input.model);
  }
}

export class ConfiguredResponseSuggestionGenerator implements ResponseSuggestionGenerator {
  constructor(
    private readonly settings: ResponseGenerationSettingsRepository,
    private readonly providers: Partial<Record<ResponseGenerationProvider, ResponseSuggestionGenerator>>,
  ) {}

  async generate(input: Parameters<ResponseSuggestionGenerator['generate']>[0]): Promise<GeneratedResponseSuggestion> {
    const active = await this.settings.get();
    if (!active || !responseGenerationModels.some((option) => option.provider === active.provider && option.model === active.model)) {
      throw new ResponseGenerationSettingsError('RESPONSE_GENERATION_SETTINGS_NOT_CONFIGURED');
    }
    const provider = this.providers[active.provider];
    if (!provider) {
      throw new ResponseGenerationSettingsError('RESPONSE_GENERATION_PROVIDER_UNAVAILABLE');
    }
    return provider.generate({ ...input, model: active.model });
  }
}
