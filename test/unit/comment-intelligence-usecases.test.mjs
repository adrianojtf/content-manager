import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { EvaluateComment, EvaluateResponseSuggestion, GenerateCommentResponseSuggestion } = require('../../dist/application/social/comment-intelligence.usecases.js');
const { SendManualCommentReply } = require('../../dist/application/social/send-manual-comment-reply.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');
const { IntelligenceProviderError } = require('../../dist/application/social/intelligence-provider-error.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001');
const account = SocialAccount.create({ id: accountId, tenantId, platform: 'youtube', externalAccountId: 'UC-channel', displayName: 'Creator', credentialReference: 'opaque-reference' });
const comment = {
  platform: 'youtube', socialAccountId: accountId, externalCommentId: 'comment-1', externalThreadId: 'thread-1',
  externalPublicationId: 'video-1', authorDisplayName: 'Viewer', text: 'Qual é o nome da música?',
  createdAt: '2026-10-13T12:00:00.000Z', canReply: true,
  lastSyncedAt: '2026-10-13T12:00:00.000Z', expiresAt: '2026-11-12T12:00:00.000Z',
};
const analysis = {
  sentiment: 'NEUTRAL', emotion: 'CURIOSITY', intent: 'QUESTION', topic: 'MUSIC', entity: null,
  spamScore: 0, toxicityScore: 0, engagementValue: 0.5, continuationRequestProbability: 0.4, confidence: 0.92, rationale: 'Direct question.',
  provider: 'JEV', model: 'jev-model', schemaVersion: '1',
  signals: {
    sentiment: { confidence: 0.92, probabilities: { NEUTRAL: 0.92, POSITIVE: 0.05, NEGATIVE: 0.03 } },
    emotion: { confidence: 0.9, probabilities: { CURIOSITY: 0.9, OTHER: 0.1 } },
    intent: { confidence: 0.91, probabilities: { QUESTION: 0.91, OTHER: 0.09 } },
    topic: { confidence: 0.85, probabilities: { MUSIC: 0.85, OTHER: 0.15 } },
    spam: { probability: 0 },
    toxicity: { probability: 0 },
    engagement: {
      rawScore: 2,
      normalizedScore: 0.5,
      confidence: 0.88,
      probabilities: { 0: 0.05, 1: 0.15, 2: 0.6, 3: 0.15, 4: 0.05 },
      legend: { 0: 'low', 1: 'limited', 2: 'medium', 3: 'high', 4: 'very high' },
    },
    needsExternalFacts: { probability: 0.76 },
    requestsContinuation: { probability: 0.4 },
  },
  usage: { inputTokens: 120, outputTokens: 24 },
};
const now = () => Date.parse('2026-10-14T12:00:00.000Z');
const generatedSuggestion = { text: 'A canção é X.', language: 'pt-BR', intendedTone: 'FRIENDLY', confidence: 0.8, rationale: 'Answers the question.', provider: 'GEMINI', model: 'gemini-3.5-flash-lite' };

