import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { JevResponseEditClassifier } = require('../../dist/infrastructure/intelligence/jev-response-edit-classifier.js');
const {
  responseEditCategories,
  observedResponseIssues,
  responseEditEvidenceSources,
} = require('../../dist/application/ports/response-edit-classifier.port.js');

const comment = {
  platform: 'instagram',
  socialAccountId: 'private-account-id',
  externalCommentId: 'private-comment-id',
  externalThreadId: 'private-thread-id',
  externalPublicationId: 'private-publication-id',
  authorDisplayName: 'Private author',
  text: 'Qual é o horário de atendimento?',
  createdAt: null,
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
  model: 'comment-model',
  schemaVersion: 'typesafe-systemone-v2',
};

function choiceAnswer(choice, options, confidence = 0.91) {
  return {
    type: 'choice',
    choice,
    confidence,
    probabilities: Object.fromEntries(options.map((option) => [
      option,
      option === choice ? confidence : (1 - confidence) / (options.length - 1),
    ])),
  };
}

function classifierAnswers({ category = 'CLARITY', issue = 'INCOMPLETE_ANSWER', evidence = 'FINAL_RESPONSE', confidence = 0.91 } = {}) {
  return {
    edit_category: choiceAnswer(category, responseEditCategories, confidence),
    observed_ai_issue: choiceAnswer(issue, observedResponseIssues, confidence),
    evidence_source: choiceAnswer(evidence, responseEditEvidenceSources, confidence),
  };
}

function fakeClient(answers) {
  const calls = [];
  const client = {
    evaluate: async (input) => {
      calls.push(input);
      return { model: 'jev-model', answers, usage: { inputTokens: 10, outputTokens: 4 } };
    },
  };
  return { calls, adapter: new JevResponseEditClassifier(client) };
}

test('JevResponseEditClassifier sends only allowlisted contextual content and validates the structured diagnosis', async () => {
  const { calls, adapter } = fakeClient(classifierAnswers());

  const result = await adapter.classify({
    comment,
    analysis,
    aiText: 'Atendemos até às 18h.',
    finalText: 'Atendemos até às 18h, de segunda a sexta.',
    editReason: 'Informar os dias.',
  });

  assert.deepEqual(result, {
    editCategory: 'CLARITY',
    observedAiIssue: 'INCOMPLETE_ANSWER',
    confidence: 0.91,
    evidenceSource: 'FINAL_RESPONSE',
    signals: {
      editCategory: {
        confidence: 0.91,
        probabilities: classifierAnswers().edit_category.probabilities,
      },
      observedAiIssue: {
        confidence: 0.91,
        probabilities: classifierAnswers().observed_ai_issue.probabilities,
      },
      evidenceSource: {
        confidence: 0.91,
        probabilities: classifierAnswers().evidence_source.probabilities,
      },
    },
    rationale: null,
    provider: 'JEV',
    model: 'jev-model',
    schemaVersion: 'response-edit-classification-v2',
    usage: { inputTokens: 10, outputTokens: 4 },
  });
  assert.deepEqual(calls[0].state, {
    comment: { text: comment.text },
    commentAnalysis: {
      sentiment: analysis.sentiment,
      emotion: analysis.emotion,
      intent: analysis.intent,
      topic: analysis.topic,
      entity: null,
      spamScore: 0,
      toxicityScore: 0,
      engagementValue: 0.5,
      confidence: 0.9,
    },
    aiResponse: { text: 'Atendemos até às 18h.' },
    finalResponse: { text: 'Atendemos até às 18h, de segunda a sexta.' },
    creatorEditReason: 'Informar os dias.',
  });
  assert.deepEqual(Object.keys(calls[0].questions), ['edit_category', 'observed_ai_issue', 'evidence_source']);
  assert.ok(Object.values(calls[0].questions).every((question) => question.type === 'choice'));
  const serialized = JSON.stringify(calls[0]);
  assert.equal(serialized.includes('private-account-id'), false);
  assert.equal(serialized.includes('private-comment-id'), false);
  assert.equal(serialized.includes('Private author'), false);
});

test('JevResponseEditClassifier rejects unknown categories and missing confidence', async () => {
  const { adapter } = fakeClient(classifierAnswers({ category: 'MAKE_A_NEW_REPLY', confidence: null }));

  await assert.rejects(adapter.classify({
    comment,
    analysis,
    aiText: 'AI response',
    finalText: 'Edited response',
    editReason: null,
  }), /INTELLIGENCE_PROVIDER_RESPONSE_INVALID/);
});

test('JevResponseEditClassifier rejects unallowlisted evidence fields', async () => {
  const { adapter } = fakeClient(classifierAnswers({ evidence: 'EXTERNAL_COMMENT_ID' }));

  await assert.rejects(adapter.classify({
    comment,
    analysis,
    aiText: 'AI response',
    finalText: 'Edited response',
    editReason: null,
  }), /INTELLIGENCE_PROVIDER_RESPONSE_INVALID/);
});
