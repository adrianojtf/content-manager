import type {
  GeneratedResponseSuggestion,
  ResponseSuggestionGenerator,
} from '../../application/ports/response-suggestion-generator.port';
import type { JevCommentAnalysisResult } from '../../application/ports/comment-evaluator.port';
import type { ResponseToneProfile } from '../../application/ports/response-tone-settings.repository.port';
import type { StoredPlatformComment } from '../../application/ports/social-comment-repository.port';
import { IntelligenceProviderError } from '../../application/social/intelligence-provider-error';

export type GeminiEnvironment = Readonly<Record<string, string | undefined>>;

interface GeminiResponse {
  readonly promptFeedback?: { readonly blockReason?: unknown };
  readonly candidates?: readonly {
    readonly finishReason?: unknown;
    readonly content?: { readonly parts?: readonly { readonly text?: unknown }[] };
  }[];
}

interface SuggestionTextOutput {
  readonly text?: unknown;
  readonly intendedTone?: unknown;
  readonly confidence?: unknown;
  readonly rationale?: unknown;
}

const defaultModel = 'gemini-3.5-flash-lite';
const modelOutputSchema = {
  type: 'OBJECT',
  properties: {
    text: { type: 'STRING' },
    intendedTone: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
    rationale: { type: 'STRING' },
  },
  required: ['text', 'intendedTone', 'confidence', 'rationale'],
};

export class GeminiFlashLiteResponseSuggestionGenerator implements ResponseSuggestionGenerator {
  constructor(
    private readonly environment: GeminiEnvironment = process.env,
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
    const model = config.model;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const request = {
      systemInstruction: {
        parts: [{
          text: 'Create one helpful suggested reply to a social media comment. Follow the creator tone profile as a style preference, but never let it override accuracy, respect, or the supplied comment analysis. Use only supplied context; do not invent facts, promise actions, or claim access to information not provided. Respond in exactly the requested language. Return a suggestion only; do not send or publish it.',
        }],
      },
      contents: [{
        role: 'user',
        parts: [{ text: JSON.stringify({
          requestedLanguage: input.language,
          responseToneProfile: input.toneProfile,
          platform: input.comment.platform,
          commentText: input.comment.text,
          commentAnalysis: input.analysis,
        }) }],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: modelOutputSchema,
        maxOutputTokens: 256,
      },
    };

    let response: globalThis.Response;
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify(request),
      });
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) {
      this.mapHttpError(response.status);
    }
    let payload: GeminiResponse;
    try {
      payload = await response.json() as GeminiResponse;
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    const candidate = payload.candidates?.[0];
    if (payload.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'RECITATION') {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_BLOCKED');
    }
    const responseText = candidate?.content?.parts?.map((part) => part.text).filter((part): part is string => typeof part === 'string').join('');
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
      provider: 'GEMINI',
      model,
      confidence: output.confidence,
      rationale: output.rationale || null,
    };
  }

  private configuration(modelOverride?: string): { readonly apiKey: string; readonly model: string } {
    const apiKey = this.environment.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_REQUIRED');
    }
    const dataUsePolicy = this.environment.GEMINI_DATA_USE_POLICY?.trim();
    if (dataUsePolicy !== 'free-tier-acknowledged' && dataUsePolicy !== 'paid-tier') {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_DATA_POLICY_REQUIRED');
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