function createUseCases({ commentFound = comment, accountFound = account, evaluation = analysis, suggestion = generatedSuggestion, events = [], toneProfile = null, tenantToneProfile = null, schedule = null, tenantSchedule = null } = {}) {
  const calls = [];
  const accounts = { findById: async (...args) => { calls.push(['findAccount', ...args]); return accountFound; } };
  const comments = { findByExternalCommentId: async (...args) => { calls.push(['findComment', ...args]); return commentFound; } };
  const evaluator = { evaluate: async (input) => { calls.push(['evaluate', input]); if (evaluation instanceof Error) throw evaluation; return evaluation; } };
  const generator = { generate: async (input) => {
    calls.push(['generate', input]);
    const output = typeof suggestion === 'function'
      ? suggestion(input)
      : suggestion instanceof Error
        ? suggestion
        : { ...suggestion, language: input.language };
    if (output instanceof Error) throw output;
    return output;
  } };
  const recordAnalysis = { execute: async (input) => { calls.push(['recordAnalysis', input]); return { id: 'analysis-event-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: input.analysis }; } };
  const recordSuggestion = { execute: async (input) => { calls.push(['recordSuggestion', input]); return { id: 'suggestion-event-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', payload: input.suggestion }; } };
  const workflowEvents = {
    listByComment: async (scope, socialId, externalId) => {
      calls.push(['listEvents', scope, socialId, externalId]);
      return events;
    },
    append: async (input) => { calls.push(['appendEvent', input]); return { ...input, id: `failure-event-${calls.length}`, expiresAt: comment.expiresAt }; },
  };
  const tenant = { resolveTenantId: async () => tenantId };
  const toneSettings = { get: async (...args) => { calls.push(['getToneProfile', ...args]); return toneProfile; } };
  const tenantToneSettings = { get: async (...args) => { calls.push(['getTenantToneProfile', ...args]); return tenantToneProfile; } };
  const scheduleSettings = { get: async (...args) => { calls.push(['getSchedule', ...args]); return schedule; } };
  const tenantScheduleSettings = { get: async (...args) => { calls.push(['getTenantSchedule', ...args]); return tenantSchedule; } };
  return {
    calls,
    evaluateComment: new EvaluateComment(accounts, comments, evaluator, recordAnalysis, workflowEvents, tenant, now),
    generateResponse: new GenerateCommentResponseSuggestion(accounts, comments, generator, recordSuggestion, workflowEvents, tenant, toneSettings, tenantToneSettings, scheduleSettings, tenantScheduleSettings, now),
  };
}

test('EvaluateComment loads tenant-scoped comment, calls JEV only on manual request, and records the validated immutable output', async () => {
  const useCases = createUseCases();

  const result = await useCases.evaluateComment.execute({ accountId, externalCommentId: comment.externalCommentId, batchOperationId: '60000000-0000-4000-8000-000000000001' });

  assert.equal(result.id, 'analysis-event-1');
  assert.deepEqual(useCases.calls.find(([name]) => name === 'evaluate')[1], { comment });
  assert.deepEqual(useCases.calls.find(([name]) => name === 'recordAnalysis')[1], {
    accountId, externalCommentId: 'comment-1', analysis, batchOperationId: '60000000-0000-4000-8000-000000000001',
  });
  assert.equal(JSON.stringify(useCases.calls).includes('opaque-reference'), false);
});

test('EvaluateComment logs provider failure per comment without replacing prior analysis', async () => {
  const useCases = createUseCases({ evaluation: new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RATE_LIMITED') });

  await assert.rejects(
    useCases.evaluateComment.execute({ accountId, externalCommentId: comment.externalCommentId }),
    (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_RATE_LIMITED',
  );
  assert.equal(useCases.calls.some(([name]) => name === 'recordAnalysis'), false);
  const failure = useCases.calls.find(([name]) => name === 'appendEvent')[1];
  assert.equal(failure.eventType, 'COMMENT_CLASSIFIED');
  assert.equal(failure.status, 'FAILED');
  assert.deepEqual(failure.payload, { errorCode: 'INTELLIGENCE_PROVIDER_RATE_LIMITED' });
});

test('EvaluateComment refuses missing/empty comment inputs before invoking JEV', async () => {
  const missing = createUseCases({ commentFound: null });
  await assert.rejects(missing.evaluateComment.execute({ accountId, externalCommentId: comment.externalCommentId }), /COMMENT_NOT_FOUND/);
  assert.equal(missing.calls.some(([name]) => name === 'evaluate'), false);

  const empty = createUseCases({ commentFound: { ...comment, text: null } });
  await assert.rejects(empty.evaluateComment.execute({ accountId, externalCommentId: comment.externalCommentId }), /SOCIAL_COMMENT_TEXT_UNAVAILABLE/);
  assert.equal(empty.calls.some(([name]) => name === 'evaluate'), false);
});

test('GenerateCommentResponseSuggestion creates separately audited variants in all supported languages', async () => {
  const firstAnalysis = { id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis };
  const correction = { id: 'correction-1', eventType: 'COMMENT_ANALYSIS_CORRECTED', parentEventId: 'analysis-1', payload: { correctedFields: { sentiment: 'POSITIVE', engagementValue: 0.9 } } };
  const useCases = createUseCases({
    events: [firstAnalysis, correction],
    suggestion: (input) => ({ ...generatedSuggestion, text: `Reply in ${input.language}`, language: input.language }),
  });

  const result = await useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId, analysisEventId: 'analysis-1' });

  assert.deepEqual(result.variants.map((event) => event.payload.language), ['pt-BR', 'en-US', 'es-ES']);
  assert.deepEqual(useCases.calls.filter(([name]) => name === 'generate').map(([, input]) => input.language), ['pt-BR', 'en-US', 'es-ES']);
  assert.equal(useCases.calls.filter(([name]) => name === 'recordSuggestion').length, 3);
  assert.ok(useCases.calls.filter(([name]) => name === 'generate').every(([, input]) => (
      input.analysis.sentiment === 'POSITIVE'
      && input.analysis.signals.sentiment.probabilities.NEUTRAL === 0.92
      && input.analysis.continuationRequestProbability === 0.4
      && input.analysis.signals.requestsContinuation.probability === 0.4
      && input.analysis.usage.inputTokens === 120
      && input.toneProfile.primaryTone === 'FRIENDLY'
  )));
  assert.deepEqual(result.failures, []);
});

test('GenerateCommentResponseSuggestion keeps successful language variants when one provider call fails', async () => {
  const useCases = createUseCases({
    events: [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }],
    suggestion: (input) => input.language === 'en-US'
      ? new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RATE_LIMITED')
      : { ...generatedSuggestion, language: input.language },
  });

  const result = await useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId });

  assert.deepEqual(result.variants.map((event) => event.payload.language), ['pt-BR', 'es-ES']);
  assert.deepEqual(result.failures, [{ language: 'en-US', errorCode: 'INTELLIGENCE_PROVIDER_RATE_LIMITED' }]);
  assert.equal(useCases.calls.filter(([name]) => name === 'generate').length, 3);
  const failedEvent = useCases.calls.find(([name, event]) => name === 'appendEvent' && event.status === 'FAILED')[1];
  assert.equal(failedEvent.payload.language, 'en-US');
});

test('GenerateCommentResponseSuggestion uses the connected account tone profile and snapshots it in audit data', async () => {
  const toneProfile = { primaryTone: 'EMPATHETIC', modifiers: ['CONCISE', 'WARM'], customNote: 'Avoid slang.' };
  const useCases = createUseCases({ toneProfile, events: [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }] });

  await useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId });

  assert.deepEqual(useCases.calls.find(([name]) => name === 'getToneProfile'), ['getToneProfile', tenantId, accountId]);
  assert.deepEqual(useCases.calls.find(([name]) => name === 'generate')[1].toneProfile, toneProfile);
  assert.deepEqual(useCases.calls.find(([name]) => name === 'recordSuggestion')[1].toneProfile, toneProfile);
});

