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

const catalog = [
  { id: 'series-1', name: 'FQA', aliases: ['Fiction Quest'], seasonMode: 'SEASONAL', knownSeasonNumbers: [1, 2] },
];

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

function classifierDouble({ classify, verify, extract, calls = [] } = {}) {
  return {
    calls,
    classify: async (input) => { calls.push(['classify', input]); return (classify ?? (async () => classification()))(input); },
    verifyEpisodeIdentity: async (input) => {
      calls.push(['verify', input]);
      return (verify ?? (async () => ({ verdict: 'VALID', confidence: 0.9, model: 'jev-test-model', usage: null })))(input);
    },
    extractEpisodeIdentity: async (input) => {
      calls.push(['extract', input]);
      return (extract ?? (async () => ({
        seriesRef: null, seasonNumber: null, episodeNumber: null, episodeCode: null,
        confidence: null, model: 'jev-test-model', usage: null,
      })))(input);
    },
  };
}

test('ClassifyImportedPublication returns explicit identity hints and separate localized rationale variants', async () => {
  const classifier = classifierDouble();

  const suggestion = await new ClassifyImportedPublication(classifier, new JsonLocalizationAdapter())
    .execute({ publication, seriesCatalog: catalog });

  assert.deepEqual(classifier.calls[0], ['classify', { publication, seriesCatalog: catalog }]);
  assert.deepEqual(classifier.calls[1][0], 'verify');
  assert.equal(suggestion.classification, 'EPISODE');
  assert.equal(suggestion.confidence, 0.91);
  assert.deepEqual(suggestion.identity, {
    seriesName: 'FQA',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 8,
    episodeCode: 'FQA-E08',
  });
  assert.equal(suggestion.identitySource, 'JEV_VERIFIED');
  assert.equal(suggestion.identityAudit.verification.verdict, 'VALID');
  assert.equal(suggestion.identityAudit.catalogSize, 1);
  assert.deepEqual(Object.keys(suggestion.rationaleVariants).sort(), ['en-US', 'es-ES', 'pt-BR']);
  assert.deepEqual(suggestion.rationaleFailures, {});
  assert.equal(suggestion.schemaVersion, 'test-schema-v1');
});

test('ClassifyImportedPublication extracts the episode number from a description with no episode code', async () => {
  const suggestion = await new ClassifyImportedPublication(
    classifierDouble(),
    new JsonLocalizationAdapter(),
  ).execute({
    publication: {
      ...publication,
      title: 'Vídeo novo',
      description: 'FQA | Episódio 8 — A pista aparece.',
    },
    seriesCatalog: catalog,
  });

  assert.equal(suggestion.identity.seriesName, 'FQA');
  assert.equal(suggestion.identity.episodeNumber, 8);
  assert.equal(suggestion.identity.episodeCode, null);
});

