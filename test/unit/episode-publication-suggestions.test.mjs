import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  extractExplicitEpisodeIdentity,
  groupEpisodePublicationSuggestions,
  normalizeSeriesIdentity,
} = require('../../dist/domain/analytics/episode-identity.js');

const publicationSuggestion = (platform, externalPublicationId, classification, identity) => ({
  classification,
  confidence: 0.9,
  publication: { platform, externalPublicationId, title: null, description: null },
  identity,
});

test('episode identity extraction distinguishes explicit seasons from unknown season metadata', () => {
  assert.deepEqual(extractExplicitEpisodeIdentity('FQA-E007'), {
    seriesName: 'FQA',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 7,
    episodeCode: 'FQA-E007',
  });
  assert.deepEqual(extractExplicitEpisodeIdentity('Nova Saga — Episódio 08'), {
    seriesName: 'Nova Saga',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 8,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity('Nova Saga - Temporada 2 - Episódio 08'), {
    seriesName: 'Nova Saga',
    seasonNumber: 2,
    seasonStatus: 'NUMBERED',
    episodeNumber: 8,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity('FQA-S02-E008'), {
    seriesName: 'FQA',
    seasonNumber: 2,
    seasonStatus: 'NUMBERED',
    episodeNumber: 8,
    episodeCode: 'FQA-S02-E008',
  });
  assert.deepEqual(extractExplicitEpisodeIdentity('Nova Saga T02E08'), {
    seriesName: 'Nova Saga',
    seasonNumber: 2,
    seasonStatus: 'NUMBERED',
    episodeNumber: 8,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity('A story with no installment number'), {
    seriesName: null,
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity('Episode 8'), {
    seriesName: null,
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 8,
    episodeCode: null,
  });
});

test('series identity extraction prefers episode headers and series names following episode markers in descriptions', () => {
  assert.deepEqual(extractExplicitEpisodeIdentity(null, '💋 FINGE QUE ME AMA | Capítulo 1 — O Beijo\nA história começa.'), {
    seriesName: 'FINGE QUE ME AMA',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 1,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    'Isadora só queria começar uma nova fase.\n\n🎬 Finge que Não Me Quer | Episódio 02\nUm reencontro inesperado.',
  ), {
    seriesName: 'Finge que Não Me Quer',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 2,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, 'No episódio 5 de Finge que Não Me Quer, Isadora enfrenta um problema.'), {
    seriesName: 'Finge que Não Me Quer',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 5,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, 'Episódio 3 | Finge que Não Me Quer\nAndreas decide ir atrás de Isadora.'), {
    seriesName: 'Finge que Não Me Quer',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 3,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, 'FINGE QUE ME AMA | EP. 03 — A PROPOSTA'), {
    seriesName: 'FINGE QUE ME AMA',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 3,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, 'EP. 13 | CONTRA-ATAQUE'), {
    seriesName: null,
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 13,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    'Ele fez um golaço. Mas a comemoração tinha uma destinatária.\n#FingeQueMeAma #Novelaria #Romance',
  ), {
    seriesName: 'Finge Que Me Ama',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, 'FINGE QUE ME AMA | GOL CONTRA'), {
    seriesName: 'FINGE QUE ME AMA',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, 'Vem conhecer Finge Que Me Ama, a novelinha de Maya.'), {
    seriesName: 'Finge Que Me Ama',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, 'Segunda-feira estreia: Finge que não me quer.'), {
    seriesName: 'Finge que não me quer',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, 'Série: Finge que me ama Todos os episódios completos no perfil.'), {
    seriesName: 'Finge que me ama',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, 'Estamos chegando à reta final de Finge que Me Ama, mas há mais um capítulo.'), {
    seriesName: 'Finge que Me Ama',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, 'EP. 13 | CONTRA-ATAQUE\n#FingeQueMeAma'), {
    seriesName: 'Finge Que Me Ama',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 13,
    episodeCode: null,
  });
});

test('series normalization groups only positive episode classifications with matching identity', () => {
  assert.equal(normalizeSeriesIdentity('  NOVA SÁGA! '), 'nova saga');
  const grouped = groupEpisodePublicationSuggestions([
    publicationSuggestion('instagram', 'ig-8', 'EPISODE', {
      seriesName: 'Nova Saga',
      seasonNumber: null,
      seasonStatus: 'NON_SEASONAL',
      episodeNumber: 8,
      episodeCode: null,
    }),
    publicationSuggestion('youtube', 'yt-8', 'EPISODE', {
      seriesName: 'NOVA SAGA',
      seasonNumber: null,
      seasonStatus: 'NON_SEASONAL',
      episodeNumber: 8,
      episodeCode: null,
    }),
    publicationSuggestion('tiktok', 'tt-9', 'EPISODE', {
      seriesName: 'Nova Saga',
      seasonNumber: null,
      seasonStatus: 'NON_SEASONAL',
      episodeNumber: 9,
      episodeCode: null,
    }),
    publicationSuggestion('facebook', 'fb-uncertain', 'UNCERTAIN', {
      seriesName: 'Nova Saga',
      seasonNumber: null,
      seasonStatus: 'NON_SEASONAL',
      episodeNumber: 8,
      episodeCode: null,
    }),
    publicationSuggestion('instagram', 'ig-other-series', 'EPISODE', {
      seriesName: 'Outra Série',
      seasonNumber: null,
      seasonStatus: 'NON_SEASONAL',
      episodeNumber: 8,
      episodeCode: null,
    }),
    publicationSuggestion('instagram', 'ig-s2-8', 'EPISODE', {
      seriesName: 'Nova Saga',
      seasonNumber: 2,
      seasonStatus: 'NUMBERED',
      episodeNumber: 8,
      episodeCode: null,
    }),
    publicationSuggestion('youtube', 'yt-s2-8', 'EPISODE', {
      seriesName: 'Nova Saga',
      seasonNumber: 2,
      seasonStatus: 'NUMBERED',
      episodeNumber: 8,
      episodeCode: null,
    }),
  ]);

  assert.equal(grouped.groups.length, 2);
  assert.equal(grouped.groups[0].seriesName, 'Nova Saga');
  assert.equal(grouped.groups[0].episodeNumber, 8);
  assert.equal(grouped.groups[0].seasonStatus, 'NON_SEASONAL');
  assert.deepEqual(grouped.groups[0].publications.map(({ publication }) => publication.externalPublicationId), ['ig-8', 'yt-8']);
  assert.equal(grouped.groups[1].seasonNumber, 2);
  assert.deepEqual(grouped.groups[1].publications.map(({ publication }) => publication.externalPublicationId), ['ig-s2-8', 'yt-s2-8']);
  assert.deepEqual(grouped.unmatched.map(({ publication }) => publication.externalPublicationId), ['tt-9', 'fb-uncertain', 'ig-other-series']);
});

test('named Obsidiana arcs resolve to the canonical series and creator-confirmable season', () => {
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    '🐺 OBSIDIANA: O LEGADO | Ep. 19 — A Escolha',
  ), {
    seriesName: 'Obsidiana',
    seasonNumber: 2,
    seasonStatus: 'NUMBERED',
    episodeNumber: 19,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    '🐉 OBSIDIANA Véspera sempre soube que havia algo diferente nela.',
  ), {
    seriesName: 'Obsidiana',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    '🐺 OBSIDIANA: O LEGADO | Ep. 19 — A Escolha',
  ), {
    seriesName: 'Obsidiana',
    seasonNumber: 2,
    seasonStatus: 'NUMBERED',
    episodeNumber: 19,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    'Obsidiana estava pronta para ouvir o legado da família.',
  ), {
    seriesName: null,
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, '🐺 OBSIDIANA: O LEGADO | #ObsidianaOLegado | EP. 20'), {
    seriesName: 'Obsidiana',
    seasonNumber: 2,
    seasonStatus: 'NUMBERED',
    episodeNumber: 20,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, '#Obsidiana #OLegado'), {
    seriesName: 'Obsidiana',
    seasonNumber: 2,
    seasonStatus: 'NUMBERED',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    '1ª temporada — OBSIDIANA',
  ), {
    seriesName: 'Obsidiana',
    seasonNumber: 1,
    seasonStatus: 'NUMBERED',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    'EP. 22 — CAMINHOS OPOSTOS\n#Obsidiana #ElaraELucius',
  ), {
    seriesName: 'Obsidiana',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 22,
    episodeCode: null,
  });
});

test('unknown season metadata stays unresolved and is never grouped as a non-seasonal episode', () => {
  const grouped = groupEpisodePublicationSuggestions([
    publicationSuggestion('instagram', 'ig-8', 'EPISODE', {
      seriesName: 'Nova Saga',
      seasonNumber: null,
      seasonStatus: 'UNKNOWN',
      episodeNumber: 8,
      episodeCode: null,
    }),
    publicationSuggestion('youtube', 'yt-8', 'EPISODE', {
      seriesName: 'Nova Saga',
      seasonNumber: null,
      seasonStatus: 'UNKNOWN',
      episodeNumber: 8,
      episodeCode: null,
    }),
  ]);

  assert.equal(grouped.groups.length, 0);
  assert.equal(grouped.unmatched.length, 2);
  assert.ok(grouped.unmatched.every((item) => item.unmatchedReason === 'SEASON_UNKNOWN'));
});

test('conflicting explicit episode codes remain ungrouped for creator review', () => {
  const grouped = groupEpisodePublicationSuggestions([
    publicationSuggestion('instagram', 'ig-8', 'EPISODE', {
      seriesName: 'Nova Saga',
      seasonNumber: null,
      seasonStatus: 'NON_SEASONAL',
      episodeNumber: 8,
      episodeCode: 'NS-E08',
    }),
    publicationSuggestion('youtube', 'yt-8', 'EPISODE', {
      seriesName: 'Nova Saga',
      seasonNumber: null,
      seasonStatus: 'NON_SEASONAL',
      episodeNumber: 8,
      episodeCode: 'NOVA-E08',
    }),
  ]);

  assert.equal(grouped.groups.length, 0);
  assert.equal(grouped.unmatched.length, 2);
  assert.ok(grouped.unmatched.every((item) => item.unmatchedReason === 'IDENTITY_CONFLICT'));
});