test('GenerateCommentResponseSuggestion uses and audits a validated one-time tone override without changing account settings', async () => {
  const accountTone = { primaryTone: 'PROFESSIONAL', modifiers: ['CONCISE'], customNote: 'Avoid promises.' };
  const toneProfile = { ...accountTone, primaryTone: 'CASUAL' };
  const useCases = createUseCases({
    toneProfile: accountTone,
    events: [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }],
  });

  await useCases.generateResponse.execute({
    accountId,
    externalCommentId: comment.externalCommentId,
    toneOverride: 'CASUAL',
  });

  assert.deepEqual(useCases.calls.find(([name]) => name === 'getToneProfile'), ['getToneProfile', tenantId, accountId]);
  assert.ok(useCases.calls.filter(([name]) => name === 'generate').every(([, input]) => input.toneProfile.primaryTone === 'CASUAL'));
  assert.ok(useCases.calls.filter(([name]) => name === 'recordSuggestion').every(([, input]) => input.toneProfile.primaryTone === 'CASUAL'));
  assert.ok(useCases.calls.filter(([name]) => name === 'recordSuggestion').every(([, input]) => JSON.stringify(input.toneProfile.modifiers) === JSON.stringify(accountTone.modifiers)));
  assert.ok(useCases.calls.filter(([name]) => name === 'recordSuggestion').every(([, input]) => input.toneProfile.customNote === accountTone.customNote));
});

