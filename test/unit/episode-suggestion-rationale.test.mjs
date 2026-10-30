import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildEpisodeSuggestionRationaleVariants } = require('../../dist/application/analytics/episode-suggestion-rationale.js');
const { JsonLocalizationAdapter } = require('../../dist/infrastructure/localization/json-localization.adapter.js');

test('episode classification rationale is localized into separate Portuguese, English, and Spanish variants', () => {
  const result = buildEpisodeSuggestionRationaleVariants(new JsonLocalizationAdapter(), 'EPISODE');

  assert.deepEqual(Object.keys(result.variants).sort(), ['en-US', 'es-ES', 'pt-BR']);
  assert.deepEqual(result.failures, {});
  assert.match(result.variants['pt-BR'], /possível episódio/);
  assert.match(result.variants['en-US'], /possible episode/);
  assert.match(result.variants['es-ES'], /posible episodio/);
});

test('one locale failure is preserved without discarding successful rationale variants', () => {
  const localization = {
    translate: (key, locale) => {
      if (locale === 'en-US') throw new Error('catalog unavailable');
      return locale === 'pt-BR' ? 'Justificativa em português.' : 'Justificación en español.';
    },
  };

  const result = buildEpisodeSuggestionRationaleVariants(localization, 'UNCERTAIN');

  assert.deepEqual(Object.keys(result.variants).sort(), ['es-ES', 'pt-BR']);
  assert.deepEqual(result.failures, { 'en-US': 'ANALYTICS_SUGGESTION_RATIONALE_UNAVAILABLE' });
});
