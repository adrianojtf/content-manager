import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commentKey,
  effectiveAnalysis,
  escapeHtml,
  latestResponseEvaluation,
  latestResponseVersion,
  renderComment,
  renderStats,
  responseVersionDetails,
} from '../../web/view.mjs';

const comment = {
  platform: 'youtube',
  socialAccountId: 'account-1',
  externalCommentId: 'comment-1',
  externalThreadId: 'thread-1',
  externalPublicationId: 'video-1',
  authorDisplayName: '<img src=x onerror=alert(1)>',
  text: '<script>alert("comment")</script>',
  createdAt: '2026-10-17T10:00:00.000Z',
  canReply: false,
  appReplied: false,
  externalReplyStatus: 'UNKNOWN',
};

const analysis = {
  sentiment: 'NEGATIVE',
  emotion: 'ANGER',
  intent: 'COMPLAINT',
  topic: 'ACCESSIBILITY',
  entity: null,
  spamScore: 0.1,
  toxicityScore: 0.25,
  engagementValue: 0.5,
  confidence: 0.9,
  rationale: 'Review the reported issue.',
  provider: 'JEV',
  model: 'test-model',
  schemaVersion: '1',
};

test('view helpers merge only corrections linked to the original analysis and identify the latest response root', () => {
  const events = [
    { id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis },
    { id: 'correction-1', eventType: 'COMMENT_ANALYSIS_CORRECTED', parentEventId: 'analysis-1', payload: { correctedFields: { sentiment: 'NEUTRAL' } } },
    { id: 'other-correction', eventType: 'COMMENT_ANALYSIS_CORRECTED', parentEventId: 'another-analysis', payload: { correctedFields: { topic: 'IGNORED' } } },
    { id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', payload: { text: 'Draft' } },
    { id: 'revision-1', eventType: 'RESPONSE_SUGGESTION_EDITED', payload: { originalSuggestionEventId: 'suggestion-1', text: 'Final' } },
  ];

  assert.equal(effectiveAnalysis(events).sentiment, 'NEUTRAL');
  assert.equal(effectiveAnalysis(events).topic, 'ACCESSIBILITY');
  assert.deepEqual(responseVersionDetails(events), {
    version: events[4],
    rootId: 'suggestion-1',
    kind: 'suggestion',
    isRevision: true,
  });
  assert.equal(commentKey('account-1', 'comment-1'), 'account-1\u0000comment-1');
});

test('comment rendering escapes provider-supplied text and disables unsupported external replies', () => {
  const key = commentKey(comment.socialAccountId, comment.externalCommentId);
  const html = renderComment(comment, {
    workflows: new Map([[key, [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }]]]),
    workflowErrors: new Map(),
    workflowLoading: new Set(),
    expandedComments: new Set([key]),
    drafts: new Map(),
    busy: new Set(),
    language: 'pt-BR',
  });

  assert.equal(escapeHtml(comment.text), '&lt;script&gt;alert(&quot;comment&quot;)&lt;/script&gt;');
  assert.equal(html.includes('<script>alert("comment")</script>'), false);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('Resposta externa desconhecida'));
  assert.ok(html.includes('A plataforma não permite responder a este comentário.'));
  assert.match(html, /<button[^>]*data-action="send-response"[^>]*disabled/);
});

test('failed workflow events do not replace the latest successful analysis, response, or evaluation', () => {
  const events = [
    { id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', status: 'SUCCEEDED', payload: analysis },
    { id: 'correction-failed', eventType: 'COMMENT_ANALYSIS_CORRECTED', status: 'FAILED', parentEventId: 'analysis-1', payload: { correctedFields: { sentiment: 'POSITIVE' } } },
    { id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { text: 'Saved response' } },
    { id: 'suggestion-failed', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'FAILED', payload: { errorCode: 'INTELLIGENCE_PROVIDER_UNAVAILABLE' } },
    { id: 'evaluation-1', eventType: 'RESPONSE_EVALUATED', status: 'SUCCEEDED', parentEventId: 'suggestion-1', payload: { evaluation: { publishRecommendation: 'REVIEW' } } },
    { id: 'evaluation-failed', eventType: 'RESPONSE_EVALUATED', status: 'FAILED', parentEventId: 'suggestion-1', payload: { errorCode: 'INTELLIGENCE_PROVIDER_UNAVAILABLE' } },
  ];

  assert.equal(effectiveAnalysis(events).sentiment, 'NEGATIVE');
  assert.equal(latestResponseVersion(events).id, 'suggestion-1');
  assert.equal(latestResponseEvaluation(events, 'suggestion-1').id, 'evaluation-1');
});

test('summary cards show unavailable values instead of implying zero when the API has failed', () => {
  const html = renderStats({ unavailable: true });

  assert.equal((html.match(/<div class="stat-value">—<\/div>/g) ?? []).length, 4);
  assert.match(html, /Dados indisponíveis/);
});