test('ClassifyImportedPublication preserves partial localized rationale failures and does not invent identity', async () => {
  const classifier = classifierDouble({
    classify: async () => classification({
      classification: 'UNCERTAIN',
      confidence: 0.55,
      probabilities: { EPISODE: 0.25, NOT_EPISODE: 0.2, UNCERTAIN: 0.55 },
    }),
  });
  const localization = {
    translate: (key, locale) => {
      if (locale === 'es-ES') return key;
      if (locale === 'en-US') throw new Error('translation unavailable');
      return 'Revise esta publicação manualmente.';
    },
  };

  const suggestion = await new ClassifyImportedPublication(classifier, localization).execute({
    publication: { ...publication, title: 'Vídeo novo', description: null },
    seriesCatalog: catalog,
  });

  assert.equal(suggestion.classification, 'UNCERTAIN');
  assert.deepEqual(suggestion.identity, {
    seriesName: null,
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.equal(suggestion.identitySource, 'JEV_EXTRACTED');
  assert.deepEqual(Object.keys(suggestion.rationaleVariants), ['pt-BR']);
  assert.deepEqual(suggestion.rationaleFailures, {
    'en-US': 'ANALYTICS_SUGGESTION_RATIONALE_UNAVAILABLE',
    'es-ES': 'ANALYTICS_SUGGESTION_RATIONALE_UNAVAILABLE',
  });
});

test('an INVALID verification escalates to extraction mapped against the tenant series catalog', async () => {
  const classifier = classifierDouble({
    verify: async () => ({ verdict: 'INVALID', confidence: 0.88, model: 'jev-test-model', usage: null }),
    extract: async ({ seriesCatalog }) => ({
      seriesRef: { type: 'existing', seriesId: seriesCatalog[0].id },
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      confidence: 0.8,
      model: 'jev-test-model',
      usage: null,
    }),
  });

  const suggestion = await new ClassifyImportedPublication(classifier, new JsonLocalizationAdapter())
    .execute({ publication, seriesCatalog: catalog });

  assert.deepEqual(classifier.calls.map(([name]) => name), ['classify', 'verify', 'extract']);
  assert.equal(suggestion.identitySource, 'JEV_EXTRACTED');
  assert.deepEqual(suggestion.identity, {
    seriesName: 'FQA',
    seasonNumber: 2,
    seasonStatus: 'NUMBERED',
    episodeNumber: 8,
    episodeCode: 'FQA-S02-E08',
  });
});

test('an UNCERTAIN verification below the confidence threshold escalates while a confident one keeps RULES', async () => {
  const belowThreshold = classifierDouble({
    verify: async () => ({ verdict: 'UNCERTAIN', confidence: 0.3, model: 'jev-test-model', usage: null }),
    extract: async () => ({
      seriesRef: { type: 'new', name: 'Nova Série' },
      seasonNumber: null,
      episodeNumber: 8,
      episodeCode: null,
      confidence: 0.7,
      model: 'jev-test-model',
      usage: null,
    }),
  });
  const escalated = await new ClassifyImportedPublication(belowThreshold, new JsonLocalizationAdapter())
    .execute({ publication, seriesCatalog: catalog });
  assert.deepEqual(belowThreshold.calls.map(([name]) => name), ['classify', 'verify', 'extract']);
  assert.equal(escalated.identitySource, 'JEV_EXTRACTED');
  assert.equal(escalated.identity.seriesName, 'Nova Série');
  assert.equal(escalated.identity.seasonStatus, 'UNKNOWN');

  const confident = classifierDouble({
    verify: async () => ({ verdict: 'UNCERTAIN', confidence: 0.95, model: 'jev-test-model', usage: null }),
  });
  const kept = await new ClassifyImportedPublication(confident, new JsonLocalizationAdapter())
    .execute({ publication, seriesCatalog: catalog });
  assert.deepEqual(confident.calls.map(([name]) => name), ['classify', 'verify']);
  assert.equal(kept.identitySource, 'RULES');
  assert.equal(kept.identity.episodeCode, 'FQA-E08');
});

test('a verification failure keeps the deterministic identity and records an isolated failure code', async () => {
  const classifier = classifierDouble({
    verify: async () => { throw new Error('provider exploded'); },
  });

  const suggestion = await new ClassifyImportedPublication(classifier, new JsonLocalizationAdapter())
    .execute({ publication, seriesCatalog: catalog });

  assert.deepEqual(classifier.calls.map(([name]) => name), ['classify', 'verify']);
  assert.equal(suggestion.identitySource, 'RULES');
  assert.equal(suggestion.identity.episodeCode, 'FQA-E08');
  assert.equal(suggestion.identityAudit.verification.failure, 'ANALYTICS_EPISODE_IDENTITY_CASCADE_FAILED');
});

test('an extraction failure or unknown catalog series keeps the deterministic identity untouched', async () => {
  const unknownSeries = classifierDouble({
    verify: async () => ({ verdict: 'INVALID', confidence: 0.9, model: 'jev-test-model', usage: null }),
    extract: async () => ({
      seriesRef: { type: 'existing', seriesId: 'series-not-in-catalog' },
      seasonNumber: 1,
      episodeNumber: 8,
      episodeCode: null,
      confidence: 0.8,
      model: 'jev-test-model',
      usage: null,
    }),
  });
  const rejected = await new ClassifyImportedPublication(unknownSeries, new JsonLocalizationAdapter())
    .execute({ publication, seriesCatalog: catalog });
  assert.equal(rejected.identitySource, 'RULES');
  assert.equal(rejected.identity.episodeCode, 'FQA-E08');
  assert.equal(rejected.identityAudit.extraction.failure, 'ANALYTICS_EPISODE_IDENTITY_EXTRACTION_INVALID');

  const failing = classifierDouble({
    verify: async () => ({ verdict: 'INVALID', confidence: 0.9, model: 'jev-test-model', usage: null }),
    extract: async () => { throw Object.assign(new Error('boom'), { code: 'INTELLIGENCE_PROVIDER_UNAVAILABLE' }); },
  });
  const kept = await new ClassifyImportedPublication(failing, new JsonLocalizationAdapter())
    .execute({ publication, seriesCatalog: catalog });
  assert.equal(kept.identitySource, 'RULES');
  assert.equal(kept.identity.episodeCode, 'FQA-E08');
  assert.equal(kept.identityAudit.extraction.failure, 'INTELLIGENCE_PROVIDER_UNAVAILABLE');
});

test('NOT_EPISODE classifications skip the identity cascade entirely', async () => {
  const classifier = classifierDouble({
    classify: async () => classification({ classification: 'NOT_EPISODE' }),
  });

  const suggestion = await new ClassifyImportedPublication(classifier, new JsonLocalizationAdapter())
    .execute({ publication, seriesCatalog: catalog });

  assert.deepEqual(classifier.calls.map(([name]) => name), ['classify']);
  assert.equal(suggestion.identitySource, 'RULES');
  assert.equal(suggestion.identityAudit.verification, undefined);
});