test('GenerateCommentResponseSuggestion rejects an invalid one-time tone override before calling the generator', async () => {
  const useCases = createUseCases({ events: [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }] });

  await assert.rejects(
    useCases.generateResponse.execute({
      accountId,
      externalCommentId: comment.externalCommentId,
      toneOverride: 'LOUD',
    }),
    /RESPONSE_SUGGESTION_INVALID/,
  );

  assert.equal(useCases.calls.some(([name]) => name === 'generate'), false);
  assert.equal(useCases.calls.some(([name]) => name === 'appendEvent'), false);
});

test('GenerateCommentResponseSuggestion preserves high-risk analysis as advisory context for an explicit request', async () => {
  const highRiskAnalysis = { ...analysis, spamScore: 0.95, toxicityScore: 0.9 };
  const useCases = createUseCases({
    events: [{ id: 'analysis-high-risk', eventType: 'COMMENT_ANALYSIS_CREATED', payload: highRiskAnalysis }],
  });

  const result = await useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId });

  const generatorCall = useCases.calls.find(([name]) => name === 'generate');
  assert.deepEqual(generatorCall[1].analysis, highRiskAnalysis);
  assert.equal(result.variants.length, 3);
});

test('GenerateCommentResponseSuggestion requires prior JEV analysis before generating any language', async () => {
  const withoutAnalysis = createUseCases();
  await assert.rejects(withoutAnalysis.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId }), /COMMENT_ANALYSIS_NOT_FOUND/);
  assert.equal(withoutAnalysis.calls.some(([name]) => name === 'generate'), false);
});

test('EvaluateResponseSuggestion evaluates exact saved final text and records result linked to revision', async () => {
  const revision = { id: 'revision-1', eventType: 'RESPONSE_SUGGESTION_EDITED', payload: { originalSuggestionEventId: 'suggestion-1', text: 'Exact final response' } };
  const events = [
    { id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis },
    { id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', payload: { language: 'pt-BR', text: 'Generated response' } },
    revision,
  ];
  const calls = [];
  const evaluation = { relevance: 0.9, tone: 0.95, helpfulness: 0.9, factualRisk: 0, toxicityRisk: 0, hallucinationRisk: 0, publishRecommendation: 'APPROVE', confidence: 0.9, rationale: null, provider: 'JEV', model: 'test-model', schemaVersion: '1' };
  const useCase = new EvaluateResponseSuggestion(
    { findById: async () => account },
    { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} },
    { evaluate: async (input) => { calls.push(['evaluate', input]); return evaluation; } },
    { execute: async (input) => { calls.push(['record', input]); return { id: 'evaluation-1', parentEventId: input.revisionEventId }; } },
    { listByComment: async () => events, append: async (input) => { events.push(input); return input; } },
    { resolveTenantId: async () => tenantId }, { get: async () => null }, { get: async () => null }, now,
  );

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id });

  assert.deepEqual(calls[0], ['evaluate', { comment, analysis, responseText: 'Exact final response' }]);
  assert.equal(calls[1][1].revisionEventId, revision.id);
  assert.deepEqual(calls[1][1].evaluation, evaluation);
  assert.equal(result.id, 'evaluation-1');
});

