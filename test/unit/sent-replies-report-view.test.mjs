import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildSentRepliesReportFilters,
  defaultSentRepliesReportDates,
  renderSentRepliesReportRows,
} from '../../web/sent-replies-report.mjs';
import { setUiLocale } from '../../web/i18n.mjs';

const sampleRow = {
  id: 'reply-1',
  sentAt: '2026-10-27T15:30:00.000Z',
  platform: 'youtube',
  socialAccountId: 'account-1',
  accountDisplayName: 'Creator channel',
  externalAccountId: 'UC-channel-1',
  externalPublicationId: 'video-1',
  publicationTitle: 'A useful episode',
  publicationPermalink: 'https://youtube.com/watch?v=video-1',
  commentText: '<script>comment</script>',
  commentAuthorDisplayName: '<img src=x>',
  commentCreatedAt: '2026-10-26T10:00:00.000Z',
  sentResponse: 'Thanks <b>for watching</b>',
  jevCommentAnalysis: {
    sentiment: 'POSITIVE',
    emotion: 'JOY',
    intent: 'PRAISE',
    topic: 'CONTENT',
    spamScore: 0.01,
    toxicityScore: 0.02,
    engagementValue: 0.8,
    confidence: 0.93,
    provider: 'JEV',
    model: 'jev-1.14.0',
    evaluatedAt: '2026-10-27T14:00:00.000Z',
    signals: { sentiment: { confidence: 0.93, probabilities: { POSITIVE: 0.93 } } },
    usage: { inputTokens: 10, outputTokens: 4 },
  },
  analysisCorrection: {
    actorSource: 'CREATOR_LOCAL',
    recordedAt: '2026-10-27T14:30:00.000Z',
    correctedFields: { sentiment: 'NEUTRAL' },
    reason: 'Review',
  },
};

test('report filters use an inclusive date range and omit empty optional filters', () => {
  const filters = buildSentRepliesReportFilters({
    from: '2026-10-01',
    to: '2026-10-28',
    platform: '',
    accountId: '',
    search: '  ',
  }, new Date('2026-10-28T12:00:00.000Z'));

  assert.deepEqual(filters, {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-28T12:00:00.000Z',
  });
});

test('default report dates cover 30 calendar days through the current UTC date', () => {
  assert.deepEqual(defaultSentRepliesReportDates(new Date('2026-10-28T12:00:00.000Z')), {
    from: '2026-09-29',
    to: '2026-10-28',
  });
});

test('report cards escape untrusted content and keep JEV output separate from human corrections', () => {
  setUiLocale('pt-BR');
  const markup = renderSentRepliesReportRows({
    items: [sampleRow],
    total: 1,
    loading: false,
    loadingMore: false,
    error: null,
    nextCursor: null,
  });

  assert.match(markup, /&lt;script&gt;comment&lt;\/script&gt;/);
  assert.match(markup, /&lt;img src=x&gt;/);
  assert.match(markup, /Thanks &lt;b&gt;for watching&lt;\/b&gt;/);
  assert.match(markup, /Sentimento/);
  assert.match(markup, /Positivo/);
  assert.match(markup, /aria-valuenow="1"/);
  assert.match(markup, /data-direction="risk"/);
  assert.match(markup, /Evidências por pergunta/);
  assert.match(markup, /Correção humana/);
  assert.doesNotMatch(markup, /POSITIVE|0\.93/);
  assert.doesNotMatch(markup, /<script>|<img src=x>|<b>for watching/);
});

test('report collapses JEV details by default and shows linked publication metadata', () => {
  setUiLocale('pt-BR');
  const markup = renderSentRepliesReportRows({
    items: [sampleRow],
    total: 1,
    loading: false,
    loadingMore: false,
    error: null,
    nextCursor: null,
  });

  assert.match(markup, /<details class="reply-report-analysis">/);
  assert.doesNotMatch(markup, /<details class="reply-report-analysis"[^>]*open/);
  assert.match(markup, /data-analysis-preview/);
  assert.match(markup, /A useful episode/);
  assert.match(markup, /href="https:\/\/youtube\.com\/watch\?v=video-1"/);
  assert.match(markup, /target="_blank"[^>]*rel="noopener noreferrer"/);

  const fallback = renderSentRepliesReportRows({
    items: [{ ...sampleRow, publicationTitle: null, publicationPermalink: null }],
    total: 1,
    loading: false,
    loadingMore: false,
    error: null,
  });
  assert.match(fallback, /video-1/);
  assert.doesNotMatch(fallback, /<a[^>]*video-1/);

  const unsafeLink = renderSentRepliesReportRows({
    items: [{ ...sampleRow, publicationPermalink: 'javascript:alert(1)' }],
    total: 1,
    loading: false,
    loadingMore: false,
    error: null,
  });
  assert.doesNotMatch(unsafeLink, /href="javascript:/);
});

test('report distinguishes loading, empty, failure, and missing JEV analysis states', () => {
  setUiLocale('pt-BR');
  const loading = renderSentRepliesReportRows({ items: [], total: 0, loading: true, loadingMore: false, error: null });
  const empty = renderSentRepliesReportRows({ items: [], total: 0, loading: false, loadingMore: false, error: null });
  const failure = renderSentRepliesReportRows({ items: [], total: 0, loading: false, loadingMore: false, error: 'failed' });
  const noAnalysis = renderSentRepliesReportRows({
    items: [{ ...sampleRow, jevCommentAnalysis: null, analysisCorrection: null }],
    total: 1,
    loading: false,
    loadingMore: false,
    error: null,
  });

  assert.match(loading, /Carregando/);
  assert.match(empty, /Nenhuma resposta enviada/);
  assert.match(failure, /Não foi possível carregar/);
  assert.match(noAnalysis, /não tinha uma análise JEV/i);
});

test('report layout uses theme tokens and reflows for narrow screens', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.reply-report-card[^}]*background: var\(--surface\)/);
  assert.match(styles, /\.reply-report-analysis \{[^}]*background: var\(--surface\)/);
  assert.match(styles, /\.reply-report-analysis-summary[^}]*color: var\(--text\)/);
  assert.match(styles, /\.report-publication-link[^}]*color: var\(--blue\)/);
  assert.match(styles, /\.report-analysis-fields[^}]*background: var\(--surface-soft\)/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.reply-report-columns \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /color-scheme: light dark/);
});
