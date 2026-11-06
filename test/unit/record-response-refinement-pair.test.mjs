import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { RecordResponseRefinementPair } = require('../../dist/application/social/record-response-refinement-pair.js');
const { SendManualCommentReply } = require('../../dist/application/social/send-manual-comment-reply.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400001';
const recordedAt = '2026-10-22T12:00:00.000Z';
const now = () => Date.parse(recordedAt);
const account = SocialAccount.create({
  id: accountId,
  tenantId,
  platform: 'youtube',
  externalAccountId: 'UC-channel',
  displayName: 'Creator',
  credentialReference: 'opaque-reference',
});
const comment = {
  platform: 'youtube', socialAccountId: accountId, externalCommentId: 'comment-1', externalThreadId: 'thread-1',
  externalPublicationId: 'video-1', authorDisplayName: 'Viewer', text: 'Qual é o nome da música?',
  createdAt: '2026-10-13T12:00:00.000Z', canReply: true,
  lastSyncedAt: '2026-10-13T12:00:00.000Z', expiresAt: '2026-11-12T12:00:00.000Z',
};

const analysisEvent = {
  id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', status: 'SUCCEEDED', parentEventId: null,
  payload: { sentiment: 'NEUTRAL', emotion: 'CURIOSITY', intent: 'QUESTION', topic: 'MUSIC', entity: 'Song', spamScore: 0, confidence: 0.9 },
};
const correctionEvent = {
  id: 'correction-1', eventType: 'COMMENT_ANALYSIS_CORRECTED', status: 'SUCCEEDED', parentEventId: 'analysis-1',
  payload: { correctedFields: { sentiment: 'POSITIVE', topic: 'SONG_RELEASE' }, reason: 'Ajuste do criador' },
};
const suggestionPayload = {
  language: 'pt-BR', text: 'Texto gerado pela IA.', provider: 'GEMINI', model: 'gemini-3.5-flash-lite',
  promptVersion: 'gemini-response-v1',
  confidence: 0.82, rationale: 'Responde a pergunta.', intendedTone: 'FRIENDLY',
  toneProfile: { primaryTone: 'FRIENDLY', modifiers: ['WARM'], customNote: null }, toneProfileSource: 'ACCOUNT',
};
const suggestionEvent = {
  id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', parentEventId: 'analysis-1',
  payload: suggestionPayload,
};
const firstRevision = {
  id: 'revision-1', eventType: 'RESPONSE_SUGGESTION_EDITED', status: 'SUCCEEDED', parentEventId: 'suggestion-1',
  payload: { originalSuggestionEventId: 'suggestion-1', revision: 1, text: 'Primeira edição.', reason: 'tom' },
};
const sentRevision = {
  id: 'revision-2', eventType: 'RESPONSE_SUGGESTION_EDITED', status: 'SUCCEEDED', parentEventId: 'revision-1',
  payload: { originalSuggestionEventId: 'suggestion-1', revision: 2, text: 'Texto final editado.', reason: 'ajuste final' },
};
const evaluationEvent = {
  id: 'evaluation-1', eventType: 'RESPONSE_EVALUATED', status: 'SUCCEEDED', parentEventId: 'revision-2',
  payload: { revisionEventId: 'revision-2', evaluation: { publishRecommendation: 'APPROVE', confidence: 0.94 } },
};

function pairRepository() {
  const appended = [];
  return {
    appended,
    append: async (input) => {
      appended.push(input);
      return { ...input, id: `pair-${appended.length}` };
    },
  };
}

function recordUseCase(pairs) {
  return new RecordResponseRefinementPair(pairs);
}

function captureInput(history, sentVersionEventId = sentRevision.id) {
  return {
    tenantId,
    socialAccountId: accountId,
    platform: 'youtube',
    manualReplyAttemptId: '60000000-0000-4000-8000-000000000009',
    sentVersionEventId,
    history,
    recordedAt,
  };
}

test('RecordResponseRefinementPair maps the edited lineage, corrected analysis labels, and evaluation snapshot', async () => {
  const pairs = pairRepository();
  const useCase = recordUseCase(pairs);
  const history = [analysisEvent, correctionEvent, suggestionEvent, firstRevision, sentRevision, evaluationEvent];

  const persisted = await useCase.execute(captureInput(history));

  assert.equal(persisted, true);
  assert.equal(pairs.appended.length, 1);
  assert.deepEqual(pairs.appended[0], {
    tenantId,
    socialAccountId: accountId,
    platform: 'youtube',
    language: 'pt-BR',
    aiText: 'Texto gerado pela IA.',
    finalText: 'Texto final editado.',
    aiProvider: 'GEMINI',
    aiModel: 'gemini-3.5-flash-lite',
    promptVersion: 'gemini-response-v1',
    aiConfidence: 0.82,
    aiRationale: 'Responde a pergunta.',
    intendedTone: 'FRIENDLY',
    toneProfile: { toneProfile: suggestionPayload.toneProfile, toneProfileSource: 'ACCOUNT' },
    revisionCount: 2,
    lastEditReason: 'ajuste final',
    evaluation: { publishRecommendation: 'APPROVE', confidence: 0.94 },
    analysisLabels: { sentiment: 'POSITIVE', emotion: 'CURIOSITY', intent: 'QUESTION', topic: 'SONG_RELEASE', entity: 'Song' },
    manualReplyAttemptId: '60000000-0000-4000-8000-000000000009',
    recordedAt,
  });
});

test('RecordResponseRefinementPair records null evaluation and null analysis labels when absent', async () => {
  const pairs = pairRepository();
  const useCase = recordUseCase(pairs);
  const orphanSuggestion = { ...suggestionEvent, id: 'suggestion-orphan', parentEventId: null, payload: { ...suggestionPayload, rationale: null } };
  const revision = {
    id: 'revision-orphan', eventType: 'RESPONSE_SUGGESTION_EDITED', status: 'SUCCEEDED', parentEventId: 'suggestion-orphan',
    payload: { originalSuggestionEventId: 'suggestion-orphan', revision: 1, text: 'Edição.' },
  };

  const persisted = await useCase.execute(captureInput([orphanSuggestion, revision], revision.id));

  assert.equal(persisted, true);
  assert.equal(pairs.appended[0].evaluation, null);
  assert.equal(pairs.appended[0].analysisLabels, null);
  assert.equal(pairs.appended[0].aiRationale, null);
});

test('RecordResponseRefinementPair uses the latest evaluation recorded for the sent revision', async () => {
  const pairs = pairRepository();
  const useCase = recordUseCase(pairs);
  const newerEvaluation = {
    id: 'evaluation-2', eventType: 'RESPONSE_EVALUATED', status: 'SUCCEEDED', parentEventId: 'revision-2',
    payload: { revisionEventId: 'revision-2', evaluation: { publishRecommendation: 'REVIEW', confidence: 0.5 } },
  };
  const otherRevisionEvaluation = {
    id: 'evaluation-other', eventType: 'RESPONSE_EVALUATED', status: 'SUCCEEDED', parentEventId: 'revision-1',
    payload: { revisionEventId: 'revision-1', evaluation: { publishRecommendation: 'REJECT' } },
  };
  const history = [suggestionEvent, firstRevision, sentRevision, evaluationEvent, otherRevisionEvaluation, newerEvaluation];

  await useCase.execute(captureInput(history));

  assert.deepEqual(pairs.appended[0].evaluation, { publishRecommendation: 'REVIEW', confidence: 0.5 });
});

test('RecordResponseRefinementPair records nothing when the sent version is the unedited AI suggestion', async () => {
  const pairs = pairRepository();
  const useCase = recordUseCase(pairs);

  const persisted = await useCase.execute(captureInput([suggestionEvent], suggestionEvent.id));

  assert.equal(persisted, false);
  assert.equal(pairs.appended.length, 0);
});

test('RecordResponseRefinementPair records nothing when the last edit reverted to the original AI text', async () => {
  const pairs = pairRepository();
  const useCase = recordUseCase(pairs);
  const reverted = {
    id: 'revision-reverted', eventType: 'RESPONSE_SUGGESTION_EDITED', status: 'SUCCEEDED', parentEventId: 'revision-1',
    payload: { originalSuggestionEventId: 'suggestion-1', revision: 2, text: 'Texto gerado pela IA.', reason: 'voltar ao original' },
  };

  const persisted = await useCase.execute(captureInput([suggestionEvent, firstRevision, reverted], reverted.id));

  assert.equal(persisted, false);
  assert.equal(pairs.appended.length, 0);
});

test('RecordResponseRefinementPair records nothing for creator-authored responses', async () => {
  const pairs = pairRepository();
  const useCase = recordUseCase(pairs);
  const manual = {
    id: 'manual-1', eventType: 'MANUAL_RESPONSE_CREATED', status: 'SUCCEEDED', parentEventId: null,
    payload: { text: 'Resposta do criador.' },
  };
  const manualEdit = {
    id: 'manual-edit-1', eventType: 'MANUAL_RESPONSE_EDITED', status: 'SUCCEEDED', parentEventId: 'manual-1',
    payload: { originalManualResponseEventId: 'manual-1', revision: 1, text: 'Edição manual.' },
  };

  assert.equal(await useCase.execute(captureInput([manual], manual.id)), false);
  assert.equal(await useCase.execute(captureInput([manual, manualEdit], manualEdit.id)), false);
  assert.equal(pairs.appended.length, 0);
});

test('RecordResponseRefinementPair skips capture when lineage payloads are missing or malformed', async () => {
  const pairs = pairRepository();
  const useCase = recordUseCase(pairs);
  const danglingRevision = {
    id: 'revision-dangling', eventType: 'RESPONSE_SUGGESTION_EDITED', status: 'SUCCEEDED', parentEventId: 'missing',
    payload: { originalSuggestionEventId: 'missing', revision: 1, text: 'Editado.' },
  };
  const malformedSuggestion = {
    id: 'suggestion-malformed', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', parentEventId: null,
    payload: { text: 'IA' },
  };
  const malformedRevision = {
    id: 'revision-malformed', eventType: 'RESPONSE_SUGGESTION_EDITED', status: 'SUCCEEDED', parentEventId: 'suggestion-malformed',
    payload: { originalSuggestionEventId: 'suggestion-malformed', revision: 1, text: 'Editado.' },
  };

  assert.equal(await useCase.execute(captureInput([suggestionEvent, danglingRevision], danglingRevision.id)), false);
  assert.equal(await useCase.execute(captureInput([malformedSuggestion, malformedRevision], malformedRevision.id)), false);
  assert.equal(await useCase.execute(captureInput([suggestionEvent], 'nonexistent-revision')), false);
  assert.equal(pairs.appended.length, 0);
});

function sendUseCase({ events, pairs, reply }) {
  const eventRepository = {
    listByComment: async () => events,
    append: async (input) => {
      const stored = { ...input, id: `event-${events.length + 1}`, expiresAt: comment.expiresAt };
      events.push(stored);
      return stored;
    },
  };
  return new SendManualCommentReply(
    { findById: async () => account },
    { findByExternalCommentId: async () => comment, markRepliedByApp: async () => {} },
    { reply },
    eventRepository,
    { resolveTenantId: async () => tenantId },
    { generate: () => '60000000-0000-4000-8000-000000000009' },
    pairs,
    now,
  );
}

test('SendManualCommentReply persists an anonymized pair and flags the result for an edited AI send', async () => {
  const pairs = pairRepository();
  const events = [analysisEvent, suggestionEvent, firstRevision, sentRevision];
  const useCase = sendUseCase({
    events,
    pairs: recordUseCase(pairs),
    reply: async () => ({ platform: 'youtube', externalReplyId: 'reply-1' }),
  });

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: sentRevision.id });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.payload.refinementPairPersisted, true);
  assert.equal(pairs.appended.length, 1);
  assert.equal(pairs.appended[0].aiText, 'Texto gerado pela IA.');
  assert.equal(pairs.appended[0].finalText, 'Texto final editado.');
  assert.equal(pairs.appended[0].manualReplyAttemptId, '60000000-0000-4000-8000-000000000009');
});