test('EvaluateResponseSuggestion accepts the selected language variant when another language was generated later', async () => {
  const selectedVariant = { id: 'suggestion-pt', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { language: 'pt-BR', text: 'Resposta em português.' } };
  const events = [
    { id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis },
    selectedVariant,
    { id: 'suggestion-en', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { language: 'en-US', text: 'English reply.' } },
    { id: 'suggestion-es', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { language: 'es-ES', text: 'Respuesta en español.' } },
  ];
  const calls = [];
  const evaluation = { publishRecommendation: 'REVIEW' };
  const useCase = new EvaluateResponseSuggestion(
    { findById: async () => account },
    { findByExternalCommentId: async () => comment },
    { evaluate: async (input) => { calls.push(['evaluate', input]); return evaluation; } },
    { execute: async (input) => { calls.push(['record', input]); return { id: 'evaluation-pt', parentEventId: input.revisionEventId }; } },
    { listByComment: async () => events, append: async () => { throw new Error('unexpected failure event'); } },
    { resolveTenantId: async () => tenantId }, { get: async () => null }, { get: async () => null }, now,
  );

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: selectedVariant.id });

  assert.deepEqual(calls[0], ['evaluate', { comment, analysis, responseText: selectedVariant.payload.text }]);
  assert.equal(calls[1][1].revisionEventId, selectedVariant.id);
  assert.equal(result.id, 'evaluation-pt');
});

test('EvaluateResponseSuggestion can evaluate a creator-authored response after manual comment analysis', async () => {
  const manualResponse = { id: 'manual-response-1', eventType: 'MANUAL_RESPONSE_CREATED', payload: { text: 'Resposta escrita pela criadora.' } };
  const events = [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }, manualResponse];
  let evaluated;
  const evaluation = { relevance: 0.9, tone: 0.9, helpfulness: 0.9, factualRisk: 0, toxicityRisk: 0, hallucinationRisk: 0, publishRecommendation: 'REJECT', confidence: 0.9, rationale: 'Advisory result.', provider: 'JEV', model: 'test-model', schemaVersion: '1' };
  const useCase = new EvaluateResponseSuggestion(
    { findById: async () => account },
    { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} },
    { evaluate: async (input) => { evaluated = input; return evaluation; } },
    { execute: async (input) => ({ id: 'evaluation-1', parentEventId: input.revisionEventId, eventType: 'RESPONSE_EVALUATED' }) },
    { listByComment: async () => events, append: async () => { throw new Error('unexpected failure event'); } },
    { resolveTenantId: async () => tenantId }, { get: async () => null }, { get: async () => null }, now,
  );

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: manualResponse.id });

  assert.deepEqual(evaluated, { comment, analysis, responseText: manualResponse.payload.text });
  assert.equal(result.parentEventId, manualResponse.id);
});

test('SendManualCommentReply persists an attempt before dispatch and records the external result for the evaluated final revision', async () => {
  const revision = { id: 'revision-1', eventType: 'RESPONSE_SUGGESTION_EDITED', parentEventId: 'suggestion-1', payload: { originalSuggestionEventId: 'suggestion-1', text: 'Final exact text' } };
  const evaluation = { id: 'evaluation-1', eventType: 'RESPONSE_EVALUATED', parentEventId: revision.id, status: 'SUCCEEDED', payload: { revisionEventId: revision.id, evaluation: { publishRecommendation: 'APPROVE' } } };
  const events = [
    { id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', payload: { text: 'Generated text' } },
    revision,
    evaluation,
  ];
  const calls = [];
  const workflowEvents = {
    listByComment: async () => events,
    append: async (input) => { calls.push(['append', input]); const event = { ...input, id: `event-${calls.length}`, expiresAt: comment.expiresAt }; events.push(event); return event; },
  };
  const responder = { reply: async (_account, _comment, text) => { calls.push(['reply', text]); return { platform: 'youtube', externalReplyId: 'reply-1' }; } };
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, responder, workflowEvents, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000001' }, { execute: async () => false }, now);

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id });

  assert.equal(calls[0][0], 'append');
  assert.equal(calls[0][1].eventType, 'MANUAL_REPLY_ATTEMPTED');
  assert.equal(calls[0][1].payload.revisionEventId, revision.id);
  assert.equal(calls[1][0], 'reply');
  assert.equal(calls[1][1], 'Final exact text');
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(calls[2][1].eventType, 'MANUAL_REPLY_RESULT');
  assert.equal(calls[2][1].payload.externalReplyId, 'reply-1');
});

