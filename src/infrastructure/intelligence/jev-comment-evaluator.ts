import type { CommentEvaluator, JevCommentAnalysisResult } from '../../application/ports/comment-evaluator.port';
import type { StoredPlatformComment } from '../../application/ports/social-comment-repository.port';
import { IntelligenceProviderError } from '../../application/social/intelligence-provider-error';

export type JevEnvironment = Readonly<Record<string, string | undefined>>;

interface JevCommentEvaluationResponse {
  readonly sentiment?: unknown;
  readonly emotion?: unknown;
  readonly intent?: unknown;
  readonly topic?: unknown;
  readonly entity?: unknown;
  readonly spamScore?: unknown;
  readonly toxicityScore?: unknown;
  readonly engagementValue?: unknown;
  readonly confidence?: unknown;
  readonly rationale?: unknown;
  readonly model?: unknown;
}

export class JevCommentEvaluator implements CommentEvaluator {
  constructor(
    private readonly environment: JevEnvironment = process.env,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async evaluate(input: { readonly comment: StoredPlatformComment }): Promise<JevCommentAnalysisResult> {
    if (!input.comment.text?.trim()) {
      throw new IntelligenceProviderError('INTELLIGENCE_INPUT_INVALID');
    }
    const config = this.configuration();
    let response: globalThis.Response;
    try {
      response = await this.fetcher(config.endpoint, {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify({
          comment: { text: input.comment.text },
          publication: { platform: input.comment.platform, externalPublicationId: input.comment.externalPublicationId },
        }),
      });
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) {
      this.mapHttpError(response.status);
    }
    let payload: JevCommentEvaluationResponse;
    try {
      payload = await response.json() as JevCommentEvaluationResponse;
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    const model = typeof payload.model === 'string' && payload.model.trim()
      ? payload.model
      : this.environment.JEV_MODEL?.trim() || 'provider-managed';
    const result: JevCommentAnalysisResult = {
      sentiment: this.requiredLabel(payload.sentiment),
      emotion: this.requiredLabel(payload.emotion),
      intent: this.requiredLabel(payload.intent),
      topic: this.requiredLabel(payload.topic),
      entity: payload.entity === null || payload.entity === undefined ? null : this.requiredLabel(payload.entity),
      spamScore: this.score(payload.spamScore),
      toxicityScore: this.score(payload.toxicityScore),
      engagementValue: this.score(payload.engagementValue),
      confidence: this.score(payload.confidence),
      rationale: payload.rationale === null || payload.rationale === undefined ? null : this.requiredLabel(payload.rationale),
      provider: 'JEV',
      model,
      schemaVersion: this.environment.JEV_COMMENT_ANALYSIS_SCHEMA_VERSION?.trim() || '1',
    };
    return result;
  }

  private configuration(): { endpoint: string; headers: HeadersInit } {
    const endpoint = this.environment.JEV_COMMENT_EVALUATION_URL?.trim();
    if (!endpoint) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_REQUIRED');
    }
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_INVALID');
    }
    const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_INVALID');
    }
    const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
    const apiKey = this.environment.JEV_API_KEY?.trim();
    if (apiKey) {
      const headerName = this.environment.JEV_API_KEY_HEADER?.trim() || 'authorization';
      const prefix = this.environment.JEV_API_KEY_PREFIX?.trim() ?? 'Bearer';
      try {
        headers.set(headerName, prefix ? `${prefix} ${apiKey}` : apiKey);
      } catch {
        throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_INVALID');
      }
    }
    return { endpoint: url.toString(), headers };
  }

  private requiredLabel(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    return value;
  }

  private score(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    return value;
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
