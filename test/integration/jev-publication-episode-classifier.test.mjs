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