test('SendManualCommentReply sends the selected generated language variant without requiring another variant to be latest', async () => {
  const selectedVariant = { id: 'suggestion-pt', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { language: 'pt-BR', text: 'Resposta em português.' } };
  const events = [
    selectedVariant,
    { id: 'suggestion-en', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { language: 'en-US', text: 'English reply.' } },
    { id: 'suggestion-es', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { language: 'es-ES', text: 'Respuesta en español.' } },
  ];
  const attempts = [];
  const sentTexts = [];
  const eventRepository = {
    listByComment: async () => events,
    append: async (input) => {
      const stored = { ...input, id: `event-${attempts.length + 1}`, expiresAt: comment.expiresAt };
      attempts.push(stored);
      events.push(stored);
      return stored;
    },
  };
  const useCase = new SendManualCommentReply(
    { findById: async () => account },
    { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} },
    { reply: async (_account, _comment, text) => { sentTexts.push(text); return { platform: 'youtube', externalReplyId: 'reply-pt' }; } },
    eventRepository,
    { resolveTenantId: async () => tenantId },
    { generate: () => '60000000-0000-4000-8000-000000000006' },
    { execute: async () => false },
    now,
  );

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: selectedVariant.id });

  assert.equal(result.status, 'SUCCEEDED');
  assert.deepEqual(sentTexts, [selectedVariant.payload.text]);
  assert.equal(attempts[0].payload.responseVersionEventId, selectedVariant.id);

  events.push({ id: 'suggestion-pt-new', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { language: 'pt-BR', text: 'Nova resposta em português.' } });
  await assert.rejects(
    useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: selectedVariant.id }),
    (error) => error.code === 'MANUAL_REPLY_REVISION_STALE',
  );
  assert.equal(sentTexts.length, 1);
});

test('SendManualCommentReply fails closed after an ambiguous recorded attempt and never retries automatically', async () => {
  const revision = { id: 'revision-1', eventType: 'RESPONSE_SUGGESTION_EDITED', payload: { originalSuggestionEventId: 'suggestion-1', text: 'Final exact text' } };
  const evaluation = { id: 'evaluation-1', eventType: 'RESPONSE_EVALUATED', parentEventId: revision.id, status: 'SUCCEEDED', payload: { revisionEventId: revision.id, evaluation: { publishRecommendation: 'APPROVE' } } };
  const events = [{ id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', payload: { text: 'Generated' } }, revision, evaluation,
    { id: 'attempt-1', eventType: 'MANUAL_REPLY_ATTEMPTED', status: 'IN_PROGRESS', payload: { revisionEventId: revision.id } }];
  let calls = 0;
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, { reply: async () => { calls += 1; } }, { listByComment: async () => events, append: async () => { calls += 1; } }, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000001' }, { execute: async () => false }, now);

  await assert.rejects(useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id }), /MANUAL_REPLY_ATTEMPT_ALREADY_EXISTS/);
  assert.equal(calls, 0);
});

