import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderAnalyticsDashboard } from '../../web/dashboard.mjs';

test('analytics dashboard makes unavailable manual data explicit across its first-view sections', () => {
  const html = renderAnalyticsDashboard();

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
  assert.ok(html.includes('Séries e episódios'));
  assert.ok(html.includes('Metas do mês'));
  assert.ok(html.includes('não representam pessoas únicas'));
  assert.doesNotMatch(html, />0</);
});

test('analytics dashboard styles use theme tokens and adapt to narrow screens', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.analytics-dashboard-card\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.analytics-dashboard-card\s*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(styles, /@media \(max-width: 999px\)[\s\S]*\.analytics-answer-grid/);
});
