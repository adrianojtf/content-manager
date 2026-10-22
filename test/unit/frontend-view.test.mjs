import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  commentKey,
  effectiveAnalysis,
  escapeHtml,
  latestResponseEvaluation,
  latestResponseVersion,
  renderAppearanceSettings,
  renderAIProviderSettings,
  renderBulkReplyDialog,
  renderConnectionSettings,
  renderComment,
  renderPublicationCard,
  renderPublicationPagination,
  renderSocialTabs,
  renderStats,
  renderVerifiedReleaseSchedulePanel,
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
  intent: 'CONTENT_REQUEST',
  topic: 'ACCESSIBILITY',
  entity: null,
  spamScore: 0.1,
  toxicityScore: 0.25,
  engagementValue: 0.5,
  continuationRequestProbability: 0.96,
  confidence: 0.9,
  rationale: 'Review the reported issue.',
  provider: 'JEV',
  model: 'test-model',
  schemaVersion: '1',
  signals: {
    needsExternalFacts: { probability: 0.76 },
    requestsContinuation: { probability: 0.96 },
  },
};

test('verified release schedule form distinguishes unconfigured, unsaved, confirmed, and disabled states', () => {
  const emptyModel = {
    open: true,
    accountSelected: true,
    loading: false,
    saving: false,
    error: null,
    dirty: false,
    schedule: null,
    draft: { enabled: false, daysOfWeek: [], localTime: '', timeZone: 'America/Sao_Paulo' },
  };
  const empty = renderVerifiedReleaseSchedulePanel(emptyModel);
  assert.match(empty, /id="verifiedReleaseScheduleForm"/);
  assert.match(empty, /<select id="verifiedScheduleTimeZone"/);
  assert.match(empty, /<option value="America\/Sao_Paulo" selected>/);
  assert.match(empty, /<option value="Europe\/London"/);
  assert.match(empty, /name="daysOfWeek"/);
  assert.match(empty, /data-day-of-week="MONDAY"/);
  assert.match(empty, /Não há uma agenda confirmada/);
  assert.doesNotMatch(empty, /data-role="verified-schedule-enabled" checked/);
  assert.match(empty, /id="verifiedScheduleLocalTime"[^>]*value=""/);

  const activeSchedule = {
    enabled: true,
    daysOfWeek: ['MONDAY', 'WEDNESDAY'],
    localTime: '20:30',
    timeZone: 'America/Sao_Paulo',
    version: 2,
    updatedAt: '2026-10-15T12:00:00.000Z',
    confirmedAt: '2026-10-15T12:00:00.000Z',
  };
  const active = renderVerifiedReleaseSchedulePanel({
    ...emptyModel,
    schedule: activeSchedule,
    draft: activeSchedule,
  });
  assert.match(active, /data-day-of-week="MONDAY"[^>]*checked/);
  assert.match(active, /value="20:30"/);
  assert.match(active, /<option value="America\/Sao_Paulo" selected>/);
  assert.match(active, /Agenda salva e confirmada \(versão 2\)/);

  const unsaved = renderVerifiedReleaseSchedulePanel({
    ...emptyModel,
    schedule: activeSchedule,
    draft: { ...activeSchedule, localTime: '21:00' },
    dirty: true,
  });
  assert.match(unsaved, /Alterações não salvas/);
  assert.match(unsaved, /value="21:00"/);

  const disabled = renderVerifiedReleaseSchedulePanel({
    ...emptyModel,
    schedule: { ...activeSchedule, enabled: false },
    draft: { ...activeSchedule, enabled: false },
  });
  assert.match(disabled, /Agenda salva, mas desativada/);
  assert.match(disabled, /data-role="verified-schedule-enabled"/);
  assert.doesNotMatch(disabled, /data-role="verified-schedule-enabled" checked/);
});

test('verified release schedule controls use theme tokens and theme-aware form colors', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.verified-schedule-panel\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.verified-schedule-panel \.field select,\s*\.verified-schedule-panel \.field input\[type="time"\]\s*\{[^}]*background:\s*var\(--surface-soft\)[^}]*color:\s*var\(--text\)[^}]*color-scheme:\s*light dark/s);
  assert.match(styles, /\[data-theme="dark"\]\s*\{[^}]*--surface:\s*#[\da-f]{6}[^}]*--text:\s*#[\da-f]{6}/is);
});

