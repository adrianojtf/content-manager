import { apiErrorMessage, formatDateTime, formatNumber, t, uiLocale } from './i18n.mjs';

export const networkInfo = Object.freeze({
  instagram: { nameKey: 'network.name.instagram', symbol: '◎', className: 'instagram' },
  facebook: { nameKey: 'network.name.facebook', symbol: 'f', className: 'facebook' },
  tiktok: { nameKey: 'network.name.tiktok', symbol: '♪', className: 'tiktok' },
  youtube: { nameKey: 'network.name.youtube', symbol: '▶', className: 'youtube' },
});

const responseEventTypes = new Set([
  'RESPONSE_SUGGESTION_GENERATED',
  'RESPONSE_SUGGESTION_EDITED',
  'MANUAL_RESPONSE_CREATED',
  'MANUAL_RESPONSE_EDITED',
]);

const eventLabels = {
  COMMENT_SYNCED: 'event.sync',
  COMMENT_ANALYSIS_CREATED: 'event.analysis',
  COMMENT_ANALYSIS_CORRECTED: 'event.correction',
  RESPONSE_SUGGESTION_GENERATED: 'event.suggestion',
  RESPONSE_SUGGESTION_EDITED: 'event.suggestionEdit',
  MANUAL_RESPONSE_CREATED: 'event.manualResponse',
  MANUAL_RESPONSE_EDITED: 'event.manualEdit',
  RESPONSE_EVALUATED: 'event.responseEvaluation',
  MANUAL_REPLY_ATTEMPTED: 'event.sendStarted',
  MANUAL_REPLY_RESULT: 'event.sendFailed',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export function formatDate(value) {
  if (!value) return t('date.unavailable');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t('date.unavailable');
  return formatDateTime(date);
}

export function formatRelative(value, now = Date.now()) {
  if (!value) return t('date.unavailable');
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return t('date.unavailable');
  const minutes = Math.round((timestamp - now) / 60_000);
  const unit = Math.abs(minutes) < 60 ? 'minute' : Math.abs(minutes) < 1440 ? 'hour' : 'day';
  const divisor = unit === 'minute' ? 1 : unit === 'hour' ? 60 : 1440;
  return new Intl.RelativeTimeFormat(uiLocale, { numeric: 'auto' }).format(Math.round(minutes / divisor), unit);
}

export function effectiveAnalysis(events = []) {
  const analysisEvent = [...events].reverse().find((event) => event.eventType === 'COMMENT_ANALYSIS_CREATED' && event.status !== 'FAILED');
  if (!analysisEvent) return null;
  return events
    .filter((event) => event.eventType === 'COMMENT_ANALYSIS_CORRECTED' && event.status !== 'FAILED' && event.parentEventId === analysisEvent.id)
    .reduce((analysis, event) => ({ ...analysis, ...(event.payload.correctedFields ?? {}) }), { ...analysisEvent.payload });
}

export function latestResponseVersion(events = []) {
  return [...events].reverse().find((event) => responseEventTypes.has(event.eventType) && event.status !== 'FAILED' && event.status !== 'UNSUPPORTED') ?? null;
}

export function responseVersionDetails(events = []) {
  const version = latestResponseVersion(events);
  if (!version) return null;
  const isSuggestion = version.eventType.startsWith('RESPONSE_SUGGESTION');
  const rootId = version.eventType === 'RESPONSE_SUGGESTION_GENERATED' || version.eventType === 'MANUAL_RESPONSE_CREATED'
    ? version.id
    : version.payload.originalSuggestionEventId ?? version.payload.originalManualResponseEventId;
  return {
    version,
    rootId,
    kind: isSuggestion ? 'suggestion' : 'manual',
    isRevision: version.eventType === 'RESPONSE_SUGGESTION_EDITED' || version.eventType === 'MANUAL_RESPONSE_EDITED',
  };
}

export function latestResponseEvaluation(events = [], versionId) {
  if (!versionId) return null;
  return [...events].reverse().find((event) => event.eventType === 'RESPONSE_EVALUATED'
    && event.status !== 'FAILED' && event.parentEventId === versionId) ?? null;
}

export function hasAttemptedVersion(events = [], versionId) {
  return events.some((event) => event.eventType === 'MANUAL_REPLY_ATTEMPTED'
    && (event.parentEventId === versionId || event.payload.revisionEventId === versionId || event.payload.responseVersionEventId === versionId));
}

export function renderSocialTabs(activeNetwork, counts) {
  return Object.entries(networkInfo).map(([platform, info]) => `
    <button class="social-tab${platform === activeNetwork ? ' active' : ''}" type="button" role="tab"
      aria-selected="${platform === activeNetwork}" data-network="${platform}">
      <span class="social-logo ${info.className}" aria-hidden="true">${info.symbol}</span>
      ${t(info.nameKey)}<span class="tab-count">${formatNumber(counts[platform] ?? 0)}</span>
    </button>`).join('');
}

export function renderAccountOptions(accounts, selectedId) {
  if (!accounts.length) return `<option value="">${t('toolbar.noAccounts')}</option>`;
  return `<option value=""${selectedId ? '' : ' selected'}>${t('toolbar.allAccounts')}</option>${accounts.map((account) => `<option value="${escapeHtml(account.id)}"${account.id === selectedId ? ' selected' : ''}>${escapeHtml(account.displayName || account.externalAccountId)}</option>`).join('')}`;
}

export function renderStats({ publications = 0, comments = [], workflows = new Map(), now = Date.now(), unavailable = false } = {}) {
  if (unavailable) {
    return [
      stat(t('stats.comments'), '—', t('stats.unavailable'), '☷'),
      stat(t('stats.pending'), '—', t('stats.unavailable'), '◷'),
      stat(t('stats.evaluationsPending'), '—', t('stats.unavailable'), '✳'),
      stat(t('stats.sent'), '—', t('stats.unavailable'), '↗'),
    ].join('');
  }
  const loadedCommentCount = comments.length;
  let pending = 0;
  let unevaluated = 0;
  let sentToday = 0;
  const today = new Date(now).toISOString().slice(0, 10);
  for (const comment of comments) {
    const events = workflows.get(commentKey(comment.socialAccountId, comment.externalCommentId)) ?? [];
    if (!comment.appReplied && comment.externalReplyStatus === 'NOT_REPLIED') pending += 1;
    if (!effectiveAnalysis(events)) unevaluated += 1;
    sentToday += events.filter((event) => event.eventType === 'MANUAL_REPLY_RESULT'
      && event.status === 'SUCCEEDED'
      && event.recordedAt?.slice(0, 10) === today).length;
  }
  return [
    stat(t('stats.comments'), formatNumber(loadedCommentCount), t('stats.commentsNote'), '☷'),
    stat(t('stats.pending'), formatNumber(pending), t('stats.pendingNote'), '◷'),
    stat(t('stats.evaluationsPending'), formatNumber(unevaluated), t('stats.evaluationsNote'), '✳'),
    stat(t('stats.sent'), formatNumber(sentToday), t('stats.sentNote'), '↗'),
  ].join('');
}

export function commentKey(accountId, externalCommentId) {
  return `${accountId}\u0000${externalCommentId}`;
}

export function publicationKey(accountId, publicationId) {
  return `${accountId}\u0000${publicationId}`;
}

export function renderPublicationCard(publication, model) {
  const { account, item } = publication;
  const key = publicationKey(account.id, item.externalPublicationId);
  const commentsState = model.comments.get(key);
  const expanded = model.expandedPublications.has(key);
  const comments = commentsState?.items ?? [];
  const repliedCount = comments.filter((comment) => comment.appReplied || comment.externalReplyStatus === 'REPLIED').length;
  const failed = model.accountResults.get(account.id);
  const image = item.thumbnailUrl && /^https?:\/\//i.test(item.thumbnailUrl) ? item.thumbnailUrl : '';
  const card = `
    <article class="video-card">
      <div class="video-head">
        ${image ? `<img class="cover" src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="cover cover-fallback" aria-hidden="true">${networkInfo[account.platform]?.symbol ?? '▣'}</div>`}
        <div class="video-info">
          <h3 class="video-title">${escapeHtml(item.title || t('publication.untitled'))}</h3>
          <p class="video-desc">${escapeHtml(item.description || t('publication.noDescription'))}</p>
          <div class="video-meta">
            <span>${escapeHtml(account.displayName || account.externalAccountId)}</span>
            <span>${escapeHtml(formatDate(item.publishedAt))}</span>
            ${item.permalink && /^https?:\/\//i.test(item.permalink) ? `<a class="meta-link" href="${escapeHtml(item.permalink)}" target="_blank" rel="noopener noreferrer">${t('publication.open')}</a>` : ''}
          </div>
        </div>
        <div class="video-actions">
          <button class="button small" type="button" data-action="sync-publication" data-account-id="${escapeHtml(account.id)}" data-publication-id="${escapeHtml(item.externalPublicationId)}" ${commentsState?.syncing || model.busy.has('network-sync') ? 'disabled' : ''}>
            ${commentsState?.syncing ? `<span class="spinner"></span> ${t('publication.syncing')}` : t('publication.sync')}
          </button>
        </div>
      </div>
      <div class="comment-summary">
        <div class="summary-left">
          <span>${commentsState?.loading ? t('publication.commentsLoading') : commentsState ? t(comments.length === 1 ? 'publication.loadedComment.one' : 'publication.loadedComment.other', { count: formatNumber(comments.length) }) : t('publication.commentsNotLoaded')}</span>
          ${commentsState && comments.length ? `<span class="pill neutral">${t('publication.respondedCount', { count: formatNumber(repliedCount) })}</span>` : ''}
          ${commentsState?.nextSyncCursor ? `<span class="pill pending">${t('publication.moreComments')}</span>` : ''}
        </div>
        <button class="content-toggle" type="button" data-action="toggle-publication" data-account-id="${escapeHtml(account.id)}" data-publication-id="${escapeHtml(item.externalPublicationId)}" aria-expanded="${expanded}">
          ${t(expanded ? 'publication.hideComments' : 'publication.showComments')}
        </button>
      </div>
      <div class="content-body"${expanded ? '' : ' hidden'}>
        ${commentsState?.error ? `<div class="error-state">${escapeHtml(commentsState.error)}<p class="error-message">${t('publication.retryHint')}</p></div>` : ''}
        ${commentsState?.loading ? `<div class="loading-state"><span class="spinner"></span> ${t('publication.commentsLoading')}</div>` : ''}
        ${commentsState && !commentsState.loading && !commentsState.error && comments.length === 0 ? `<div class="empty-state">${t('publication.empty')}</div>` : ''}
        <div class="comment-list">${comments.map((comment) => renderComment(comment, model)).join('')}</div>
        ${commentsState?.nextSyncCursor ? `<div class="load-more"><button class="button small" type="button" data-action="sync-publication-next" data-account-id="${escapeHtml(account.id)}" data-publication-id="${escapeHtml(item.externalPublicationId)}">${t('publication.nextPage')}</button></div>` : ''}
      </div>
      ${failed && failed.status !== 'available' ? `<p class="error-message">${apiErrorMessage(failed.errorCode ?? 'SOCIAL_PROVIDER_UNAVAILABLE')}</p>` : ''}
    </article>`;
  return card;
}

export function renderComment(comment, model) {
  const key = commentKey(comment.socialAccountId, comment.externalCommentId);
  const events = model.workflows.get(key) ?? [];
  const analysis = effectiveAnalysis(events);
  const response = responseVersionDetails(events);
  const evaluation = latestResponseEvaluation(events, response?.version.id);
  const expanded = model.expandedComments.has(key);
  const draft = model.drafts.has(key) ? model.drafts.get(key) : response?.version.payload.text ?? '';
  const attemptRecorded = response ? hasAttemptedVersion(events, response.version.id) : false;
  const replied = Boolean(comment.appReplied || comment.externalReplyStatus === 'REPLIED');
  const replyStateLabel = comment.appReplied
    ? t('comment.replyByApp')
    : comment.externalReplyStatus === 'REPLIED'
      ? t('comment.replyOnPlatform')
      : comment.externalReplyStatus === 'NOT_REPLIED'
        ? t('comment.notReplied')
        : t('comment.replyUnknown');
  const author = comment.authorDisplayName?.trim() || t('comment.unknownAuthor');
  const initials = author.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  const isDirty = draft.trim() !== (response?.version.payload.text ?? '').trim();
  const error = model.workflowErrors.get(key);
  const sendDisabled = !comment.canReply || !draft.trim() || attemptRecorded || model.busy.has(`send:${key}`);
  const sendHint = attemptRecorded
    ? t('comment.attemptExists')
    : !comment.canReply
      ? t('comment.cannotReply')
      : '';
  const sendDisabledAttribute = sendDisabled
    ? `disabled${sendHint ? ` title="${escapeHtml(sendHint)}"` : ''}`
    : '';

  return `
    <article class="comment${expanded ? ' expanded' : ''}">
      <div class="comment-main">
        <span class="comment-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
        <div class="comment-body">
          <div class="comment-top">
            <span class="comment-author">${escapeHtml(author)}</span>
            <time class="comment-time" datetime="${escapeHtml(comment.createdAt ?? '')}">${escapeHtml(formatRelative(comment.createdAt))}</time>
            ${analysis ? `<span class="pill ai">${t('comment.evaluated')}</span>` : ''}
          </div>
          <p class="comment-text">${escapeHtml(comment.text || t('comment.unavailableText'))}</p>
          ${analysis ? renderAnalysisSummary(analysis) : ''}
          <div class="comment-controls">
            <span class="status${replied ? ' replied' : ''}"><span class="status-dot"></span>${escapeHtml(replyStateLabel)}</span>
            ${comment.canReply ? '' : `<span class="pill pending">${t('comment.replyUnsupported')}</span>`}
            <button class="expand-button" type="button" data-action="toggle-comment" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" aria-expanded="${expanded}">
              ${t(expanded ? 'comment.collapse' : 'comment.expand')}
            </button>
          </div>
        </div>
      </div>
      ${expanded ? `
        <section class="comment-detail" aria-label="${t('comment.detailLabel')}">
          <div class="detail-top">
            <span class="detail-title">${t('comment.analysisTitle')}</span>
            <span class="pill ${analysis ? 'done' : 'pending'}">${t(analysis ? 'comment.analysisAvailable' : 'comment.analysisPending')}</span>
          </div>
          ${error ? `<p class="error-message">${escapeHtml(error)}</p>` : ''}
          ${model.workflowLoading.has(key) ? `<p class="loading-state"><span class="spinner"></span> ${t('comment.historyLoading')}</p>` : ''}
          ${analysis ? renderAnalysis(analysis) : `<p class="empty-copy">${t('comment.analysisHelp')}</p>`}
          <div class="reply-label">
            <span>${t('comment.replyTitle')}</span>
            <span class="status${replied ? ' replied' : ''}"><span class="status-dot"></span>${escapeHtml(replied ? t('comment.alreadyReplied') : t('comment.draftNotSent'))}</span>
          </div>
          <label class="response-language-field">
            <span>${t('toolbar.responseLanguage')}</span>
            <select data-role="response-language" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" aria-label="${t('toolbar.responseLanguage')}">
              ${renderLanguageOptions(model.language)}
            </select>
          </label>
          <textarea class="reply-box" data-role="response-draft" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" aria-label="${t('comment.replyTextLabel')}" placeholder="${t('comment.replyPlaceholder')}">${escapeHtml(draft)}</textarea>
          <div class="reply-actions">
            <button class="button small" type="button" data-action="classify" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${model.busy.has(`classify:${key}`) ? 'disabled' : ''}>✳ ${model.busy.has(`classify:${key}`) ? t('comment.classifying') : t(analysis ? 'comment.reclassify' : 'comment.classify')}</button>
            <button class="button small" type="button" data-action="generate" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${!analysis || model.busy.has(`generate:${key}`) ? `disabled title="${t('comment.generateNeedsAnalysis')}"` : ''}>✧ ${model.busy.has(`generate:${key}`) ? t('comment.generating') : t('comment.generate')}</button>
            <button class="button small" type="button" data-action="save-response" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${!draft.trim() || !isDirty || model.busy.has(`save:${key}`) ? 'disabled' : ''}>${model.busy.has(`save:${key}`) ? t('comment.saving') : t('comment.saveDraft')}</button>
            <span class="spacer"></span>
            <button class="button small" type="button" data-action="evaluate-response" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${!analysis || !response || model.busy.has(`evaluate:${key}`) ? `disabled title="${t('comment.evaluateNeedsSaved')}"` : ''}>◇ ${t('comment.evaluateResponse')}</button>
            <button class="button primary small" type="button" data-action="send-response" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${sendDisabledAttribute}>${model.busy.has(`send:${key}`) ? t('comment.sending') : t('comment.send')}</button>
          </div>
          ${evaluation ? renderResponseEvaluation(evaluation) : ''}
          ${response && !evaluation ? `<p class="advisory-note">${t('comment.optionalEvaluation')}</p>` : ''}
          ${response && attemptRecorded ? `<p class="advisory-note">${t('comment.attemptRecorded')}</p>` : ''}
          ${events.length ? renderHistory(events) : `<div class="history"><p class="history-title">${t('comment.historyTitle')}</p><p class="empty-copy">${t('comment.noHistory')}</p></div>`}
        </section>` : ''}
    </article>`;
}

export function renderEmptyState(title, description, actionLabel = '', action = '') {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${actionLabel ? `<button class="button small" type="button" data-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>` : ''}</div>`;
}

export function eventLabel(event) {
  const labelKey = eventLabels[event.eventType] ?? 'event.unknown';
  if (event.eventType === 'MANUAL_REPLY_RESULT') {
    const result = event.payload.outcome;
    return t(result === 'AMBIGUOUS' ? 'event.sendAmbiguous' : result === 'SUCCEEDED' ? 'event.sendSucceeded' : 'event.sendFailed');
  }
  if (event.status === 'FAILED') return t('event.failed', { label: t(labelKey) });
  if (event.status === 'UNSUPPORTED') return t('event.unsupported', { label: t(labelKey) });
  return t(labelKey);
}

function stat(label, value, note, icon) {
  return `<article class="stat-card"><div class="stat-heading">${escapeHtml(label)}<span class="stat-icon" aria-hidden="true">${icon}</span></div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-foot">${escapeHtml(note)}</div></article>`;
}

function renderAnalysisSummary(analysis) {
  return `<div class="analysis-summary">
    <span class="analysis-chip"><strong>${t('comment.scoreSentiment')}</strong> ${escapeHtml(label(analysis.sentiment))}</span>
    <span class="analysis-chip"><strong>${t('comment.scoreIntent')}</strong> ${escapeHtml(label(analysis.intent))}</span>
    <span class="analysis-chip"><strong>${t('comment.scoreConfidence')}</strong> ${escapeHtml(formatScore(analysis.confidence))}</span>
  </div>`;
}

function renderAnalysis(analysis) {
  const metrics = [
    [t('comment.scoreSentiment'), analysis.sentiment],
    [t('comment.scoreEmotion'), analysis.emotion],
    [t('comment.scoreIntent'), analysis.intent],
    [t('comment.scoreTopic'), analysis.topic],
    [t('comment.scoreEntity'), analysis.entity ?? t('comment.entityUnknown')],
    [t('comment.scoreSpam'), formatScore(analysis.spamScore)],
    [t('comment.scoreToxicity'), formatScore(analysis.toxicityScore)],
    [t('comment.scoreEngagement'), formatScore(analysis.engagementValue)],
    [t('comment.scoreConfidence'), formatScore(analysis.confidence)],
  ];
  return `<div class="analysis-grid">${metrics.map(([name, value]) => `<div class="analysis-metric"><span>${escapeHtml(name)}</span><strong>${escapeHtml(label(value))}</strong></div>`).join('')}</div>
    ${analysis.rationale ? `<p class="analysis-note">${escapeHtml(analysis.rationale)}</p>` : ''}
    <div class="analysis-meta"><span class="pill neutral">${escapeHtml(analysis.provider)} · ${escapeHtml(analysis.model)}</span><span class="pill neutral">${t('comment.analysisVersion', { version: escapeHtml(analysis.schemaVersion) })}</span></div>`;
}

function renderResponseEvaluation(event) {
  const evaluation = event.payload.evaluation ?? {};
  const recommendation = evaluation.publishRecommendation ?? 'REVIEW';
  const cls = recommendation === 'REJECT' ? 'reject' : '';
  return `<div class="response-review ${cls}">
    <strong>${t('comment.responseRecommendation', { recommendation: escapeHtml(label(recommendation)) })}</strong>
    <span>${t('comment.responseScores', {
      relevance: escapeHtml(formatScore(evaluation.relevance)),
      tone: escapeHtml(formatScore(evaluation.tone)),
      helpfulness: escapeHtml(formatScore(evaluation.helpfulness)),
      factualRisk: escapeHtml(formatScore(evaluation.factualRisk)),
      toxicityRisk: escapeHtml(formatScore(evaluation.toxicityRisk)),
      hallucinationRisk: escapeHtml(formatScore(evaluation.hallucinationRisk)),
    })}</span>
    ${evaluation.rationale ? `<p>${escapeHtml(evaluation.rationale)}</p>` : ''}
    <p>${t('comment.advisoryResult')}</p>
  </div>`;
}

function renderHistory(events) {
  return `<div class="history"><p class="history-title">${t('comment.historyTitle')}</p>${events.slice().reverse().map((event) => `
    <div class="history-item"><strong>${escapeHtml(eventLabel(event))}</strong><span>${escapeHtml(formatDate(event.recordedAt))}${event.errorCode ? ` · ${escapeHtml(event.errorCode)}` : ''}</span></div>`).join('')}</div>`;
}

function renderLanguageOptions(selected) {
  const values = [['pt-BR', 'toolbar.portuguese'], ['en-US', 'toolbar.english'], ['es-ES', 'toolbar.spanish']];
  return values.map(([code, key]) => `<option value="${code}"${selected === code ? ' selected' : ''}>${t(key)}</option>`).join('');
}

function formatScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(uiLocale, { style: 'percent', maximumFractionDigits: 0 }).format(value);
}

function label(value) {
  if (typeof value !== 'string') return value ?? '—';
  const keys = {
    POSITIVE: 'analysis.positive',
    NEGATIVE: 'analysis.negative',
    NEUTRAL: 'analysis.neutral',
    APPROVE: 'analysis.approve',
    REVIEW: 'analysis.review',
    REJECT: 'analysis.reject',
    QUESTION: 'analysis.question',
    COMPLAINT: 'analysis.complaint',
    PRAISE: 'analysis.praise',
  };
  return keys[value] ? t(keys[value]) : value.replaceAll('_', ' ').toLocaleLowerCase(uiLocale).replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase(uiLocale));
}
