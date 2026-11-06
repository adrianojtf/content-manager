import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as episodeReview from '../../web/episode-review.mjs';

const { renderEpisodeReviewScreen } = episodeReview;

const group = {
  seriesName: 'FQA',
  seasonStatus: 'NUMBERED',
  seasonNumber: 2,
  episodeNumber: 8,
  episodeCode: 'FQA-S02-E08',
  publications: [{
    id: 'suggestion-1',
    classification: 'EPISODE',
    confidence: 0.93,
    rationaleVariants: { 'pt-BR': 'O JEV sinalizou esta publicação como possível episódio.' },
    publication: {
      platform: 'instagram',
      externalPublicationId: 'ig-8',
      title: '<img src=x onerror=alert(1)>',
      description: 'FQA-S02-E08',
      permalink: 'https://social.example/ig-8',
      publishedAt: '2026-10-10T12:00:00.000Z',
    },
  }],
};

test('episode review screen groups source publications by Series, season, and episode with editable approval controls', () => {
  const html = renderEpisodeReviewScreen({
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    recommendationsOpen: true,
    series: [{ id: 'series-1', name: 'FQA', aliases: ['Fiction Quest'], seasonMode: 'SEASONAL' }],
    groups: [group],
    unmatched: [],
  });

  assert.match(html, /Episódios/);
  assert.match(html, /FQA/);
  assert.match(html, /Temporada 2/);
  assert.match(html, /Episódio 8/);
  assert.match(html, /Possível episódio/);
  assert.match(html, /name="seriesId"/);
  assert.doesNotMatch(html, /name="seriesId"[^>]*required/);
  assert.match(html, /<option value="series-1"[^>]*selected/);
  assert.match(html, /name="newSeriesName"[^>]*disabled/);
  assert.match(html, /name="seasonMode"[^>]*disabled/);
  assert.match(html, /name="seasonNumber"[^>]*required/);
  assert.match(html, /name="episodeNumber"/);
  assert.doesNotMatch(html, /name="episodeCode"/);
  assert.match(html, /data-review-publication="suggestion-1"/);
  assert.match(html, /data-action="approve-episode-group"/);
  assert.match(html, /data-action="reject-episode-group"/);
  assert.match(html, /data-action="defer-episode-group"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('episode review screen keeps a new-series draft submittable', () => {
  const html = renderEpisodeReviewScreen({
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    recommendationsOpen: true,
    series: [],
    groups: [],
    showUnmatchedEpisodes: true,
    unmatched: [{
      ...group.publications[0],
      unmatchedReason: 'IDENTITY_SINGLE',
      identity: {
        seriesName: 'Nova série',
        seasonStatus: 'UNKNOWN',
        seasonNumber: null,
        episodeNumber: 8,
        episodeCode: 'NOVA-E08',
      },
    }],
  });

  assert.match(html, /data-role="new-series-fields"/);
  assert.doesNotMatch(html, /name="seriesId"[^>]*required/);
  assert.match(html, /name="newSeriesName"[^>]*required/);
  assert.match(html, /name="seasonMode"[^>]*required/);
  assert.match(html, /Não encontramos outra publicação com a mesma identidade/);
});

test('episode review screen distinguishes loading, error, and empty states', () => {
  const loading = renderEpisodeReviewScreen({
    loading: true, refreshing: false, saving: false, error: null, recommendationsOpen: true, series: [], groups: [], unmatched: [],
  });
  assert.match(loading, /aria-busy="true"/);

  const error = renderEpisodeReviewScreen({
    loading: false, refreshing: false, saving: false, error: 'API_UNAVAILABLE', recommendationsOpen: true, series: [], groups: [], unmatched: [],
  });
  assert.match(error, /role="alert"/);
  assert.match(error, /data-action="retry-episode-review"/);

  const empty = renderEpisodeReviewScreen({
    loading: false, refreshing: false, saving: false, error: null, recommendationsOpen: true, series: [], groups: [], unmatched: [],
  });
  assert.match(empty, /data-action="refresh-episode-suggestions"/);
  assert.match(empty, /Nenhum episódio identificado para revisar/);
});

test('episode review cards use theme tokens and responsive layout', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.episode-review-card\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.episode-review-card\s*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(styles, /\.episode-series-row\s*\{[^}]*background:\s*transparent[^}]*color:\s*var\(--text\)/s);
  assert.match(styles, /\.episode-series-suggestion\s*\{[^}]*background:\s*var\(--surface-soft\)[^}]*color:\s*var\(--text\)/s);
  assert.match(styles, /\.episode-series-episode-card\s*\{[^}]*background:\s*var\(--surface-soft\)[^}]*color:\s*var\(--text\)/s);
  assert.match(styles, /\.episode-series-pending-item\s*\{[^}]*background:\s*var\(--surface-soft\)/s);
  assert.match(styles, /\.episode-series-pending \.episode-review-actions\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/s);
  assert.match(styles, /\.episode-series-episode-source-copy p\s*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(styles, /\.episode-setup-progress-step\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.episode-source-card\s*\{[^}]*background:\s*var\(--surface-soft\)/s);
  assert.match(styles, /\.episode-candidate-toggle\s*\{[^}]*background:\s*var\(--surface-soft\)/s);
  assert.match(styles, /:focus-visible\s*\{[^}]*outline:/s);
  assert.match(styles, /@media \(max-width: 999px\)[\s\S]*\.episode-review-grid/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.episode-setup-progress/);
});

