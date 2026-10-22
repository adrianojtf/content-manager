import type { ResponseEvaluator, JevResponseEvaluationResult } from '../../application/ports/response-evaluator.port';
import type {
  JevCommentAnalysisResult,
} from '../../application/ports/comment-evaluator.port';
import type { StoredPlatformComment } from '../../application/ports/social-comment-repository.port';
import type { ActiveVerifiedReleaseScheduleContext } from '../../application/ports/verified-release-schedule.repository.port';
import { IntelligenceProviderError } from '../../application/social/intelligence-provider-error';
import { readChoiceAnswer, readNoulAnswer, readScoreAnswer, summarizeConfidence } from './typesafe-system-one.answers';
import type { TypeSafeQuestion, TypeSafeSystemOneClient, TypeSafeSystemOneOutput } from './typesafe-system-one.client';

const responseEvaluationSchemaVersion = 'typesafe-systemone-v2';
const qualityLevels = [
  'Very poor: the response does not address the comment or is unsuitable.',
  'Poor: the response addresses little of the comment or has a notable weakness.',
  'Adequate: the response is partly useful and has no major issue.',
  'Good: the response addresses the comment clearly and appropriately.',
  'Excellent: the response is directly helpful, clear, and well matched to the comment.',
] as const;

const recommendationOptions = ['APPROVE', 'REVIEW', 'REJECT'] as const;

export class JevResponseEvaluator implements ResponseEvaluator {
  constructor(private readonly systemOne: TypeSafeSystemOneClient) {}

  async evaluate(input: {
    readonly comment: StoredPlatformComment;
    readonly analysis: JevCommentAnalysisResult;
    readonly responseText: string;
    readonly verifiedReleaseSchedule?: ActiveVerifiedReleaseScheduleContext;
  }): Promise<JevResponseEvaluationResult> {
    if (!input.comment.text?.trim() || !input.responseText.trim()) {
      throw new IntelligenceProviderError('INTELLIGENCE_INPUT_INVALID');
    }
    const result = await this.systemOne.evaluate({
      state: {
        comment: { text: input.comment.text },
        commentAnalysis: this.analysisState(input.analysis),
        response: { text: input.responseText },
        ...(input.verifiedReleaseSchedule ? { verifiedReleaseSchedule: input.verifiedReleaseSchedule } : {}),
      },
      questions: this.questions(Boolean(input.verifiedReleaseSchedule)),
    });
    return this.normalize(result, Boolean(input.verifiedReleaseSchedule));
  }

  private normalize(result: TypeSafeSystemOneOutput, includeScheduleConsistency: boolean): JevResponseEvaluationResult {
    const relevance = readScoreAnswer(result, 'relevance', qualityLevels.length);
    const tone = readScoreAnswer(result, 'tone', qualityLevels.length);
    const helpfulness = readScoreAnswer(result, 'helpfulness', qualityLevels.length);
    const factualRisk = readNoulAnswer(result, 'factual_risk');
    const toxicityRisk = readNoulAnswer(result, 'toxicity_risk');
    const hallucinationRisk = readNoulAnswer(result, 'hallucination_risk');
    const scheduleConsistency = includeScheduleConsistency
      ? readNoulAnswer(result, 'schedule_consistency')
      : undefined;
    const publishRecommendation = readChoiceAnswer(result, 'publish_recommendation', recommendationOptions);
    const confidence = summarizeConfidence(
      relevance,
      tone,
      helpfulness,
      publishRecommendation.signal,
    );
    const normalized: JevResponseEvaluationResult = {
      relevance: relevance.normalizedScore,
      tone: tone.normalizedScore,
      helpfulness: helpfulness.normalizedScore,
      factualRisk: factualRisk.probability,
      toxicityRisk: toxicityRisk.probability,
      hallucinationRisk: hallucinationRisk.probability,
      ...(scheduleConsistency ? { scheduleConsistency: scheduleConsistency.probability } : {}),
      publishRecommendation: publishRecommendation.value as 'APPROVE' | 'REVIEW' | 'REJECT',
      confidence,
      rationale: null,
      provider: 'JEV',
      model: result.model,
      schemaVersion: responseEvaluationSchemaVersion,
      signals: {
        relevance,
        tone,
        helpfulness,
        factualRisk,
        toxicityRisk,
        hallucinationRisk,
        ...(scheduleConsistency ? { scheduleConsistency } : {}),
        publishRecommendation: publishRecommendation.signal,
      },
      usage: result.usage,
    };
    return normalized;
  }

  private analysisState(analysis: JevCommentAnalysisResult): Readonly<Record<string, unknown>> {
    return {
      sentiment: analysis.sentiment,
      emotion: analysis.emotion,
      intent: analysis.intent,
      topic: analysis.topic,
      entity: analysis.entity,
      spamScore: analysis.spamScore,
      toxicityScore: analysis.toxicityScore,
      engagementValue: analysis.engagementValue,
      ...(analysis.continuationRequestProbability !== undefined
        ? { continuationRequestProbability: analysis.continuationRequestProbability }
        : {}),
      confidence: analysis.confidence,
      rationale: analysis.rationale,
      signals: analysis.signals,
    };
  }

  private questions(includeScheduleConsistency: boolean): Readonly<Record<string, TypeSafeQuestion>> {
    return {
      relevance: {
        type: 'score',
        instructions: 'How directly does `response.text` address `comment.text` and the supplied comment analysis?',
        criteria: qualityLevels,
      },
      tone: {
        type: 'score',
        instructions: 'How appropriate and respectful is the tone of `response.text` for `comment.text`?',
        criteria: qualityLevels,
      },
      helpfulness: {
        type: 'score',
        instructions: 'How helpful is `response.text` to the commenter, based only on the supplied state?',
        criteria: qualityLevels,
      },
      factual_risk: {
        type: 'noul',
        instructions: 'Does `response.text` assert factual details that are not supported by the supplied state?',
      },
      toxicity_risk: {
        type: 'noul',
        instructions: 'Does `response.text` contain insulting, harassing, hateful, or threatening language?',
      },
      hallucination_risk: {
        type: 'noul',
        instructions: 'Does `response.text` invent specific facts, promises, or actions not supported by the supplied state?',
      },
      ...(includeScheduleConsistency ? {
        schedule_consistency: {
          type: 'noul' as const,
          instructions: 'Is every release day or local time explicitly stated in `response.text` consistent with `verifiedReleaseSchedule`? Answer yes if the response makes no schedule claim. Do not infer a schedule from a continuation request or calculate a next release date.',
        },
      } : {}),
      publish_recommendation: {
        type: 'choice',
        instructions: 'Choose an advisory review recommendation for the exact response. Evaluate the response against the supplied comment and analysis; do not infer or cause publication.',
        criteria: {
          APPROVE: 'The response is relevant, respectful, useful, and contains no material unsupported claim.',
          REVIEW: 'The response is ambiguous, has a notable uncertainty, or would benefit from creator review.',
          REJECT: 'The response is materially irrelevant, harmful, or contains a serious unsupported claim.',
        },
      },
    };
  }
}
