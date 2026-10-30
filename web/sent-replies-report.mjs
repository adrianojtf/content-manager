import { formatNumber, t } from './i18n.mjs';
import { escapeHtml, formatDate } from './view.mjs';
import { localizedAnalysisEnum, renderAnalysisEvidence, renderAnalysisGauge } from './analysis-visuals.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const categoricalFields = [
  ['sentiment', 'report.sentiment'],
  ['emotion', 'report.emotion'],
  ['intent', 'report.intent'],
  ['topic', 'report.topic'],
  ['entity', 'report.entity'],
];
const scoreFields = [
  ['spamScore', 'report.spamScore', 'risk'],
  ['toxicityScore', 'report.toxicityScore', 'risk'],
  ['engagementValue', 'report.engagementEstimate', 'positive'],
  ['confidence', 'report.confidence', 'positive'],
  ['continuationRequestProbability', 'report.continuationRequest', 'positive'],
];

export function defaultSentRepliesReportDates(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const todayStart = Date.parse(`${today}T00:00:00.000Z`);
  return {
    from: new Date(todayStart - 29 * DAY_MS).toISOString().slice(0, 10),
    to: today,
  };
}

export function buildSentRepliesReportFilters(filters, now = new Date()) {
  const fromStart = parseDateInput(filters.from);
  const toStart = parseDateInput(filters.to);
  if (fromStart > toStart) throw new RangeError('Invalid report date range.');

  const today = now.toISOString().slice(0, 10);
  const end = filters.to === today ? now.getTime() : toStart + DAY_MS;
  if (end > now.getTime() || end - fromStart > 30 * DAY_MS) {
    throw new RangeError('Invalid report date range.');
  }
  const to = new Date(end).toISOString();
  const result = {
    from: new Date(fromStart).toISOString(),
    to,
  };
  if (filters.platform) result.platform = filters.platform;
  if (filters.accountId) result.accountId = filters.accountId;
  if (filters.search?.trim()) result.search = filters.search.trim();
  return result;
}

export function renderSentRepliesReportRows(model) {
  if (model.error && model.items.length === 0) {
    return `<div class="report-state error" role="alert"><p>${t('report.loadFailed')}</p><button class="button" type="button" data-action="report-retry">${t('report.retry')}</button></div>`;
  }
  if (model.loading && model.items.length === 0) {
    return `<div class="report-state" role="status"><span class="spinner" aria-hidden="true"></span><span>${t('report.loading')}</span></div>`;
  }
  if (model.items.length === 0) {
    return `<p class="report-state">${t('report.empty')}</p>`;
  }

  const cards = model.items.map(renderSentReplyRow).join('');
  const error = model.error
    ? `<div class="report-inline-error" role="alert"><span>${t('report.loadFailed')}</span><button class="button small" type="button" data-action="report-retry">${t('report.retry')}</button></div>`
    : '';
  const more = model.nextCursor
    ? `<button class="button report-more" type="button" data-action="report-more"${model.loadingMore ? ' disabled' : ''}>${model.loadingMore ? t('report.loadingMore') : t('report.more')}</button>`
    : '';
  const countKey = model.total === 1 ? 'report.resultsCount.one' : 'report.resultsCount.other';
  return `${error}<p class="report-result-count">${t(countKey, { count: formatNumber(model.total) })}</p><div class="reply-report-list">${cards}</div>${more}`;
}

function renderSentReplyRow(row) {
  const accountName = row.accountDisplayName || row.externalAccountId || t('report.notAvailable');
  const author = row.commentAuthorDisplayName || t('report.authorUnknown');
  const comment = row.commentText || t('report.commentUnknown');
  const publicationTitle = row.publicationTitle?.trim() || row.externalPublicationId || t('report.notAvailable');
  const publicationUrl = safeExternalUrl(row.publicationPermalink);
  const publicationLink = publicationUrl
    ? `<a class="report-publication-link" href="${escapeHtml(publicationUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(t('report.openPublication', { title: publicationTitle }))}">${escapeHtml(publicationTitle)}</a>`
    : `<span class="report-publication-title">${escapeHtml(publicationTitle)}</span>`;
  const publicationId = row.publicationTitle?.trim() && row.externalPublicationId
    ? `<small>${t('report.publicationId')}: ${escapeHtml(row.externalPublicationId)}</small>`
    : '';
  return `
    <article class="reply-report-card">
      <header class="reply-report-meta">
        <time datetime="${escapeHtml(row.sentAt)}">${escapeHtml(formatDate(row.sentAt))}</time>
        <span class="report-platform">${escapeHtml(t(`network.${row.platform}`))}</span>
        <span>${escapeHtml(accountName)}</span>
        <span class="report-publication-context"><span>${t('report.publication')}:</span>${publicationLink}${publicationId}</span>
      </header>
      <div class="reply-report-columns">
        <section class="reply-report-comment" aria-label="${escapeHtml(t('report.comment'))}">
          <h3>${t('report.commenter')}</h3>
          <p class="report-author">${escapeHtml(author)}</p>
          <p class="report-text">${escapeHtml(comment)}</p>
        </section>
        <section class="reply-report-response" aria-label="${escapeHtml(t('report.sentResponse'))}">
          <h3>${t('report.sentResponse')}</h3>
          <p class="report-text">${escapeHtml(row.sentResponse)}</p>
        </section>
      </div>
      ${renderAnalysis(row)}
    </article>`;
}

