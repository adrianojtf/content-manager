import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AnalyzeResponseRefinementPairs } = require('../../dist/application/social/analyze-response-refinement-pairs.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const asOf = '2026-11-05T12:00:00.000Z';
const comment = {
  platform: 'instagram',
  socialAccountId: accountId,
  externalCommentId: 'private-comment-id',
  externalThreadId: 'private-thread-id',
  externalPublicationId: 'private-publication-id',
  authorDisplayName: 'Private author',
  text: 'Qual é o horário de atendimento?',
  createdAt: '2026-11-01T12:00:00.000Z',
  canReply: true,
  canLike: false,
  appReplied: true,
  appLiked: false,
  lastSyncedAt: '2026-11-05T11:00:00.000Z',
  expiresAt: '2026-12-01T12:00:00.000Z',
  creatorReplies: [],
};
const analysis = {
  sentiment: 'NEUTRAL',
  emotion: 'CURIOSITY',
  intent: 'QUESTION',
  topic: 'GENERAL',
  entity: null,
  spamScore: 0,
  toxicityScore: 0,
  engagementValue: 0.5,
  confidence: 0.9,
  rationale: null,
  provider: 'JEV',
  model: 'test-model',
  schemaVersion: 'typesafe-systemone-v2',
};
const pair = {
  id: 'pair-1',
  tenantId,
  socialAccountId: accountId,
  platform: 'instagram',
  language: 'pt-BR',
  aiText: 'Atendemos até às 18h.',
  finalText: 'Nosso atendimento funciona até 18h, de segunda a sexta.',
  aiProvider: 'OPENAI',
  aiModel: 'gpt-6-luna',
  promptVersion: 'openai-response-v2',
  aiConfidence: 0.8,
  aiRationale: null,
  intendedTone: 'FRIENDLY',
  toneProfile: {},
  revisionCount: 1,
  lastEditReason: 'Especificar os dias.',
  evaluation: null,
  analysisLabels: {},
  manualReplyAttemptId: '60000000-0000-4000-8000-000000000001',
  recordedAt: '2026-11-04T12:00:00.000Z',
};
const candidate = {
  pair,
  context: {
    status: 'AVAILABLE',
    comment,
    analysis,
    verifiedReleaseSchedule: null,
    sourceContextUpdatedAt: '2026-11-04T13:00:00.000Z',
  },
};
const evaluation = {
  relevance: 0.8,
  tone: 0.9,
  helpfulness: 0.8,
  factualRisk: 0.1,
  toxicityRisk: 0,
  hallucinationRisk: 0.1,
  publishRecommendation: 'APPROVE',
  confidence: 0.8,
  rationale: null,
  provider: 'JEV',
  model: 'test-model',
  schemaVersion: 'typesafe-systemone-v2',
  usage: { inputTokens: 10, outputTokens: 4 },
};
const classification = {
  editCategory: 'CLARITY',
  observedAiIssue: 'INCOMPLETE_ANSWER',
  confidence: 0.91,
  evidenceSources: ['COMMENT', 'AI_RESPONSE', 'FINAL_RESPONSE', 'CREATOR_EDIT_REASON'],
  provider: 'JEV',
  model: 'test-model',
  schemaVersion: 'response-edit-classification-v1',
  usage: { inputTokens: 15, outputTokens: 5 },
};

function createUseCase(overrides = {}) {
  const calls = [];
  const appended = [];
  const query = overrides.query ?? {
    listCandidates: async (...args) => {
      calls.push(['query', ...args]);
      return { items: [candidate], nextCursor: null };
    },
  };
  const evaluations = overrides.evaluations ?? { evaluate: async (input) => {
    calls.push(['evaluate', input]);
    return evaluation;
  } };
  const classifier = overrides.classifier ?? { classify: async (input) => {
    calls.push(['classify', input]);
    return classification;
  } };
  const repository = overrides.repository ?? {
    append: async (input) => {
      appended.push(input);
      return { id: `analysis-${appended.length}` };
    },
  };
  const tenant = overrides.tenant ?? { resolveTenantId: async () => tenantId };
  const ids = overrides.ids ?? { generate: () => '70000000-0000-4000-8000-000000000001' };
  return {
    calls,
    appended,
    useCase: new AnalyzeResponseRefinementPairs(query, repository, evaluations, classifier, tenant, ids, () => Date.parse(asOf)),
  };
}

test('AnalyzeResponseRefinementPairs requires explicit external-processing confirmation before querying', async () => {
  const { calls, useCase } = createUseCase();

  await assert.rejects(
    useCase.execute({ confirmExternalProcessing: false }),
    (error) => error.code === 'RESPONSE_REFINEMENT_CONSENT_REQUIRED',
  );

  assert.equal(calls.length, 0);
});

test('AnalyzeResponseRefinementPairs evaluates both exact texts against the same retained context and stores a structured result', async () => {
  const { calls, appended, useCase } = createUseCase();

  const result = await useCase.execute({ confirmExternalProcessing: true, limit: 10 });

  const evaluationCalls = calls.filter(([name]) => name === 'evaluate');
  assert.equal(evaluationCalls.length, 2);
  assert.deepEqual(evaluationCalls[0][1], {
    comment,
    analysis,
    responseText: pair.aiText,
  });
  assert.deepEqual(evaluationCalls[1][1], {
    comment,
    analysis,
    responseText: pair.finalText,
  });
  assert.equal(calls.filter(([name]) => name === 'classify').length, 1);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].analysisRequestId, '70000000-0000-4000-8000-000000000001');
  assert.equal(appended[0].status, 'SUCCEEDED');
  assert.deepEqual(appended[0].aiEvaluation, evaluation);
  assert.deepEqual(appended[0].finalEvaluation, evaluation);
  assert.deepEqual(appended[0].editClassification, classification);
  assert.deepEqual(appended[0].scoreDeltas, {
    relevance: 0,
    tone: 0,
    helpfulness: 0,
    factualRisk: 0,
    toxicityRisk: 0,
    hallucinationRisk: 0,
    scheduleConsistency: null,
    publishRecommendation: { ai: 'APPROVE', final: 'APPROVE' },
  });
  assert.equal(result.items[0].analysisId, 'analysis-1');
  assert.equal(JSON.stringify(result).includes(comment.text), false);
  assert.equal(JSON.stringify(result).includes(pair.aiText), false);
  assert.equal(JSON.stringify(result).includes('private-comment-id'), false);
});

