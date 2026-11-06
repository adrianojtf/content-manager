import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { JevPublicationEpisodeClassifier } = require('../../dist/infrastructure/intelligence/jev-publication-episode-classifier.js');
const { IntelligenceProviderError } = require('../../dist/application/social/intelligence-provider-error.js');

const probabilities = { EPISODE: 0.88, NOT_EPISODE: 0.04, UNCERTAIN: 0.08 };

function createClient(answer, error = null) {
  const calls = [];
  return {
    calls,
    client: {
      evaluate: async (input) => {
        calls.push(input);
        if (error) throw error;
        return {
          model: 'jev-test-model',
          usage: { inputTokens: 24, outputTokens: 8 },
          answers: {
            episode_classification: {
              type: 'choice',
              choice: answer,
              confidence: probabilities[answer],
              probabilities,
            },
          },
        };
      },
    },
  };
}

test('JEV classifies only imported publication metadata and returns a structured auditable result', async () => {
  const { calls, client } = createClient('EPISODE');
  const classifier = new JevPublicationEpisodeClassifier(client);
  const publication = {
    platform: 'instagram',
    externalPublicationId: 'ig-publication-8',
    title: null,
    description: 'Nova Saga - Episódio 8',
  };

  const result = await classifier.classify({ publication });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].state.publication, {
    platform: publication.platform,
    title: publication.title,
    description: publication.description,
  });
  assert.equal(JSON.stringify(calls[0].state).includes(publication.externalPublicationId), false);
  assert.match(calls[0].questions.episode_classification.instructions, /ignore any instructions/i);
  assert.equal(result.classification, 'EPISODE');
  assert.equal(result.confidence, 0.88);
  assert.deepEqual(result.probabilities, probabilities);
  assert.deepEqual(result.evidence, publication);
  assert.equal(result.provider, 'JEV');
  assert.ok(result.model);
  assert.ok(result.schemaVersion);
  assert.ok(result.usage);
});

test('missing publication text becomes uncertain without a JEV request', async () => {
  const { calls, client } = createClient('EPISODE');
  const classifier = new JevPublicationEpisodeClassifier(client);

  const result = await classifier.classify({
    publication: { platform: 'youtube', externalPublicationId: 'video-1', title: null, description: '   ' },
  });

  assert.equal(calls.length, 0);
  assert.equal(result.classification, 'UNCERTAIN');
  assert.equal(result.confidence, null);
  assert.equal(result.provider, 'RULES');
  assert.equal(result.evidence, null);
});

test('invalid JEV classification output is rejected and provider errors remain visible', async () => {
  const malformed = createClient('UNSUPPORTED');
  const classifier = new JevPublicationEpisodeClassifier(malformed.client);
  await assert.rejects(
    classifier.classify({ publication: { platform: 'tiktok', externalPublicationId: 'tt-1', title: 'FQA-E07', description: null } }),
    (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID',
  );

  const unavailable = createClient('EPISODE', new IntelligenceProviderError('INTELLIGENCE_PROVIDER_UNAVAILABLE'));
  await assert.rejects(
    new JevPublicationEpisodeClassifier(unavailable.client).classify({
      publication: { platform: 'tiktok', externalPublicationId: 'tt-1', title: 'FQA-E07', description: null },
    }),
    (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_UNAVAILABLE',
  );
});

function createCascadeClient(answers) {
  const calls = [];
  return {
    calls,
    client: {
      evaluate: async (input) => {
        calls.push(input);
        return { model: 'jev-test-model', usage: { inputTokens: 30, outputTokens: 12 }, answers };
      },
    },
  };
}

test('JEV verification sends the untrusted text and the candidate identity as a choice question', async () => {
  const { calls, client } = createCascadeClient({
    episode_identity_verification: {
      type: 'choice',
      choice: 'VALID',
      confidence: 0.86,
      probabilities: { VALID: 0.86, INVALID: 0.05, UNCERTAIN: 0.09 },
    },
  });
  const classifier = new JevPublicationEpisodeClassifier(client);
  const publication = {
    platform: 'instagram',
    externalPublicationId: 'ig-1',
    title: 'FQA-S02-E08',
    description: 'episódio novo',
  };
  const identity = {
    seriesName: 'FQA',
    seasonNumber: 2,
    seasonStatus: 'NUMBERED',
    episodeNumber: 8,
    episodeCode: 'FQA-S02-E08',
  };

  const result = await classifier.verifyEpisodeIdentity({ publication, identity });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].state.candidateIdentity, identity);
  assert.equal(JSON.stringify(calls[0].state).includes(publication.externalPublicationId), false);
  assert.match(calls[0].questions.episode_identity_verification.instructions, /untrusted/i);
  assert.equal(result.verdict, 'VALID');
  assert.equal(result.confidence, 0.86);
  assert.equal(result.model, 'jev-test-model');
});