test('SendManualCommentReply records ambiguous provider outcome and blocks a second dispatch', async () => {
  const revision = { id: 'revision-1', eventType: 'RESPONSE_SUGGESTION_EDITED', payload: { originalSuggestionEventId: 'suggestion-1', text: 'Final text' } };
  const events = [
    { id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', payload: { text: 'Generated' } },
    revision,
    { id: 'evaluation-1', eventType: 'RESPONSE_EVALUATED', parentEventId: revision.id, status: 'SUCCEEDED', payload: { revisionEventId: revision.id, evaluation: { publishRecommendation: 'APPROVE' } } },
  ];
  let dispatches = 0;
  const eventRepository = { listByComment: async () => events, append: async (input) => { const stored = { ...input, id: `event-${events.length}`, expiresAt: comment.expiresAt }; events.push(stored); return stored; } };
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, { reply: async () => { dispatches += 1; throw new Error('uncertain outcome'); } }, eventRepository, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000002' }, { execute: async () => false }, now);

  await assert.rejects(useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id }), (error) => error.code === 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS');
  const result = events.find((event) => event.eventType === 'MANUAL_REPLY_RESULT');
  assert.equal(result.status, 'FAILED');
  assert.equal(result.payload.outcome, 'AMBIGUOUS');
  await assert.rejects(useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id }), /MANUAL_REPLY_ATTEMPT_ALREADY_EXISTS/);
  assert.equal(dispatches, 1);
});

test('SendManualCommentReply treats JEV REJECT as advisory and still requires explicit manual action', async () => {
  const revision = { id: 'revision-1', eventType: 'RESPONSE_SUGGESTION_EDITED', payload: { originalSuggestionEventId: 'suggestion-1', text: 'Unsafe text' } };
  const events = [{ id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', payload: { text: 'Generated' } }, revision,
    { id: 'evaluation-1', eventType: 'RESPONSE_EVALUATED', parentEventId: revision.id, status: 'SUCCEEDED', payload: { revisionEventId: revision.id, evaluation: { publishRecommendation: 'REJECT' } } }];
  let sends = 0;
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, { reply: async () => { sends += 1; return { platform: 'youtube', externalReplyId: 'reply-1' }; } }, { listByComment: async () => events, append: async (event) => { events.push(event); return event; } }, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000003' }, { execute: async () => false }, now);

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id });
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(sends, 1);
  assert.equal(events.some((event) => event.eventType === 'MANUAL_REPLY_ATTEMPTED'), true);
});

test('SendManualCommentReply treats JEV REVIEW as advisory and still requires explicit manual action', async () => {
  const revision = { id: 'revision-1', eventType: 'RESPONSE_SUGGESTION_EDITED', payload: { originalSuggestionEventId: 'suggestion-1', text: 'Review text' } };
  const events = [{ id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', payload: { text: 'Generated' } }, revision,
    { id: 'evaluation-1', eventType: 'RESPONSE_EVALUATED', parentEventId: revision.id, status: 'SUCCEEDED', payload: { revisionEventId: revision.id, evaluation: { publishRecommendation: 'REVIEW' } } }];
  let sends = 0;
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, { reply: async () => { sends += 1; return { platform: 'youtube', externalReplyId: 'reply-review' }; } }, { listByComment: async () => events, append: async (event) => { events.push(event); return event; } }, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000005' }, { execute: async () => false }, now);

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(sends, 1);
});

test('SendManualCommentReply accepts a creator-authored response without comment analysis or response evaluation', async () => {
  const manualResponse = { id: 'manual-response-1', eventType: 'MANUAL_RESPONSE_CREATED', payload: { text: 'Resposta escrita diretamente.' } };
  const events = [manualResponse];
  let sends = 0;
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, { reply: async (_account, _comment, text) => { sends += 1; assert.equal(text, manualResponse.payload.text); return { platform: 'youtube', externalReplyId: 'reply-2' }; } }, { listByComment: async () => events, append: async (event) => { const stored = { ...event, id: `event-${events.length}`, expiresAt: comment.expiresAt }; events.push(stored); return stored; } }, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000004' }, { execute: async () => false }, now);

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: manualResponse.id });
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(sends, 1);
  assert.equal(events.some((event) => event.eventType === 'RESPONSE_EVALUATED'), false);
});

