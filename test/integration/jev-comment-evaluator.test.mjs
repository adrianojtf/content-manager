import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { JevCommentEvaluator } = require('../../dist/infrastructure/intelligence/jev-comment-evaluator.js');
const { JevResponseEvaluator } = require('../../dist/infrastructure/intelligence/jev-response-evaluator.js');
const { IntelligenceProviderError } = require('../../dist/application/social/intelligence-provider-error.js');

const comment = {
  platform: 'youtube',
  socialAccountId: '5b7f1f84-25a8-4bd8-a7df-680dc4400001',
  externalCommentId: 'comment-123',
  externalThreadId: 'thread-123',
  externalPublicationId: 'video-123',
  authorDisplayName: 'Viewer name',
  text: 'Great episode!',
  createdAt: '2026-10-13T12:00:00.000Z',
  canReply: true,
  lastSyncedAt: '2026-10-13T12:00:00.000Z',
  expiresAt: '2026-11-12T12:00:00.000Z',
};

const sentimentProbabilities = { POSITIVE: 0.93, NEUTRAL: 0.05, NEGATIVE: 0.02 };
const emotionProbabilities = { JOY: 0.84, CURIOSITY: 0.08, FRUSTRATION: 0.02, SADNESS: 0.01, ANGER: 0.01, SURPRISE: 0.02, NEUTRAL: 0.01, OTHER: 0.01 };
const intentProbabilities = { QUESTION: 0.04, PRAISE: 0.05, COMPLAINT: 0.01, SUGGESTION: 0.01, CONTENT_REQUEST: 0.01, REACTION: 0.86, OTHER: 0.02 };
const topicProbabilities = { CHARACTER: 0.82, STORY: 0.06, CONTENT: 0.05, PRODUCTION: 0.02, COMMUNITY: 0.02, PLATFORM: 0.01, OTHER: 0.02 };
const engagementProbabilities = { 0: 0.02, 1: 0.04, 2: 0.12, 3: 0.52, 4: 0.30 };
const engagementLegend = {
  0: 'Generic comment with little discussion potential.',
  1: 'Simple reaction with limited discussion potential.',
  2: 'Specific opinion or question that can support a short reply.',
  3: 'Substantive feedback likely to invite a useful exchange.',
  4: 'Thoughtful comment likely to spark a broader conversation.',
};

function choice(choiceValue, confidence, probabilities) {
  return { type: 'choice', choice: choiceValue, confidence, probabilities };
}

function noul(probability) {
  return { type: 'noul', noul: probability };
}

function score(value, confidence, probabilities, legend) {
  return { type: 'score', score: value, confidence, probabilities, legend };
}

const commentAnswers = {
  sentiment: choice('POSITIVE', 0.93, sentimentProbabilities),
  emotion: choice('JOY', 0.84, emotionProbabilities),
  intent: choice('REACTION', 0.87, intentProbabilities),
  topic: choice('CHARACTER', 0.82, topicProbabilities),
  spam: noul(0.01),
  toxicity: noul(0.02),
  engagement: score(3.2, 0.88, engagementProbabilities, engagementLegend),
  needs_external_facts: noul(0.76),
  requests_continuation: noul(0.02),
};
const providerUsage = { inputTokens: 128, outputTokens: 39 };
const commentSignals = {
  sentiment: { confidence: 0.93, probabilities: sentimentProbabilities },
  emotion: { confidence: 0.84, probabilities: emotionProbabilities },
  intent: { confidence: 0.87, probabilities: intentProbabilities },
  topic: { confidence: 0.82, probabilities: topicProbabilities },
  spam: { probability: 0.01 },
  toxicity: { probability: 0.02 },
  engagement: {
    rawScore: 3.2,
    normalizedScore: 0.8,
    confidence: 0.88,
    probabilities: engagementProbabilities,
    legend: engagementLegend,
  },
  needsExternalFacts: { probability: 0.76 },
  requestsContinuation: { probability: 0.02 },
};

const answerResult = (answers, model = 'jev-1.14.0', usage = providerUsage) => ({ answers, model, usage });

