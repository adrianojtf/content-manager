import type { ResponseEvaluator, JevResponseEvaluationResult } from '../../application/ports/response-evaluator.port';
import type { JevCommentAnalysisResult } from '../../application/ports/comment-evaluator.port';
import type { StoredPlatformComment } from '../../application/ports/social-comment-repository.port';
import { IntelligenceProviderError } from '../../application/social/intelligence-provider-error';

export type JevResponseEnvironment = Readonly<Record<string, string | undefined>>;

export class JevResponseEvaluator implements ResponseEvaluator {
  constructor(private readonly environment: JevResponseEnvironment = process.env, private readonly fetcher: typeof fetch = fetch) {}

  async evaluate(input: { readonly comment: StoredPlatformComment; readonly analysis: JevCommentAnalysisResult; readonly responseText: string }): Promise<JevResponseEvaluationResult> {
    if (!input.comment.text?.trim() || !input.responseText.trim()) {
      throw new IntelligenceProviderError('INTELLIGENCE_INPUT_INVALID');
    }
    const endpoint = this.endpoint();
    const headers = this.headers();
    let response: globalThis.Response;
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ comment: { text: input.comment.text }, commentAnalysis: input.analysis, response: { text: input.responseText } }),
      });
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_AUTHORIZATION_FAILED');
      if (response.status === 429) throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RATE_LIMITED');
      if (response.status >= 500) throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_UNAVAILABLE');
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_REQUEST_FAILED');
    }
    let value: Record<string, unknown>;
    try {
      value = await response.json() as Record<string, unknown>;
    } catch {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    }
    const result: JevResponseEvaluationResult = {
      relevance: this.score(value.relevance),
      tone: this.score(value.tone),
      helpfulness: this.score(value.helpfulness),
      factualRisk: this.score(value.factualRisk),
      toxicityRisk: this.score(value.toxicityRisk),
      hallucinationRisk: this.score(value.hallucinationRisk),
      publishRecommendation: this.recommendation(value.publishRecommendation),
      confidence: this.score(value.confidence),
      rationale: value.rationale === null || value.rationale === undefined ? null : this.label(value.rationale),
      provider: 'JEV',
      model: typeof value.model === 'string' && value.model.trim() ? value.model : this.environment.JEV_MODEL?.trim() || 'provider-managed',
      schemaVersion: this.environment.JEV_RESPONSE_EVALUATION_SCHEMA_VERSION?.trim() || '1',
    };
    return result;
  }

  private endpoint(): string {
    const endpoint = this.environment.JEV_RESPONSE_EVALUATION_URL?.trim();
    if (!endpoint) throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_REQUIRED');
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_INVALID'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_INVALID');
    return url.toString();
  }

  private headers(): HeadersInit {
    const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
    const key = this.environment.JEV_API_KEY?.trim();
    if (key) {
      try { headers.set(this.environment.JEV_API_KEY_HEADER?.trim() || 'authorization', `${this.environment.JEV_API_KEY_PREFIX?.trim() ?? 'Bearer'}${this.environment.JEV_API_KEY_PREFIX?.trim() === '' ? '' : ' '}${key}`); }
      catch { throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_CONFIGURATION_INVALID'); }
    }
    return headers;
  }

  private label(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    return value;
  }

  private score(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    return value;
  }

  private recommendation(value: unknown): 'APPROVE' | 'REVIEW' | 'REJECT' {
    if (value !== 'APPROVE' && value !== 'REVIEW' && value !== 'REJECT') throw new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
    return value;
  }
}