test('verified release schedule form exposes accessible loading, no-account, validation, and retry states', () => {
  const base = {
    open: true,
    accountSelected: true,
    loading: false,
    saving: false,
    error: null,
    dirty: false,
    schedule: null,
    draft: { enabled: false, daysOfWeek: [], localTime: '', timeZone: 'America/Sao_Paulo' },
  };
  const noAccount = renderVerifiedReleaseSchedulePanel({ ...base, accountSelected: false });
  assert.match(noAccount, /Selecione uma única conta social/);
  assert.match(noAccount, /data-role="verified-schedule-enabled"[^>]*disabled/);

  const loading = renderVerifiedReleaseSchedulePanel({ ...base, loading: true });
  assert.match(loading, /Carregando agenda/);
  assert.match(loading, /schedule-save" disabled/);

  const saving = renderVerifiedReleaseSchedulePanel({ ...base, saving: true });
  assert.match(saving, /Salvando…/);

  const loadError = renderVerifiedReleaseSchedulePanel({
    ...base,
    error: { kind: 'load', code: 'VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE' },
  });
  assert.match(loadError, /Não foi possível carregar a agenda/);
  assert.match(loadError, /data-action="retry-verified-schedule"[^>]*>Tentar carregar novamente/);

  const invalid = renderVerifiedReleaseSchedulePanel({
    ...base,
    error: { kind: 'validation', message: 'Verifique os campos da agenda.' },
  });
  assert.match(invalid, /Verifique os campos da agenda/);
  assert.match(invalid, /id="verifiedScheduleTimeZone"[^>]*aria-invalid="true"/);
});

test('verified release schedule panel offers account and global scopes with source-aware status', () => {
  const base = {
    open: true,
    accountSelected: true,
    loading: false,
    saving: false,
    error: null,
    dirty: false,
    schedule: null,
    draft: { enabled: false, daysOfWeek: [], localTime: '', timeZone: 'America/Sao_Paulo' },
  };

  const accountScope = renderVerifiedReleaseSchedulePanel({ ...base, scope: 'ACCOUNT' });
  assert.match(accountScope, /data-action="verified-schedule-scope" data-scope="ACCOUNT"[^>]*aria-pressed="true"/);
  assert.match(accountScope, /data-action="verified-schedule-scope" data-scope="GLOBAL"[^>]*aria-pressed="false"/);
  assert.match(accountScope, /Agenda de lançamentos desta conta/);

  const globalSchedule = {
    enabled: true,
    daysOfWeek: ['FRIDAY'],
    localTime: '18:00',
    timeZone: 'UTC',
    version: 4,
    updatedAt: '2026-10-15T12:00:00.000Z',
    confirmedAt: '2026-10-15T12:00:00.000Z',
  };
  const globalScope = renderVerifiedReleaseSchedulePanel({
    ...base,
    scope: 'GLOBAL',
    accountSelected: false,
    schedule: globalSchedule,
    source: 'TENANT',
    draft: globalSchedule,
  });
  assert.match(globalScope, /data-scope="GLOBAL"[^>]*aria-pressed="true"/);
  assert.match(globalScope, /Agenda global de lançamentos/);
  assert.match(globalScope, /Agenda salva e confirmada \(versão 4\)/);
  assert.doesNotMatch(globalScope, /data-role="verified-schedule-enabled"[^>]*disabled/);
  assert.match(globalScope, /data-day-of-week="FRIDAY"[^>]*checked/);

  const inherited = renderVerifiedReleaseSchedulePanel({
    ...base,
    scope: 'ACCOUNT',
    schedule: globalSchedule,
    source: 'TENANT',
    draft: globalSchedule,
  });
  assert.match(inherited, /Herdando a agenda global ativa \(versão 4\)/);

  const inheritedDisabled = renderVerifiedReleaseSchedulePanel({
    ...base,
    scope: 'ACCOUNT',
    schedule: { ...globalSchedule, enabled: false },
    source: 'TENANT',
    draft: { ...globalSchedule, enabled: false },
  });
  assert.match(inheritedDisabled, /Herdando a agenda global desativada \(versão 4\)/);

  const unconfiguredGlobal = renderVerifiedReleaseSchedulePanel({
    ...base,
    scope: 'GLOBAL',
    accountSelected: false,
    source: 'UNCONFIGURED',
  });
  assert.match(unconfiguredGlobal, /Não há uma agenda global confirmada/);
});

test('settings scope controls use theme tokens in both themes', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.settings-scope\s*\{[^}]*border:\s*1px solid var\(--border\)[^}]*background:\s*var\(--surface-soft\)/s);
  assert.match(styles, /\.scope-option\.is-active\s*\{[^}]*background:\s*var\(--blue-soft\)[^}]*color:\s*var\(--blue\)/s);
  assert.doesNotMatch(styles.match(/\.settings-scope[^}]*\}/s)?.[0] ?? '', /#[\da-f]{3,6}/i);
});

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

