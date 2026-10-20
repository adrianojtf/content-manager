import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveLocale, resolveTimezone } = require('../dist/application/localization/locale-resolution.js');
const { JsonLocalizationAdapter } = require('../dist/infrastructure/localization/json-localization.adapter.js');

const supportedLocales = ['pt-BR', 'en-US', 'es-ES'];

test('locale resolution prefers user over tenant and request header', () => {
  assert.equal(resolveLocale({
    userLocale: 'en-us',
    tenantDefaultLocale: 'es-ES',
    acceptLanguage: 'pt-BR',
  }, supportedLocales, 'pt-BR'), 'en-US');
});

test('locale resolution falls back to tenant and then system locale', () => {
  assert.equal(resolveLocale({ tenantDefaultLocale: 'es-ES' }, supportedLocales, 'pt-BR'), 'es-ES');
  assert.equal(resolveLocale({}, supportedLocales, 'pt-BR'), 'pt-BR');
});

test('invalid and unsupported persisted locales are skipped', () => {
  assert.equal(resolveLocale({ userLocale: 'not_a_locale', tenantDefaultLocale: 'es-ES' }, supportedLocales, 'pt-BR'), 'es-ES');
  assert.equal(resolveLocale({ userLocale: 'fr-FR' }, supportedLocales, 'pt-BR'), 'pt-BR');
});

test('anonymous Accept-Language negotiates supported locales by quality without overriding persisted preferences', () => {
  assert.equal(resolveLocale({ acceptLanguage: 'fr-FR, es-ES;q=0.9, en-US;q=0.8' }, supportedLocales, 'pt-BR'), 'es-ES');
  assert.equal(resolveLocale({ userLocale: 'unsupported', acceptLanguage: 'en-US' }, supportedLocales, 'pt-BR'), 'pt-BR');
  assert.equal(resolveLocale({ tenantDefaultLocale: 'unsupported', acceptLanguage: 'en-US' }, supportedLocales, 'pt-BR'), 'pt-BR');
});

test('locale resolution rejects an unsupported system default configuration', () => {
  assert.throws(() => resolveLocale({}, supportedLocales, 'fr-FR'), /system default locale/i);
});

test('timezone resolution prefers user then tenant and falls back to UTC', () => {
  assert.equal(resolveTimezone('America/Los_Angeles', 'Europe/London'), 'America/Los_Angeles');
  assert.equal(resolveTimezone(undefined, 'Europe/London'), 'Europe/London');
  assert.equal(resolveTimezone('Invalid/Zone', 'Europe/London'), 'Europe/London');
  assert.equal(resolveTimezone('Invalid/Zone', undefined), 'UTC');
});

test('JSON catalogs translate semantic keys, normalize locale tags and interpolate named parameters', () => {
  const localization = new JsonLocalizationAdapter('pt-BR');

  assert.deepEqual(localization.getSupportedLocales(), supportedLocales);
  assert.equal(localization.translate('user.create', 'pt-br'), 'Criar usuário');
  assert.equal(localization.translate('user.greeting', 'en-US', { name: 'Ada' }), 'Hello, Ada');
});

test('translation uses plural categories, system-catalog fallback, and semantic-key fallback', () => {
  const localization = new JsonLocalizationAdapter('pt-BR');

  assert.equal(localization.translate('items.count', 'en-US', { count: 1 }), '1 item');
  assert.equal(localization.translate('items.count', 'en-US', { count: 3 }), '3 items');
  assert.equal(localization.translate('app.systemOnly', 'en-US'), 'Disponível');
  assert.equal(localization.translate('unknown.key', 'es-ES'), 'unknown.key');
  assert.equal(localization.translate('error.notFound', 'fr-FR'), 'Registro não encontrado');
});

test('formats dates with the explicit timezone and numbers with the resolved locale', () => {
  const localization = new JsonLocalizationAdapter('pt-BR');
  const instant = new Date('2026-10-05T12:00:00.000Z');

  assert.match(localization.formatDate(instant, 'en-US', 'America/Los_Angeles'), /5:00 AM/);
  assert.match(localization.formatDate(instant, 'en-US', 'UTC'), /12:00 PM/);
  assert.equal(localization.formatNumber(1234.56, 'pt-BR'), '1.234,56');
  assert.equal(localization.formatNumber(1234.5, 'fr-FR'), '1.234,5');
});

test('formats structured currency without mutating the monetary value', () => {
  const localization = new JsonLocalizationAdapter('pt-BR');
  const value = { amount: 1234.56, currency: 'BRL' };
  const result = localization.formatCurrency(value, 'pt-BR');

  assert.match(result, /R\$/);
  assert.match(result, /1\.234,56/);
  assert.deepEqual(value, { amount: 1234.56, currency: 'BRL' });
});

test('date formatting rejects invalid explicit timezones', () => {
  const localization = new JsonLocalizationAdapter('pt-BR');

  assert.throws(() => localization.formatDate(new Date('2026-10-05T12:00:00.000Z'), 'en-US', 'Invalid/Zone'), RangeError);
});
