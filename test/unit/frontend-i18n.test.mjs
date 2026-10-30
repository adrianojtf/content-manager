import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  apiErrorMessage,
  catalogKeys,
  formatDateTime,
  formatNumber,
  readUiLocale,
  setUiLocale,
  socialSyncFailureMessage,
  supportedLocales,
  t,
  uiLocale,
  writeUiLocale,
} from '../../web/i18n.mjs';
import enUS from '../../web/locales/en-US.mjs';
import esES from '../../web/locales/es-ES.mjs';

test('static UI labels and semantic keys used by the frontend resolve in the current catalog', () => {
  const files = ['web/index.html', 'web/app.mjs', 'web/view.mjs', 'web/dashboard.mjs', 'web/episode-review.mjs', 'web/sent-replies-report.mjs', 'web/analysis-visuals.mjs'];
  const source = files.map((file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')).join('\n');
  const keys = new Set([
    ...[...source.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((match) => match[1]),
    ...[...source.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]),
  ]);

  assert.equal(uiLocale, 'pt-BR');
  for (const key of keys) assert.notEqual(t(key), key, `Missing frontend translation for ${key}`);
});

test('Portuguese, English, and Spanish catalogs translate every semantic UI key', () => {
  const keys = catalogKeys();

  assert.deepEqual(supportedLocales, ['pt-BR', 'en-US', 'es-ES']);
  for (const [locale, messages] of [['en-US', enUS], ['es-ES', esES]]) {
    assert.deepEqual(Object.keys(messages).sort(), [...keys].sort(), `${locale} must contain exactly the same UI keys`);
    assert.ok(Object.values(messages).every((message) => typeof message === 'string' && message.length > 0));
  }
});

test('interface locale can be selected, persisted locally, and translated independently', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(readUiLocale(storage), 'pt-BR');
  assert.equal(writeUiLocale('en-US', storage), true);
  assert.equal(readUiLocale(storage), 'en-US');
  assert.equal(setUiLocale(readUiLocale(storage)), true);
  assert.equal(t('settings.title'), 'Preferences');
  assert.equal(setUiLocale('es-ES'), true);
  assert.equal(t('settings.title'), 'Preferencias');
  assert.equal(t('comment.generate'), 'Generar en 3 idiomas');
  assert.equal(setUiLocale('unsupported'), false);
  setUiLocale('pt-BR');
  assert.equal(uiLocale, 'pt-BR');
  assert.equal(writeUiLocale('es-ES', { setItem: () => { throw new Error('storage unavailable'); } }), false);
});

test('creator reply label is localized in every supported interface locale', () => {
  for (const [locale, expected] of [
    ['pt-BR', 'Resposta do autor'],
    ['en-US', 'Creator reply'],
    ['es-ES', 'Respuesta del creador'],
  ]) {
    assert.equal(setUiLocale(locale), true);
    assert.equal(t('comment.creatorReply'), expected);
  }
  setUiLocale('pt-BR');
});

test('semi-automatic send-all controls are localized in every supported interface locale', () => {
  for (const [locale, expected] of [
    ['pt-BR', 'Enviar aprovadas (3)'],
    ['en-US', 'Send approved (3)'],
    ['es-ES', 'Enviar aprobadas (3)'],
  ]) {
    assert.equal(setUiLocale(locale), true);
    assert.equal(t('bulkReplies.sendAll', { count: '3' }), expected);
    assert.notEqual(t('bulkReplies.confirmSendAll', { count: '3' }), 'bulkReplies.confirmSendAll');
    assert.notEqual(t('bulkReplies.sendPaused', { sent: '1', failed: '1', remaining: '2' }), 'bulkReplies.sendPaused');
  }
  setUiLocale('pt-BR');
});

test('global font controls are localized in every supported interface locale', () => {
  const translations = [
    ['pt-BR', 'Fonte', 'Configurar tamanho da fonte', 'Tamanho do texto', 'Pequeno', 'Padrão', 'Grande', 'Muito grande'],
    ['en-US', 'Font', 'Configure font size', 'Text size', 'Small', 'Default', 'Large', 'Very large'],
    ['es-ES', 'Fuente', 'Configurar tamaño de fuente', 'Tamaño del texto', 'Pequeño', 'Predeterminado', 'Grande', 'Muy grande'],
  ];

  for (const [locale, ...expected] of translations) {
    assert.equal(setUiLocale(locale), true);
    assert.deepEqual([
      t('settings.fontSettings'),
      t('settings.fontSettingsAria'),
      t('settings.fontSize'),
      t('settings.fontSize.small'),
      t('settings.fontSize.default'),
      t('settings.fontSize.large'),
      t('settings.fontSize.veryLarge'),
    ], expected);
  }
  setUiLocale('pt-BR');
});

test('verified release schedule API errors use localized stable messages', () => {
  const codes = [
    'VERIFIED_RELEASE_SCHEDULE_INVALID',
    'VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE',
    'VERIFIED_RELEASE_SCHEDULE_DATA_INVALID',
    'VERIFIED_RELEASE_SCHEDULE_FAILED',
  ];
  const messages = new Map();

  for (const locale of supportedLocales) {
    assert.equal(setUiLocale(locale), true);
    const localized = codes.map((code) => apiErrorMessage(code));
    assert.ok(localized.every((message) => !message.includes('VERIFIED_RELEASE_SCHEDULE_')));
    messages.set(locale, localized);
  }

  assert.equal(new Set(messages.get('pt-BR')).size, codes.length);
  assert.equal(new Set(messages.get('en-US')).size, codes.length);
  assert.equal(new Set(messages.get('es-ES')).size, codes.length);
  setUiLocale('pt-BR');
});

test('number formatting follows the selected interface catalog locale', () => {
  setUiLocale('en-US');
  assert.equal(formatNumber(1234.56), '1,234.56');
  setUiLocale('es-ES');
  assert.equal(formatNumber(1234.56), '1234,56');
  setUiLocale('pt-BR');
  assert.equal(formatNumber(1234.56), '1.234,56');
});

test('frontend catalog interpolates named values without changing raw API data', () => {
  assert.equal(t('toast.syncPublication', { count: '3' }), '3 comentários carregados para esta publicação.');
  assert.equal(t('event.failed', { label: 'Envio iniciado' }), 'Envio iniciado — falhou');
  assert.match(t('settings.disconnectConfirm', { name: 'Meu canal' }), /credenciais salvas.*A autorização no provedor não será revogada\./);
  assert.equal(t('missing.semantic.key'), 'missing.semantic.key');
});

test('sync failure codes map to safe platform-specific customer messages', () => {
  assert.equal(socialSyncFailureMessage('youtube', 'SOCIAL_COMMENTS_DISABLED'), 'Os comentários deste vídeo estão desativados.');
  assert.equal(socialSyncFailureMessage('instagram', 'SOCIAL_ACCOUNT_PERMISSION_DENIED'), 'Verifique se a conta é profissional e se o aplicativo Meta tem acesso aos comentários.');
  assert.equal(socialSyncFailureMessage('facebook', 'SOCIAL_ACCOUNT_PERMISSION_DENIED'), 'Verifique o acesso à Página e as permissões de leitura de comentários no Meta.');
  assert.equal(socialSyncFailureMessage('tiktok', 'SOCIAL_ACCOUNT_PERMISSION_DENIED'), 'Verifique o acesso da conta TikTok Business e as permissões de leitura de comentários.');
  assert.equal(socialSyncFailureMessage('youtube', 'SOCIAL_PROVIDER_RATE_LIMITED'), 'A plataforma limitou as solicitações. Aguarde e tente novamente.');
  assert.equal(socialSyncFailureMessage('youtube', 'PROVIDER_PRIVATE_ERROR'), 'Não foi possível sincronizar os comentários. Tente novamente.');
  assert.equal(socialSyncFailureMessage('youtube', 'toString'), 'Não foi possível sincronizar os comentários. Tente novamente.');
  assert.equal(apiErrorMessage('SOCIAL_PUBLICATION_PERSISTENCE_FAILED'), 'Não foi possível salvar os metadados desta publicação. Tente novamente.');
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
