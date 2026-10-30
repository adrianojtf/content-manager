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
  assert.match(html, /name="episodeCode"/);
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
    loading: true, refreshing: false, saving: false, error: null, series: [], groups: [], unmatched: [],
  });
  assert.match(loading, /aria-busy="true"/);

  const error = renderEpisodeReviewScreen({
    loading: false, refreshing: false, saving: false, error: 'API_UNAVAILABLE', series: [], groups: [], unmatched: [],
  });
  assert.match(error, /role="alert"/);
  assert.match(error, /data-action="retry-episode-review"/);

  const empty = renderEpisodeReviewScreen({
    loading: false, refreshing: false, saving: false, error: null, series: [], groups: [], unmatched: [],
  });
  assert.match(empty, /data-action="refresh-episode-suggestions"/);
  assert.match(empty, /Nenhum episódio identificado para revisar/);
});

test('episode review cards use theme tokens and responsive layout', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.episode-review-card\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.episode-review-card\s*\{[^}]*color:\s*var\(--text\)/s);
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
      episodeCode: 'OBS-S02-E20',
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
});

test('manual publication picker modal shows platform-filtered available content and accessible selection actions', () => {
  const html = renderEpisodeReviewScreen({
    stage: 'COMPLETE',
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
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