function createClient(result) {
  const calls = [];
  return {
    calls,
    client: {
      evaluate: async (request) => {
        calls.push(request);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

test('JEV comment evaluator sends typed questions and preserves statistical evidence', async () => {
  const { client, calls } = createClient(answerResult(commentAnswers));
  const evaluator = new JevCommentEvaluator(client);

  const result = await evaluator.evaluate({ comment });

  assert.deepEqual(calls[0].state, {
    comment: { text: 'Great episode!' },
    publication: { platform: 'youtube', externalPublicationId: 'video-123' },
  });
  assert.deepEqual(Object.keys(calls[0].questions), [
    'sentiment', 'emotion', 'intent', 'topic', 'spam', 'toxicity', 'engagement', 'needs_external_facts', 'requests_continuation',
  ]);
  assert.equal(calls[0].questions.sentiment.type, 'choice');
  assert.deepEqual(Object.keys(calls[0].questions.sentiment.criteria), ['POSITIVE', 'NEUTRAL', 'NEGATIVE']);
  assert.equal(calls[0].questions.intent.criteria.CONTENT_REQUEST !== undefined, true);
  assert.equal(calls[0].questions.spam.type, 'noul');
  assert.equal(calls[0].questions.engagement.type, 'score');
  assert.equal(calls[0].questions.engagement.criteria.length, 5);
  assert.equal(calls[0].questions.requests_continuation.type, 'noul');
  assert.match(calls[0].questions.engagement.instructions, /message length/i);
  assert.match(calls[0].questions.engagement.criteria[3], /continuation|another part/i);
  assert.equal(JSON.stringify(calls[0].state).includes('Viewer name'), false);

  assert.equal(result.sentiment, 'POSITIVE');
  assert.equal(result.emotion, 'JOY');
  assert.equal(result.intent, 'REACTION');
  assert.equal(result.topic, 'CHARACTER');
  assert.equal(result.entity, null);
  assert.equal(result.spamScore, 0.01);
  assert.equal(result.toxicityScore, 0.02);
  assert.equal(result.engagementValue, 0.8);
  assert.equal(result.continuationRequestProbability, 0.02);
  assert.equal(result.confidence, 0.82);
  assert.equal(result.rationale, null);
  assert.equal(result.provider, 'JEV');
  assert.equal(result.model, 'jev-1.14.0');
  assert.equal(result.schemaVersion, 'typesafe-systemone-v1');
  assert.deepEqual(result.signals, commentSignals);
  assert.deepEqual(result.usage, providerUsage);
});

test('short continuation requests carry content-demand probability and an elevated engagement score', async () => {
  const continuationIntentProbabilities = {
    QUESTION: 0.01,
    PRAISE: 0.005,
    COMPLAINT: 0.001,
    SUGGESTION: 0.005,
    CONTENT_REQUEST: 0.96,
    REACTION: 0.015,
    OTHER: 0.004,
  };
  const answers = {
    ...commentAnswers,
    intent: choice('CONTENT_REQUEST', 0.96, continuationIntentProbabilities),
    requests_continuation: noul(0.98),
    engagement: score(3.4, 0.9, { 0: 0.01, 1: 0.02, 2: 0.07, 3: 0.55, 4: 0.35 }, engagementLegend),
  };
  const { client } = createClient(answerResult(answers));
  const evaluator = new JevCommentEvaluator(client);

  const result = await evaluator.evaluate({ comment: { ...comment, text: 'Continuação parte 2' } });

  assert.equal(result.intent, 'CONTENT_REQUEST');
  assert.equal(result.continuationRequestProbability, 0.98);
  assert.equal(result.engagementValue, 0.85);
  assert.equal(result.signals.requestsContinuation.probability, 0.98);
});

test('JEV comment evaluator rejects invalid TypeSafe answers and input before persisting', async (t) => {
  const invalidAnswers = [
    { ...commentAnswers, sentiment: choice('UNLISTED', 0.9, { UNLISTED: 1 }) },
    { ...commentAnswers, toxicity: noul(1.2) },
    { ...commentAnswers, engagement: score(4.1, 0.9, engagementProbabilities, engagementLegend) },
    { ...commentAnswers, emotion: { ...commentAnswers.emotion, confidence: 'high' } },
    Object.fromEntries(Object.entries(commentAnswers).filter(([key]) => key !== 'intent')),
    { ...commentAnswers, requests_continuation: noul(-0.1) },
  ];
  for (const [index, answers] of invalidAnswers.entries()) {
    await t.test(`invalid answers ${index + 1}`, async () => {
      const { client } = createClient(answerResult(answers));
      const evaluator = new JevCommentEvaluator(client);
      await assert.rejects(
        evaluator.evaluate({ comment }),
        (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID',
      );
    });
  }

  const { client, calls } = createClient(answerResult(commentAnswers));
  const evaluator = new JevCommentEvaluator(client);
  await assert.rejects(
    evaluator.evaluate({ comment: { ...comment, text: '  ' } }),
    (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_INPUT_INVALID',
  );
  assert.equal(calls.length, 0);
});

const evaluationAnswers = {
  relevance: score(3.6, 0.95, { 0: 0.01, 1: 0.03, 2: 0.06, 3: 0.3, 4: 0.6 }, engagementLegend),
  tone: score(3.2, 0.88, { 0: 0.01, 1: 0.04, 2: 0.08, 3: 0.55, 4: 0.32 }, engagementLegend),
  helpfulness: score(2.8, 0.82, { 0: 0.02, 1: 0.08, 2: 0.22, 3: 0.50, 4: 0.18 }, engagementLegend),
  factual_risk: noul(0.08),
  toxicity_risk: noul(0.02),
  hallucination_risk: noul(0.04),
  publish_recommendation: choice('APPROVE', 0.86, { APPROVE: 0.86, REVIEW: 0.12, REJECT: 0.02 }),
};
const analysis = {
  sentiment: 'POSITIVE',
  emotion: 'JOY',
  intent: 'REACTION',
  topic: 'CHARACTER',
  entity: null,
  spamScore: 0.01,
  toxicityScore: 0.02,
  engagementValue: 0.8,
  continuationRequestProbability: 0.02,
  confidence: 0.82,
  rationale: null,
  provider: 'JEV',
  model: 'jev-1.14.0',
  schemaVersion: 'typesafe-systemone-v1',
  signals: commentSignals,
  usage: providerUsage,
};

test('JEV response evaluator evaluates a saved version with independent typed questions', async () => {
  const { client, calls } = createClient(answerResult(evaluationAnswers, 'jev-1.14.0', { inputTokens: 144, outputTokens: 46 }));
  const evaluator = new JevResponseEvaluator(client);

  const result = await evaluator.evaluate({ comment, analysis, responseText: 'Thank you for watching.' });

  assert.deepEqual(calls[0].state, {
    comment: { text: 'Great episode!' },
    commentAnalysis: {
      sentiment: 'POSITIVE',
      emotion: 'JOY',
      intent: 'REACTION',
      topic: 'CHARACTER',
      entity: null,
      spamScore: 0.01,
      toxicityScore: 0.02,
      engagementValue: 0.8,
      continuationRequestProbability: 0.02,
      confidence: 0.82,
      rationale: null,
      signals: commentSignals,
    },
    response: { text: 'Thank you for watching.' },
  });
  assert.equal(calls[0].questions.relevance.type, 'score');
  assert.equal(calls[0].questions.factual_risk.type, 'noul');
  assert.equal(calls[0].questions.publish_recommendation.type, 'choice');
  assert.equal('schedule_consistency' in calls[0].questions, false);
  assert.deepEqual(Object.keys(calls[0].questions.publish_recommendation.criteria), ['APPROVE', 'REVIEW', 'REJECT']);
  assert.equal(JSON.stringify(calls[0]).includes('usage'), false);

  assert.equal(result.relevance, 0.9);
  assert.equal(result.tone, 0.8);
  assert.equal(result.helpfulness, 0.7);
  assert.equal(result.factualRisk, 0.08);
  assert.equal(result.toxicityRisk, 0.02);
  assert.equal(result.hallucinationRisk, 0.04);
  assert.equal(result.publishRecommendation, 'APPROVE');
  assert.equal(result.confidence, 0.82);
  assert.equal(result.rationale, null);
  assert.equal(result.scheduleConsistency, undefined);
  assert.deepEqual(result.usage, { inputTokens: 144, outputTokens: 46 });
  assert.equal(result.signals.publishRecommendation.confidence, 0.86);
});

test('JEV response evaluator adds schedule consistency only for an active verified schedule', async () => {
  const schedule = {
    daysOfWeek: ['MONDAY', 'WEDNESDAY'],
    localTime: '20:30',
    timeZone: 'America/Sao_Paulo',
  };
  const answers = { ...evaluationAnswers, schedule_consistency: noul(0.83) };
  const { client, calls } = createClient(answerResult(answers, 'jev-1.14.0', { inputTokens: 152, outputTokens: 48 }));
  const evaluator = new JevResponseEvaluator(client);

  const result = await evaluator.evaluate({
    comment,
    analysis,
    responseText: 'New episodes arrive on Monday and Wednesday at 8:30 PM in Sao Paulo.',
    verifiedReleaseSchedule: schedule,
  });

  assert.deepEqual(calls[0].state.verifiedReleaseSchedule, schedule);
  assert.equal(calls[0].questions.schedule_consistency.type, 'noul');
  assert.equal(calls[0].questions.publish_recommendation.type, 'choice');
  assert.match(calls[0].questions.schedule_consistency.instructions, /no schedule claim/i);
  assert.match(calls[0].questions.schedule_consistency.instructions, /continuation request/i);
  assert.equal(result.scheduleConsistency, 0.83);
  assert.deepEqual(result.signals.scheduleConsistency, { probability: 0.83 });
  assert.equal(result.rationale, null);
  assert.equal(result.schemaVersion, 'typesafe-systemone-v2');
});

test('JEV response evaluator rejects missing or invalid active schedule-consistency answers', async (t) => {
  for (const probability of [undefined, -0.1, 1.1]) {
    await t.test(`invalid schedule consistency ${String(probability)}`, async () => {
      const answers = { ...evaluationAnswers };
      if (probability !== undefined) answers.schedule_consistency = noul(probability);
      const { client } = createClient(answerResult(answers));
      const evaluator = new JevResponseEvaluator(client);

      await assert.rejects(
        evaluator.evaluate({
          comment,
          analysis,
          responseText: 'Reply',
          verifiedReleaseSchedule: {
            daysOfWeek: ['MONDAY'],
            localTime: '20:30',
            timeZone: 'America/Sao_Paulo',
          },
        }),
        (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID',
      );
    });
  }
});

test('JEV response evaluator rejects malformed typed answers', async () => {
  const invalidAnswers = {
    ...evaluationAnswers,
    publish_recommendation: choice('SEND_NOW', 0.9, { SEND_NOW: 1 }),
  };
  const { client } = createClient(answerResult(invalidAnswers));
  const evaluator = new JevResponseEvaluator(client);

  await assert.rejects(
    evaluator.evaluate({ comment, analysis, responseText: 'Reply' }),
    (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID',
  );
});
