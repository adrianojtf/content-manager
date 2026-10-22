import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  RecordCommentAnalysis,
  CorrectCommentAnalysis,
  RecordResponseSuggestion,
  ReviseResponseSuggestion,
  RecordResponseEvaluation,
  RecordManualResponse,
  ReviseManualResponse,
  ListCommentWorkflow,
} = require('../../dist/application/social/comment-workflow-audit.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const commentId = 'comment-1';
const now = () => Date.parse('2026-10-13T12:00:00.000Z');
const analysis = {
  sentiment: 'POSITIVE',
  emotion: 'JOY',
  intent: 'REACTION',
  topic: 'CHARACTER',
  entity: 'JOAO',
  spamScore: 0.01,
  toxicityScore: 0.01,
  engagementValue: 0.82,
  continuationRequestProbability: 0.02,
  confidence: 0.94,
  rationale: 'A positive reaction about the character.',
  provider: 'JEV',
  model: 'test-model',
  schemaVersion: 'typesafe-systemone-v1',
  signals: {
    sentiment: { confidence: 0.94, probabilities: { POSITIVE: 0.94, NEUTRAL: 0.04, NEGATIVE: 0.02 } },
    emotion: { confidence: 0.91, probabilities: { JOY: 0.91, OTHER: 0.09 } },
    intent: { confidence: 0.9, probabilities: { REACTION: 0.9, OTHER: 0.1 } },
    topic: { confidence: 0.88, probabilities: { CHARACTER: 0.88, OTHER: 0.12 } },
    spam: { probability: 0.01 },
    toxicity: { probability: 0.01 },
    engagement: { rawScore: 3.28, normalizedScore: 0.82, confidence: 0.9, probabilities: { 0: 0.01, 1: 0.04, 2: 0.1, 3: 0.55, 4: 0.3 }, legend: { 0: 'low', 1: 'limited', 2: 'medium', 3: 'high', 4: 'very high' } },
    needsExternalFacts: { probability: 0.05 },
    requestsContinuation: { probability: 0.02 },
  },
  usage: { inputTokens: 128, outputTokens: 42 },
};

function createWorkflow(existingEvents = []) {
  const events = [...existingEvents];
  const repository = {
    append: async (event) => {
      const stored = { ...event, id: `event-${events.length + 1}`, expiresAt: '2026-11-12T12:00:00.000Z' };
      events.push(stored);
      return stored;
    },
    listByComment: async (scope, account, externalComment) => {
      assert.equal(scope, tenantId);
      assert.equal(account, accountId);
      assert.equal(externalComment, commentId);
      return events.filter((event) => event.tenantId === scope && event.socialAccountId === account && event.externalCommentId === externalComment);
    },
  };
  const pilotTenant = { resolveTenantId: async () => tenantId };
  const accounts = { findById: async (scope, id) => scope === tenantId && id === accountId ? { id, tenantId } : null };
  return {
    events,
    recordAnalysis: new RecordCommentAnalysis(repository, pilotTenant, now),
    correctAnalysis: new CorrectCommentAnalysis(repository, pilotTenant, now),
    recordSuggestion: new RecordResponseSuggestion(repository, pilotTenant, now),
    reviseSuggestion: new ReviseResponseSuggestion(repository, pilotTenant, now),
    recordResponseEvaluation: new RecordResponseEvaluation(repository, pilotTenant, now),
    recordManualResponse: new RecordManualResponse(repository, pilotTenant, now),
    reviseManualResponse: new ReviseManualResponse(repository, pilotTenant, now),
    listWorkflow: new ListCommentWorkflow(repository, accounts, pilotTenant, now),
  };
}

test('RecordCommentAnalysis preserves normalized TypeSafe evidence, usage, and provenance as an immutable AI event', async () => {
  const workflow = createWorkflow();

  const event = await workflow.recordAnalysis.execute({ accountId, externalCommentId: commentId, analysis });

  assert.equal(event.eventType, 'COMMENT_ANALYSIS_CREATED');
  assert.equal(event.actorSource, 'AI');
  assert.deepEqual(event.payload, analysis);
  assert.equal(event.recordedAt, '2026-10-13T12:00:00.000Z');
  assert.equal(event.expiresAt, '2026-11-12T12:00:00.000Z');
});

test('RecordCommentAnalysis rejects invalid model scores without changing a prior valid analysis', async () => {
  const workflow = createWorkflow();
  await workflow.recordAnalysis.execute({ accountId, externalCommentId: commentId, analysis });

  await assert.rejects(
    workflow.recordAnalysis.execute({ accountId, externalCommentId: commentId, analysis: { ...analysis, confidence: 1.5 } }),
    /COMMENT_ANALYSIS_INVALID/,
  );
  await assert.rejects(
    workflow.recordAnalysis.execute({
      accountId,
      externalCommentId: commentId,
      analysis: { ...analysis, signals: { ...analysis.signals, engagement: { ...analysis.signals.engagement, normalizedScore: 0.1 } } },
    }),
    /COMMENT_ANALYSIS_INVALID/,
  );
  await assert.rejects(
    workflow.recordAnalysis.execute({
      accountId,
      externalCommentId: commentId,
      analysis: { ...analysis, continuationRequestProbability: 1.1 },
    }),
    /COMMENT_ANALYSIS_INVALID/,
  );
  assert.equal(workflow.events.length, 1);
  assert.deepEqual(workflow.events[0].payload, analysis);
});

test('CorrectCommentAnalysis appends allowed human labels/scores without changing the JEV artifact', async () => {
  const original = {
    id: 'analysis-event-1',
    tenantId,
    socialAccountId: accountId,
    externalCommentId: commentId,
    eventType: 'COMMENT_ANALYSIS_CREATED',
    actorSource: 'AI',
    status: 'SUCCEEDED',
    operationId: null,
    batchOperationId: null,
    parentEventId: null,
    payload: analysis,
    recordedAt: '2026-10-13T11:00:00.000Z',
    expiresAt: '2026-11-12T12:00:00.000Z',
  };
  const workflow = createWorkflow([original]);
  const correction = await workflow.correctAnalysis.execute({
    accountId,
    externalCommentId: commentId,
    analysisEventId: original.id,
    correctedFields: { sentiment: 'NEGATIVE', spamScore: 0.8 },
    reason: 'Creator reviewed the context.',
  });

  assert.equal(correction.eventType, 'COMMENT_ANALYSIS_CORRECTED');
  assert.equal(correction.actorSource, 'CREATOR_LOCAL');
  assert.equal(correction.parentEventId, original.id);
  assert.deepEqual(correction.payload.correctedFields, { sentiment: 'NEGATIVE', spamScore: 0.8 });
  assert.deepEqual(original.payload, analysis);
});

test('CorrectCommentAnalysis rejects confidence/rationale edits and out-of-range scores', async () => {
  const original = {
    id: 'analysis-event-1', tenantId, socialAccountId: accountId, externalCommentId: commentId,
    eventType: 'COMMENT_ANALYSIS_CREATED', actorSource: 'AI', status: 'SUCCEEDED', operationId: null,
    batchOperationId: null, parentEventId: null, payload: analysis, recordedAt: '2026-10-13T11:00:00.000Z', expiresAt: '2026-11-12T12:00:00.000Z',
  };
  const workflow = createWorkflow([original]);

  await assert.rejects(workflow.correctAnalysis.execute({ accountId, externalCommentId: commentId, analysisEventId: original.id, correctedFields: { confidence: 0.2 } }), /COMMENT_ANALYSIS_CORRECTION_INVALID/);
  await assert.rejects(workflow.correctAnalysis.execute({ accountId, externalCommentId: commentId, analysisEventId: original.id, correctedFields: { toxicityScore: 1.2 } }), /COMMENT_ANALYSIS_CORRECTION_INVALID/);
  assert.equal(workflow.events.length, 1);
});

test('RecordResponseSuggestion and ReviseResponseSuggestion preserve generated and manual text as linked artifacts', async () => {
  const workflow = createWorkflow();
  const toneProfile = { primaryTone: 'PROFESSIONAL', modifiers: ['CONCISE'], customNote: 'Use clear language.' };
  const verifiedReleaseScheduleSnapshot = {
    status: 'ACTIVE',
    source: 'ACCOUNT',
    schedule: {
      enabled: true,
      daysOfWeek: ['MONDAY', 'WEDNESDAY'],
      localTime: '20:30',
      timeZone: 'America/Sao_Paulo',
      version: 2,
      updatedAt: '2026-10-13T12:00:00.000Z',
      confirmedAt: '2026-10-13T12:00:00.000Z',
    },
  };
  const generated = await workflow.recordSuggestion.execute({
    accountId,
    externalCommentId: commentId,
    suggestion: { text: 'AI response', language: 'pt-BR', intendedTone: 'FRIENDLY', provider: 'response-provider', model: 'model-v1', confidence: 0.88, rationale: 'Answers the question.' },
    toneProfile,
    verifiedReleaseScheduleSnapshot,
  });
  const edited = await workflow.reviseSuggestion.execute({
    accountId,
    externalCommentId: commentId,
    suggestionEventId: generated.id,
    text: 'Creator-edited response',
    reason: 'Adjusted the tone.',
  });

  assert.equal(generated.eventType, 'RESPONSE_SUGGESTION_GENERATED');
  assert.equal(generated.actorSource, 'GENERATOR');
  assert.equal(edited.eventType, 'RESPONSE_SUGGESTION_EDITED');
  assert.equal(edited.actorSource, 'CREATOR_LOCAL');
  assert.equal(edited.parentEventId, generated.id);
  assert.equal(edited.payload.originalSuggestionEventId, generated.id);
  assert.equal(edited.payload.text, 'Creator-edited response');
  assert.equal(generated.payload.text, 'AI response');
  assert.deepEqual(generated.payload.toneProfile, toneProfile);
  assert.deepEqual(generated.payload.verifiedReleaseScheduleSnapshot, verifiedReleaseScheduleSnapshot);
});

test('creator-authored responses can start without comment analysis and edits preserve each manual version', async () => {
  const workflow = createWorkflow();
  const authored = await workflow.recordManualResponse.execute({ accountId, externalCommentId: commentId, text: 'Resposta escrita pela criadora.' });
  const edited = await workflow.reviseManualResponse.execute({ accountId, externalCommentId: commentId, responseEventId: authored.id, text: 'Resposta manual revisada.' });

  assert.equal(authored.eventType, 'MANUAL_RESPONSE_CREATED');
  assert.equal(authored.actorSource, 'CREATOR_LOCAL');
  assert.equal(authored.parentEventId, null);
  assert.equal(authored.payload.text, 'Resposta escrita pela criadora.');
  assert.equal(edited.eventType, 'MANUAL_RESPONSE_EDITED');
  assert.equal(edited.parentEventId, authored.id);
  assert.equal(edited.payload.originalManualResponseEventId, authored.id);
  assert.equal(edited.payload.text, 'Resposta manual revisada.');
  assert.equal(workflow.events.some((event) => event.eventType === 'COMMENT_ANALYSIS_CREATED'), false);
});

test('ReviseResponseSuggestion only accepts an AI suggestion from the same comment', async () => {
  const other = {
    id: 'other-event', tenantId, socialAccountId: accountId, externalCommentId: 'other-comment',
    eventType: 'RESPONSE_SUGGESTION_GENERATED', actorSource: 'GENERATOR', status: 'SUCCEEDED', operationId: null,
    batchOperationId: null, parentEventId: null, payload: { text: 'AI response' }, recordedAt: '2026-10-13T11:00:00.000Z', expiresAt: '2026-11-12T12:00:00.000Z',
  };
  const workflow = createWorkflow([other]);

  await assert.rejects(workflow.reviseSuggestion.execute({ accountId, externalCommentId: commentId, suggestionEventId: other.id, text: 'Edited text' }), /RESPONSE_SUGGESTION_NOT_FOUND/);
  assert.equal(workflow.events.length, 1);
});

test('RecordResponseEvaluation binds immutable output to the exact current revision and rejects evaluation after an edit', async () => {
  const workflow = createWorkflow();
  const generated = await workflow.recordSuggestion.execute({ accountId, externalCommentId: commentId, suggestion: { text: 'Generated', language: 'pt-BR', intendedTone: 'FRIENDLY', provider: 'generator', model: 'model', confidence: 0.8, rationale: null } });
  const edited = await workflow.reviseSuggestion.execute({ accountId, externalCommentId: commentId, suggestionEventId: generated.id, text: 'Final text' });
  const evaluation = {
    relevance: 0.9, tone: 0.95, helpfulness: 0.9, factualRisk: 0.1, toxicityRisk: 0.05, hallucinationRisk: 0.1,
    publishRecommendation: 'APPROVE', confidence: 0.9, rationale: null, provider: 'JEV', model: 'jev-1.14.0',
    schemaVersion: 'typesafe-systemone-v1',
    signals: {
      relevance: { rawScore: 3.6, normalizedScore: 0.9, confidence: 0.9, probabilities: { 0: 0.01, 1: 0.04, 2: 0.1, 3: 0.55, 4: 0.3 }, legend: { 0: 'low', 1: 'limited', 2: 'medium', 3: 'high', 4: 'very high' } },
      tone: { rawScore: 3.8, normalizedScore: 0.95, confidence: 0.95, probabilities: { 0: 0.01, 1: 0.02, 2: 0.02, 3: 0.2, 4: 0.75 }, legend: { 0: 'low', 1: 'limited', 2: 'medium', 3: 'high', 4: 'very high' } },
      helpfulness: { rawScore: 3.6, normalizedScore: 0.9, confidence: 0.9, probabilities: { 0: 0.01, 1: 0.04, 2: 0.1, 3: 0.55, 4: 0.3 }, legend: { 0: 'low', 1: 'limited', 2: 'medium', 3: 'high', 4: 'very high' } },
      factualRisk: { probability: 0.1 },
      toxicityRisk: { probability: 0.05 },
      hallucinationRisk: { probability: 0.1 },
      publishRecommendation: { confidence: 0.9, probabilities: { APPROVE: 0.9, REVIEW: 0.08, REJECT: 0.02 } },
    },
    usage: { inputTokens: 132, outputTokens: 48 },
  };

  const verifiedReleaseScheduleSnapshot = { status: 'UNCONFIGURED', schedule: null };
  const recorded = await workflow.recordResponseEvaluation.execute({
    accountId,
    externalCommentId: commentId,
    revisionEventId: edited.id,
    evaluation,
    verifiedReleaseScheduleSnapshot,
  });
  assert.equal(recorded.eventType, 'RESPONSE_EVALUATED');
  assert.equal(recorded.parentEventId, edited.id);
  assert.equal(recorded.payload.revisionEventId, edited.id);
  assert.deepEqual(recorded.payload.evaluation, evaluation);
  assert.deepEqual(recorded.payload.verifiedReleaseScheduleSnapshot, verifiedReleaseScheduleSnapshot);

  const nextRevision = await workflow.reviseSuggestion.execute({ accountId, externalCommentId: commentId, suggestionEventId: generated.id, previousRevisionId: edited.id, text: 'Changed again' });
  await assert.rejects(workflow.recordResponseEvaluation.execute({ accountId, externalCommentId: commentId, revisionEventId: edited.id, evaluation }), /RESPONSE_EVALUATION_REVISION_STALE/);
  assert.equal(nextRevision.payload.text, 'Changed again');
  assert.equal(workflow.events.filter((event) => event.eventType === 'RESPONSE_EVALUATED').length, 1);
});

test('RecordResponseEvaluation rejects invalid risk output without appending an event', async () => {
  const workflow = createWorkflow();
  const generated = await workflow.recordSuggestion.execute({ accountId, externalCommentId: commentId, suggestion: { text: 'Generated', language: 'pt-BR', intendedTone: 'FRIENDLY', provider: 'generator', model: 'model', confidence: 0.8, rationale: null } });
  const invalid = { relevance: 0.9, tone: 0.95, helpfulness: 0.9, factualRisk: 1.1, toxicityRisk: 0, hallucinationRisk: 0, publishRecommendation: 'APPROVE', confidence: 0.9, rationale: null, provider: 'JEV', model: 'test-model', schemaVersion: '1' };
  await assert.rejects(workflow.recordResponseEvaluation.execute({ accountId, externalCommentId: commentId, revisionEventId: generated.id, evaluation: invalid }), /RESPONSE_EVALUATION_INVALID/);
  assert.equal(workflow.events.some((event) => event.eventType === 'RESPONSE_EVALUATED'), false);
});

test('RecordResponseEvaluation rejects an out-of-range schedule consistency probability', async () => {
  const workflow = createWorkflow();
  const generated = await workflow.recordSuggestion.execute({
    accountId,
    externalCommentId: commentId,
    suggestion: { text: 'Generated', language: 'en-US', intendedTone: 'FRIENDLY', provider: 'generator', model: 'model', confidence: 0.8, rationale: null },
  });
  const invalid = {
    relevance: 0.9,
    tone: 0.9,
    helpfulness: 0.9,
    factualRisk: 0.1,
    toxicityRisk: 0.1,
    hallucinationRisk: 0.1,
    scheduleConsistency: 1.1,
    publishRecommendation: 'REVIEW',
    confidence: 0.9,
    rationale: null,
    provider: 'JEV',
    model: 'jev-1.14.0',
    schemaVersion: 'typesafe-systemone-v2',
  };

  await assert.rejects(
    workflow.recordResponseEvaluation.execute({
      accountId,
      externalCommentId: commentId,
      revisionEventId: generated.id,
      evaluation: invalid,
    }),
    /RESPONSE_EVALUATION_INVALID/,
  );
  assert.equal(workflow.events.some((event) => event.eventType === 'RESPONSE_EVALUATED'), false);
});

test('RecordResponseEvaluation preserves matching Noul evidence only with the active schedule snapshot', async () => {
  const workflow = createWorkflow();
  const generated = await workflow.recordSuggestion.execute({
    accountId,
    externalCommentId: commentId,
    suggestion: { text: 'Generated', language: 'en-US', intendedTone: 'FRIENDLY', provider: 'generator', model: 'model', confidence: 0.8, rationale: null },
  });
  const scoreSignal = {
    rawScore: 4,
    normalizedScore: 1,
    confidence: 1,
    probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 },
    legend: { 0: 'low', 1: 'limited', 2: 'medium', 3: 'high', 4: 'very high' },
  };
  const evaluation = {
    relevance: 1,
    tone: 1,
    helpfulness: 1,
    factualRisk: 0,
    toxicityRisk: 0,
    hallucinationRisk: 0,
    scheduleConsistency: 0.8,
    publishRecommendation: 'APPROVE',
    confidence: 1,
    rationale: null,
    provider: 'JEV',
    model: 'jev-1.14.0',
    schemaVersion: 'typesafe-systemone-v2',
    signals: {
      relevance: scoreSignal,
      tone: scoreSignal,
      helpfulness: scoreSignal,
      factualRisk: { probability: 0 },
      toxicityRisk: { probability: 0 },
      hallucinationRisk: { probability: 0 },
      scheduleConsistency: { probability: 0.8 },
      publishRecommendation: { confidence: 1, probabilities: { APPROVE: 1 } },
    },
  };
  const verifiedReleaseScheduleSnapshot = {
    status: 'ACTIVE',
    source: 'TENANT',
    schedule: {
      enabled: true,
      daysOfWeek: ['WEDNESDAY'],
      localTime: '20:30',
      timeZone: 'America/Sao_Paulo',
      version: 3,
      updatedAt: '2026-10-13T12:00:00.000Z',
      confirmedAt: '2026-10-13T12:00:00.000Z',
    },
  };

  const recorded = await workflow.recordResponseEvaluation.execute({
    accountId,
    externalCommentId: commentId,
    revisionEventId: generated.id,
    evaluation,
    verifiedReleaseScheduleSnapshot,
  });

  assert.deepEqual(recorded.payload.evaluation.signals.scheduleConsistency, { probability: 0.8 });
  assert.deepEqual(recorded.payload.verifiedReleaseScheduleSnapshot, verifiedReleaseScheduleSnapshot);

  await assert.rejects(
    workflow.recordResponseEvaluation.execute({
      accountId,
      externalCommentId: commentId,
      revisionEventId: generated.id,
      evaluation,
    }),
    /RESPONSE_EVALUATION_INVALID/,
  );
  await assert.rejects(
    workflow.recordResponseEvaluation.execute({
      accountId,
      externalCommentId: commentId,
      revisionEventId: generated.id,
      evaluation: { ...evaluation, scheduleConsistency: 0.7 },
      verifiedReleaseScheduleSnapshot,
    }),
    /RESPONSE_EVALUATION_INVALID/,
  );
});