test('response variant selection resolves the saved revision for the requested locale', () => {
  const events = [
    { id: 'suggestion-pt', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { text: 'Olá', language: 'pt-BR' } },
    { id: 'suggestion-en', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { text: 'Hello', language: 'en-US' } },
    { id: 'revision-en', eventType: 'RESPONSE_SUGGESTION_EDITED', status: 'SUCCEEDED', parentEventId: 'suggestion-en', payload: { originalSuggestionEventId: 'suggestion-en', text: 'Hello there' } },
    { id: 'suggestion-es', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { text: 'Hola', language: 'es-ES' } },
  ];

  assert.equal(responseVersionDetails(events, 'pt-BR').version.id, 'suggestion-pt');
  assert.equal(responseVersionDetails(events, 'en-US').version.id, 'revision-en');
  assert.equal(responseVersionDetails(events, 'es-ES').version.id, 'suggestion-es');
  assert.equal(responseVersionDetails(events, 'fr-FR'), null);
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
  assert.ok(html.includes('Pedido de conteúdo'));
  assert.ok(html.includes('Potencial de engajamento (estimado)'));
  assert.ok(html.includes('Prob. de precisar de fatos externos'));
  assert.ok(html.includes('Prob. de pedir continuação'));
  assert.ok(html.includes('76%'));
  assert.ok(html.includes('96%'));
  assert.ok(html.includes('A plataforma não permite responder a este comentário.'));
  assert.match(html, /<button[^>]*data-action="send-response"[^>]*disabled/);
});

test('comment rendering shows only persisted creator replies and escapes their provider-supplied text', () => {
  const replyComment = {
    ...comment,
    externalReplyStatus: 'REPLIED',
    creatorReplies: [{
      externalReplyId: 'reply-1',
      externalCommentId: comment.externalCommentId,
      text: '<script>thanks</script>',
      createdAt: '2026-10-17T11:00:00.000Z',
    }],
  };
  const key = commentKey(replyComment.socialAccountId, replyComment.externalCommentId);
  const html = renderComment(replyComment, {
    workflows: new Map([[key, []]]),
    workflowErrors: new Map(),
    workflowLoading: new Set(),
    expandedComments: new Set(),
    drafts: new Map(),
    busy: new Set(),
    language: 'pt-BR',
  });

  assert.match(html, /Resposta do autor/);
  assert.match(html, /&lt;script&gt;thanks&lt;\/script&gt;/);
  assert.equal(html.includes('<script>thanks</script>'), false);
});

test('comment rendering does not duplicate a provider reply already recorded as an app send', () => {
  const replyComment = {
    ...comment,
    externalReplyStatus: 'REPLIED',
    creatorReplies: [{
      externalReplyId: 'app-reply-1',
      externalCommentId: comment.externalCommentId,
      text: 'The saved app response',
      createdAt: '2026-10-17T11:00:00.000Z',
    }],
  };
  const key = commentKey(replyComment.socialAccountId, replyComment.externalCommentId);
  const workflows = new Map([[key, [
    { id: 'response-1', eventType: 'MANUAL_RESPONSE_CREATED', status: 'SUCCEEDED', payload: { text: 'The saved app response' } },
    { id: 'send-1', eventType: 'MANUAL_REPLY_RESULT', status: 'SUCCEEDED', payload: { externalReplyId: 'app-reply-1' } },
  ]]]);
  const html = renderComment(replyComment, {
    workflows,
    workflowErrors: new Map(),
    workflowLoading: new Set(),
    expandedComments: new Set([key]),
    drafts: new Map(),
    busy: new Set(),
    language: 'pt-BR',
  });

  assert.equal(html.match(/The saved app response/g)?.length, 1);
});