test('episode group renders cross-network publications in one accessible carousel card', () => {
  const html = renderEpisodeReviewScreen({
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    recommendationsOpen: true,
    series: [{ id: 'series-1', name: 'FQA', aliases: ['Fiction Quest'], seasonMode: 'SEASONAL' }],
    groups: [{
      ...group,
      publications: [
        { ...group.publications[0], socialAccountName: 'FQA Oficial' },
        {
          ...group.publications[0],
          id: 'suggestion-2',
          socialAccountName: 'FQA Oficial',
          publication: {
            ...group.publications[0].publication,
            platform: 'youtube',
            externalPublicationId: 'yt-8',
            title: 'Fiction Quest S02E08',
          },
        },
        {
          ...group.publications[0],
          id: 'suggestion-3',
          socialAccountName: 'FQA Oficial',
          publication: {
            ...group.publications[0].publication,
            platform: 'tiktok',
            externalPublicationId: 'tt-8',
            title: 'FQA 8',
          },
        },
      ],
    }],
    unmatched: [],
  });

  assert.equal((html.match(/<form class="episode-review-card"[^>]*data-episode-group/g) ?? []).length, 1);
  assert.equal((html.match(/data-carousel-slide/g) ?? []).length, 3);
  assert.match(html, /aria-roledescription="carrossel"/);
  assert.match(html, /Conta: FQA Oficial/);
  assert.match(html, /data-action="episode-carousel-prev"[^>]*disabled/);
  assert.match(html, /data-action="episode-carousel-next"/);
  assert.match(html, /aria-live="polite"[^>]*>Publicação 1 de 3</);
  assert.match(html, /data-review-publication="suggestion-1" checked/);
  assert.match(html, /data-review-publication="suggestion-2" checked/);
  assert.match(html, /data-review-publication="suggestion-3" checked/);
  assert.match(html, /data-carousel-slide[^>]*hidden[^>]*aria-hidden="true"/);
});

test('episode carousel navigation updates slides, position, and boundary controls', () => {
  const slides = Array.from({ length: 3 }, (_, index) => ({
    hidden: index !== 0,
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  }));
  const previous = { disabled: true };
  const next = { disabled: false };
  const position = { textContent: 'Publicação 1 de 3' };
  const carousel = {
    dataset: { carouselIndex: '0' },
    querySelectorAll: () => slides,
    querySelector: (selector) => ({
      '[data-carousel-prev]': previous,
      '[data-carousel-next]': next,
      '[data-carousel-position]': position,
    })[selector],
  };

  assert.equal(typeof episodeReview.updateEpisodeCarousel, 'function');
  assert.equal(episodeReview.updateEpisodeCarousel(carousel, 1), 1);
  assert.equal(carousel.dataset.carouselIndex, '1');
  assert.deepEqual(slides.map((slide) => slide.hidden), [true, false, true]);
  assert.equal(position.textContent, 'Publicação 2 de 3');
  assert.equal(previous.disabled, false);
  assert.equal(next.disabled, false);
  assert.equal(episodeReview.updateEpisodeCarousel(carousel, 3), 2);
  assert.equal(next.disabled, true);
});

