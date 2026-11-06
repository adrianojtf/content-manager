import type { CommentWorkflowEvent } from '../ports/comment-workflow-event-repository.port';
import type { ResponseRefinementPairRepository } from '../ports/response-refinement-pair-repository.port';
import { isResponseVersionEventType, responseVersionRootId } from './comment-workflow-audit';

export interface RecordResponseRefinementPairInput {
  readonly tenantId: string;
  readonly socialAccountId: string;
  readonly platform: string;
  readonly manualReplyAttemptId: string;
  readonly sentVersionEventId: string;
  readonly history: readonly CommentWorkflowEvent[];
  readonly recordedAt: string;
}

export class RecordResponseRefinementPair {
  constructor(private readonly pairs: ResponseRefinementPairRepository) {}

  async execute(input: RecordResponseRefinementPairInput): Promise<boolean> {
    const sent = input.history.find((event) => event.id === input.sentVersionEventId
      && isResponseVersionEventType(event.eventType));
    const rootId = sent ? responseVersionRootId(sent) : null;
    const root = rootId ? input.history.find((event) => event.id === rootId) : undefined;
    if (!sent || !root || root.eventType !== 'RESPONSE_SUGGESTION_GENERATED') {
      return false;
    }
    const aiText = root.payload.text;
    const finalText = sent.payload.text;
    if (typeof aiText !== 'string' || !aiText.trim() || typeof finalText !== 'string' || !finalText.trim() || finalText === aiText) {
      return false;
    }
    const suggestion = this.parseSuggestion(root.payload);
    if (!suggestion) {
      return false;
    }
    const revisionCount = input.history.filter((event) => event.eventType === 'RESPONSE_SUGGESTION_EDITED'
      && event.payload.originalSuggestionEventId === root.id).length;
    const lastEditReason = sent.eventType === 'RESPONSE_SUGGESTION_EDITED' && typeof sent.payload.reason === 'string'
      ? sent.payload.reason
      : null;
    const evaluationEvent = input.history.filter((event) => event.eventType === 'RESPONSE_EVALUATED'
      && event.parentEventId === sent.id && event.payload.revisionEventId === sent.id).at(-1);
    const evaluation = this.isRecord(evaluationEvent?.payload.evaluation) ? evaluationEvent.payload.evaluation : null;

    await this.pairs.append({
      tenantId: input.tenantId,
      socialAccountId: input.socialAccountId,
      platform: input.platform,
      language: suggestion.language,
      aiText,
      finalText,
      aiProvider: suggestion.provider,
      aiModel: suggestion.model,
      promptVersion: typeof root.payload.promptVersion === 'string' && root.payload.promptVersion.trim()
        ? root.payload.promptVersion
        : 'UNKNOWN',
      aiConfidence: suggestion.confidence,
      aiRationale: suggestion.rationale,
      intendedTone: suggestion.intendedTone,
      toneProfile: {
        toneProfile: this.isRecord(root.payload.toneProfile) ? root.payload.toneProfile : null,
        toneProfileSource: typeof root.payload.toneProfileSource === 'string' ? root.payload.toneProfileSource : null,
      },
      revisionCount,
      lastEditReason,
      evaluation,
      analysisLabels: this.analysisLabels(root, input.history),
      manualReplyAttemptId: input.manualReplyAttemptId,
      recordedAt: input.recordedAt,
    });
    return true;
  }

  private parseSuggestion(payload: Readonly<Record<string, unknown>>) {
    if (typeof payload.language !== 'string' || !payload.language.trim()
      || typeof payload.provider !== 'string' || !payload.provider.trim()
      || typeof payload.model !== 'string' || !payload.model.trim()
      || typeof payload.intendedTone !== 'string' || !payload.intendedTone.trim()
      || typeof payload.confidence !== 'number' || !Number.isFinite(payload.confidence)
      || payload.confidence < 0 || payload.confidence > 1
      || (payload.rationale !== null && payload.rationale !== undefined && typeof payload.rationale !== 'string')) {
      return null;
    }
    return {
      language: payload.language,
      provider: payload.provider,
      model: payload.model,
      intendedTone: payload.intendedTone,
      confidence: payload.confidence,
      rationale: payload.rationale ?? null,
    };
  }

  private analysisLabels(
    suggestion: CommentWorkflowEvent,
    history: readonly CommentWorkflowEvent[],
  ): Readonly<Record<string, unknown>> | null {
    let analysisEvent = suggestion.parentEventId
      ? history.find((event) => event.id === suggestion.parentEventId)
      : undefined;
    while (analysisEvent && analysisEvent.eventType === 'COMMENT_ANALYSIS_CORRECTED') {
      const parentId = analysisEvent.parentEventId;
      analysisEvent = parentId ? history.find((event) => event.id === parentId) : undefined;
    }
    if (!analysisEvent || analysisEvent.eventType !== 'COMMENT_ANALYSIS_CREATED') {
      return null;
    }
    const correctedFields = history
      .filter((event) => event.eventType === 'COMMENT_ANALYSIS_CORRECTED' && event.parentEventId === analysisEvent.id)
      .reduce<Record<string, unknown>>((result, event) => {
        const fields = event.payload.correctedFields;
        if (this.isRecord(fields)) {
          Object.assign(result, fields);
        }
        return result;
      }, {});
    const effective = { ...analysisEvent.payload, ...correctedFields };
    return {
      sentiment: effective.sentiment ?? null,
      emotion: effective.emotion ?? null,
      intent: effective.intent ?? null,
      topic: effective.topic ?? null,
      entity: effective.entity ?? null,
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
