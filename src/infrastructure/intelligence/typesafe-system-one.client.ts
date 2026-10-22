import type { AIProviderSettingsRepository } from '../../application/ports/ai-provider-settings.repository.port';
import { IntelligenceProviderError } from '../../application/social/intelligence-provider-error';

export type TypeSafeEnvironment = Readonly<Record<string, string | undefined>>;

export type TypeSafeQuestion =
  | {
    readonly type: 'choice';
    readonly instructions: string;
    readonly criteria: Readonly<Record<string, string>>;
  }
  | {
    readonly type: 'score';
    readonly instructions: string;
    readonly criteria: readonly string[];
  }
  | {
    readonly type: 'noul';
    readonly instructions: string;
    readonly criteria?: { readonly true: string; readonly false: string };
  };

export interface TypeSafeSystemOneInput {
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, TypeSafeQuestion>>;
}

export interface TypeSafeSystemOneUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface TypeSafeSystemOneOutput {
  readonly model: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly usage: TypeSafeSystemOneUsage | null;
}

interface TypeSafeSystemOneResponse {
  readonly model?: unknown;
  readonly answers?: unknown;
  readonly usage?: unknown;
}

const endpoint = 'https://api.typesafe.ai/v1/systemone';
const model = 'jev-latest';

export class TypeSafeSystemOneClient {
  constructor(
    private readonly environment: TypeSafeEnvironment = process.env,
    private readonly fetcher: typeof fetch = fetch,
    private readonly settings?: AIProviderSettingsRepository,
  ) {}

  async evaluate(input: TypeSafeSystemOneInput): Promise<TypeSafeSystemOneOutput> {
    const apiKey = await this.apiKey();
    let response: globalThis.Response;
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          model,
          state: input.state,
          questions: input.questions,
        }),
      });
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) this.mapHttpError(response.status);

    let payload: TypeSafeSystemOneResponse;
    try {
      payload = await response.json() as TypeSafeSystemOneResponse;
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    if (!isRecord(payload)
      || typeof payload.model !== 'string' || !payload.model.trim()
      || !isRecord(payload.answers)
      || (payload.usage !== undefined && payload.usage !== null && !this.isUsage(payload.usage))) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    return {
      model: payload.model,
      answers: payload.answers,
      usage: payload.usage === undefined || payload.usage === null ? null : this.usage(payload.usage),
    };
  }

  private async apiKey(): Promise<string> {
    const configured = await this.settings?.get();
    const key = configured?.jevApiKey?.trim()
      || this.environment.TYPESAFE_API_KEY?.trim()
      || this.environment.JEV_API_KEY?.trim();
    if (!key) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_REQUIRED');
    }
    return key;
  }

  private isUsage(value: unknown): value is { readonly input_tokens: number; readonly output_tokens: number } {
    if (!isRecord(value)) return false;
    return Number.isSafeInteger(value.input_tokens) && (value.input_tokens as number) >= 0
      && Number.isSafeInteger(value.output_tokens) && (value.output_tokens as number) >= 0;
  }

  private usage(value: unknown): TypeSafeSystemOneUsage {
    const raw = value as { readonly input_tokens: number; readonly output_tokens: number };
    return { inputTokens: raw.input_tokens, outputTokens: raw.output_tokens };
  }

  private mapHttpError(status: number): never {
    if (status === 401 || status === 403) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_AUTHORIZATION_FAILED');
    }
    if (status === 429) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RATE_LIMITED');
    }
    if (status === 529 || status >= 500) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_UNAVAILABLE');
    }
    throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_REQUEST_FAILED');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
