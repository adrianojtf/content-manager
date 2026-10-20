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
  spamScore: 0, toxicityScore: 0, engagementValue: 0.5, confidence: 0.92, rationale: 'Direct question.',
  provider: 'JEV', model: 'jev-model', schemaVersion: '1',
};
const now = () => Date.parse('2026-10-14T12:00:00.000Z');
const generatedSuggestion = { text: 'A canção é X.', language: 'pt-BR', intendedTone: 'FRIENDLY', confidence: 0.8, rationale: 'Answers the question.', provider: 'GEMINI', model: 'gemini-3.5-flash-lite' };

function createUseCases({ commentFound = comment, accountFound = account, evaluation = analysis, suggestion = generatedSuggestion, events = [], toneProfile = null } = {}) {
  const calls = [];
  const accounts = { findById: async (...args) => { calls.push(['findAccount', ...args]); return accountFound; } };
  const comments = { findByExternalCommentId: async (...args) => { calls.push(['findComment', ...args]); return commentFound; } };
  const evaluator = { evaluate: async (input) => { calls.push(['evaluate', input]); if (evaluation instanceof Error) throw evaluation; return evaluation; } };
  const generator = { generate: async (input) => { calls.push(['generate', input]); if (suggestion instanceof Error) throw suggestion; return suggestion; } };
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
  return {
    calls,
    evaluateComment: new EvaluateComment(accounts, comments, evaluator, recordAnalysis, workflowEvents, tenant, now),
    generateResponse: new GenerateCommentResponseSuggestion(accounts, comments, generator, recordSuggestion, workflowEvents, tenant, toneSettings, now),
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

test('GenerateCommentResponseSuggestion uses an explicit language and the latest corrected JEV analysis', async () => {
  const firstAnalysis = { id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis };
  const correction = { id: 'correction-1', eventType: 'COMMENT_ANALYSIS_CORRECTED', parentEventId: 'analysis-1', payload: { correctedFields: { sentiment: 'POSITIVE', engagementValue: 0.9 } } };
  const useCases = createUseCases({ events: [firstAnalysis, correction] });

  const result = await useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId, language: 'pt-BR', analysisEventId: 'analysis-1' });

  assert.equal(result.id, 'suggestion-event-1');
  assert.deepEqual(useCases.calls.find(([name]) => name === 'generate')[1], {
    comment,
    analysis: { ...analysis, sentiment: 'POSITIVE', engagementValue: 0.9 },
    language: 'pt-BR',
    toneProfile: { primaryTone: 'FRIENDLY', modifiers: [], customNote: null },
  });
  assert.deepEqual(useCases.calls.find(([name]) => name === 'recordSuggestion')[1], {
    accountId, externalCommentId: 'comment-1', sourceAnalysisEventId: 'analysis-1', suggestion: generatedSuggestion, batchOperationId: undefined,
    toneProfile: { primaryTone: 'FRIENDLY', modifiers: [], customNote: null },
  });
});

test('GenerateCommentResponseSuggestion uses the connected account tone profile and snapshots it in audit data', async () => {
  const toneProfile = { primaryTone: 'EMPATHETIC', modifiers: ['CONCISE', 'WARM'], customNote: 'Avoid slang.' };
  const useCases = createUseCases({ toneProfile, events: [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }] });

  await useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId, language: 'pt-BR' });

  assert.deepEqual(useCases.calls.find(([name]) => name === 'getToneProfile'), ['getToneProfile', tenantId, accountId]);
  assert.deepEqual(useCases.calls.find(([name]) => name === 'generate')[1].toneProfile, toneProfile);
  assert.deepEqual(useCases.calls.find(([name]) => name === 'recordSuggestion')[1].toneProfile, toneProfile);
});

test('GenerateCommentResponseSuggestion preserves high-risk analysis as advisory context for an explicit request', async () => {
  const highRiskAnalysis = { ...analysis, spamScore: 0.95, toxicityScore: 0.9 };
  const useCases = createUseCases({
    events: [{ id: 'analysis-high-risk', eventType: 'COMMENT_ANALYSIS_CREATED', payload: highRiskAnalysis }],
  });

  const result = await useCases.generateResponse.execute({
    accountId,
    externalCommentId: comment.externalCommentId,
    language: 'pt-BR',
  });

  const generatorCall = useCases.calls.find(([name]) => name === 'generate');
  assert.deepEqual(generatorCall[1].analysis, highRiskAnalysis);
  assert.equal(result.id, 'suggestion-event-1');
});

test('GenerateCommentResponseSuggestion requires an explicit response language and prior JEV analysis', async () => {
  const useCases = createUseCases();
  await assert.rejects(useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId, language: '' }), /RESPONSE_SUGGESTION_INVALID/);
  assert.equal(useCases.calls.some(([name]) => name === 'generate'), false);

  const withoutAnalysis = createUseCases();
  await assert.rejects(withoutAnalysis.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId, language: 'pt-BR' }), /COMMENT_ANALYSIS_NOT_FOUND/);
  assert.equal(withoutAnalysis.calls.some(([name]) => name === 'generate'), false);
});

