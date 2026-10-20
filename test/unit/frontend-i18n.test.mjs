import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatDateTime, t, uiLocale } from '../../web/i18n.mjs';

test('static UI labels and semantic keys used by the frontend resolve in the current catalog', () => {
  const files = ['web/index.html', 'web/app.mjs', 'web/view.mjs'];
  const source = files.map((file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')).join('\n');
  const keys = new Set([
    ...[...source.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((match) => match[1]),
    ...[...source.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]),
  ]);

  assert.equal(uiLocale, 'pt-BR');
  for (const key of keys) assert.notEqual(t(key), key, `Missing frontend translation for ${key}`);
});

test('frontend catalog interpolates named values without changing raw API data', () => {
  assert.equal(t('toast.syncPublication', { count: '3' }), '3 comentários carregados para esta publicação.');
  assert.equal(t('event.failed', { label: 'Envio iniciado' }), 'Envio iniciado — falhou');
  assert.equal(t('missing.semantic.key'), 'missing.semantic.key');
});

test('date formatting uses an explicit timezone and defaults deterministically to UTC', () => {
  const instant = new Date('2026-01-01T00:00:00.000Z');
  const utc = formatDateTime(instant, { dateStyle: 'short', timeStyle: 'short' }, 'UTC');
  const losAngeles = formatDateTime(instant, { dateStyle: 'short', timeStyle: 'short' }, 'America/Los_Angeles');
  const expectedUtc = new Intl.DateTimeFormat(uiLocale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(instant);

  assert.equal(utc, expectedUtc);
  assert.notEqual(utc, losAngeles);
});
