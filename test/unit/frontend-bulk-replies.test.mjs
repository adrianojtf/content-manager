import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approveSemiAutomaticReplies,
  eligibleSemiAutomaticReplyRows,
  generateSemiAutomaticReplies,
  isConfirmedUnanswered,
  loadSemiAutomaticReplyComments,
  regenerateSemiAutomaticReply,
  sendApprovedSemiAutomaticReplies,
} from '../../web/bulk-replies.mjs';

const toneProfile = {
  primaryTone: 'EMPATHETIC',
  modifiers: ['CONCISE'],
  customNote: 'Do not promise unconfirmed dates.',
};

test('the semi-automatic queue includes only comments with a confirmed unanswered status', () => {
  assert.equal(isConfirmedUnanswered({ appReplied: false, externalReplyStatus: 'NOT_REPLIED' }), true);
  assert.equal(isConfirmedUnanswered({ appReplied: true, externalReplyStatus: 'NOT_REPLIED' }), false);
  assert.equal(isConfirmedUnanswered({ appReplied: false, externalReplyStatus: 'REPLIED' }), false);
  assert.equal(isConfirmedUnanswered({ appReplied: false, externalReplyStatus: 'UNKNOWN' }), false);
});

test('loading the semi-automatic queue syncs all pages for one publication and excludes unknown replies', async () => {
  const calls = [];
  const comments = [
    { externalCommentId: 'pending-1', appReplied: false, externalReplyStatus: 'NOT_REPLIED' },
    { externalCommentId: 'replied-1', appReplied: false, externalReplyStatus: 'REPLIED' },
    { externalCommentId: 'unknown-1', appReplied: false, externalReplyStatus: 'UNKNOWN' },
    { externalCommentId: 'app-replied-1', appReplied: true, externalReplyStatus: 'NOT_REPLIED' },
    { externalCommentId: 'stale-pending-1', appReplied: false, externalReplyStatus: 'NOT_REPLIED' },
  ];
  const api = {
    runWorkflowBatch: async (input) => {
      calls.push(['sync', input]);
      return {
        status: 'PARTIAL',
        results: [
          { externalCommentId: 'pending-1', status: 'SUCCEEDED' },
          { externalCommentId: 'replied-1', status: 'SUCCEEDED' },
        ],
      };
    },
    listComments: async (...args) => {
      calls.push(['comments', ...args]);
      return comments;
    },
  };

  const result = await loadSemiAutomaticReplyComments(api, 'account-1', 'video-1');

  assert.deepEqual(calls, [
    ['sync', { operation: 'sync', scope: 'publication', accountId: 'account-1', publicationId: 'video-1' }],
    ['comments', 'account-1', 'video-1'],
  ]);
  assert.deepEqual(result.comments.map((comment) => comment.externalCommentId), ['pending-1']);
  assert.equal(result.allComments.length, 5);
});