test('AnalyzeResponseRefinementPairs records expired context as skipped without making provider calls', async () => {
  const expired = { ...candidate, context: { status: 'SOURCE_CONTEXT_EXPIRED' } };
  const { calls, appended, useCase } = createUseCase({
    query: { listCandidates: async () => ({ items: [expired], nextCursor: null }) },
  });

  const result = await useCase.execute({ confirmExternalProcessing: true });

  assert.equal(calls.length, 0);
  assert.equal(appended[0].status, 'SKIPPED');
  assert.equal(appended[0].skipReason, 'SOURCE_CONTEXT_EXPIRED');
  assert.equal(result.skippedCount, 1);
});

test('AnalyzeResponseRefinementPairs keeps successful capabilities when one JEV evaluation fails', async () => {
  let evaluationNumber = 0;
  const { appended, useCase } = createUseCase({
    evaluations: { evaluate: async () => {
      evaluationNumber += 1;
      if (evaluationNumber === 1) throw Object.assign(new Error('provider failure'), { code: 'INTELLIGENCE_PROVIDER_UNAVAILABLE' });
      return evaluation;
    } },
  });

  const result = await useCase.execute({ confirmExternalProcessing: true });

  assert.equal(appended[0].status, 'PARTIAL');
  assert.equal(appended[0].aiEvaluation, null);
  assert.deepEqual(appended[0].finalEvaluation, evaluation);
  assert.deepEqual(appended[0].capabilityErrors.aiEvaluation, 'INTELLIGENCE_PROVIDER_UNAVAILABLE');
  assert.equal(result.failedCount, 1);
});

test('AnalyzeResponseRefinementPairs rejects more than 25 pairs per request', async () => {
  const { calls, useCase } = createUseCase();

  await assert.rejects(
    useCase.execute({ confirmExternalProcessing: true, limit: 26 }),
    (error) => error.code === 'RESPONSE_REFINEMENT_ANALYSIS_REQUEST_INVALID',
  );
  assert.equal(calls.length, 0);
});

test('AnalyzeResponseRefinementPairs retries only a missing classification and reuses unchanged evaluations', async () => {
  const previousAnalysis = {
    id: 'prior-analysis-id',
    status: 'PARTIAL',
    aiEvaluation: evaluation,
    finalEvaluation: evaluation,
    editClassification: null,
    scoreDeltas: { relevance: 0, tone: 0, helpfulness: 0, factualRisk: 0, toxicityRisk: 0, hallucinationRisk: 0, scheduleConsistency: null, publishRecommendation: { ai: 'APPROVE', final: 'APPROVE' } },
    capabilityErrors: { editClassification: 'INTELLIGENCE_PROVIDER_REQUEST_FAILED' },
    recordedAt: asOf,
  };
  const { calls, appended, useCase } = createUseCase({
    query: {
      listCandidates: async () => ({ items: [], nextCursor: null }),
      listRetryCandidates: async () => ({ items: [{ ...candidate, previousAnalysis }] }),
    },
  });

  const result = await useCase.execute({
    confirmExternalProcessing: true,
    retryClassificationFromAnalysisRequestId: '70000000-0000-4000-8000-000000000002',
  });

  assert.equal(calls.filter(([name]) => name === 'evaluate').length, 0);
  assert.equal(calls.filter(([name]) => name === 'classify').length, 1);
  assert.equal(appended[0].sourceAnalysisId, 'prior-analysis-id');
  assert.deepEqual(appended[0].aiEvaluation, evaluation);
  assert.deepEqual(appended[0].finalEvaluation, evaluation);
  assert.equal(appended[0].status, 'SUCCEEDED');
  assert.equal(result.items[0].category, 'CLARITY');
});

test('AnalyzeResponseRefinementPairs does not reuse evaluations after source context changes', async () => {
  const previousAnalysis = {
    id: 'prior-analysis-id',
    status: 'PARTIAL',
    aiEvaluation: evaluation,
    finalEvaluation: evaluation,
    editClassification: null,
    scoreDeltas: null,
    capabilityErrors: { editClassification: 'INTELLIGENCE_PROVIDER_REQUEST_FAILED' },
    recordedAt: '2026-11-04T12:00:00.000Z',
  };
  const changedCandidate = {
    ...candidate,
    context: { ...candidate.context, sourceContextUpdatedAt: '2026-11-05T11:00:00.000Z' },
  };
  const { calls, appended, useCase } = createUseCase({
    query: {
      listCandidates: async () => ({ items: [], nextCursor: null }),
      listRetryCandidates: async () => ({ items: [{ ...changedCandidate, previousAnalysis }] }),
    },
  });

  const result = await useCase.execute({
    confirmExternalProcessing: true,
    retryClassificationFromAnalysisRequestId: '70000000-0000-4000-8000-000000000003',
  });

  assert.equal(calls.filter(([name]) => name === 'evaluate' || name === 'classify').length, 0);
  assert.equal(appended[0].status, 'SKIPPED');
  assert.equal(appended[0].skipReason, 'SOURCE_CONTEXT_CHANGED');
  assert.equal(result.skippedCount, 1);
});
