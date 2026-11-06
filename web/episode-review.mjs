import { formatDateTime, formatNumber, t, uiLocale } from './i18n.mjs';
import { escapeHtml, networkInfo } from './view.mjs';

const seriesPageSize = 10;

function normalizedName(value) {
  return String(value ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function safePublicationUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function safeThumbnailUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function platformName(platform) {
  const keys = {
    facebook: 'network.name.facebook',
    instagram: 'network.name.instagram',
    tiktok: 'network.name.tiktok',
    youtube: 'network.name.youtube',
  };
  return t(keys[platform] ?? 'episodes.publication');
}

function reasonText(reason) {
  const keys = {
    IDENTITY_INCOMPLETE: 'episodes.reason.identityIncomplete',
    SEASON_UNKNOWN: 'episodes.reason.seasonUnknown',
    SERIES_SEASON_MODE_CONFLICT: 'episodes.reason.seriesSeasonConflict',
    IDENTITY_CONFLICT: 'episodes.reason.identityConflict',
    IDENTITY_SINGLE: 'episodes.reason.identitySingle',
    UNCERTAIN: 'episodes.reason.uncertain',
    NOT_EPISODE: 'episodes.reason.notEpisode',
  };
  return reason && keys[reason] ? t(keys[reason]) : '';
}

function matchedSeries(series, name) {
  if (!name) return null;
  const target = normalizedName(name);
  const matches = series.filter((candidate) => (
    [candidate.name, ...(candidate.aliases ?? [])].some((value) => normalizedName(value) === target)
  ));
  return matches.length === 1 ? matches[0] : null;
}

function renderPublication(suggestion, index, total, saving) {
  const publication = suggestion.publication;
  const title = publication.title?.trim() || publication.externalPublicationId;
  const url = safePublicationUrl(publication.permalink);
  const confidence = typeof suggestion.confidence === 'number'
    ? `${formatNumber(Math.round(suggestion.confidence * 100))}%`
    : t('analytics.unavailable');
  const classification = suggestion.classification === 'EPISODE'
    ? t('episodes.classification.episode')
    : t('episodes.classification.uncertain');
  const rationale = suggestion.rationaleVariants?.[uiLocale] ?? t('episodes.rationaleUnavailable');
  const publishedDate = publication.publishedAt ? new Date(publication.publishedAt) : null;
  const publishedAt = publishedDate && Number.isFinite(publishedDate.getTime())
    ? t('episodes.publishedAt', { date: escapeHtml(formatDateTime(publishedDate)) })
    : '';
  const sourceLink = url
    ? `<a class="episode-source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(t('episodes.openPublication', { title }))}">${escapeHtml(t('episodes.publication'))}</a>`
    : `<span class="episode-source-link">${escapeHtml(t('episodes.publication'))}</span>`;

  const inactive = index === 0 ? '' : ' hidden inert aria-hidden="true"';
  const disabled = saving ? ' disabled' : '';
  return `<article class="episode-source-card" role="group" data-carousel-slide aria-roledescription="${escapeHtml(t('episodes.carouselSlide'))}" aria-label="${escapeHtml(t('episodes.carouselPosition', {
    current: formatNumber(index + 1),
    total: formatNumber(total),
  }))}"${inactive}>
    <label class="episode-source-select">
      <input type="checkbox" data-review-publication="${escapeHtml(suggestion.id)}" checked${disabled}>
      <span>${escapeHtml(t('episodes.selectPublication'))}</span>
    </label>
    <div class="episode-source-heading">
      <span class="episode-platform-pill">${escapeHtml(platformName(publication.platform))}</span>
      ${suggestion.socialAccountName ? `<span class="episode-source-account">${escapeHtml(t('episodes.account', { name: suggestion.socialAccountName }))}</span>` : ''}
      <span class="episode-classification-pill">${escapeHtml(classification)}</span>
      ${sourceLink}
      <span class="episode-source-confidence">${escapeHtml(t('episodes.confidence'))}: ${escapeHtml(confidence)}</span>
    </div>
    <h4>${escapeHtml(title)}</h4>
    ${publication.description ? `<p class="episode-source-description">${escapeHtml(publication.description)}</p>` : ''}
    ${publishedAt ? `<p class="episode-source-date">${publishedAt}</p>` : ''}
    <p class="episode-source-rationale">${escapeHtml(rationale)}</p>
  </article>`;
}

function renderPublicationCarousel(publications, saving) {
  const total = publications.length;
  const selectedCount = formatNumber(total);
  return `<div class="episode-carousel" data-episode-carousel data-carousel-index="0" role="group" aria-roledescription="${escapeHtml(t('episodes.carousel'))}" aria-label="${escapeHtml(t('episodes.carouselLabel'))}">
    <div class="episode-carousel-slides">${publications.map((suggestion, index) => renderPublication(suggestion, index, total, saving)).join('')}</div>
    <div class="episode-carousel-footer">
      <span class="episode-carousel-selection" data-carousel-selection-summary>${t('episodes.selectedCount', {
        selected: selectedCount,
        total: selectedCount,
      })}</span>
      <span class="episode-carousel-position" data-carousel-position role="status" aria-live="polite">${t('episodes.carouselPosition', {
        current: formatNumber(1),
        total: selectedCount,
      })}</span>
      ${total > 1 ? `<nav class="episode-carousel-controls" aria-label="${escapeHtml(t('episodes.carouselControls'))}">
        <button class="button small" type="button" data-action="episode-carousel-prev" data-carousel-prev disabled>${t('episodes.carouselPrevious')}</button>
        <button class="button small" type="button" data-action="episode-carousel-next" data-carousel-next${saving ? ' disabled' : ''}>${t('episodes.carouselNext')}</button>
      </nav>` : ''}
    </div>
  </div>`;
}

export function updateEpisodeCarousel(carousel, requestedIndex) {
  const slides = [...carousel.querySelectorAll('[data-carousel-slide]')];
  if (!slides.length) return 0;
  const index = Math.max(0, Math.min(slides.length - 1, requestedIndex));
  slides.forEach((slide, slideIndex) => {
    const active = slideIndex === index;
    slide.hidden = !active;
    if (active) {
      slide.removeAttribute('inert');
      slide.removeAttribute('aria-hidden');
    } else {
      slide.setAttribute('inert', '');
      slide.setAttribute('aria-hidden', 'true');
    }
  });
  carousel.dataset.carouselIndex = String(index);
  const position = carousel.querySelector('[data-carousel-position]');
  if (position) {
    position.textContent = t('episodes.carouselPosition', {
      current: formatNumber(index + 1),
      total: formatNumber(slides.length),
    });
  }
  const previous = carousel.querySelector('[data-carousel-prev]');
  if (previous) previous.disabled = index === 0;
  const next = carousel.querySelector('[data-carousel-next]');
  if (next) next.disabled = index === slides.length - 1;
  return index;
}

export function updateEpisodeSelectionSummary(form) {
  const inputs = [...form.querySelectorAll('[data-review-publication]')];
  const summary = form.querySelector('[data-carousel-selection-summary]');
  if (!summary) return inputs.filter((input) => input.checked).length;
  const selected = inputs.filter((input) => input.checked).length;
  summary.textContent = t('episodes.selectedCount', {
    selected: formatNumber(selected),
    total: formatNumber(inputs.length),
  });
  form.querySelectorAll('[data-episode-group-action]').forEach((button) => {
    button.disabled = selected === 0;
  });
  return selected;
}

function renderSeriesOptions(series, selectedSeriesId) {
  return `<option value="">${t('episodes.selectSeries')}</option>${series.map((item) => `
    <option value="${escapeHtml(item.id)}"${item.id === selectedSeriesId ? ' selected' : ''}>${escapeHtml(item.name)} · ${t(item.seasonMode === 'SEASONAL' ? 'episodes.seasonal' : 'episodes.nonSeasonal')}</option>`).join('')}`;
}

function renderProposalActions(suggestionIds, model, action, label) {
  const disabled = model.saving ? ' disabled' : '';
  return `<footer class="episode-review-actions">
    <button class="button primary" type="submit" data-episode-group-action data-action="${action}"${disabled}>${model.saving ? t('episodes.saving') : label}</button>
    <button class="button" type="button" data-episode-group-action data-action="reject-episode-group" data-suggestion-ids="${escapeHtml(JSON.stringify(suggestionIds))}"${disabled}>${t('episodes.reject')}</button>
    <button class="button" type="button" data-episode-group-action data-action="defer-episode-group" data-suggestion-ids="${escapeHtml(JSON.stringify(suggestionIds))}"${disabled}>${t('episodes.defer')}</button>
  </footer>`;
}

function renderManualSeriesForm(model) {
  if (!model.manualSeriesOpen) return '';
  return `<form class="episode-review-card manual-series-form" data-manual-series-form>
    <header class="episode-review-card-heading">
      <div>
        <p class="episode-review-kicker">${t('episodes.manual')}</p>
        <h2>${t('episodes.manualSeriesTitle')}</h2>
      </div>
    </header>
    <div class="episode-review-fields">
      <label class="field">
        <span>${t('episodes.seriesName')}</span>
        <input name="name" maxlength="200" required>
      </label>
      <label class="field">
        <span>${t('episodes.seriesAliases')}</span>
        <input name="aliases" maxlength="500" placeholder="${escapeHtml(t('episodes.seriesAliases'))}">
      </label>
      <label class="field">
        <span>${t('episodes.seasonMode')}</span>
        <select name="seasonMode" required>
          <option value="" selected>${t('episodes.selectSeasonMode')}</option>
          <option value="SEASONAL">${t('episodes.seasonal')}</option>
          <option value="NON_SEASONAL">${t('episodes.nonSeasonal')}</option>
        </select>
      </label>
    </div>
    <footer class="episode-review-actions">
      <button class="button primary" type="submit" data-action="create-manual-series"${model.saving ? ' disabled' : ''}>${model.saving ? t('episodes.saving') : t('episodes.createSeries')}</button>
      <button class="button" type="button" data-action="cancel-manual-series"${model.saving ? ' disabled' : ''}>${t('episodes.cancel')}</button>
    </footer>
  </form>`;
}

function renderSeriesCatalog(model) {
  const series = [...(model.series ?? [])].sort((left, right) => left.name.localeCompare(right.name, uiLocale, { numeric: true }));
  const pageCount = Math.max(1, Math.ceil(series.length / seriesPageSize));
  const page = Math.max(0, Math.min(pageCount - 1, Number.isSafeInteger(model.seriesPage) ? model.seriesPage : 0));
  const pageItems = series.slice(page * seriesPageSize, (page + 1) * seriesPageSize);
  const items = pageItems.map((item) => `<li data-series-catalog-item="${escapeHtml(item.id)}">
    <button class="episode-series-row" type="button" data-action="open-series-details" data-series-id="${escapeHtml(item.id)}">
      <span class="episode-series-row-main">
        <strong>${escapeHtml(item.name)}</strong>
        <small>${t(item.seasonMode === 'SEASONAL' ? 'episodes.seasonal' : 'episodes.nonSeasonal')}</small>
      </span>
      ${item.aliases?.length ? `<span class="episode-series-aliases">${escapeHtml(item.aliases.join(', '))}</span>` : ''}
      <span class="episode-series-row-chevron" aria-hidden="true">›</span>
    </button>
  </li>`).join('');
  const pagination = series.length > seriesPageSize
    ? `<nav class="episode-series-pagination" aria-label="${t('episodes.seriesCatalogTitle')}">
        <button class="button small" type="button" data-action="series-list-page" data-page="${page - 1}"${page === 0 ? ' disabled' : ''}>${t('episodes.seriesListPrevious')}</button>
        <span aria-live="polite">${t('episodes.seriesListPage', {
          current: formatNumber(page + 1),
          total: formatNumber(pageCount),
        })}</span>
        <button class="button small" type="button" data-action="series-list-page" data-page="${page + 1}"${page === pageCount - 1 ? ' disabled' : ''}>${t('episodes.seriesListNext')}</button>
      </nav>`
    : '';
  return `<section class="episode-review-card episode-series-catalog" data-episode-series-catalog aria-labelledby="episodeSeriesCatalogTitle">
    <header class="episode-review-card-heading">
      <h2 id="episodeSeriesCatalogTitle">${t('episodes.seriesCatalogTitle')}</h2>
    </header>
    ${items
      ? `<ul class="episode-series-list">${items}</ul>${pagination}`
      : `<p class="episode-series-empty">${t('episodes.noCreatedSeries')}</p>`}
  </section>`;
}

function renderSeriesEpisodeList(model) {
  const episodes = model.seriesEpisodes ?? [];
  if (model.seriesEpisodesLoading) {
    return `<div class="episode-review-state" role="status" aria-busy="true">${t('episodes.loading')}</div>`;
  }
  if (model.seriesEpisodesError) {
    return `<div class="episode-review-state episode-review-error" role="alert">
      ${t('episodes.loadFailed')}
      <button class="button small" type="button" data-action="retry-series-episodes">${t('report.retry')}</button>
    </div>`;
  }
  if (!episodes.length) {
    return `<div class="episode-review-state"><p>${t('episodes.noSeriesEpisodes')}</p></div>`;
  }
  const series = (model.series ?? []).find((item) => item.id === model.selectedSeriesId);
  const seasonal = series?.seasonMode === 'SEASONAL';
  return `<ol class="episode-series-episode-list" data-series-episodes>${episodes.map((episode) => `<li data-series-episode-id="${escapeHtml(episode.id)}">
    <article class="episode-series-episode-card">
      <header class="episode-series-episode-card-heading">
        <span class="episode-series-episode-number">${escapeHtml(episode.seasonNumber
          ? t('episodes.seasonLabel', { season: formatNumber(episode.seasonNumber) })
          : '')} ${escapeHtml(t('episodes.episodeLabel', { episode: formatNumber(episode.episodeNumber) }))}</span>
        <button class="episode-edit-pencil" type="button" data-action="edit-series-episode" data-episode-id="${escapeHtml(episode.id)}" title="${t('episodes.editEpisode')}" aria-label="${t('episodes.editEpisode')}"${model.saving ? ' disabled' : ''}>✎</button>
      </header>
      ${model.editingEpisodeId === episode.id ? renderSeriesEpisodeEditForm(episode, series, seasonal, model) : ''}
      <p class="episode-series-episode-code">${escapeHtml(episode.episodeCode)}</p>
      ${episode.publications?.length
        ? `<ul class="episode-series-episode-sources">${(() => {
          const fallbackThumbnail = episode.publications
            .map((publication) => safeThumbnailUrl(publication.thumbnailUrl))
            .find(Boolean) ?? '';
          return episode.publications.map((publication) => {
          const title = publication.title?.trim() || publication.externalPublicationId;
          const thumbnail = safeThumbnailUrl(publication.thumbnailUrl) || fallbackThumbnail;
          const permalink = safePublicationUrl(publication.permalink);
          const publishedDate = publication.publishedAt ? new Date(publication.publishedAt) : null;
          const publishedAt = publishedDate && Number.isFinite(publishedDate.getTime())
            ? t('episodes.publishedAt', { date: escapeHtml(formatDateTime(publishedDate)) })
            : '';
          const linkKey = `${episode.id}\u0000${publication.socialAccountId}\u0000${publication.externalPublicationId}`;
          const editingLink = model.editingLink?.key === linkKey;
          const otherThumbs = episode.publications
            .map((candidate) => safeThumbnailUrl(candidate.thumbnailUrl))
            .filter((candidate) => candidate && candidate !== thumbnail);
          return `<li data-series-episode-source>
            ${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-thumb-fallbacks='${escapeHtml(JSON.stringify(otherThumbs))}'>` : ''}
            <div class="episode-series-episode-source-copy">
              <div class="episode-series-episode-source-meta">
                <span class="episode-platform-pill">${escapeHtml(platformName(publication.platform))}</span>
                ${publication.socialAccountName ? `<span>${escapeHtml(t('episodes.account', { name: publication.socialAccountName }))}</span>` : ''}
                ${publishedAt ? `<span>${publishedAt}</span>` : ''}
              </div>
              <strong>${escapeHtml(title)}</strong>
              ${publication.description ? `<p>${escapeHtml(publication.description)}</p>` : ''}
              ${permalink ? `<a class="episode-source-link" href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('episodes.publication'))}</a>` : ''}
              <small>${escapeHtml(publication.externalPublicationId)}</small>
            </div>
            ${editingLink ? renderEpisodeLinkEditForm(episode, publication, seasonal, model) : `<button class="episode-edit-pencil" type="button" data-action="edit-episode-publication" data-episode-id="${escapeHtml(episode.id)}" data-account-id="${escapeHtml(publication.socialAccountId)}" data-publication-id="${escapeHtml(publication.externalPublicationId)}" data-platform="${escapeHtml(publication.platform)}" title="${t('episodes.editEpisode')}" aria-label="${t('episodes.editEpisode')}"${model.saving ? ' disabled' : ''}>✎</button>`}
          </li>`;
        }).join('')})()}</ul>`
        : ''}
    </article>
  </li>`).join('')}</ol>`;
}

function renderEpisodeLinkEditForm(episode, publication, seasonal, model) {
  return `<form class="episode-link-edit" data-episode-link-edit-form data-episode-id="${escapeHtml(episode.id)}" data-account-id="${escapeHtml(publication.socialAccountId)}" data-publication-id="${escapeHtml(publication.externalPublicationId)}" aria-busy="${String(model.saving)}">
    <div class="episode-link-edit-fields">
      ${seasonal ? `<label class="field">
        <span>${t('episodes.seasonNumber')}</span>
        <input name="seasonNumber" type="number" min="1" step="1" value="${escapeHtml(episode.seasonNumber ?? '')}" required${model.saving ? ' disabled' : ''}>
      </label>` : ''}
      <label class="field">
        <span>${t('episodes.episodeNumber')}</span>
        <span class="episode-link-edit-input">
          <input name="episodeNumber" type="number" min="1" step="1" value="${escapeHtml(episode.episodeNumber)}" required${model.saving ? ' disabled' : ''}>
          <button class="episode-link-edit-confirm" type="submit" title="${t('episodes.saveEpisode')}" aria-label="${t('episodes.saveEpisode')}"${model.saving ? ' disabled' : ''}>✓</button>
          <button class="episode-link-edit-cancel" type="button" data-action="cancel-episode-publication-edit" title="${t('episodes.cancel')}" aria-label="${t('episodes.cancel')}"${model.saving ? ' disabled' : ''}>×</button>
        </span>
      </label>
    </div>
  </form>`;
}

function renderSeriesEpisodeEditForm(episode, series, seasonal, model) {
  const costAmount = episode.productionCost?.amount ?? '';
  const timeSeconds = episode.productionTimeSeconds ?? '';
  return `<form class="episode-link-edit" data-series-episode-edit-form data-episode-id="${escapeHtml(episode.id)}" aria-busy="${String(model.saving)}">
    <div class="episode-link-edit-fields">
      ${seasonal ? `<label class="field">
        <span>${t('episodes.seasonNumber')}</span>
        <input name="seasonNumber" type="number" min="1" step="1" value="${escapeHtml(episode.seasonNumber ?? '')}" required${model.saving ? ' disabled' : ''}>
      </label>` : ''}
      <label class="field">
        <span>${t('episodes.episodeNumber')}</span>
        <input name="episodeNumber" type="number" min="1" step="1" value="${escapeHtml(episode.episodeNumber)}" required${model.saving ? ' disabled' : ''}>
      </label>
      <label class="field">
        <span>${t('episodes.episodeCode')}</span>
        <input name="episodeCode" type="text" maxlength="100" value="${escapeHtml(episode.episodeCode ?? '')}"${model.saving ? ' disabled' : ''}>
      </label>
      <label class="field">
        <span>${t('episodes.productionCost')}</span>
        <input name="productionCostAmount" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(costAmount)}"${model.saving ? ' disabled' : ''}>
      </label>
      <label class="field">
        <span>${t('episodes.productionTime')}</span>
        <span class="episode-link-edit-input">
          <input name="productionTimeSeconds" type="number" min="0" step="1" value="${escapeHtml(timeSeconds)}"${model.saving ? ' disabled' : ''}>
          <button class="episode-link-edit-confirm" type="submit" title="${t('episodes.saveEpisode')}" aria-label="${t('episodes.saveEpisode')}"${model.saving ? ' disabled' : ''}>✓</button>
          <button class="episode-link-edit-cancel" type="button" data-action="cancel-series-episode-edit" title="${t('episodes.cancel')}" aria-label="${t('episodes.cancel')}"${model.saving ? ' disabled' : ''}>×</button>
        </span>
      </label>
    </div>
  </form>`;
}

function renderSeriesPendingSuggestions(model) {
  const suggestions = model.seriesPendingSuggestions ?? [];
  if (model.seriesPendingSuggestionsLoading) {
    return `<div class="episode-review-state" role="status" aria-busy="true">${t('episodes.loading')}</div>`;
  }
  if (model.seriesPendingSuggestionsError) {
    return `<div class="episode-review-state episode-review-error" role="alert">
      ${t('episodes.loadFailed')}
      <button class="button small" type="button" data-action="retry-series-pending-suggestions">${t('report.retry')}</button>
    </div>`;
  }
  if (!suggestions.length) return '';
  const series = (model.series ?? []).find((item) => item.id === model.selectedSeriesId);
  const selectedIds = model.seriesPendingEpisodeSelection ?? [];
  const episodeNumberDrafts = model.seriesPendingEpisodeNumberDrafts ?? {};
  const saving = Boolean(model.seriesPendingEpisodeSaving);
  const renderSuggestion = (suggestion) => {
    const publication = suggestion.publication ?? {};
    const identity = suggestion.identity ?? {};
    const description = publication.description?.trim() ?? '';
    const descriptionTitle = description.replace(/\s+/g, ' ');
    const identifiedEpisode = Number.isSafeInteger(identity.episodeNumber) && identity.episodeNumber > 0
      ? t('episodes.episodeLabel', { episode: formatNumber(identity.episodeNumber) })
      : '';
    const title = publication.title?.trim() || descriptionTitle.slice(0, 100) || identifiedEpisode || t('episodes.publication');
    const thumbnail = safeThumbnailUrl(publication.thumbnailUrl);
    const network = networkInfo[publication.platform];
    const permalink = safePublicationUrl(publication.permalink);
    const publishedDate = publication.publishedAt ? new Date(publication.publishedAt) : null;
    const publishedAt = publishedDate && Number.isFinite(publishedDate.getTime())
      ? t('episodes.publishedAt', { date: escapeHtml(formatDateTime(publishedDate)) })
      : '';
    const episode = Number.isSafeInteger(identity.episodeNumber) && identity.episodeNumber > 0
      ? t('episodes.episodeLabel', { episode: formatNumber(identity.episodeNumber) })
      : t('analytics.unavailable');
    const seasonal = series?.seasonMode === 'SEASONAL';
    const seasonNumber = seasonal ? suggestion.setupSeasonNumber : null;
    const displaySeasonNumber = suggestion.setupSeasonConfirmedAt
      ? suggestion.setupSeasonNumber
      : identity.seasonNumber;
    const season = Number.isSafeInteger(displaySeasonNumber) && displaySeasonNumber > 0
      ? t('episodes.seasonLabel', { season: formatNumber(displaySeasonNumber) })
      : '';
    const extractedEpisodeNumber = Number.isSafeInteger(identity.episodeNumber) && identity.episodeNumber > 0
      ? identity.episodeNumber
      : null;
    const draftEpisodeNumber = Number(episodeNumberDrafts[suggestion.id]);
    const episodeNumber = extractedEpisodeNumber
      ?? (Number.isSafeInteger(draftEpisodeNumber) && draftEpisodeNumber > 0 ? draftEpisodeNumber : null);
    const readyWithoutEpisodeNumber = Boolean(series
      && suggestion.setupSeriesId === series.id
      && suggestion.setupSeriesConfirmedAt
      && suggestion.setupSeasonConfirmedAt
      && (!seasonal || (Number.isSafeInteger(seasonNumber) && seasonNumber > 0))
      && (suggestion.classification === 'EPISODE' || suggestion.classification === 'UNCERTAIN'));
    const ready = readyWithoutEpisodeNumber && episodeNumber !== null;
    const isChecked = selectedIds.includes(suggestion.id);
    const checked = isChecked ? ' checked' : '';
    const disabled = !ready || saving ? ' disabled' : '';
    const episodeNumberEditor = extractedEpisodeNumber === null
      ? `<label class="episode-series-pending-code">
          <span>${t('episodes.episodeNumber')}</span>
          <input type="number" min="1" step="1" data-series-pending-episode-number value="${escapeHtml(episodeNumberDrafts[suggestion.id] ?? '')}"${isChecked ? ' required' : ''}${saving ? ' disabled' : ''}>
        </label>`
      : '';
    return `<li data-series-pending-suggestion-id="${escapeHtml(suggestion.id)}">
      <article class="episode-series-pending-item has-media">
        <div class="episode-series-pending-media">
          ${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" data-series-pending-thumbnail loading="lazy" referrerpolicy="no-referrer">` : ''}
          <div class="episode-series-pending-image-fallback"${thumbnail ? ' hidden' : ''}>
            ${network ? `<span class="social-logo ${network.className}" aria-hidden="true">${network.symbol}</span>` : escapeHtml(t('episodes.publication'))}
          </div>
        </div>
        <div class="episode-series-pending-copy">
          <label class="episode-series-pending-select">
            <input type="checkbox" data-series-pending-episode-suggestion-id="${escapeHtml(suggestion.id)}"
              data-season-number="${escapeHtml(seasonNumber ?? '')}"
              data-episode-number="${escapeHtml(episodeNumber ?? '')}"
              data-ready-without-episode-number="${String(readyWithoutEpisodeNumber)}"${checked}${disabled}>
            <span>${t('episodes.selectPendingEpisode')}</span>
          </label>
          <div class="episode-series-pending-meta">
            <span class="episode-platform-pill">${escapeHtml(platformName(publication.platform))}</span>
            ${suggestion.socialAccountName ? `<span>${escapeHtml(t('episodes.account', { name: suggestion.socialAccountName }))}</span>` : ''}
            <span data-series-pending-episode-label>${escapeHtml([season, episode].filter(Boolean).join(' · '))}</span>
            ${publishedAt ? `<span>${publishedAt}</span>` : ''}
          </div>
          <strong>${escapeHtml(title)}</strong>
          ${description ? `<p>${escapeHtml(description)}</p>` : ''}
          ${episodeNumberEditor}
          ${permalink ? `<a class="episode-source-link" href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(t('episodes.openPublication', { title }))}">${escapeHtml(t('episodes.publication'))}</a>` : ''}
          <small>${escapeHtml(t('report.publicationId'))}: ${escapeHtml(publication.externalPublicationId)}</small>
          <small class="episode-series-pending-needs-review"${ready ? ' hidden' : ''}>${t('episodes.pendingSuggestionNeedsReview')}</small>
        </div>
      </article>
    </li>`;
  };
  const suggestionsByPlatform = new Map();
  for (const suggestion of suggestions) {
    const platform = suggestion.publication?.platform ?? 'unknown';
    const group = suggestionsByPlatform.get(platform) ?? [];
    group.push(suggestion);
    suggestionsByPlatform.set(platform, group);
  }
  const items = [...suggestionsByPlatform.entries()]
    .sort(([left], [right]) => platformName(left).localeCompare(platformName(right), uiLocale))
    .map(([platform, platformSuggestions]) => {
      const orderedSuggestions = platformSuggestions.sort((left, right) => {
        const leftDate = Date.parse(left.publication?.publishedAt ?? '');
        const rightDate = Date.parse(right.publication?.publishedAt ?? '');
        const leftTime = Number.isFinite(leftDate) ? leftDate : Number.POSITIVE_INFINITY;
        const rightTime = Number.isFinite(rightDate) ? rightDate : Number.POSITIVE_INFINITY;
        if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
        return String(left.publication?.externalPublicationId ?? '')
          .localeCompare(String(right.publication?.externalPublicationId ?? ''), uiLocale, { numeric: true });
      });
      return `<li class="episode-series-pending-network" data-series-pending-network="${escapeHtml(platform)}">
        <h4>${escapeHtml(platformName(platform))}</h4>
        <ul>${orderedSuggestions.map(renderSuggestion).join('')}</ul>
      </li>`;
    }).join('');
  return `<section class="episode-review-card episode-series-pending" data-series-pending-suggestions aria-labelledby="seriesPendingSuggestionsTitle">
    <header class="episode-review-card-heading">
      <div>
        <h3 id="seriesPendingSuggestionsTitle">${t('episodes.seriesPendingSuggestions')}</h3>
        <p>${t('episodes.seriesPendingReview')}</p>
      </div>
    </header>
    <form data-series-pending-episode-form>
      <ul class="episode-series-pending-networks">${items}</ul>
      <footer class="episode-review-actions">
        <span class="episode-series-suggestion-count" data-series-pending-episode-count role="status" aria-live="polite">${t('episodes.seriesPendingSelectionCount', { count: formatNumber(selectedIds.length) })}</span>
        <button class="button primary" type="submit" data-action="add-series-pending-episodes"${saving || !selectedIds.length ? ' disabled' : ''}>${saving ? t('episodes.saving') : t('episodes.addSelectedSeriesEpisodes')}</button>
      </footer>
    </form>
  </section>`;
}

function renderSeriesSuggestionCandidate(suggestion, selectedSuggestionIds, saving) {
  const publication = suggestion.publication ?? {};
  const identity = suggestion.identity ?? {};
  const title = publication.title?.trim()
    || publication.description?.trim().replace(/\s+/g, ' ').slice(0, 100)
    || (Number.isSafeInteger(identity.episodeNumber) ? t('episodes.episodeLabel', { episode: formatNumber(identity.episodeNumber) }) : '')
    || t('episodes.publication');
  const checked = selectedSuggestionIds.includes(suggestion.id) ? ' checked' : '';
  const disabled = saving ? ' disabled' : '';
  const episode = Number.isSafeInteger(identity.episodeNumber) && identity.episodeNumber > 0
    ? t('episodes.episodeLabel', { episode: formatNumber(identity.episodeNumber) })
    : t('analytics.unavailable');
  const season = Number.isSafeInteger(identity.seasonNumber) && identity.seasonNumber > 0
    ? t('episodes.seasonLabel', { season: formatNumber(identity.seasonNumber) })
    : '';
  return `<label class="episode-series-suggestion" data-series-suggestion-row>
    <input type="checkbox" data-series-suggestion-id="${escapeHtml(suggestion.id)}"${checked}${disabled}>
    <span class="episode-series-suggestion-copy">
      <strong>${escapeHtml(title || t('episodes.publication'))}</strong>
      <small>${escapeHtml([platformName(publication.platform), season, episode].filter(Boolean).join(' · '))}</small>
    </span>
  </label>`;
}

function renderSeriesSuggestionModal(model) {
  const modal = model.seriesSuggestionModal;
  if (!modal?.open) return '';
  const selectedSuggestionIds = modal.selectedSuggestionIds ?? [];
  const content = modal.loading
    ? `<div class="episode-review-state" role="status" aria-busy="true">${t('episodes.loading')}</div>`
    : modal.error
      ? `<div class="episode-review-state episode-review-error" role="alert">${t('episodes.loadFailed')} <button class="button small" type="button" data-action="retry-series-suggestions">${t('report.retry')}</button></div>`
      : modal.candidates?.length
        ? `<div class="episode-series-suggestion-list">${modal.candidates.map((suggestion) => (
          renderSeriesSuggestionCandidate(suggestion, selectedSuggestionIds, modal.saving)
        )).join('')}</div>`
        : `<div class="episode-review-state"><p>${t('episodes.noSeriesSuggestions')}</p></div>`;
  return `<div class="episode-series-suggestion-backdrop" data-series-suggestions-backdrop>
    <section class="episode-series-suggestion-modal" data-series-suggestion-modal role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="seriesSuggestionTitle">
      <header class="episode-review-card-heading">
        <div>
          <h2 id="seriesSuggestionTitle">${t('episodes.seriesSuggestionsTitle')}</h2>
          <p>${t('episodes.seriesSuggestionsDescription')}</p>
        </div>
        <button class="button small" type="button" data-action="close-series-suggestions" aria-label="${t('episodes.closePicker')}">×</button>
      </header>
      <form data-series-suggestion-form>
        ${content}
        <footer class="episode-review-actions">
          <span class="episode-series-suggestion-count" data-series-suggestion-count>${t('episodes.seriesSuggestionSelectedCount', { selected: formatNumber(selectedSuggestionIds.length) })}</span>
          <button class="button primary" type="submit" data-action="add-series-suggestions"${modal.loading || modal.error || modal.saving || !selectedSuggestionIds.length ? ' disabled' : ''}>${modal.saving ? t('episodes.saving') : t('episodes.addSelectedSuggestions')}</button>
          <button class="button" type="button" data-action="close-series-suggestions"${modal.saving ? ' disabled' : ''}>${t('episodes.cancel')}</button>
        </footer>
      </form>
    </section>
  </div>`;
}

function renderSeriesDetails(model) {
  const series = (model.series ?? []).find((item) => item.id === model.selectedSeriesId);
  if (!series) {
    return `<section class="episode-series-detail" data-series-details>
      <button class="button" type="button" data-action="back-to-series-list">${t('episodes.seriesDetailsBack')}</button>
      <div class="episode-review-state"><p>${t('episodes.noCreatedSeries')}</p></div>
    </section>${renderSeriesSuggestionModal(model)}`;
  }
  return `<section class="episode-series-detail" data-series-details aria-labelledby="seriesDetailTitle">
    <header class="episode-series-detail-heading">
      <button class="button" type="button" data-action="back-to-series-list">${t('episodes.seriesDetailsBack')}</button>
      <div>
        <p class="episode-review-kicker">${t('episodes.series')}</p>
        <h2 id="seriesDetailTitle">${escapeHtml(series.name)}</h2>
        <p>${t(series.seasonMode === 'SEASONAL' ? 'episodes.seasonal' : 'episodes.nonSeasonal')}</p>
      </div>
      <button class="button primary" type="button" data-action="open-series-suggestions">${t('episodes.suggestEpisodes')}</button>
    </header>
    <section class="episode-review-card" aria-labelledby="seriesEpisodesTitle">
      <header class="episode-review-card-heading">
        <h3 id="seriesEpisodesTitle">${t('episodes.seriesEpisodes')}</h3>
      </header>
      ${renderSeriesEpisodeList(model)}
    </section>
    ${renderSeriesPendingSuggestions(model)}
  </section>${renderSeriesSuggestionModal(model)}`;
}

function renderManualPublicationTile(platform, selection, saving) {
  const info = networkInfo[platform];
  if (!info) return '';
  const networkName = t(info.nameKey);
  const controls = selection
    ? `<div class="manual-publication-preview">
        <div class="manual-publication-copy">
          <strong>${escapeHtml(selection.title || t('publication.untitled'))}</strong>
          <small>${escapeHtml(selection.socialAccountName || selection.accountName || networkName)}</small>
        </div>
        ${selection.thumbnailUrl && safeThumbnailUrl(selection.thumbnailUrl)
          ? `<img src="${escapeHtml(safeThumbnailUrl(selection.thumbnailUrl))}" alt="" loading="lazy" referrerpolicy="no-referrer">`
          : `<div class="manual-publication-placeholder ${info.className}" aria-hidden="true">${info.symbol}</div>`}
        <button class="button small" type="button" data-action="open-manual-publication-picker" data-platform="${platform}"${saving ? ' disabled' : ''}>${t('episodes.replacePublication')}</button>
        <button class="button small danger" type="button" data-action="remove-manual-publication" data-platform="${platform}" aria-label="${escapeHtml(t('episodes.removePublication', { network: networkName }))}"${saving ? ' disabled' : ''}>${t('episodes.remove')}</button>
      </div>`
    : `<button class="button manual-publication-add" type="button" data-action="open-manual-publication-picker" data-platform="${platform}"${saving ? ' disabled' : ''}>
        <span class="social-logo ${info.className}" aria-hidden="true">${info.symbol}</span>
        <span>${t(info.nameKey)}</span>
        <span class="manual-publication-add-icon" aria-hidden="true">+</span>
        <span>${t('episodes.addPublication')}</span>
      </button>`;
  return `<article class="manual-publication-tile" data-manual-platform="${platform}">
    ${selection ? `<div class="manual-publication-network"><span class="social-logo ${info.className}" aria-hidden="true">${info.symbol}</span><strong>${t(info.nameKey)}</strong></div>` : ''}
    ${controls}
  </article>`;
}

function renderManualEpisodeForm(model) {
  if (!model.manualEpisodeOpen) {
    return `<button class="button primary manual-episode-start" type="button" data-action="toggle-manual-episode-form">${t('episodes.manualEpisodeTitle')}</button>`;
  }
  const draft = model.manualEpisodeDraft ?? {};
  const selectedSeries = (model.series ?? []).find((series) => series.id === draft.seriesId);
  const seasonal = selectedSeries?.seasonMode === 'SEASONAL';
  const platforms = ['instagram', 'tiktok', 'youtube', 'facebook'];
  return `<form class="episode-review-card manual-episode-form" data-manual-episode-form aria-busy="${String(model.saving)}">
    <header class="episode-review-card-heading">
      <div>
        <p class="episode-review-kicker">${t('episodes.manual')}</p>
        <h2>${t('episodes.manualEpisodeTitle')}</h2>
        <p class="episode-setup-step-description">${t('episodes.manualEpisodeDescription')}</p>
      </div>
    </header>
    <div class="episode-review-fields">
      <label class="field">
        <span>${t('episodes.series')}</span>
        <select name="seriesId" data-role="manual-episode-series" required${model.saving ? ' disabled' : ''}>${renderSeriesOptions(model.series ?? [], draft.seriesId ?? '')}</select>
      </label>
      ${seasonal ? `<label class="field">
        <span>${t('episodes.seasonNumber')}</span>
        <input name="seasonNumber" type="number" min="1" step="1" value="${escapeHtml(draft.seasonNumber ?? '')}" required${model.saving ? ' disabled' : ''}>
      </label>` : ''}
      <label class="field">
        <span>${t('episodes.episodeNumber')}</span>
        <input name="episodeNumber" type="number" min="1" step="1" value="${escapeHtml(draft.episodeNumber ?? '')}" required${model.saving ? ' disabled' : ''}>
      </label>
    </div>
    <fieldset class="manual-publication-fieldset">
      <legend>${t('episodes.manualNetworksLegend')}</legend>
      <div class="manual-publication-grid">${platforms.map((platform) => (
        renderManualPublicationTile(platform, draft.selectedPublications?.[platform] ?? null, model.saving)
      )).join('')}</div>
    </fieldset>
    <footer class="episode-review-actions">
      <button class="button primary" type="submit" data-action="create-manual-episode"${model.saving ? ' disabled' : ''}>${model.saving ? t('episodes.saving') : t('episodes.createEpisode')}</button>
      <button class="button" type="button" data-action="cancel-manual-episode"${model.saving ? ' disabled' : ''}>${t('episodes.cancel')}</button>
    </footer>
  </form>`;
}

function renderManualPublicationPicker(model) {
  const picker = model.manualPicker;
  if (!picker?.open) return '';
  const platform = picker.platform;
  const info = networkInfo[platform];
  const networkName = info ? t(info.nameKey) : t('episodes.publication');
  const content = picker.loading
    ? `<div class="episode-review-state" role="status" aria-busy="true">${t('episodes.manualPublicationsLoading')}</div>`
    : picker.error
      ? `<div class="episode-review-state episode-review-error" role="alert">${t('episodes.manualPublicationsFailed')} <button class="button small" type="button" data-action="retry-manual-publication-picker" data-platform="${escapeHtml(platform)}">${t('report.retry')}</button></div>`
      : picker.publications?.length
        ? `<div class="manual-publication-picker-list">${picker.publications.map((publication) => {
          const thumbnail = safeThumbnailUrl(publication.thumbnailUrl);
          return `<button class="manual-publication-option" type="button" data-action="select-manual-publication" data-platform="${escapeHtml(platform)}" data-account-id="${escapeHtml(publication.socialAccountId)}" data-publication-id="${escapeHtml(publication.externalPublicationId)}">
            ${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="manual-publication-placeholder ${info?.className ?? ''}" aria-hidden="true">${info?.symbol ?? '▣'}</span>`}
            <span class="manual-publication-copy">
              <strong>${escapeHtml(publication.title || t('publication.untitled'))}</strong>
              <small>${escapeHtml(publication.socialAccountName || networkName)} · ${escapeHtml(publication.publishedAt ? formatDateTime(new Date(publication.publishedAt)) : t('date.unavailable'))}</small>
              ${publication.description ? `<span>${escapeHtml(publication.description)}</span>` : ''}
            </span>
          </button>`;
        }).join('')}</div>`
        : `<div class="episode-review-state"><h3>${t('episodes.noManualPublications', { network: networkName })}</h3><p>${t('episodes.noManualPublicationsDescription')}</p></div>`;
  return `<div class="manual-publication-picker-backdrop" data-manual-picker-backdrop>
    <section class="manual-publication-picker" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="manualPublicationPickerTitle">
      <header class="episode-review-card-heading">
        <div>
          <p class="episode-review-kicker">${networkName}</p>
          <h2 id="manualPublicationPickerTitle">${t('episodes.selectManualPublication')}</h2>
        </div>
        <button class="button small" type="button" data-action="close-manual-publication-picker" data-picker-return-platform="${escapeHtml(platform)}" aria-label="${t('episodes.closePicker')}">×</button>
      </header>
      ${content}
    </section>
  </div>`;
}

function renderSeriesProposal(proposal, model) {
  const suggestions = proposal.suggestions ?? [];
  if (!suggestions.length) return '';
  const suggestedName = proposal.suggestedName ?? suggestions[0].identity?.seriesName ?? '';
  const existing = matchedSeries(model.series ?? [], suggestedName);
  const selectedSeriesId = existing?.id ?? '';
  const disabled = model.saving ? ' disabled' : '';
  const suggestionIds = suggestions.map((suggestion) => suggestion.id);
  return `<form class="episode-review-card" data-series-proposal data-setup-proposal aria-busy="${String(model.saving)}">
    <header class="episode-review-card-heading">
      <div>
        <p class="episode-review-kicker">${t('episodes.seriesProposal')}</p>
        <h2>${escapeHtml(suggestedName || t('episodes.unmatchedTitle'))}</h2>
      </div>
      <span class="episode-review-count">${t('episodes.sourceCount', { count: formatNumber(suggestions.length) })}</span>
    </header>
    ${renderPublicationCarousel(suggestions, model.saving)}
    <div class="episode-review-fields">
      <label class="field">
        <span>${t('episodes.series')}</span>
        <select name="seriesId" data-role="setup-series"${disabled}>${renderSeriesOptions(model.series ?? [], selectedSeriesId)}</select>
      </label>
      <div class="episode-new-series-fields" data-role="setup-new-series-fields"${selectedSeriesId ? ' hidden' : ''}>
        <label class="field">
          <span>${t('episodes.seriesName')}</span>
          <input name="newSeriesName" maxlength="200" value="${escapeHtml(suggestedName)}" placeholder="${escapeHtml(t('episodes.seriesName'))}"${selectedSeriesId || model.saving ? ' disabled' : ' required'}>
        </label>
        <label class="field">
          <span>${t('episodes.seriesAliases')}</span>
          <input name="seriesAliases" maxlength="500" value="" placeholder="${escapeHtml(t('episodes.seriesAliases'))}"${selectedSeriesId || model.saving ? ' disabled' : ''}>
        </label>
      </div>
      <label class="field">
        <span>${t('episodes.seasonMode')}</span>
        <select name="seasonMode" data-role="setup-season-mode" required${selectedSeriesId || model.saving ? ' disabled' : ''}>
          <option value=""${existing ? '' : ' selected'}>${t('episodes.selectSeasonMode')}</option>
          <option value="SEASONAL"${existing?.seasonMode === 'SEASONAL' ? ' selected' : ''}>${t('episodes.seasonal')}</option>
          <option value="NON_SEASONAL"${existing?.seasonMode === 'NON_SEASONAL' ? ' selected' : ''}>${t('episodes.nonSeasonal')}</option>
        </select>
      </label>
    </div>
    ${renderProposalActions(suggestionIds, model, 'confirm-series-proposal', t('episodes.confirmSeries'))}
  </form>`;
}

function renderSeasonProposal(proposal, model) {
  const suggestions = proposal.suggestions ?? [];
  if (!suggestions.length) return '';
  const suggestionIds = suggestions.map((suggestion) => suggestion.id);
  const proposedSeasonNumber = proposal.proposedSeasonNumber;
  const disabled = model.saving ? ' disabled' : '';
  return `<form class="episode-review-card" data-season-proposal data-setup-proposal aria-busy="${String(model.saving)}">
    <header class="episode-review-card-heading">
      <div>
        <p class="episode-review-kicker">${t('episodes.seasonProposal')}</p>
        <h2>${escapeHtml(proposal.seriesName)}</h2>
      </div>
      <span class="episode-review-count">${t('episodes.sourceCount', { count: formatNumber(suggestions.length) })}</span>
    </header>
    ${proposedSeasonNumber
      ? `<p class="episode-review-reason">${t('episodes.proposedSeason', { season: formatNumber(proposedSeasonNumber) })}</p>`
      : `<p class="episode-review-reason">${t('episodes.seasonUnknown')}</p>`}
    ${renderPublicationCarousel(suggestions, model.saving)}
    <div class="episode-review-fields episode-review-fields-single">
      <label class="field">
        <span>${t('episodes.seasonNumber')}</span>
        <input name="seasonNumber" type="number" min="1" step="1" value="${escapeHtml(proposedSeasonNumber ?? '')}" required${disabled}>
      </label>
    </div>
    ${renderProposalActions(suggestionIds, model, 'confirm-season-proposal', t('episodes.confirmSeason'))}
  </form>`;
}

function renderSetupProgress(stage) {
  const steps = [
    ['SERIES', 'episodes.step.series'],
    ['SEASONS', 'episodes.step.seasons'],
    ['EPISODES', 'episodes.step.episodes'],
  ];
  const currentIndex = steps.findIndex(([key]) => key === stage);
  return `<ol class="episode-setup-progress" aria-label="${t('episodes.setupProgress')}">${steps.map(([key, label], index) => {
    const complete = stage === 'COMPLETE' || (currentIndex >= 0 && index < currentIndex);
    const active = key === stage;
    const state = complete ? 'complete' : active ? 'current' : 'upcoming';
    return `<li class="episode-setup-progress-step is-${state}" data-episode-setup-step="${key.toLowerCase()}"${active ? ' aria-current="step"' : ''}>
      <button class="episode-setup-progress-button" type="button" data-action="episode-review-stage" data-stage="${key}"${stage !== 'COMPLETE' && (complete || active) ? '' : ' disabled'}${active ? ' aria-current="step"' : ''}>
        <span class="episode-setup-progress-number">${complete ? '&#10003;' : formatNumber(index + 1)}</span>
        <span>${t(label)}</span>
      </button>
    </li>`;
  }).join('')}</ol>`;
}

function renderCandidateVisibilityToggle(action, expanded, count, showKey, hideKey, panelId) {
  if (!count) return '';
  return `<button class="button small episode-candidate-toggle" type="button" data-action="${action}" aria-expanded="${String(expanded)}" aria-controls="${panelId}">
    ${t(expanded ? hideKey : showKey, { count: formatNumber(count) })}
  </button>`;
}

function renderSeriesStep(model) {
  const proposals = model.seriesProposals ?? [];
  const identified = proposals.filter((proposal) => proposal.suggestedName?.trim());
  const unidentified = proposals.filter((proposal) => !proposal.suggestedName?.trim());
  const expanded = Boolean(model.showUnidentifiedSeries);
  const cards = identified.map((proposal) => renderSeriesProposal(proposal, model)).join('');
  const hiddenCandidates = expanded
    ? unidentified.map((proposal) => renderSeriesProposal(proposal, model)).join('')
    : '';
  const empty = !identified.length && !unidentified.length
    ? `<div class="episode-review-state"><h2>${t('episodes.noIdentifiedSeries')}</h2><p>${t('episodes.emptyDescription')}</p></div>`
    : '';
  return `${cards}
    ${renderCandidateVisibilityToggle(
      'toggle-unidentified-series',
      expanded,
      unidentified.length,
      'episodes.showUnidentifiedSeries',
      'episodes.hideUnidentifiedSeries',
      'episodeUnidentifiedSeries',
    )}
    <div id="episodeUnidentifiedSeries" class="episode-hidden-candidates"${expanded ? '' : ' hidden'}>${hiddenCandidates}</div>
    ${empty}`;
}

function renderGroup(group, model, unmatchedReason = null) {
  const publications = group.publications ?? [group];
  if (!publications.length) return '';
  const first = publications[0];
  const seriesName = group.seriesName ?? first.identity?.seriesName ?? '';
  const confirmedSeriesId = group.seriesId ?? first.setupSeriesId ?? '';
  const existingSeries = confirmedSeriesId
    ? (model.series ?? []).find((item) => item.id === confirmedSeriesId) ?? null
    : matchedSeries(model.series ?? [], seriesName);
  const seasonStatus = group.seasonStatus ?? first.identity?.seasonStatus ?? 'UNKNOWN';
  const suggestedSeason = group.seasonNumber ?? first.setupSeasonNumber ?? first.identity?.seasonNumber;
  const seasonMode = existingSeries?.seasonMode
    ?? (seasonStatus === 'NUMBERED' ? 'SEASONAL' : seasonStatus === 'NON_SEASONAL' ? 'NON_SEASONAL' : '');
  const episodeNumber = group.episodeNumber ?? first.identity?.episodeNumber ?? '';
  const suggestionIds = publications.map((item) => item.id);
  const hasNumberedSeason = seasonStatus === 'NUMBERED' && Number.isSafeInteger(suggestedSeason);
  const heading = hasNumberedSeason
    ? t('episodes.seasonLabel', { season: formatNumber(suggestedSeason) })
    : seriesName || t('episodes.unmatchedTitle');
  const episodeLabel = episodeNumber
    ? t('episodes.episodeLabel', { episode: formatNumber(episodeNumber) })
    : t('analytics.unavailable');
  const selectedSeries = confirmedSeriesId || existingSeries?.id || '';
  const setupConfirmed = Boolean(confirmedSeriesId);
  const reason = reasonText(unmatchedReason);
  const disabled = model.saving ? ' disabled' : '';

  return `<form class="episode-review-card" data-episode-group aria-busy="${String(model.saving)}">
    <header class="episode-review-card-heading">
      <div>
        <p class="episode-review-kicker">${escapeHtml(heading)}</p>
        <h2>${escapeHtml(seriesName || t('episodes.unmatchedTitle'))} · ${escapeHtml(episodeLabel)}</h2>
      </div>
      <span class="episode-review-count">${t('episodes.sourceCount', { count: formatNumber(publications.length) })}</span>
    </header>
    ${reason ? `<p class="episode-review-reason" role="status">${escapeHtml(reason)}</p>` : ''}
    ${renderPublicationCarousel(publications, model.saving)}
    <div class="episode-review-fields">
      <label class="field">
        <span>${t('episodes.series')}</span>
        <select name="seriesId" data-role="episode-series"${setupConfirmed ? ' disabled' : disabled}>${renderSeriesOptions(model.series ?? [], selectedSeries)}</select>
        ${setupConfirmed ? `<input type="hidden" name="seriesId" value="${escapeHtml(selectedSeries)}">` : ''}
      </label>
      <div class="episode-new-series-fields" data-role="new-series-fields"${selectedSeries ? ' hidden' : ''}>
        <label class="field">
          <span>${t('episodes.seriesName')}</span>
          <input name="newSeriesName" maxlength="200" value="${escapeHtml(seriesName)}" placeholder="${escapeHtml(t('episodes.seriesName'))}"${selectedSeries || model.saving ? ' disabled' : ' required'}>
        </label>
        <label class="field">
          <span>${t('episodes.seriesAliases')}</span>
          <input name="seriesAliases" maxlength="500" value="" placeholder="${escapeHtml(t('episodes.seriesAliases'))}"${selectedSeries || model.saving ? ' disabled' : ''}>
        </label>
      </div>
      <label class="field">
        <span>${t('episodes.seasonMode')}</span>
        <select name="seasonMode" data-role="episode-season-mode" required${selectedSeries || model.saving ? ' disabled' : ''}>
          <option value=""${!seasonMode ? ' selected' : ''}>${t('episodes.selectSeasonMode')}</option>
          <option value="SEASONAL"${seasonMode === 'SEASONAL' ? ' selected' : ''}>${t('episodes.seasonal')}</option>
          <option value="NON_SEASONAL"${seasonMode === 'NON_SEASONAL' ? ' selected' : ''}>${t('episodes.nonSeasonal')}</option>
        </select>
      </label>
      <label class="field">
        <span>${t('episodes.seasonNumber')}</span>
        <input name="seasonNumber" type="number" min="1" step="1" value="${escapeHtml(suggestedSeason ?? '')}"${seasonMode === 'SEASONAL' ? ' required' : ''}${seasonMode === 'NON_SEASONAL' || model.saving || setupConfirmed ? ' disabled' : ''}>
        ${setupConfirmed && seasonMode === 'SEASONAL' ? `<input type="hidden" name="seasonNumber" value="${escapeHtml(suggestedSeason ?? '')}">` : ''}
      </label>
      <label class="field">
        <span>${t('episodes.episodeNumber')}</span>
        <input name="episodeNumber" type="number" min="1" step="1" value="${escapeHtml(episodeNumber)}" required${disabled}>
      </label>
    </div>
    <footer class="episode-review-actions">
      <button class="button primary" type="submit" data-episode-group-action data-action="approve-episode-group"${disabled}>${model.saving ? t('episodes.saving') : t('episodes.approve')}</button>
      <button class="button" type="button" data-episode-group-action data-action="reject-episode-group" data-suggestion-ids="${escapeHtml(JSON.stringify(suggestionIds))}"${disabled}>${t('episodes.reject')}</button>
      <button class="button" type="button" data-episode-group-action data-action="defer-episode-group" data-suggestion-ids="${escapeHtml(JSON.stringify(suggestionIds))}"${disabled}>${t('episodes.defer')}</button>
    </footer>
  </form>`;
}

function renderEpisodeStep(groups, unmatched, model) {
  const expanded = Boolean(model.showUnmatchedEpisodes);
  const identifiedGroups = groups.map(({ group, reason }) => renderGroup(group, model, reason)).join('');
  const unmatchedCards = expanded
    ? unmatched.map((suggestion) => renderGroup(suggestion, model, suggestion.unmatchedReason)).join('')
    : '';
  const empty = !groups.length && !unmatched.length
    ? `<div class="episode-review-state"><h2>${t('episodes.noGroupedEpisodes')}</h2><p>${t('episodes.emptyDescription')}</p></div>`
    : '';
  return `${identifiedGroups}
    ${renderCandidateVisibilityToggle(
      'toggle-unmatched-episodes',
      expanded,
      unmatched.length,
      'episodes.showUnmatchedEpisodes',
      'episodes.hideUnmatchedEpisodes',
      'episodeUnmatchedCandidates',
    )}
    <div id="episodeUnmatchedCandidates" class="episode-hidden-candidates"${expanded ? '' : ' hidden'}>${unmatchedCards}</div>
    ${empty}`;
}

export function renderEpisodeReviewScreen(model) {
  if (model.selectedSeriesId) {
    return `<section class="episode-review" aria-label="${t('episodes.series')}">
      ${renderSeriesDetails(model)}
    </section>`;
  }
  const stage = model.stage ?? 'EPISODES';
  const groups = (model.groups ?? []).map((group) => ({ group, reason: null }));
  const unmatched = model.unmatched ?? [];
  const loading = Boolean(model.loading);
  const content = loading
    ? `<div class="episode-review-state" role="status" aria-busy="true">${t('episodes.loading')}</div>`
    : model.error
      ? `<div class="episode-review-state episode-review-error" role="alert">${t('episodes.loadFailed')} <button class="button small" type="button" data-action="retry-episode-review">${t('report.retry')}</button></div>`
      : stage === 'SERIES'
        ? renderSeriesStep(model)
      : stage === 'SEASONS'
        ? (model.seasonProposals ?? []).map((proposal) => renderSeasonProposal(proposal, model)).join('')
      : stage === 'EPISODES'
        ? renderEpisodeStep(groups, unmatched, model)
        : `<div class="episode-review-state">
            <h2>${t('episodes.emptyTitle')}</h2>
            <p>${t('episodes.emptyDescription')}</p>
          </div>`;
  const failures = model.refreshResult?.failures?.length
    ? `<p class="episode-review-reason" role="status">${t('episodes.refreshPartial', { failed: formatNumber(model.refreshResult.failures.length) })}</p>`
    : '';
  const recommendationsOpen = Boolean(model.recommendationsOpen);
  const recommendations = recommendationsOpen
    ? `<section class="episode-recommendations" id="episodeRecommendations" aria-label="${t('episodes.answersLabel')}">
        ${renderSetupProgress(stage)}
        ${stage === 'SERIES' ? `<div class="episode-setup-step-heading"><h2>${t('episodes.seriesStepTitle')}</h2><p>${t('episodes.seriesStepDescription')}</p></div>` : ''}
        ${stage === 'SEASONS' ? `<div class="episode-setup-step-heading"><h2>${t('episodes.seasonStepTitle')}</h2><p>${t('episodes.seasonStepDescription')}</p></div>` : ''}
        <div class="episode-review-grid" aria-busy="${String(loading || model.refreshing || model.saving)}">
          ${content}
        </div>
      </section>`
    : '';

  return `<section class="episode-review" aria-labelledby="episodeReviewTitle">
    <header class="episode-review-heading">
      <div>
        <p class="eyebrow">${t('episodes.eyebrow')}</p>
        <h1 id="episodeReviewTitle">${t('episodes.title')}</h1>
        <p class="subtitle">${t('episodes.subtitle')}</p>
      </div>
      <div class="episode-review-heading-actions">
        <button class="button" type="button" data-action="toggle-manual-series-form" aria-expanded="${String(Boolean(model.manualSeriesOpen))}"${model.saving ? ' disabled' : ''}>${t('episodes.createSeries')}</button>
        <button class="button" type="button" data-action="toggle-episode-recommendations" aria-expanded="${String(recommendationsOpen)}" aria-controls="episodeRecommendations">${t(recommendationsOpen ? 'episodes.hideRecommendations' : 'episodes.showRecommendations')}</button>
        <button class="button primary" type="button" data-action="refresh-episode-suggestions"${model.loading || model.refreshing || model.saving ? ' disabled' : ''}>
          ${model.refreshing ? t('episodes.refreshing') : t('episodes.refresh')}
        </button>
      </div>
    </header>
    ${failures}
    ${renderSeriesCatalog(model)}
    ${renderManualSeriesForm(model)}
    ${renderManualEpisodeForm(model)}
    ${recommendations}
    ${renderManualPublicationPicker(model)}
  </section>`;
}