test('generation evaluates only missing analyses, processes comments sequentially, and keeps failures isolated', async () => {
  const calls = [];
  const eventsByComment = new Map([
    ['has-analysis', [{ id: 'analysis-existing', eventType: 'COMMENT_ANALYSIS_CREATED', status: 'SUCCEEDED', payload: {} }]],
    ['needs-analysis', []],
    ['analysis-fails', []],
  ]);
  const api = {
    getWorkflow: async (accountId, commentId) => {
      calls.push(['workflow', commentId]);
      return [...eventsByComment.get(commentId)];
    },
    classify: async (accountId, commentId) => {
      calls.push(['classify', commentId]);
      if (commentId === 'analysis-fails') throw Object.assign(new Error('failed'), { code: 'INTELLIGENCE_PROVIDER_UNAVAILABLE' });
      eventsByComment.set(commentId, [{
        id: 'analysis-new',
        eventType: 'COMMENT_ANALYSIS_CREATED',
        status: 'SUCCEEDED',
        payload: {},
      }]);
      return eventsByComment.get(commentId)[0];
    },
    generateResponse: async (accountId, commentId, options) => {
      calls.push(['generate', commentId, options]);
      eventsByComment.set(commentId, [
        ...eventsByComment.get(commentId),
        { id: `suggestion-${commentId}`, eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { language: 'pt-BR' } },
      ]);
      return { variants: [eventsByComment.get(commentId).at(-1)], failures: [] };
    },
  };
  const comments = ['has-analysis', 'needs-analysis', 'analysis-fails'].map((externalCommentId) => ({
    socialAccountId: 'account-1',
    externalCommentId,
    externalReplyStatus: 'NOT_REPLIED',
    appReplied: false,
  }));
  const progress = [];

  const rows = await generateSemiAutomaticReplies(api, {
    accountId: 'account-1',
    comments,
    toneProfile,
    toneProfileForComment: (item) => item.externalCommentId === 'needs-analysis'
      ? { ...toneProfile, primaryTone: 'CASUAL' }
      : toneProfile,
    onProgress: (update) => progress.push([update.commentId, update.phase]),
  });

  assert.deepEqual(calls, [
    ['workflow', 'has-analysis'],
    ['generate', 'has-analysis', { analysisEventId: 'analysis-existing', toneOverride: toneProfile.primaryTone }],
    ['workflow', 'has-analysis'],
    ['workflow', 'needs-analysis'],
    ['classify', 'needs-analysis'],
    ['workflow', 'needs-analysis'],
    ['generate', 'needs-analysis', { analysisEventId: 'analysis-new', toneOverride: 'CASUAL' }],
    ['workflow', 'needs-analysis'],
    ['workflow', 'analysis-fails'],
    ['classify', 'analysis-fails'],
    ['workflow', 'analysis-fails'],
  ]);
  assert.deepEqual(rows.map((row) => row.status), ['ready', 'ready', 'failed']);
  assert.equal(rows[2].errorCode, 'INTELLIGENCE_PROVIDER_UNAVAILABLE');
  assert.deepEqual(progress.filter(([, phase]) => phase !== 'completed').slice(0, 4), [
    ['has-analysis', 'loading-history'],
    ['has-analysis', 'generating'],
    ['needs-analysis', 'loading-history'],
    ['needs-analysis', 'evaluating'],
  ]);
});

test('bulk approval appends only changed response revisions and never sends replies', async () => {
  const toneProfile = { primaryTone: 'FRIENDLY', modifiers: [], customNote: null };
  const editedSuggestion = {
    id: 'suggestion-1',
    eventType: 'RESPONSE_SUGGESTION_GENERATED',
    status: 'SUCCEEDED',
    payload: { language: 'pt-BR', text: 'Original AI text', toneProfile },
  };
  const englishSuggestion = {
    id: 'suggestion-en',
    eventType: 'RESPONSE_SUGGESTION_GENERATED',
    status: 'SUCCEEDED',
    payload: { language: 'en-US', text: 'Original English AI text', toneProfile },
  };
  const unchangedSuggestion = {
    id: 'suggestion-2',
    eventType: 'RESPONSE_SUGGESTION_GENERATED',
    status: 'SUCCEEDED',
    payload: { language: 'pt-BR', text: 'Leave this as generated', toneProfile },
  };
  const rows = [
    {
      comment: { externalCommentId: 'edited-comment' },
      status: 'ready',
      language: 'pt-BR',
      events: [editedSuggestion, englishSuggestion],
      draft: 'Human-edited text',
      drafts: new Map([
        ['pt-BR', 'Human-edited text'],
        ['en-US', 'Human-edited English text'],
      ]),
      approved: false,
    },
    {
      comment: { externalCommentId: 'unchanged-comment' },
      status: 'ready',
      language: 'pt-BR',
      events: [unchangedSuggestion],
      draft: unchangedSuggestion.payload.text,
      drafts: new Map(),
      approved: false,
    },
  ];
  const calls = [];
  const revision = {
    id: 'revision-1',
    eventType: 'RESPONSE_SUGGESTION_EDITED',
    status: 'SUCCEEDED',
    payload: { originalSuggestionEventId: 'suggestion-1', text: 'Human-edited text' },
  };
  const englishRevision = {
    id: 'revision-en',
    eventType: 'RESPONSE_SUGGESTION_EDITED',
    status: 'SUCCEEDED',
    payload: { originalSuggestionEventId: 'suggestion-en', text: 'Human-edited English text' },
  };
  let historyReads = 0;
  const api = {
    reviseSuggestion: async (...args) => {
      calls.push(['revise', ...args]);
      return args[2] === 'suggestion-1' ? revision : englishRevision;
    },
    getWorkflow: async (accountId, commentId) => {
      calls.push(['history', commentId]);
      historyReads += 1;
      return historyReads === 1
        ? [editedSuggestion, revision, englishSuggestion]
        : [editedSuggestion, revision, englishSuggestion, englishRevision];
    },
    sendResponse: async () => {
      throw new Error('bulk approval must never send');
    },
  };

  const result = await approveSemiAutomaticReplies(api, {
    accountId: 'account-1',
    rows,
    commentIds: ['edited-comment', 'unchanged-comment'],
  });

  assert.deepEqual(result, { approved: 2, failed: 0 });
  assert.deepEqual(calls, [
    ['revise', 'account-1', 'edited-comment', 'suggestion-1', { text: 'Human-edited text' }],
    ['history', 'edited-comment'],
    ['revise', 'account-1', 'edited-comment', 'suggestion-en', { text: 'Human-edited English text' }],
    ['history', 'edited-comment'],
  ]);
  assert.equal(rows[0].events.at(-1).id, 'revision-en');
  assert.equal(rows[0].approved, true);
  assert.equal(rows[1].approved, true);
});

