import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ClassifyImportedPublication } = require('../../dist/application/analytics/classify-imported-publication.js');
const { JsonLocalizationAdapter } = require('../../dist/infrastructure/localization/json-localization.adapter.js');

const publication = {
  platform: 'instagram',
  externalPublicationId: 'ig-publication-8',
  title: 'FQA-E08',
  description: 'Confira o episódio 8 da série FQA.',
};

function classification(overrides = {}) {
  return {
    classification: 'EPISODE',
    confidence: 0.91,
    probabilities: { EPISODE: 0.91, NOT_EPISODE: 0.03, UNCERTAIN: 0.06 },
    evidence: publication,
    provider: 'JEV',
    model: 'jev-test-model',
    schemaVersion: 'test-schema-v1',
    usage: { inputTokens: 20, outputTokens: 8 },
    ...overrides,
  };
}

test('ClassifyImportedPublication returns explicit identity hints and separate localized rationale variants', async () => {
  const calls = [];
  const classifier = {
    classify: async (input) => {
      calls.push(input);
      return classification();
    },
  };

  const suggestion = await new ClassifyImportedPublication(classifier, new JsonLocalizationAdapter()).execute({ publication });

  assert.deepEqual(calls, [{ publication }]);
  assert.equal(suggestion.classification, 'EPISODE');
  assert.equal(suggestion.confidence, 0.91);
  assert.deepEqual(suggestion.identity, {
    seriesName: 'FQA',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 8,
    episodeCode: 'FQA-E08',
  });
  assert.deepEqual(Object.keys(suggestion.rationaleVariants).sort(), ['en-US', 'es-ES', 'pt-BR']);
  assert.deepEqual(suggestion.rationaleFailures, {});
  assert.equal(suggestion.schemaVersion, 'test-schema-v1');
});

test('ClassifyImportedPublication preserves partial localized rationale failures and does not invent identity', async () => {
  const classifier = {
    classify: async () => classification({
      classification: 'UNCERTAIN',
      confidence: 0.55,
      probabilities: { EPISODE: 0.25, NOT_EPISODE: 0.2, UNCERTAIN: 0.55 },
    }),
  };
  const localization = {
    translate: (key, locale) => {
      if (locale === 'es-ES') return key;
      if (locale === 'en-US') throw new Error('translation unavailable');
      return 'Revise esta publicação manualmente.';
    },
  };

  const suggestion = await new ClassifyImportedPublication(classifier, localization).execute({
    publication: { ...publication, title: 'Vídeo novo', description: null },
  });

  assert.equal(suggestion.classification, 'UNCERTAIN');
  assert.deepEqual(suggestion.identity, {
    seriesName: null,
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(Object.keys(suggestion.rationaleVariants), ['pt-BR']);
  assert.deepEqual(suggestion.rationaleFailures, {
    'en-US': 'ANALYTICS_SUGGESTION_RATIONALE_UNAVAILABLE',
    'es-ES': 'ANALYTICS_SUGGESTION_RATIONALE_UNAVAILABLE',
  });
});