test('episode group selection summary prevents approval when no source is selected', () => {
  const inputs = [{ checked: true }, { checked: false }, { checked: true }];
  const buttons = [{ disabled: false }, { disabled: false }, { disabled: false }];
  const summary = { textContent: '' };
  const form = {
    querySelectorAll: (selector) => selector === '[data-review-publication]' ? inputs : buttons,
    querySelector: () => summary,
  };

  assert.equal(episodeReview.updateEpisodeSelectionSummary(form), 2);
  assert.equal(summary.textContent, '2 de 3 publicações selecionadas');
  assert.ok(buttons.every((button) => !button.disabled));
  inputs.forEach((input) => { input.checked = false; });
  assert.equal(episodeReview.updateEpisodeSelectionSummary(form), 0);
  assert.ok(buttons.every((button) => button.disabled));
});

test('episode setup renders series and season confirmation as separate automatic steps', () => {
  const seriesStep = renderEpisodeReviewScreen({
    stage: 'SERIES',
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    recommendationsOpen: true,
    series: [],
    seriesProposals: [{ suggestedName: 'FQA', suggestions: group.publications }],
    seasonProposals: [],
    groups: [],
    unmatched: [],
  });
  assert.match(seriesStep, /data-episode-setup-step="series"/);
  assert.match(seriesStep, /data-series-proposal/);
  assert.match(seriesStep, /data-action="confirm-series-proposal"/);
  assert.doesNotMatch(seriesStep, /name="episodeNumber"/);

  const seasonStep = renderEpisodeReviewScreen({
    stage: 'SEASONS',
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    recommendationsOpen: true,
    series: [{ id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'SEASONAL' }],
    seriesProposals: [],
    seasonProposals: [{ seriesId: 'series-1', seriesName: 'FQA', proposedSeasonNumber: null, suggestions: group.publications }],
    groups: [],
    unmatched: [],
  });
  assert.match(seasonStep, /data-episode-setup-step="seasons"/);
  assert.match(seasonStep, /data-season-proposal/);
  assert.match(seasonStep, /data-action="confirm-season-proposal"/);
  assert.doesNotMatch(seasonStep, /name="episodeNumber"/);
});