test('send-all includes only approved, capable, unattempted rows and continues after an isolated failure', async () => {
  const makeRow = (commentId, versionId, { approved = true, canReply = true, attempted = false } = {}) => {
    const events = [{
      id: versionId,
      eventType: 'RESPONSE_SUGGESTION_GENERATED',
      status: 'SUCCEEDED',
      payload: { language: 'pt-BR', text: `Saved reply for ${commentId}` },
    }];
    if (attempted) {
      events.push({
        id: `attempt-${commentId}`,
        eventType: 'MANUAL_REPLY_ATTEMPTED',
        parentEventId: versionId,
        payload: { responseVersionEventId: versionId, revisionEventId: versionId },
      });
    }
    return {
      comment: {
        externalCommentId: commentId,
        canReply,
        appReplied: false,
        externalReplyStatus: 'NOT_REPLIED',
      },
      status: approved ? 'approved' : 'ready',
      language: 'pt-BR',
      events,
      approved,
    };
  };
  const rows = [
    makeRow('first', 'version-first'),
    makeRow('unapproved', 'version-unapproved', { approved: false }),
    makeRow('unsupported', 'version-unsupported', { canReply: false }),
    makeRow('attempted', 'version-attempted', { attempted: true }),
    makeRow('fails', 'version-fails'),
    makeRow('last', 'version-last'),
  ];
  const calls = [];
  const progress = [];
  let activeRequests = 0;
  let maximumConcurrentRequests = 0;
  const api = {
    sendResponse: async (accountId, commentId, versionId) => {
      activeRequests += 1;
      maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
      calls.push(['send', accountId, commentId, versionId]);
      await Promise.resolve();
      activeRequests -= 1;
      if (commentId === 'fails') {
        throw Object.assign(new Error('provider unavailable'), { code: 'SOCIAL_PROVIDER_UNAVAILABLE' });
      }
      return {
        id: `result-${commentId}`,
        eventType: 'MANUAL_REPLY_RESULT',
        status: 'SUCCEEDED',
        payload: { responseVersionEventId: versionId },
      };
    },
    getWorkflow: async (accountId, commentId) => {
      calls.push(['history', commentId]);
      const row = rows.find((item) => item.comment.externalCommentId === commentId);
      return [...row.events];
    },
  };

  assert.deepEqual(
    eligibleSemiAutomaticReplyRows(rows).map((row) => row.comment.externalCommentId),
    ['first', 'fails', 'last'],
  );
  const result = await sendApprovedSemiAutomaticReplies(api, {
    accountId: 'account-1',
    rows,
    onProgress: (update) => progress.push([update.phase, update.row.comment.externalCommentId]),
  });

  assert.deepEqual(result, { sent: 2, failed: 1, remaining: 0, stoppedByRateLimit: false });
  assert.deepEqual(calls.filter(([kind]) => kind === 'send'), [
    ['send', 'account-1', 'first', 'version-first'],
    ['send', 'account-1', 'fails', 'version-fails'],
    ['send', 'account-1', 'last', 'version-last'],
  ]);
  assert.equal(maximumConcurrentRequests, 1);
  assert.deepEqual(rows.map((row) => row.status), [
    'sent',
    'ready',
    'approved',
    'approved',
    'send-failed',
    'sent',
  ]);
  assert.deepEqual(progress.filter(([phase]) => phase === 'completed'), [
    ['completed', 'first'],
    ['completed', 'fails'],
    ['completed', 'last'],
  ]);
  assert.equal(rows[0].events.at(-1).id, 'result-first');
  assert.equal(rows[4].errorCode, 'SOCIAL_PROVIDER_UNAVAILABLE');
});