test('GenerateCommentResponseSuggestion records a failed stage but never a suggestion when Gemini fails', async () => {
  const useCases = createUseCases({
    events: [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }],
    suggestion: new IntelligenceProviderError('INTELLIGENCE_PROVIDER_RATE_LIMITED'),
  });

  await assert.rejects(useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId }), (error) => error.code === 'INTELLIGENCE_PROVIDER_RATE_LIMITED');
  assert.equal(useCases.calls.some(([name]) => name === 'recordSuggestion'), false);
  const failure = useCases.calls.find(([name]) => name === 'appendEvent')[1];
  assert.equal(failure.eventType, 'RESPONSE_SUGGESTION_GENERATED');
  assert.equal(failure.status, 'FAILED');
  assert.equal(failure.parentEventId, 'analysis-1');
});

test('GenerateCommentResponseSuggestion inherits the tenant tone profile when the account has none', async () => {
  const tenantTone = { primaryTone: 'EMPATHETIC', modifiers: ['WARM'], customNote: 'Global voice', updatedAt: '2026-10-14T10:00:00.000Z' };
  const useCases = createUseCases({
    tenantToneProfile: tenantTone,
    events: [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }],
  });

  await useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId });

  assert.deepEqual(useCases.calls.find(([name]) => name === 'getTenantToneProfile'), ['getTenantToneProfile', tenantId]);
  const generated = useCases.calls.filter(([name]) => name === 'generate').map(([, input]) => input);
  assert.ok(generated.every((input) => input.toneProfile.primaryTone === 'EMPATHETIC'
    && JSON.stringify(input.toneProfile.modifiers) === '["WARM"]'
    && input.toneProfile.customNote === 'Global voice'));
  const recorded = useCases.calls.filter(([name]) => name === 'recordSuggestion').map(([, input]) => input);
  assert.ok(recorded.every((input) => input.toneProfileSource === 'TENANT' && input.toneProfile.primaryTone === 'EMPATHETIC'));
});

test('an account tone profile overrides the tenant default and is never merged with it', async () => {
  const accountTone = { primaryTone: 'CASUAL', modifiers: [], customNote: null, updatedAt: '2026-10-14T11:00:00.000Z' };
  const tenantTone = { primaryTone: 'EMPATHETIC', modifiers: ['WARM'], customNote: 'Global voice', updatedAt: '2026-10-14T10:00:00.000Z' };
  const useCases = createUseCases({
    toneProfile: accountTone,
    tenantToneProfile: tenantTone,
    events: [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }],
  });

  await useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId });

  assert.equal(useCases.calls.some(([name]) => name === 'getTenantToneProfile'), false);
  const generated = useCases.calls.filter(([name]) => name === 'generate').map(([, input]) => input);
  assert.ok(generated.every((input) => input.toneProfile.primaryTone === 'CASUAL'
    && input.toneProfile.modifiers.length === 0
    && input.toneProfile.customNote === null));
  const recorded = useCases.calls.filter(([name]) => name === 'recordSuggestion').map(([, input]) => input);
  assert.ok(recorded.every((input) => input.toneProfileSource === 'ACCOUNT'));
});

test('a one-time tone override applies on top of an inherited tenant profile', async () => {
  const tenantTone = { primaryTone: 'EMPATHETIC', modifiers: ['WARM'], customNote: 'Global voice', updatedAt: '2026-10-14T10:00:00.000Z' };
  const useCases = createUseCases({
    tenantToneProfile: tenantTone,
    events: [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }],
  });

  await useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId, toneOverride: 'PROFESSIONAL' });

  const generated = useCases.calls.filter(([name]) => name === 'generate').map(([, input]) => input);
  assert.ok(generated.every((input) => input.toneProfile.primaryTone === 'PROFESSIONAL'
    && JSON.stringify(input.toneProfile.modifiers) === '["WARM"]'
    && input.toneProfile.customNote === 'Global voice'));
  const recorded = useCases.calls.filter(([name]) => name === 'recordSuggestion').map(([, input]) => input);
  assert.ok(recorded.every((input) => input.toneProfileSource === 'TENANT'));
});