test('series catalog and manual episode entry remain available while recommendations stay in the background', () => {
  const model = {
    stage: 'SERIES',
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    series: [{ id: 'created-series', name: 'Minha série', aliases: ['Meu projeto'], seasonMode: 'SEASONAL' }],
    seriesProposals: [{ suggestedName: 'Sugestão JEV', suggestions: group.publications }],
    seasonProposals: [],
    groups: [],
    unmatched: [],
  };

  const collapsed = renderEpisodeReviewScreen(model);
  assert.match(collapsed, /data-episode-series-catalog/);
  assert.match(collapsed, /data-series-catalog-item="created-series"[^>]*>[\s\S]*Minha série/);
  assert.match(collapsed, /data-action="toggle-episode-recommendations"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(collapsed, /data-series-proposal/);
  assert.match(collapsed, /data-action="toggle-manual-episode-form"/);

  const expanded = renderEpisodeReviewScreen({ ...model, recommendationsOpen: true });
  assert.match(expanded, /data-action="toggle-episode-recommendations"[^>]*aria-expanded="true"/);
  assert.match(expanded, /data-series-proposal/);
});

test('manual episode entry is available on series, seasons, and episode recommendation stages', () => {
  for (const stage of ['SERIES', 'SEASONS', 'EPISODES']) {
    const html = renderEpisodeReviewScreen({
      stage,
      loading: false,
      refreshing: false,
      saving: false,
      error: null,
      series: [{ id: 'created-series', name: 'Minha série', aliases: [], seasonMode: 'SEASONAL' }],
      seriesProposals: [],
      seasonProposals: [],
      groups: [],
      unmatched: [],
    });

    assert.match(html, /data-action="toggle-manual-episode-form"/, `${stage} should expose manual episode entry`);
    assert.match(html, /data-series-catalog-item="created-series"/, `${stage} should keep the created series listed`);
  }
});

test('series catalog paginates its list without limiting the series data', () => {
  const series = Array.from({ length: 12 }, (_, index) => ({
    id: `series-${index + 1}`,
    name: `Série ${index + 1}`,
    aliases: [],
    seasonMode: 'NON_SEASONAL',
  }));
  const firstPage = renderEpisodeReviewScreen({
    series,
    seriesPage: 0,
    groups: [],
    unmatched: [],
  });
  const secondPage = renderEpisodeReviewScreen({
    series,
    seriesPage: 1,
    groups: [],
    unmatched: [],
  });

  assert.equal((firstPage.match(/data-series-catalog-item=/g) ?? []).length, 10);
  assert.match(firstPage, /data-series-catalog-item="series-1"/);
  assert.doesNotMatch(firstPage, /data-series-catalog-item="series-11"/);
  assert.match(firstPage, /data-action="series-list-page" data-page="1"/);
  assert.match(secondPage, /data-series-catalog-item="series-11"/);
  assert.match(secondPage, /data-action="series-list-page" data-page="0"/);
});

test('series detail lists every saved episode and provides a back action', () => {
  const seriesEpisodes = Array.from({ length: 12 }, (_, index) => ({
    id: `episode-${index + 1}`,
    seriesId: 'series-1',
    seasonNumber: index < 10 ? 1 : 2,
    episodeNumber: (index % 10) + 1,
    episodeCode: `FQA-E${String(index + 1).padStart(2, '0')}`,
    publications: index === 11 ? [{
      platform: 'youtube',
      socialAccountName: 'FQA Oficial',
      externalPublicationId: 'video-12',
      title: 'FQA episódio 12 - final',
      description: 'A equipe descobre a pista que identifica o episódio final.',
      permalink: 'https://video.example/fqa-12',
      publishedAt: '2026-10-10T12:00:00.000Z',
    }] : [],
  }));
  const html = renderEpisodeReviewScreen({
    series: [{ id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'SEASONAL' }],
    selectedSeriesId: 'series-1',
    seriesEpisodes,
    seriesPendingEpisodeSelection: ['suggestion-ready'],
    seriesPendingSuggestions: [{
      id: 'suggestion-pending',
      classification: 'EPISODE',
      setupSeriesId: 'series-1',
      setupSeriesConfirmedAt: '2026-10-10T12:00:00.000Z',
      setupSeasonNumber: 2,
      setupSeasonConfirmedAt: '2026-10-10T12:00:00.000Z',
      socialAccountName: 'FQA Oficial',
      publication: {
        platform: 'instagram',
        externalPublicationId: '18080154299399337',
        title: null,
        description: 'FQA: a equipe encontra uma pista sobre a origem da série.',
        permalink: 'https://social.example/18080154299399337',
        thumbnailUrl: 'https://media.example/18080154299399337.jpg',
        publishedAt: '2026-10-10T12:00:00.000Z',
      },
      identity: { seasonNumber: 2, episodeNumber: 13 },
    }, {
      id: 'suggestion-ready',
      classification: 'EPISODE',
      setupSeriesId: 'series-1',
      setupSeriesConfirmedAt: '2026-10-10T12:00:00.000Z',
      setupSeasonNumber: 2,
      setupSeasonConfirmedAt: '2026-10-10T12:00:00.000Z',
      publication: {
        platform: 'youtube',
        externalPublicationId: 'video-14',
        title: 'FQA episódio 14',
        description: 'Mais uma pista sobre a origem da série.',
      },
      identity: { seasonNumber: 2, episodeNumber: 14, episodeCode: 'FQA-S02-E14' },
    }, {
      id: 'suggestion-unresolved',
      classification: 'EPISODE',
      setupSeriesId: 'series-1',
      setupSeriesConfirmedAt: '2026-10-10T12:00:00.000Z',
      setupSeasonNumber: null,
      setupSeasonConfirmedAt: null,
      publication: {
        platform: 'instagram',
        externalPublicationId: 'post-unresolved',
        title: 'FQA episódio 15',
      },
      identity: { seasonNumber: null, episodeNumber: 15, episodeCode: 'FQA-S02-E15' },
    }],
    groups: [],
    unmatched: [],
  });
  assert.match(html, /data-series-details/);
  assert.match(html, /data-action="back-to-series-list"/);
  assert.equal((html.match(/data-series-episode-id=/g) ?? []).length, 12);
  assert.match(html, /Temporada 2 Episódio 2/);
  assert.match(html, /data-series-episode-source/);
  assert.match(html, /FQA Oficial/);
  assert.match(html, /FQA episódio 12 - final/);
  assert.match(html, /A equipe descobre a pista que identifica o episódio final\./);
  assert.match(html, /https:\/\/video\.example\/fqa-12/);
  assert.match(html, /data-series-pending-suggestions/);
  assert.match(html, /FQA: a equipe encontra uma pista sobre a origem da série\./);
  assert.match(html, /<strong>FQA: a equipe encontra uma pista sobre a origem da série\.<\/strong>/);
  assert.match(html, /FQA Oficial/);
  assert.match(html, /Instagram/);
  assert.match(html, /18080154299399337/);
  assert.match(html, /https:\/\/social\.example\/18080154299399337/);
  assert.match(html, /media\.example\/18080154299399337\.jpg/);
  assert.match(html, /data-series-pending-thumbnail/);
  assert.match(html, /episode-series-pending-image-fallback" hidden/);
  assert.match(html, /social-logo youtube/);
  assert.match(html, /Publicada em 10 de out\./);
  assert.equal((html.match(/data-series-pending-episode-suggestion-id=/g) ?? []).length, 3);
  const missingCodeCheckbox = html.match(/<input type="checkbox" data-series-pending-episode-suggestion-id="suggestion-pending"[^>]*>/)?.[0];
  assert.ok(missingCodeCheckbox);
  assert.doesNotMatch(missingCodeCheckbox, /disabled/);
  assert.doesNotMatch(html, /data-series-pending-episode-code/);
  assert.match(html, /data-series-pending-episode-suggestion-id="suggestion-ready"/);
  assert.match(html, /<input type="checkbox" data-series-pending-episode-suggestion-id="suggestion-unresolved"[^>]*disabled/);
  assert.match(html, /Confirme a temporada e informe um número de episódio válido/);
  assert.match(html, /data-action="add-series-pending-episodes"[^>]*>Adicionar episódios selecionados/);
  assert.doesNotMatch(html, /data-action="add-series-pending-episodes" disabled/);
  assert.doesNotMatch(html, /data-action="series-list-page"/);
  assert.match(html, /data-action="open-series-suggestions"/);
});

test('registered episodes offer an edit action and the edit form carries current values', () => {
  const base = {
    series: [{ id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'SEASONAL' }],
    selectedSeriesId: 'series-1',
    seriesEpisodes: [{
      id: 'episode-1',
      seriesId: 'series-1',
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      productionCost: { amount: '750.25', currency: 'BRL' },
      productionTimeSeconds: 4200,
      publications: [],
    }],
    groups: [],
    unmatched: [],
  };

  const list = renderEpisodeReviewScreen(base);
  assert.match(list, /data-action="edit-series-episode" data-episode-id="episode-1"/);
  assert.match(list, /FQA-S02-E08/);

  const editing = renderEpisodeReviewScreen({ ...base, editingEpisodeId: 'episode-1' });
  assert.match(editing, /data-series-episode-edit-form data-episode-id="episode-1"/);
  assert.match(editing, /name="seasonNumber" type="number" min="1" step="1" value="2"/);
  assert.match(editing, /name="episodeNumber" type="number" min="1" step="1" value="8"/);
  assert.match(editing, /name="episodeCode" type="text" maxlength="100" value="FQA-S02-E08"/);
  assert.match(editing, /name="productionCostAmount"[^>]*value="750.25"/);
  assert.match(editing, /name="productionTimeSeconds"[^>]*value="4200"/);
  assert.match(editing, /data-action="cancel-series-episode-edit"/);
});

test('episode source offers per-publication edit and inline replacement form', () => {
  const base = {
    series: [{ id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'SEASONAL' }],
    selectedSeriesId: 'series-1',
    seriesEpisodes: [{
      id: 'episode-1',
      seriesId: 'series-1',
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
      publications: [{
        platform: 'instagram',
        socialAccountId: 'account-1',
        socialAccountName: 'Creator',
        externalPublicationId: 'post-1',
        title: 'FQA no Instagram',
      }],
    }],
    groups: [],
    unmatched: [],
  };

  const list = renderEpisodeReviewScreen(base);
  assert.match(list, /data-action="edit-episode-publication" data-episode-id="episode-1" data-account-id="account-1" data-publication-id="post-1"/);

  const editing = renderEpisodeReviewScreen({
    ...base,
    editingLink: { key: 'episode-1\u0000account-1\u0000post-1' },
  });
  assert.match(editing, /data-episode-link-edit-form data-episode-id="episode-1" data-account-id="account-1" data-publication-id="post-1"/);
  assert.match(editing, /name="seasonNumber" type="number" min="1" step="1" value="2"/);
  assert.match(editing, /name="episodeNumber" type="number" min="1" step="1" value="8"/);
  assert.match(editing, /data-action="cancel-episode-publication-edit"/);
  assert.doesNotMatch(editing, /<select name="next"/);
});

test('non-seasonal episode edit form omits the season field', () => {
  const editing = renderEpisodeReviewScreen({
    series: [{ id: 'series-2', name: 'Daily', aliases: [], seasonMode: 'NON_SEASONAL' }],
    selectedSeriesId: 'series-2',
    seriesEpisodes: [{
      id: 'episode-9',
      seriesId: 'series-2',
      seasonNumber: null,
      episodeNumber: 3,
      episodeCode: 'DV-E03',
      productionCost: null,
      productionTimeSeconds: null,
      publications: [],
    }],
    editingEpisodeId: 'episode-9',
    groups: [],
    unmatched: [],
  });

  assert.match(editing, /data-series-episode-edit-form/);
  assert.doesNotMatch(editing, /name="seasonNumber"/);
});

test('pending episode with unavailable number can be corrected before selection and approval', () => {
  const model = {
    series: [{ id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'SEASONAL' }],
    selectedSeriesId: 'series-1',
    seriesEpisodes: [],
    seriesPendingSuggestions: [{
      id: 'suggestion-no-number',
      classification: 'EPISODE',
      setupSeriesId: 'series-1',
      setupSeriesConfirmedAt: '2026-10-10T12:00:00.000Z',
      setupSeasonNumber: 2,
      setupSeasonConfirmedAt: '2026-10-10T12:00:00.000Z',
      publication: {
        platform: 'instagram',
        externalPublicationId: 'episode-without-number',
        title: 'FQA: uma cena nova',
        description: 'A publicação não informa o número do episódio.',
      },
      identity: { seasonNumber: 2, episodeNumber: null, episodeCode: null },
    }],
    groups: [],
    unmatched: [],
  };

  const unavailable = renderEpisodeReviewScreen(model);
  assert.match(unavailable, /data-series-pending-episode-number/);
  const blockedCheckbox = unavailable.match(/<input type="checkbox" data-series-pending-episode-suggestion-id="suggestion-no-number"[^>]*>/)?.[0];
  assert.match(blockedCheckbox, /disabled/);

  const corrected = renderEpisodeReviewScreen({
    ...model,
    seriesPendingEpisodeNumberDrafts: { 'suggestion-no-number': '16' },
    seriesPendingEpisodeSelection: ['suggestion-no-number'],
  });
  const availableCheckbox = corrected.match(/<input type="checkbox" data-series-pending-episode-suggestion-id="suggestion-no-number"[^>]*>/)?.[0];
  assert.doesNotMatch(availableCheckbox, /disabled/);
  assert.match(availableCheckbox, /data-episode-number="16"/);
  assert.match(corrected, /data-action="add-series-pending-episodes"[^>]*>Adicionar episódios selecionados/);
});

test('pending suggestions are grouped by platform and ordered by publication date ascending', () => {
  const makeSuggestion = (id, platform, publishedAt) => ({
    id,
    classification: 'EPISODE',
    setupSeriesId: 'series-1',
    setupSeriesConfirmedAt: '2026-10-01T00:00:00.000Z',
    setupSeasonNumber: 2,
    setupSeasonConfirmedAt: '2026-10-01T00:00:00.000Z',
    publication: {
      platform,
      externalPublicationId: id,
      title: id,
      description: `Descrição ${id}`,
      publishedAt,
    },
    identity: { seasonNumber: 2, episodeNumber: 8, episodeCode: 'FQA-S02-E08' },
  });
  const html = renderEpisodeReviewScreen({
    series: [{ id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'SEASONAL' }],
    selectedSeriesId: 'series-1',
    seriesPendingSuggestions: [
      makeSuggestion('youtube-post', 'youtube', '2026-10-01T00:00:00.000Z'),
      makeSuggestion('instagram-late', 'instagram', '2026-10-20T00:00:00.000Z'),
      makeSuggestion('instagram-undated', 'instagram', null),
      makeSuggestion('facebook-post', 'facebook', '2026-10-05T00:00:00.000Z'),
      makeSuggestion('instagram-early', 'instagram', '2026-10-10T00:00:00.000Z'),
    ],
    groups: [],
    unmatched: [],
  });

  const facebookGroup = html.indexOf('data-series-pending-network="facebook"');
  const instagramGroup = html.indexOf('data-series-pending-network="instagram"');
  const youtubeGroup = html.indexOf('data-series-pending-network="youtube"');
  assert.ok(facebookGroup >= 0 && facebookGroup < instagramGroup);
  assert.ok(instagramGroup < youtubeGroup);
  assert.ok(html.indexOf('data-series-pending-suggestion-id="instagram-early"') < html.indexOf('data-series-pending-suggestion-id="instagram-late"'));
  assert.ok(html.indexOf('data-series-pending-suggestion-id="instagram-late"') < html.indexOf('data-series-pending-suggestion-id="instagram-undated"'));
});

test('suggestion modal shows all pending candidates without pagination and starts with no selection', () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    id: `suggestion-${index + 1}`,
    classification: 'EPISODE',
    publication: {
      platform: 'instagram',
      externalPublicationId: `post-${index + 1}`,
      title: `FQA episódio ${index + 1}`,
    },
    identity: {
      seriesName: 'FQA',
      seasonNumber: 2,
      seasonStatus: 'NUMBERED',
      episodeNumber: index + 1,
      episodeCode: `FQA-S02-E${String(index + 1).padStart(2, '0')}`,
    },
  }));
  const html = renderEpisodeReviewScreen({
    series: [{ id: 'series-1', name: 'FQA', aliases: [], seasonMode: 'SEASONAL' }],
    selectedSeriesId: 'series-1',
    seriesEpisodes: [],
    seriesSuggestionModal: {
      open: true,
      loading: false,
      error: false,
      saving: false,
      candidates,
      selectedSuggestionIds: [],
    },
    groups: [],
    unmatched: [],
  });

  assert.equal((html.match(/data-series-suggestion-id=/g) ?? []).length, 12);
  assert.match(html, /FQA episódio 12/);
  assert.match(html, /data-series-suggestion-modal/);
  assert.match(html, /data-action="add-series-suggestions" disabled/);
  assert.doesNotMatch(html, /data-action="series-suggestion-page"/);
});