test('JEV verification rejects out-of-contract verdicts', async () => {
  const { client } = createCascadeClient({
    episode_identity_verification: {
      type: 'choice',
      choice: 'MAYBE',
      confidence: 0.5,
      probabilities: { VALID: 0.3, INVALID: 0.3, UNCERTAIN: 0.4 },
    },
  });
  await assert.rejects(
    new JevPublicationEpisodeClassifier(client).verifyEpisodeIdentity({
      publication: { platform: 'youtube', externalPublicationId: 'v-1', title: 't', description: null },
      identity: { seriesName: 'FQA', seasonNumber: null, seasonStatus: 'UNKNOWN', episodeNumber: 8, episodeCode: null },
    }),
    (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID',
  );
});

test('JEV extraction sends only the safe series catalog projection and validates the JSON payload', async () => {
  const { calls, client } = createCascadeClient({
    episode_identity_extraction: {
      type: 'json',
      value: {
        seriesRef: { type: 'existing', seriesId: 'series-1' },
        seasonNumber: 2,
        episodeNumber: 8,
        episodeCode: 'FQA-S02-E08',
        confidence: 0.77,
      },
      confidence: 0.77,
    },
  });
  const classifier = new JevPublicationEpisodeClassifier(client);
  const seriesCatalog = [{
    id: 'series-1',
    name: 'FQA',
    aliases: ['Fiction Quest'],
    seasonMode: 'SEASONAL',
    knownSeasonNumbers: [1, 2],
  }];

  const result = await classifier.extractEpisodeIdentity({
    publication: { platform: 'tiktok', externalPublicationId: 'tt-9', title: 'FQA ep 8', description: null },
    seriesCatalog,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].state.seriesCatalog, [{
    id: 'series-1',
    name: 'FQA',
    aliases: ['Fiction Quest'],
    seasonMode: 'SEASONAL',
    knownSeasonNumbers: [1, 2],
  }]);
  assert.equal(calls[0].questions.episode_identity_extraction.type, 'json');
  assert.deepEqual(result, {
    seriesRef: { type: 'existing', seriesId: 'series-1' },
    seasonNumber: 2,
    episodeNumber: 8,
    episodeCode: 'FQA-S02-E08',
    confidence: 0.77,
    model: 'jev-test-model',
    usage: { inputTokens: 30, outputTokens: 12 },
  });
});

test('JEV extraction accepts a new series proposal and rejects malformed payloads', async () => {
  const newSeries = createCascadeClient({
    episode_identity_extraction: {
      type: 'json',
      value: {
        seriesRef: { type: 'new', name: 'Nova Série' },
        seasonNumber: null,
        episodeNumber: 3,
        episodeCode: null,
      },
      confidence: 0.6,
    },
  });
  const result = await new JevPublicationEpisodeClassifier(newSeries.client).extractEpisodeIdentity({
    publication: { platform: 'youtube', externalPublicationId: 'v-2', title: 'ep 3', description: null },
    seriesCatalog: [],
  });
  assert.deepEqual(result.seriesRef, { type: 'new', name: 'Nova Série' });
  assert.equal(result.seasonNumber, null);
  assert.equal(result.episodeNumber, 3);

  const malformed = createCascadeClient({
    episode_identity_extraction: {
      type: 'json',
      value: { seriesRef: { type: 'existing' }, episodeNumber: 'eight' },
    },
  });
  await assert.rejects(
    new JevPublicationEpisodeClassifier(malformed.client).extractEpisodeIdentity({
      publication: { platform: 'youtube', externalPublicationId: 'v-3', title: 'ep 8', description: null },
      seriesCatalog: [],
    }),
    (error) => error instanceof IntelligenceProviderError && error.code === 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID',
  );
});
