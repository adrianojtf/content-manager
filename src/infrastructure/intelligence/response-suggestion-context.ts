import type { JevCommentAnalysisResult } from '../../application/ports/comment-evaluator.port';

export function responseSuggestionAnalysisContext(analysis: JevCommentAnalysisResult): Readonly<Record<string, unknown>> {
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
    ...(analysis.signals ? { signals: analysis.signals } : {}),
  };
}