test('series candidates without an identified name stay collapsed until the creator asks to review them', () => {
  const unidentified = {
    ...group.publications[0],
    id: 'unidentified-series',
    identity: { seriesName: null, seasonNumber: null, seasonStatus: 'UNKNOWN', episodeNumber: null, episodeCode: null },
  };
  const base = {
    stage: 'SERIES',
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    recommendationsOpen: true,
    series: [],
    seriesProposals: [
      { suggestedName: 'FQA', suggestions: group.publications },
      { suggestedName: null, suggestions: [unidentified] },
    ],
    seasonProposals: [],
    groups: [],
    unmatched: [],
  };

  const collapsed = renderEpisodeReviewScreen({ ...base, showUnidentifiedSeries: false });
  assert.match(collapsed, /data-action="toggle-unidentified-series"[^>]*aria-expanded="false"/);
  assert.match(collapsed, /Mostrar publicações sem série identificada \(1\)/);
  assert.doesNotMatch(collapsed, /data-series-proposal[^>]*aria-busy[^>]*>[\s\S]*Precisa de identificação/);

  const expanded = renderEpisodeReviewScreen({ ...base, showUnidentifiedSeries: true });
  assert.match(expanded, /data-action="toggle-unidentified-series"[^>]*aria-expanded="true"/);
  assert.match(expanded, /Precisa de identificação/);
  assert.match(expanded, /data-review-publication="unidentified-series"/);
});