test('RecordResponseEvaluation rejects invalid per-question signal evidence', async () => {
  const workflow = createWorkflow();
  const generated = await workflow.recordSuggestion.execute({ accountId, externalCommentId: commentId, suggestion: { text: 'Generated', language: 'pt-BR', intendedTone: 'FRIENDLY', provider: 'generator', model: 'model', confidence: 0.8, rationale: null } });
  const invalid = {
    relevance: 0.9, tone: 0.95, helpfulness: 0.9, factualRisk: 0.1, toxicityRisk: 0.05, hallucinationRisk: 0.1,
    publishRecommendation: 'APPROVE', confidence: 0.9, rationale: null, provider: 'JEV', model: 'jev-1.14.0', schemaVersion: 'typesafe-systemone-v1',
    signals: {
      relevance: { rawScore: 4, normalizedScore: 0.2, confidence: 0.9, probabilities: { 0: 1 }, legend: { 0: 'highest' } },
      tone: { rawScore: 4, normalizedScore: 1, confidence: 0.9, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 }, legend: { 0: 'low', 1: 'limited', 2: 'medium', 3: 'high', 4: 'very high' } },
      helpfulness: { rawScore: 4, normalizedScore: 1, confidence: 0.9, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 }, legend: { 0: 'low', 1: 'limited', 2: 'medium', 3: 'high', 4: 'very high' } },
      factualRisk: { probability: 0.1 }, toxicityRisk: { probability: 0.05 }, hallucinationRisk: { probability: 0.1 },
      publishRecommendation: { confidence: 0.9, probabilities: { APPROVE: 1 } },
    },
  };

  await assert.rejects(
    workflow.recordResponseEvaluation.execute({ accountId, externalCommentId: commentId, revisionEventId: generated.id, evaluation: invalid }),
    /RESPONSE_EVALUATION_INVALID/,
  );
  assert.equal(workflow.events.some((event) => event.eventType === 'RESPONSE_EVALUATED'), false);
});

test('ListCommentWorkflow returns the server-scoped ordered audit timeline', async () => {
  const event = { id: 'event-1', tenantId, socialAccountId: accountId, externalCommentId: commentId, eventType: 'COMMENT_ANALYSIS_CREATED', actorSource: 'AI', status: 'SUCCEEDED', operationId: null, batchOperationId: 'batch-1', parentEventId: null, payload: analysis, recordedAt: '2026-10-13T11:00:00.000Z', expiresAt: '2026-11-12T12:00:00.000Z' };
  const workflow = createWorkflow([event]);

  assert.deepEqual(await workflow.listWorkflow.execute({ accountId, externalCommentId: commentId }), [event]);
});