test('SendManualCommentReply flags false and captures nothing for an unedited AI send', async () => {
  const pairs = pairRepository();
  const events = [{ ...suggestionEvent }];
  const useCase = sendUseCase({
    events,
    pairs: recordUseCase(pairs),
    reply: async () => ({ platform: 'youtube', externalReplyId: 'reply-2' }),
  });

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: suggestionEvent.id });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.payload.refinementPairPersisted, false);
  assert.equal(pairs.appended.length, 0);
});

test('SendManualCommentReply flags false and captures nothing for a creator-authored send', async () => {
  const pairs = pairRepository();
  const manual = {
    id: 'manual-1', eventType: 'MANUAL_RESPONSE_CREATED', status: 'SUCCEEDED', parentEventId: null,
    payload: { text: 'Resposta do criador.' },
  };
  const events = [manual];
  const useCase = sendUseCase({
    events,
    pairs: recordUseCase(pairs),
    reply: async () => ({ platform: 'youtube', externalReplyId: 'reply-3' }),
  });

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: manual.id });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.payload.refinementPairPersisted, false);
  assert.equal(pairs.appended.length, 0);
});

test('SendManualCommentReply keeps the send result and flags false when pair capture fails', async () => {
  const events = [suggestionEvent, sentRevision];
  const failingCapture = { execute: async () => { throw new Error('database unavailable'); } };
  const useCase = sendUseCase({
    events,
    pairs: failingCapture,
    reply: async () => ({ platform: 'youtube', externalReplyId: 'reply-4' }),
  });

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: sentRevision.id });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.payload.externalReplyId, 'reply-4');
  assert.equal(result.payload.refinementPairPersisted, false);
});

test('SendManualCommentReply never captures a pair when the platform send fails or is ambiguous', async () => {
  const pairs = pairRepository();
  const capture = recordUseCase(pairs);
  const captureCalls = [];
  const spy = { execute: async (input) => { captureCalls.push(input); return capture.execute(input); } };
  const events = [suggestionEvent, sentRevision];
  const useCase = sendUseCase({
    events,
    pairs: spy,
    reply: async () => { throw new Error('uncertain outcome'); },
  });

  await assert.rejects(
    useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: sentRevision.id }),
    (error) => error.code === 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS',
  );

  assert.equal(captureCalls.length, 0);
  assert.equal(pairs.appended.length, 0);
  const result = events.find((event) => event.eventType === 'MANUAL_REPLY_RESULT');
  assert.equal(result.status, 'FAILED');
  assert.equal(result.payload.refinementPairPersisted, undefined);
});