test('response evaluation renders the optional schedule consistency signal without inventing a score', () => {
  const suggestion = { id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', status: 'SUCCEEDED', payload: { text: 'Wednesday at 8:30 PM.', language: 'pt-BR' } };
  const scheduleSnapshot = {
    status: 'ACTIVE',
    schedule: {
      enabled: true,
      daysOfWeek: ['WEDNESDAY'],
      localTime: '20:30',
      timeZone: 'America/Sao_Paulo',
      version: 1,
      updatedAt: '2026-10-15T12:00:00.000Z',
      confirmedAt: '2026-10-15T12:00:00.000Z',
    },
  };
  const key = commentKey(comment.socialAccountId, comment.externalCommentId);
  const model = {
    workflows: new Map([[key, [
      suggestion,
      {
        id: 'evaluation-1',
        eventType: 'RESPONSE_EVALUATED',
        status: 'SUCCEEDED',
        parentEventId: suggestion.id,
        payload: {
          evaluation: { publishRecommendation: 'REVIEW', scheduleConsistency: 0.82 },
          verifiedReleaseScheduleSnapshot: scheduleSnapshot,
        },
      },
    ]]]),
    workflowErrors: new Map(),
    workflowLoading: new Set(),
    expandedComments: new Set([key]),
    drafts: new Map(),
    busy: new Set(),
    language: 'pt-BR',
  };

  const active = renderComment(comment, model);
  assert.match(active, /Consistência com a agenda \(consultiva\): 82%/);

  const noSchedule = renderComment(comment, {
    ...model,
    workflows: new Map([[key, [
      suggestion,
      {
        id: 'evaluation-2',
        eventType: 'RESPONSE_EVALUATED',
        status: 'SUCCEEDED',
        parentEventId: suggestion.id,
        payload: {
          evaluation: { publishRecommendation: 'REVIEW' },
          verifiedReleaseScheduleSnapshot: { status: 'UNCONFIGURED', schedule: null },
        },
      },
    ]]]),
  });
  assert.match(noSchedule, /Consistência da agenda não avaliada/);
  assert.doesNotMatch(noSchedule, /Consistência com a agenda \(consultiva\):/);
});

test('publication sync failures show a generic badge beside the platform-specific explanation', () => {
  const publication = {
    account: { id: 'account-1', platform: 'youtube', externalAccountId: 'UC-channel-1', displayName: 'Creator channel' },
    item: { platform: 'youtube', externalPublicationId: 'video-1', title: 'Video title' },
  };
  const key = `${publication.account.id}\u0000${publication.item.externalPublicationId}`;
  const html = renderPublicationCard(publication, {
    comments: new Map([[key, {
      items: [],
      syncing: false,
      error: 'Os comentários deste vídeo estão desativados.',
      syncErrorCode: 'SOCIAL_COMMENTS_DISABLED',
    }]]),
    workflows: new Map(),
    workflowErrors: new Map(),
    workflowLoading: new Set(),
    expandedPublications: new Set(),
    expandedComments: new Set(),
    drafts: new Map(),
    busy: new Set(),
    accountResults: new Map(),
    language: 'pt-BR',
  });

  assert.match(html, /<span class="pill error">Falha ao sincronizar<\/span>/);
  assert.match(html, /class="sync-error-detail"[^>]*>Os comentários deste vídeo estão desativados\./);
  assert.match(html, /data-action="bulk-reply"[^>]*data-account-id="account-1"[^>]*data-publication-id="video-1"/);
});

test('bulk reply dialog shows safe side-by-side drafts, per-comment tone, selection, and review-only approval', () => {
  const toneProfile = { primaryTone: 'EMPATHETIC', modifiers: ['CONCISE'], customNote: null };
  const events = [
    {
      id: 'suggestion-1',
      eventType: 'RESPONSE_SUGGESTION_GENERATED',
      status: 'SUCCEEDED',
      payload: { language: 'pt-BR', text: '<script>Original AI</script>', toneProfile },
    },
    {
      id: 'revision-1',
      eventType: 'RESPONSE_SUGGESTION_EDITED',
      status: 'SUCCEEDED',
      payload: { originalSuggestionEventId: 'suggestion-1', text: '<img src=x onerror=alert(1)>' },
    },
  ];
  const html = renderBulkReplyDialog({
    open: true,
    status: 'review',
    videoTitle: '<b>Video title</b>',
    accountName: '<i>Creator</i>',
    rows: [{
      comment: { ...comment, externalReplyStatus: 'NOT_REPLIED', appReplied: false },
      status: 'ready',
      language: 'pt-BR',
      toneProfile,
      events,
      draft: '<img src=x onerror=alert(1)>',
      errorCode: null,
      approved: false,
    }],
    selectedIds: new Set(['comment-1']),
    busy: false,
    progress: null,
    syncWarning: null,
    errorCode: null,
  });

  assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /class="bulk-reply-row/);
  assert.match(html, /data-role="bulk-selection"[^>]*checked/);
  assert.match(html, /data-role="bulk-response-draft"/);
  assert.match(html, /data-role="bulk-response-tone"/);
  assert.match(html, /data-action="approve-bulk-row"/);
  assert.match(html, /data-action="approve-selected"/);
  assert.match(html, /data-action="approve-all"/);
  assert.match(html, /Texto alterado por você/);
  assert.match(html, /&lt;script&gt;Original AI&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(html.includes('<script>Original AI</script>'), false);
  assert.equal(html.includes('<img src=x onerror=alert(1)>'), false);
  assert.doesNotMatch(html, /data-action="send-response"/);
});

test('global font-size control and mobile comments navigation remain available outside the dialog', () => {
  const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');

  assert.match(html, /class="global-font-settings"/);
  assert.match(html, /data-action="toggle-global-font-settings"/);
  assert.match(html, /aria-controls="globalFontSettingsPanel"/);
  assert.match(html, /data-ui-font-size-option/);
  assert.match(html, /value="very-large"/);
  assert.match(html, /class="button small mobile-comments-link"[^>]*data-view="comments"[^>]*>[\s\S]*data-i18n="nav\.comments"/);
});

test('toolbar sync and schedule actions use compact icons with accessible names', () => {
  const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../web/app.mjs', import.meta.url), 'utf8');
  const syncButton = html.match(/<button[^>]*id="syncPageButton"[\s\S]*?<\/button>/)?.[0] ?? '';
  const scheduleButton = html.match(/<button[^>]*id="verifiedReleaseScheduleToggle"[\s\S]*?<\/button>/)?.[0] ?? '';

  assert.match(syncButton, /aria-labelledby="syncPageLabel"/);
  assert.match(syncButton, /id="syncPageIcon"/);
  assert.match(syncButton, /id="syncPageLabel" class="visually-hidden"[^>]*data-i18n="toolbar\.syncPage"/);
  assert.match(scheduleButton, /data-i18n-aria-label="toolbar\.verifiedSchedule"/);
  assert.match(scheduleButton, /class="[^"]*\btoolbar-calendar-icon\b/);
  assert.doesNotMatch(scheduleButton, /data-i18n="toolbar\.verifiedSchedule"/);
  assert.match(app, /syncIcon\.hidden\s*=\s*Boolean\(syncProgress\)/);
  assert.match(app, /syncSpinner\.hidden\s*=\s*!syncProgress/);
});

test('bulk reply dialog renders accessible loading, empty, and error states', () => {
  const base = { open: true, videoTitle: 'Video', accountName: 'Creator', rows: [], selectedIds: new Set() };
  const loading = renderBulkReplyDialog({ ...base, status: 'syncing', busy: true });
  const empty = renderBulkReplyDialog({ ...base, status: 'ready', busy: false });
  const error = renderBulkReplyDialog({ ...base, status: 'error', errorCode: 'API_UNAVAILABLE', busy: false });

  assert.match(loading, /role="status" aria-live="polite"/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(empty, /class="bulk-empty-state"/);
  assert.match(error, /role="alert"/);
  assert.match(error, /Não foi possível carregar esta fila/);
});

test('bulk review exposes a separate send-all action only for approved saved responses', () => {
  const response = {
    id: 'suggestion-1',
    eventType: 'RESPONSE_SUGGESTION_GENERATED',
    status: 'SUCCEEDED',
    payload: { language: 'pt-BR', text: 'Approved saved response' },
  };
  const base = {
    open: true,
    videoTitle: 'Video',
    accountName: 'Creator',
    status: 'review',
    busy: false,
    selectedIds: new Set(),
    rows: [{
      comment: { ...comment, canReply: true },
      status: 'approved',
      language: 'pt-BR',
      events: [response],
      draft: response.payload.text,
      approved: true,
    }],
  };

  const sendable = renderBulkReplyDialog({ ...base, sendableCount: 1 });
  const notSendable = renderBulkReplyDialog({ ...base, sendableCount: 0 });
  const generating = renderBulkReplyDialog({ ...base, status: 'processing', sendableCount: 1 });

  assert.match(sendable, /data-action="send-all-approved"/);
  assert.match(sendable, /Enviar aprovadas \(1\)/);
  assert.match(sendable, /não envia nem publica/);
  assert.match(notSendable, /data-action="send-all-approved" disabled/);
  assert.match(notSendable, /Enviar aprovadas \(0\)/);
  assert.doesNotMatch(generating, /data-action="send-all-approved"/);
});

test('bulk send controls and outcomes use theme tokens in light and dark themes', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.button\.send-approved\s*\{[^}]*background:\s*var\(--green-soft\)[^}]*color:\s*var\(--green\)/s);
  assert.match(styles, /\.bulk-row-status\.send-failed[^}]*background:\s*var\(--red-soft\)[^}]*color:\s*var\(--red\)/s);
  assert.match(styles, /\[data-theme="dark"\]\s+\.button\.send-approved\s*\{[^}]*background:\s*var\(--green-soft\)[^}]*color:\s*var\(--green\)/s);
  assert.match(styles, /\[data-theme="dark"\]\s+\.bulk-row-status\.send-ambiguous\s*\{[^}]*background:\s*var\(--red-soft\)[^}]*color:\s*var\(--red\)/s);
  assert.match(styles, /\.bulk-approval-actions \.button\.send-approved\s*\{\s*flex-basis:\s*100%/);
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

test('summary cards render tenant-wide totals across all platforms', () => {
  const html = renderStats({
    summary: { totalComments: 9, unansweredComments: 4, unevaluatedComments: 6, sentRepliesToday: 3 },
  });

  const values = [...html.matchAll(/<div class="stat-value">([^<]+)<\/div>/g)].map((match) => match[1]);
  assert.deepEqual(values, ['9', '4', '6', '3']);
});

test('summary cards show placeholders until the summary loads', () => {
  const html = renderStats({ summary: null });

  assert.equal((html.match(/<div class="stat-value">—<\/div>/g) ?? []).length, 4);
});

test('profile settings render safe connected-account summaries and explicit Facebook Page selection', () => {
  const accounts = [
    { id: 'account-1', platform: 'facebook', externalAccountId: 'page-1', displayName: '<b>Creator Page</b>' },
  ];
  const html = renderConnectionSettings(accounts, {
    loading: false,
    error: null,
    connecting: new Set(),
    disconnectingAccounts: new Set(),
    facebookSelection: {
      selectionId: 'one-time-selection',
      pages: [{ pageId: 'page-2', displayName: '<script>Page</script>' }],
    },
    selectedFacebookPageId: 'page-2',
  });

  assert.ok(html.includes('&lt;b&gt;Creator Page&lt;/b&gt;'));
  assert.ok(html.includes('&lt;script&gt;Page&lt;/script&gt;'));
  assert.match(html, /data-action="disconnect-social-account"[^>]*data-account-id="account-1"/);
  assert.match(html, />Desconectar</);
  assert.ok(html.includes('data-action="select-facebook-page"'));
  assert.equal(html.includes('one-time-selection'), false);

  const pendingHtml = renderConnectionSettings(accounts, {
    loading: false,
    error: null,
    connecting: new Set(),
    disconnectingAccounts: new Set(['account-1']),
    facebookSelection: null,
    selectedFacebookPageId: null,
  });
  assert.match(pendingHtml, /data-action="disconnect-social-account"[^>]*disabled/);
  assert.match(pendingHtml, />Desconectando…</);
});

test('profile appearance settings expose the selected light or dark theme', () => {
  const dark = renderAppearanceSettings('dark');
  const light = renderAppearanceSettings('light');
  const spanish = renderAppearanceSettings('dark', 'es-ES');

  assert.match(dark, /data-theme-option="dark"[^>]*checked/);
  assert.match(dark, /data-theme-option="light"/);
  assert.match(light, /data-theme-option="light"[^>]*checked/);
  assert.match(spanish, /data-locale-option/);
  assert.match(spanish, /<option value="es-ES" selected>Español<\/option>/);
});

test('AI preferences render write-only password inputs and an allowlisted model selector', () => {
  const html = renderAIProviderSettings({
    loading: false,
    saving: false,
    savingAccess: false,
    error: null,
    accessError: null,
    active: { provider: 'google', model: 'gemini-3.5-flash-lite' },
    models: [
      { provider: 'google', model: 'gemini-3.5-flash-lite', displayName: 'Gemini Flash-Lite' },
      { provider: 'openai', model: 'gpt-6-luna', displayName: 'GPT-6 Luna' },
    ],
    accessSaving: false,
    access: {
      storageReady: true,
      jev: { apiKeyConfigured: true },
      textGeneration: {
        google: { credentialsConfigured: true, dataUsePolicy: 'free-tier-acknowledged', dataUsePolicyConfigured: true },
        openai: { credentialsConfigured: false },
      },
    },
  });

  assert.match(html, /id="responseGenerationModel"/);
  assert.match(html, /Gemini Flash-Lite/);
  assert.match(html, /GPT-6 Luna/);
  assert.match(html, /name="jevApiKey"[^>]*type="password"/);
  assert.match(html, /TypeSafe/);
  assert.match(html, /name="geminiApiKey"[^>]*type="password"/);
  assert.match(html, /name="openaiApiKey"[^>]*type="password"/);
  assert.match(html, /value="free-tier-acknowledged" selected/);
  assert.match(html, /class="setting-status configured"/);
  assert.doesNotMatch(html, /jevCommentEvaluationUrl|jevResponseEvaluationUrl|jevApiKeyHeader|jevApiKeyPrefix/);
  assert.match(html, /POST https:\/\/api\.typesafe\.ai\/v1\/systemone/);
  assert.match(html, /Bearer/);
  assert.match(html, /No Free tier, o conteúdo pode ser usado para aprimorar produtos do Google/);
  assert.doesNotMatch(html, /value="[^"]*secret/i);
});