function renderAnalysis(row) {
  const analysis = row.jevCommentAnalysis;
  if (!analysis) {
    return `<section class="reply-report-analysis"><h3>${t('report.analysis')}</h3><p class="report-not-evaluated">${t('report.notEvaluated')}</p></section>`;
  }
  const labels = categoricalFields
    .filter(([field]) => analysis[field] !== null && analysis[field] !== undefined)
    .map(([field, label]) => {
      const value = field === 'entity' ? analysis[field] : localizedAnalysisEnum(field, analysis[field]);
      return `<div><dt>${t(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
    })
    .join('');
  const scores = scoreFields
    .filter(([field]) => typeof analysis[field] === 'number')
    .map(([field, label, direction]) => `<div class="report-analysis-score"><span>${t(label)}</span>${renderAnalysisGauge(analysis[field], { label: t(label), direction })}</div>`)
    .join('');
  const correction = row.analysisCorrection
    ? renderCorrection(row.analysisCorrection)
    : '';
  return `
    <details class="reply-report-analysis">
      <summary class="reply-report-analysis-summary">
        <span class="report-analysis-summary-title">${t('report.analysis')}</span>
        <span class="report-analysis-preview" data-analysis-preview>${escapeHtml(localizedAnalysisEnum('sentiment', analysis.sentiment))} · ${escapeHtml(localizedAnalysisEnum('intent', analysis.intent))}</span>
        <span class="report-analysis-summary-confidence">${t('report.confidence')}${renderAnalysisGauge(analysis.confidence, { label: t('report.confidence'), direction: 'positive', compact: true })}</span>
      </summary>
      <div class="reply-report-analysis-content">
        <div class="report-analysis-heading"><span>${escapeHtml(analysis.provider ?? 'JEV')} · ${escapeHtml(analysis.model ?? '')}</span></div>
        <p class="report-analysis-time">${t('report.evaluatedAt')}: ${escapeHtml(formatDate(analysis.evaluatedAt))}</p>
        <dl class="report-analysis-fields">${labels}</dl>
        <div class="report-analysis-gauges">${scores}</div>
        ${renderAnalysisEvidence(analysis.signals)}
        ${correction}
      </div>
    </details>`;
}

function renderCorrection(correction) {
  const fields = Object.entries(correction.correctedFields ?? {}).map(([field, value]) => {
    const enumField = ['sentiment', 'emotion', 'intent', 'topic'].includes(field);
    const labelKey = {
      sentiment: 'report.sentiment',
      emotion: 'report.emotion',
      intent: 'report.intent',
      topic: 'report.topic',
      entity: 'report.entity',
      spamScore: 'report.spamScore',
      toxicityScore: 'report.toxicityScore',
      engagementValue: 'report.engagementEstimate',
    }[field] ?? 'analysis.enum.other';
    if (enumField) {
      return `<div><dt>${t(labelKey)}</dt><dd>${escapeHtml(localizedAnalysisEnum(field, value))}</dd></div>`;
    }
    if (typeof value === 'number') {
      const direction = ['spamScore', 'toxicityScore'].includes(field) ? 'risk' : 'positive';
      return `<div class="report-analysis-score"><span>${t(labelKey)}</span>${renderAnalysisGauge(value, { label: t(labelKey), direction })}</div>`;
    }
    return `<div><dt>${t(labelKey)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  }).join('');
  const actorLabel = correction.actorSource === 'CREATOR_LOCAL'
    ? t('report.correctionActor.creator')
    : t('report.correctionActor.application');
  return `<aside class="report-correction"><strong>${t('report.correctionTitle')}</strong><p>${t('report.correctionRecordedAt')}: ${escapeHtml(formatDate(correction.recordedAt))}</p><p>${t('report.correctionActor')}: ${actorLabel}</p><dl class="report-correction-fields">${fields}</dl>${correction.reason ? `<p>${t('report.correctionReason')}: ${escapeHtml(correction.reason)}</p>` : ''}</aside>`;
}

function parseDateInput(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('Invalid report date.');
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new RangeError('Invalid report date.');
  }
  return timestamp;
}

function safeExternalUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
