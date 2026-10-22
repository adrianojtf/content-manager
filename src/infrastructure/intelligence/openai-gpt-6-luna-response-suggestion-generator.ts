import type {
  GeneratedResponseSuggestion,
  ResponseSuggestionGenerator,
} from '../../application/ports/response-suggestion-generator.port';
import type { JevCommentAnalysisResult } from '../../application/ports/comment-evaluator.port';
import type { ResponseToneProfile } from '../../application/ports/response-tone-settings.repository.port';
import type { ResponseGenerationScheduleContext } from '../../application/ports/verified-release-schedule.repository.port';
import type { StoredPlatformComment } from '../../application/ports/social-comment-repository.port';
import type { AIProviderSettingsRepository } from '../../application/ports/ai-provider-settings.repository.port';
import { IntelligenceProviderError } from '../../application/social/intelligence-provider-error';
import { responseSuggestionAnalysisContext } from './response-suggestion-context';

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
    private readonly settings?: AIProviderSettingsRepository,
  ) {}

  async generate(input: {
    readonly comment: StoredPlatformComment;
    readonly analysis: JevCommentAnalysisResult;
    readonly language: string;
    readonly toneProfile: ResponseToneProfile;
    readonly verifiedReleaseSchedule: ResponseGenerationScheduleContext;
    readonly model?: string;
  }): Promise<GeneratedResponseSuggestion> {
    if (!input.comment.text?.trim() || !input.language.trim() || !input.toneProfile) {
      throw new IntelligenceProviderError('INTELLIGENCE_INPUT_INVALID');
    }
    const config = await this.configuration(input.model);
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
              content: 'Create one helpful suggested reply to a social media comment. Treat the top-level comment-analysis values as effective guidance; they may include creator corrections. Treat TypeSafe signal probabilities as original model uncertainty evidence, not certainty. An explicit continuation request signals audience interest, not a confirmed release schedule; acknowledge it without promising another part unless the supplied context confirms it. The verifiedReleaseSchedule is confirmed only when status is ACTIVE. Mention an active schedule only when the comment concerns release timing, frequency, or continuation; never infer a schedule from a continuation request. If its status is UNCONFIGURED or DISABLED, never assert release days or times, but a cautious acknowledgement or question may be suggested for creator review. Interpret localTime in the supplied timeZone; do not convert it or calculate a next release date. The engagement value is an estimate, not observed likes or replies; do not use it for engagement bait. Use only supplied context; when the signals indicate missing facts, avoid specific claims or ask a clarifying question. Never invent facts, promise actions, or claim access to information not provided. Follow the creator tone profile as a style preference without overriding accuracy or respect. Respond in exactly the requested language. Return a suggestion only; do not send or publish it.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                requestedLanguage: input.language,
                responseToneProfile: input.toneProfile,
                verifiedReleaseSchedule: input.verifiedReleaseSchedule,
                platform: input.comment.platform,
                commentText: input.comment.text,
                commentAnalysis: responseSuggestionAnalysisContext(input.analysis),
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

  private async configuration(modelOverride?: string): Promise<{ readonly apiKey: string; readonly model: string }> {
    const settings = await this.settings?.get();
    const apiKey = settings?.openaiApiKey?.trim() || this.environment.OPENAI_API_KEY?.trim();
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