test('unmatched episode candidates stay collapsed until explicitly expanded', () => {
  const model = {
    stage: 'EPISODES',
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    recommendationsOpen: true,
    series: [],
    groups: [],
    unmatched: [{
      ...group.publications[0],
      unmatchedReason: 'IDENTITY_INCOMPLETE',
      identity: { seriesName: null, seasonNumber: null, seasonStatus: 'UNKNOWN', episodeNumber: null, episodeCode: null },
    }],
  };

  const collapsed = renderEpisodeReviewScreen({ ...model, showUnmatchedEpisodes: false });
  assert.match(collapsed, /data-action="toggle-unmatched-episodes"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(collapsed, /data-action="approve-episode-group"/);

  const expanded = renderEpisodeReviewScreen({ ...model, showUnmatchedEpisodes: true });
  assert.match(expanded, /data-action="toggle-unmatched-episodes"[^>]*aria-expanded="true"/);
  assert.match(expanded, /data-action="approve-episode-group"/);
  assert.match(expanded, /Informe a série e o número do episódio/);
});

test('manual episode form shows one selectable publication tile per network and previews selected thumbnails', () => {
  const html = renderEpisodeReviewScreen({
    stage: 'COMPLETE',
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    series: [{ id: 'series-1', name: 'Obsidiana', aliases: [], seasonMode: 'SEASONAL' }],
    groups: [],
    unmatched: [],
    manualEpisodeOpen: true,
    manualEpisodeDraft: {
      seriesId: 'series-1',
      seasonNumber: '2',
      episodeNumber: '20',
      selectedPublications: {
        instagram: {
          platform: 'instagram',
          socialAccountId: 'account-1',
          externalPublicationId: 'ig-20',
          accountName: 'Novelaria',
          title: 'Obsidiana: O Legado · Episódio 20',
          thumbnailUrl: 'https://media.example/ig-20.jpg',
        },
      },
    },
    manualPicker: { open: false, platform: null, loading: false, error: null, publications: [] },
  });

  assert.match(html, /data-manual-episode-form/);
  assert.equal((html.match(/data-manual-platform=/g) ?? []).length, 4);
  assert.match(html, /data-manual-platform="instagram"[\s\S]*Novelaria[\s\S]*<img[^>]+src="https:\/\/media.example\/ig-20.jpg"/);
  assert.match(html, /data-action="open-manual-publication-picker" data-platform="youtube"/);
  assert.match(html, /data-action="remove-manual-publication" data-platform="instagram"/);
  assert.match(html, /data-action="create-manual-episode"/);
  assert.doesNotMatch(html, /name="episodeCode"/);
});

test('manual publication picker modal shows platform-filtered available content and accessible selection actions', () => {
  const html = renderEpisodeReviewScreen({
    stage: 'COMPLETE',
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    recommendationsOpen: true,
    series: [],
    groups: [],
    unmatched: [],
    manualEpisodeOpen: true,
    manualEpisodeDraft: { selectedPublications: {} },
    manualPicker: {
      open: true,
      platform: 'youtube',
      loading: false,
      error: null,
      publications: [{
        platform: 'youtube',
        socialAccountId: 'account-yt',
        socialAccountName: 'Novelaria Oficial',
        externalPublicationId: 'yt-1',
        title: 'Obsidiana · Capítulo 1',
        description: 'Um episódio de fantasia.',
        thumbnailUrl: 'https://media.example/yt-1.jpg',
        permalink: 'https://video.example/yt-1',
        publishedAt: '2026-10-10T12:00:00.000Z',
      }],
    },
  });

  assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /Obsidiana · Capítulo 1/);
  assert.match(html, /Novelaria Oficial/);
  assert.match(html, /data-action="select-manual-publication"/);
  assert.match(html, /src="https:\/\/media.example\/yt-1.jpg"/);
  assert.match(html, /data-action="close-manual-publication-picker"/);
});
