import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderAnalyticsDashboard } from '../../web/dashboard.mjs';

const report = {
  generatedAt: '2026-10-15T12:00:00.000Z',
  reportingTimezone: 'UTC',
  seriesCount: 2,
  episodeCount: 8,
  linkedPublicationCount: 12,
  month: {
    start: '2026-10-01',
    views: { value: 4500, status: 'COMPLETE' },
    previousComparableViews: { value: 3000, status: 'COMPLETE' },
    growthPercent: 50,
    revenue: { value: 1500, status: 'COMPLETE' },
    productionCost: { value: 800, status: 'COMPLETE' },
  },
  views: {
    last7Days: { value: 1200, status: 'COMPLETE' },
    last30Days: { value: 4500, status: 'COMPLETE' },
    last90Days: { value: 9800, status: 'COMPLETE' },
  },
  followers: {
    total: { value: 15200, status: 'COMPLETE' },
    new: { value: 340, status: 'COMPLETE' },
  },
  conversion: { value: 4.2, status: 'COMPLETE' },
  platforms: [
    {
      platform: 'instagram',
      views: { last7Days: { value: 700 }, last30Days: { value: 2500 }, last90Days: { value: 5200 } },
      monthGrowthPercent: 25,
      monthViews: { value: 2500 },
      rates: { 30: { engagement: { value: 6.5, status: 'COMPLETE' }, share: null, conversion: null } },
    },
    { platform: 'tiktok', views: {}, monthGrowthPercent: null, rates: {} },
    { platform: 'facebook', views: {}, monthGrowthPercent: -5, rates: {} },
  ],
  rankings: {
    last7Days: { series: [], episodes: [] },
    last30Days: {
      series: [{ seriesId: 's1', name: 'FQA', episodeCount: 8, value: 4200, status: 'COMPLETE' }],
      episodes: [{ episodeId: 'e1', episodeCode: 'FQA-S02-E08', seriesName: 'FQA', value: 1200, status: 'COMPLETE' }],
    },
    last90Days: { series: [], episodes: [] },
    defaultWindowDays: 30,
  },
  goals: {
    views: { value: 4500, status: 'COMPLETE', achieved: [], next: 1_000_000, progressPercent: 0.45 },
    revenue: { value: 1500, status: 'COMPLETE', achieved: [1000], next: 3000, progressPercent: 25 },
  },
};

test('analytics dashboard renders the six answers plus headline metrics in its first view', () => {
  const html = renderAnalyticsDashboard({ report, rankingWindow: 30 });

  for (const label of [
    'As visualizações estão crescendo?',
    'Qual plataforma está crescendo?',
    'Qual é a melhor série?',
    'Qual é o melhor episódio?',
    'As visualizações geram novos seguidores?',
    'Como está o progresso da monetização?',
  ]) {
    assert.ok(html.includes(label), `Dashboard should include ${label}`);
  }
  assert.ok(html.includes('Os dados de desempenho são registrados manualmente'));
  assert.ok(html.includes('Visualizações · 7 dias'));
  assert.ok(html.includes('Visualizações · 30 dias'));
  assert.ok(html.includes('Visualizações · 90 dias'));
  assert.ok(html.includes('Desempenho por plataforma'));
  assert.ok(html.includes('Destaques por período'));
  assert.ok(html.includes('Metas do mês'));
  assert.ok(html.includes('não representam pessoas únicas'));
  assert.ok(html.includes('FQA-S02-E08'));
  assert.ok(html.includes('data-analytics-ranking-window'));
  assert.ok(html.includes('Receita e produção'));
});

test('analytics dashboard distinguishes zero, incomplete, and unavailable metric states', () => {
  const zero = renderAnalyticsDashboard({ report, rankingWindow: 30 });
  assert.ok(zero.includes('1.200'));

  const missing = renderAnalyticsDashboard({
    report: { ...report, month: { ...report.month, revenue: { value: null, status: 'INCOMPLETE' } } },
    rankingWindow: 30,
  });
  assert.ok(missing.includes('Histórico incompleto'));

  const unavailable = renderAnalyticsDashboard({
    report: { ...report, views: { last7Days: { value: null, status: 'UNAVAILABLE' }, last30Days: {}, last90Days: {} } },
    rankingWindow: 30,
  });
  assert.ok(unavailable.includes('Indisponível'));
});

test('analytics dashboard supports loading and error states with a retry control', () => {
  const loading = renderAnalyticsDashboard({ loading: true });
  assert.ok(loading.includes('Carregando dados consolidados'));

  const error = renderAnalyticsDashboard({ error: true });
  assert.ok(error.includes('data-action="retry-analytics-dashboard"'));
});

test('analytics dashboard styles use theme tokens and adapt to narrow screens', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.analytics-dashboard-card\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.analytics-dashboard-card\s*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(styles, /@media \(max-width: 999px\)[\s\S]*\.analytics-answer-grid/);
});