test('send-all stops after a platform rate limit and leaves remaining approved rows unsent', async () => {
  const rows = ['first', 'limited', 'not-sent'].map((commentId) => ({
    comment: {
      externalCommentId: commentId,
      canReply: true,
      appReplied: false,
      externalReplyStatus: 'NOT_REPLIED',
    },
    status: 'approved',
    language: 'pt-BR',
    events: [{
      id: `version-${commentId}`,
      eventType: 'RESPONSE_SUGGESTION_GENERATED',
      status: 'SUCCEEDED',
      payload: { language: 'pt-BR', text: `Reply to ${commentId}` },
    }],
    approved: true,
  }));
  const calls = [];
  const api = {
    sendResponse: async (accountId, commentId, versionId) => {
      calls.push(['send', commentId, versionId]);
      if (commentId === 'limited') {
        throw Object.assign(new Error('rate limited'), { code: 'SOCIAL_PROVIDER_RATE_LIMITED' });
      }
      return {
        id: `result-${commentId}`,
        eventType: 'MANUAL_REPLY_RESULT',
        status: 'SUCCEEDED',
        payload: { responseVersionEventId: versionId },
      };
    },
    getWorkflow: async (_accountId, commentId) => {
      calls.push(['history', commentId]);
      return [];
    },
  };

  const result = await sendApprovedSemiAutomaticReplies(api, {
    accountId: 'account-1',
    rows,
  });

  assert.deepEqual(result, { sent: 1, failed: 1, remaining: 1, stoppedByRateLimit: true });
  assert.deepEqual(calls.filter(([kind]) => kind === 'send'), [
    ['send', 'first', 'version-first'],
    ['send', 'limited', 'version-limited'],
  ]);
  assert.equal(rows[0].status, 'sent');
  assert.equal(rows[1].status, 'send-failed');
  assert.equal(rows[2].status, 'approved');
});

