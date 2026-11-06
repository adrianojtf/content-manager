import type {
  JevChoiceSignal,
  JevNoulSignal,
  JevScoreSignal,
} from '../../application/ports/comment-evaluator.port';
import { IntelligenceProviderError } from '../../application/social/intelligence-provider-error';
import type { TypeSafeSystemOneOutput } from './typesafe-system-one.client';

export interface TypeSafeChoiceResult {
  readonly value: string;
  readonly signal: JevChoiceSignal;
}

export function readChoiceAnswer(
  result: TypeSafeSystemOneOutput,
  questionId: string,
  options: readonly string[],
): TypeSafeChoiceResult {
  const answer = answerFor(result, questionId);
  if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !options.includes(answer.choice)) {
    throw invalidResponse();
  }
  const probabilities = probabilityMap(answer.probabilities);
  if (Object.keys(probabilities).length !== options.length
    || options.some((option) => !Object.hasOwn(probabilities, option))) {
    throw invalidResponse();
  }
  return {
    value: answer.choice,
    signal: {
      confidence: unitScore(answer.confidence),
      probabilities,
    },
  };
}

export function readScoreAnswer(
  result: TypeSafeSystemOneOutput,
  questionId: string,
  levels: number,
): JevScoreSignal {
  const answer = answerFor(result, questionId);
  const maximum = levels - 1;
  if (answer.type !== 'score' || typeof answer.score !== 'number'
    || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > maximum) {
    throw invalidResponse();
  }
  const probabilities = probabilityMap(answer.probabilities);
  const legend = stringMap(answer.legend);
  const expectedLevels = Array.from({ length: levels }, (_, index) => String(index));
  if (Object.keys(probabilities).length !== levels || Object.keys(legend).length !== levels
    || expectedLevels.some((level) => !Object.hasOwn(probabilities, level) || !Object.hasOwn(legend, level))) {
    throw invalidResponse();
  }
  return {
    rawScore: answer.score,
    normalizedScore: answer.score / maximum,
    confidence: unitScore(answer.confidence),
    probabilities,
    legend,
  };
}

export function readNoulAnswer(result: TypeSafeSystemOneOutput, questionId: string): JevNoulSignal {
  const answer = answerFor(result, questionId);
  if (answer.type !== 'noul') throw invalidResponse();
  return { probability: unitScore(answer.noul) };
}

export interface TypeSafeJsonResult {
  readonly value: Readonly<Record<string, unknown>>;
  readonly confidence: number | null;
}

export function readJsonAnswer(result: TypeSafeSystemOneOutput, questionId: string): TypeSafeJsonResult {
  const answer = answerFor(result, questionId);
  if (answer.type !== 'json' || !isRecord(answer.value)) {
    throw invalidResponse();
  }
  let confidence: number | null = null;
  if (answer.confidence !== undefined && answer.confidence !== null) {
    confidence = unitScore(answer.confidence);
  } else if (answer.value.confidence !== undefined && answer.value.confidence !== null) {
    confidence = unitScore(answer.value.confidence);
  }
  return { value: answer.value, confidence };
}

export function summarizeConfidence(...signals: readonly { readonly confidence: number }[]): number {
  if (signals.length === 0) throw invalidResponse();
  return Math.min(...signals.map((signal) => signal.confidence));
}

function answerFor(result: TypeSafeSystemOneOutput, questionId: string): Record<string, unknown> {
  const answer = result.answers[questionId];
  if (!isRecord(answer)) throw invalidResponse();
  return answer;
}

function probabilityMap(value: unknown): Readonly<Record<string, number>> {
  if (!isRecord(value)) throw invalidResponse();
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([, score]) => typeof score !== 'number'
    || !Number.isFinite(score) || score < 0 || score > 1)) {
    throw invalidResponse();
  }
  return value as Record<string, number>;
}

function stringMap(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) throw invalidResponse();
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([, label]) => typeof label !== 'string' || !label.trim())) {
    throw invalidResponse();
  }
  return value as Record<string, string>;
}

function unitScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidResponse();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): IntelligenceProviderError {
  return new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RESPONSE_INVALID');
}