test('EvaluateResponseSuggestion evaluates exact saved final text and records result linked to revision', async () => {
  const revision = { id: 'revision-1', eventType: 'RESPONSE_SUGGESTION_EDITED', payload: { originalSuggestionEventId: 'suggestion-1', text: 'Exact final response' } };
  const events = [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }, revision];
  const calls = [];
  const evaluation = { relevance: 0.9, tone: 0.95, helpfulness: 0.9, factualRisk: 0, toxicityRisk: 0, hallucinationRisk: 0, publishRecommendation: 'APPROVE', confidence: 0.9, rationale: null, provider: 'JEV', model: 'test-model', schemaVersion: '1' };
  const useCase = new EvaluateResponseSuggestion(
    { findById: async () => account },
    { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} },
    { evaluate: async (input) => { calls.push(['evaluate', input]); return evaluation; } },
    { execute: async (input) => { calls.push(['record', input]); return { id: 'evaluation-1', parentEventId: input.revisionEventId }; } },
    { listByComment: async () => events, append: async (input) => { events.push(input); return input; } },
    { resolveTenantId: async () => tenantId }, now,
  );

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id });

  assert.deepEqual(calls[0], ['evaluate', { comment, analysis, responseText: 'Exact final response' }]);
  assert.equal(calls[1][1].revisionEventId, revision.id);
  assert.deepEqual(calls[1][1].evaluation, evaluation);
  assert.equal(result.id, 'evaluation-1');
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
    { resolveTenantId: async () => tenantId }, now,
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
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, responder, workflowEvents, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000001' }, now);

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

test('SendManualCommentReply fails closed after an ambiguous recorded attempt and never retries automatically', async () => {
  const revision = { id: 'revision-1', eventType: 'RESPONSE_SUGGESTION_EDITED', payload: { originalSuggestionEventId: 'suggestion-1', text: 'Final exact text' } };
  const evaluation = { id: 'evaluation-1', eventType: 'RESPONSE_EVALUATED', parentEventId: revision.id, status: 'SUCCEEDED', payload: { revisionEventId: revision.id, evaluation: { publishRecommendation: 'APPROVE' } } };
  const events = [{ id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', payload: { text: 'Generated' } }, revision, evaluation,
    { id: 'attempt-1', eventType: 'MANUAL_REPLY_ATTEMPTED', status: 'IN_PROGRESS', payload: { revisionEventId: revision.id } }];
  let calls = 0;
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, { reply: async () => { calls += 1; } }, { listByComment: async () => events, append: async () => { calls += 1; } }, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000001' }, now);

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
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, { reply: async () => { dispatches += 1; throw new Error('uncertain outcome'); } }, eventRepository, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000002' }, now);

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
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, { reply: async () => { sends += 1; return { platform: 'youtube', externalReplyId: 'reply-1' }; } }, { listByComment: async () => events, append: async (event) => { events.push(event); return event; } }, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000003' }, now);

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
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, { reply: async () => { sends += 1; return { platform: 'youtube', externalReplyId: 'reply-review' }; } }, { listByComment: async () => events, append: async (event) => { events.push(event); return event; } }, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000005' }, now);

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(sends, 1);
});

test('SendManualCommentReply accepts a creator-authored response without comment analysis or response evaluation', async () => {
  const manualResponse = { id: 'manual-response-1', eventType: 'MANUAL_RESPONSE_CREATED', payload: { text: 'Resposta escrita diretamente.' } };
  const events = [manualResponse];
  let sends = 0;
  const useCase = new SendManualCommentReply({ findById: async () => account }, { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} }, { reply: async (_account, _comment, text) => { sends += 1; assert.equal(text, manualResponse.payload.text); return { platform: 'youtube', externalReplyId: 'reply-2' }; } }, { listByComment: async () => events, append: async (event) => { const stored = { ...event, id: `event-${events.length}`, expiresAt: comment.expiresAt }; events.push(stored); return stored; } }, { resolveTenantId: async () => tenantId }, { generate: () => '60000000-0000-4000-8000-000000000004' }, now);

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

  await assert.rejects(useCases.generateResponse.execute({ accountId, externalCommentId: comment.externalCommentId, language: 'pt-BR' }), (error) => error.code === 'INTELLIGENCE_PROVIDER_RATE_LIMITED');
  assert.equal(useCases.calls.some(([name]) => name === 'recordSuggestion'), false);
  const failure = useCases.calls.find(([name]) => name === 'appendEvent')[1];
  assert.equal(failure.eventType, 'RESPONSE_SUGGESTION_GENERATED');
  assert.equal(failure.status, 'FAILED');
  assert.equal(failure.parentEventId, 'analysis-1');
});