test('generated variants remain available when the follow-up history read fails', async () => {
  const analysis = { id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', status: 'SUCCEEDED', payload: {} };
  const suggestion = {
    id: 'suggestion-1',
    eventType: 'RESPONSE_SUGGESTION_GENERATED',
    status: 'SUCCEEDED',
    payload: { language: 'pt-BR', text: 'Saved suggestion' },
  };
  let historyReads = 0;
  const api = {
    getWorkflow: async () => {
      historyReads += 1;
      if (historyReads > 1) throw Object.assign(new Error('unavailable'), { code: 'API_UNAVAILABLE' });
      return [analysis];
    },
    generateResponse: async () => ({ variants: [suggestion], failures: [] }),
  };

  const rows = await generateSemiAutomaticReplies(api, {
    accountId: 'account-1',
    comments: [{ externalCommentId: 'comment-1' }],
    toneProfile,
  });

  assert.equal(rows[0].status, 'ready');
  assert.equal(rows[0].historyWarning, true);
  assert.equal(rows[0].events.at(-1).id, 'suggestion-1');
});

test('tone regeneration reuses the existing analysis and only generates new suggestions', async () => {
  const calls = [];
  const existingEvents = [
    { id: 'analysis-failed', eventType: 'COMMENT_ANALYSIS_CREATED', status: 'FAILED', payload: {} },
    { id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', status: 'SUCCEEDED', payload: { sentiment: 'NEUTRAL' } },
    { id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { language: 'pt-BR', text: 'Original', toneProfile: { primaryTone: 'FRIENDLY' } } },
  ];
  const regenerated = {
    id: 'suggestion-2',
    eventType: 'RESPONSE_SUGGESTION_GENERATED',
    status: 'SUCCEEDED',
    payload: { language: 'pt-BR', text: 'Novo tom', toneProfile: { primaryTone: 'CASUAL' } },
  };
  const api = {
    classify: async () => { calls.push(['classify']); throw new Error('must not re-evaluate'); },
    generateResponse: async (accountId, commentId, options) => {
      calls.push(['generate', commentId, options]);
      return { variants: [regenerated], failures: [] };
    },
    getWorkflow: async (accountId, commentId) => {
      calls.push(['workflow', commentId]);
      return [...existingEvents, regenerated];
    },
  };

  const result = await regenerateSemiAutomaticReply(api, {
    accountId: 'account-1',
    commentId: 'comment-1',
    events: existingEvents,
    toneOverride: 'CASUAL',
  });

  assert.deepEqual(calls, [
    ['generate', 'comment-1', { analysisEventId: 'analysis-1', toneOverride: 'CASUAL' }],
    ['workflow', 'comment-1'],
  ]);
  assert.equal(result.events.at(-1).id, 'suggestion-2');
  assert.deepEqual(result.failures, []);
  assert.equal(result.historyWarning, false);
});

test('tone regeneration merges generated variants when the history read fails', async () => {
  const existingEvents = [
    { id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', status: 'SUCCEEDED', payload: {} },
  ];
  const regenerated = { id: 'suggestion-2', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { language: 'pt-BR' } };
  const api = {
    generateResponse: async () => ({ variants: [regenerated], failures: [{ language: 'en-US', errorCode: 'X' }] }),
    getWorkflow: async () => { throw Object.assign(new Error('unavailable'), { code: 'API_UNAVAILABLE' }); },
  };

  const result = await regenerateSemiAutomaticReply(api, {
    accountId: 'account-1',
    commentId: 'comment-1',
    events: existingEvents,
    toneOverride: 'EMPATHETIC',
  });

  assert.equal(result.historyWarning, true);
  assert.deepEqual(result.events.map((event) => event.id), ['analysis-1', 'suggestion-2']);
  assert.deepEqual(result.failures, [{ language: 'en-US', errorCode: 'X' }]);
});

test('tone regeneration fails with COMMENT_ANALYSIS_NOT_FOUND without classifying when no usable analysis exists', async () => {
  const calls = [];
  const api = {
    classify: async () => { calls.push(['classify']); },
    generateResponse: async () => { calls.push(['generate']); },
    getWorkflow: async () => { calls.push(['workflow']); },
  };

  await assert.rejects(
    regenerateSemiAutomaticReply(api, {
      accountId: 'account-1',
      commentId: 'comment-1',
      events: [{ id: 'analysis-failed', eventType: 'COMMENT_ANALYSIS_CREATED', status: 'FAILED', payload: {} }],
      toneOverride: 'CASUAL',
    }),
    (error) => error.code === 'COMMENT_ANALYSIS_NOT_FOUND',
  );

  assert.deepEqual(calls, []);
});