test('publication pagination renders independent cursors and accessible loading states per account', () => {
  const account = { id: 'account-1', displayName: '<b>Channel</b>', externalAccountId: 'channel-1' };
  const html = renderPublicationPagination(account, {
    pageIndex: 1,
    hasPrevious: true,
    hasNext: true,
    loading: false,
  });
  assert.match(html, /aria-label="Paginação de &lt;b&gt;Channel&lt;\/b&gt;"/);
  assert.match(html, /data-action="publication-page" data-account-id="account-1" data-direction="previous"/);
  assert.match(html, /Página 2/);
  assert.match(html, /data-direction="next"/);

  const loading = renderPublicationPagination(account, {
    pageIndex: 1,
    hasPrevious: true,
    hasNext: true,
    loading: true,
  });
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Carregando vídeos…/);
  assert.match(loading, /data-direction="next"[^>]*disabled/);
});

test('network tabs distinguish unrequested publication pages from an empty loaded page', () => {
  const html = renderSocialTabs('youtube', { youtube: 5, instagram: null, facebook: undefined, tiktok: 0 });

  assert.match(html, /YouTube<span class="tab-count">5<\/span>/);
  assert.match(html, /Instagram<span class="tab-count">—<\/span>/);
  assert.match(html, /Facebook<span class="tab-count">—<\/span>/);
  assert.match(html, /TikTok<span class="tab-count">0<\/span>/);
});
