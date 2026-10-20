import type {
  GeneratedResponseSuggestion,
  ResponseSuggestionGenerator,
} from '../../application/ports/response-suggestion-generator.port';
import type { JevCommentAnalysisResult } from '../../application/ports/comment-evaluator.port';
import type { ResponseToneProfile } from '../../application/ports/response-tone-settings.repository.port';
import type { StoredPlatformComment } from '../../application/ports/social-comment-repository.port';
import { IntelligenceProviderError } from '../../application/social/intelligence-provider-error';

export type OpenAIEnvironment = Readonly<Record<string, string | undefined>>;

interface OpenAIResponse {
  readonly status?: unknown;
  readonly output?: readonly {
    readonly type?: unknown;
    readonly content?: readonly {
      readonly type?: unknown;
      readonly text?: unknown;
      readonly refusal?: unknown;
    }[];
  }[];
}

interface SuggestionTextOutput {
  readonly text?: unknown;
  readonly intendedTone?: unknown;
  readonly confidence?: unknown;
  readonly rationale?: unknown;
}

const defaultModel = 'gpt-6-luna';
const responseSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    intendedTone: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' },
  },
  required: ['text', 'intendedTone', 'confidence', 'rationale'],
  additionalProperties: false,
};

export class OpenAIGpt6LunaResponseSuggestionGenerator implements ResponseSuggestionGenerator {
  constructor(
    private readonly environment: OpenAIEnvironment = process.env,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generate(input: {
    readonly comment: StoredPlatformComment;
    readonly analysis: JevCommentAnalysisResult;
    readonly language: string;
    readonly toneProfile: ResponseToneProfile;
    readonly model?: string;
  }): Promise<GeneratedResponseSuggestion> {
    if (!input.comment.text?.trim() || !input.language.trim() || !input.toneProfile) {
      throw new IntelligenceProviderError('INTELLIGENCE_INPUT_INVALID');
    }
    const config = this.configuration(input.model);
    let response: globalThis.Response;
    try {
      response = await this.fetcher('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          store: false,
          reasoning: { effort: 'none' },
          max_output_tokens: 256,
          input: [
            {
              role: 'system',
              content: 'Create one helpful suggested reply to a social media comment. Follow the creator tone profile as a style preference, but never let it override accuracy, respect, or the supplied comment analysis. Use only supplied context; do not invent facts, promise actions, or claim access to information not provided. Respond in exactly the requested language. Return a suggestion only; do not send or publish it.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                requestedLanguage: input.language,
                responseToneProfile: input.toneProfile,
                platform: input.comment.platform,
                commentText: input.comment.text,
                commentAnalysis: input.analysis,
              }),
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'response_suggestion',
              strict: true,
              schema: responseSchema,
            },
          },
        }),
      });
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) {
      this.mapHttpError(response.status);
    }
    let payload: OpenAIResponse;
    try {
      payload = await response.json() as OpenAIResponse;
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    if (payload.status === 'incomplete') {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    const content = payload.output?.flatMap((item) => item.content ?? []) ?? [];
    if (content.some((part) => part.type === 'refusal')) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_BLOCKED');
    }
    const responseText = content.filter((part) => part.type === 'output_text')
      .map((part) => part.text)
      .filter((text): text is string => typeof text === 'string')
      .join('');
    if (!responseText) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    let output: SuggestionTextOutput;
    try {
      output = JSON.parse(responseText) as SuggestionTextOutput;
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    if (typeof output.text !== 'string' || !output.text.trim() || typeof output.intendedTone !== 'string' || !output.intendedTone.trim()
      || typeof output.confidence !== 'number' || !Number.isFinite(output.confidence) || output.confidence < 0 || output.confidence > 1
      || typeof output.rationale !== 'string') {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    return {
      text: output.text,
      language: input.language,
      intendedTone: output.intendedTone,
      provider: 'OPENAI',
      model: config.model,
      confidence: output.confidence,
      rationale: output.rationale || null,
    };
  }

  private configuration(modelOverride?: string): { readonly apiKey: string; readonly model: string } {
    const apiKey = this.environment.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_REQUIRED');
    }
    const model = modelOverride?.trim() || defaultModel;
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_INVALID');
    }
    return { apiKey, model };
  }

  private mapHttpError(status: number): never {
    if (status === 401 || status === 403) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_AUTHORIZATION_FAILED');
    }
    if (status === 429) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RATE_LIMITED');
    }
    if (status >= 500) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_UNAVAILABLE');
    }
    throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_REQUEST_FAILED');
  }
}
