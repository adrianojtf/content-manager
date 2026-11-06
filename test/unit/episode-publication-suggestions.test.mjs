import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  extractExplicitEpisodeIdentity,
  generateCanonicalEpisodeCode,
  groupEpisodePublicationSuggestions,
  normalizeSeriesIdentity,
} = require('../../dist/domain/analytics/episode-identity.js');

const publicationSuggestion = (platform, externalPublicationId, classification, identity) => ({
  classification,
  confidence: 0.9,
  publication: { platform, externalPublicationId, title: null, description: null },
  identity,
});

test('canonical episode codes are deterministic from series, season, and episode identity', () => {
  assert.equal(
    generateCanonicalEpisodeCode('5b7f1f84-25a8-4bd8-a7df-680dc4400010', 2, 8),
    'EP-5B7F1F8425A84BD8A7DF680DC4400010-S02-E08',
  );
  assert.equal(
    generateCanonicalEpisodeCode('5b7f1f84-25a8-4bd8-a7df-680dc4400010', null, 12),
    'EP-5B7F1F8425A84BD8A7DF680DC4400010-E12',
  );
  assert.notEqual(
    generateCanonicalEpisodeCode('5b7f1f84-25a8-4bd8-a7df-680dc4400011', 2, 8),
    generateCanonicalEpisodeCode('5b7f1f84-25a8-4bd8-a7df-680dc4400010', 2, 8),
  );
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
  assert.equal(normalizeSeriesIdentity('Fora de Roteiro'), normalizeSeriesIdentity('Fora Do Roteiro'));
  assert.equal(normalizeSeriesIdentity('Elara E Lucius'), 'elara lucius');
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

test('named arc titles surface as generic deterministic candidates without series-specific rules', () => {
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    '🐺 OBSIDIANA: O LEGADO | Ep. 19 — A Escolha',
  ), {
    seriesName: 'OBSIDIANA: O LEGADO',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 19,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    '🐉 OBSIDIANA Véspera sempre soube que havia algo diferente nela.',
  ), {
    seriesName: null,
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
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
    seriesName: 'OBSIDIANA: O LEGADO | #ObsidianaOLegado',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: 20,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(null, '#Obsidiana #OLegado'), {
    seriesName: 'Obsidiana',
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  });
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    '1ª temporada — OBSIDIANA',
  ), {
    seriesName: null,
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
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

test('character-pair names lose to series-looking hashtags, and single-word tags need non-generic company', () => {
  assert.deepEqual(extractExplicitEpisodeIdentity(
    null,
    'Elara finalmente descobre a verdade sobre Lucius. #NoveladeIA #Obsidiana #OLegado #ElaraELucius',
  ).seriesName, 'Obsidiana');
  assert.equal(extractExplicitEpisodeIdentity(
    null,
    'Bastidores da gravação de hoje #Novelaria #Studionovelaria',
  ).seriesName, null);
});

test('named-series cues require a capitalized candidate and stop before temporal prose', () => {
  assert.equal(extractExplicitEpisodeIdentity(
    null,
    'Para Lucius, atravessar aquele portal significa finalmente conhecer o mundo de Elara. #Obsidiana #ObsidianaOLegado',
  ).seriesName, 'Obsidiana O Legado');
  assert.equal(extractExplicitEpisodeIdentity(
    null,
    'Véspera quer conhecer o rapaz que conquistou sua filha. #Obsidiana #ObsidianaOLegado',
  ).seriesName, 'Obsidiana O Legado');
  assert.equal(extractExplicitEpisodeIdentity(
    null,
    'Ele quer conhecer Obsidiana amanhã.',
  ).seriesName, 'Obsidiana');
});
