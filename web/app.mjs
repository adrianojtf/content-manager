import { CreatorDeskApi, CreatorDeskApiError } from './api.mjs';
import { resolveSelectedAccountId } from './account-selection.mjs';
import {
  approveSemiAutomaticReplies,
  eligibleSemiAutomaticReplyRows,
  generateSemiAutomaticReplies,
  loadSemiAutomaticReplyComments,
  regenerateSemiAutomaticReply,
  sendApprovedSemiAutomaticReplies,
} from './bulk-replies.mjs';
import {
  applyUiFontSizePreference,
  isSupportedUiFontSize,
  readUiFontSizePreference,
  writeUiFontSizePreference,
} from './ui-font-size.mjs';
import {
  apiErrorMessage,
  applyStaticTranslations,
  formatNumber,
  readUiLocale,
  setUiLocale,
  socialSyncFailureMessage,
  t,
  uiLocale,
  writeUiLocale,
} from './i18n.mjs';
import { openOAuthPopup } from './oauth-flow.mjs';
import {
  defaultPublicationPageSize,
  isPublicationPageSize,
  publicationPageRequest,
  recordPublicationPageCursor,
} from './publication-pagination.mjs';
import { syncPublicationPage } from './publication-page-sync.mjs';
import { renderAnalyticsDashboard } from './dashboard.mjs';
import {
  renderEpisodeReviewScreen,
  updateEpisodeCarousel,
  updateEpisodeSelectionSummary,
} from './episode-review.mjs';
import {
  buildSentRepliesReportFilters,
  defaultSentRepliesReportDates,
  renderSentRepliesReportRows,
} from './sent-replies-report.mjs';
import { applyThemePreference, readThemePreference, writeThemePreference } from './theme.mjs';
import { replaceHtmlPreservingScroll } from './scroll-preservation.mjs';
import {
  commentKey,
  effectiveAnalysis,
  escapeHtml,
  formatDate,
  latestResponseVersion,
  networkInfo,
  publicationKey,
  renderAIProviderSettings,
  renderAppearanceSettings,
  renderBulkReplyDialog,
  renderBulkReplyRow,
  renderAccountOptions,
  renderConnectionSettings,
  renderEmptyState,
  renderPublicationPagination,
  renderPublicationCard,
  renderSocialTabs,
  renderStats,
  renderVerifiedReleaseSchedulePanel,
  responseVersionDetails,
} from './view.mjs';

const $ = (selector) => document.querySelector(selector);
const lastRenderedMarkup = new Map();

function setInnerHtmlIfChanged(element, markup) {
  if (!element || lastRenderedMarkup.get(element) === markup) return false;
  lastRenderedMarkup.set(element, markup);
  element.innerHTML = markup;
  return true;
}
const toneDefaults = Object.freeze({ primaryTone: 'FRIENDLY', modifiers: [], customNote: null });
const verifiedScheduleDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const apiBaseUrl = document.querySelector('meta[name="api-base-url"]')?.content ?? '';
const api = new CreatorDeskApi({ baseUrl: apiBaseUrl });
const initialTheme = readThemePreference();
const initialUiFontSize = readUiFontSizePreference();
const reportDates = defaultSentRepliesReportDates();
const initialScreen = window.location.hash === '#connections'
  ? 'connections'
  : window.location.hash === '#replies-report'
    ? 'replies-report'
    : window.location.hash === '#episodes'
      ? 'episodes'
    : window.location.hash === '#comments'
      ? 'comments'
      : 'dashboard';
setUiLocale(readUiLocale());
applyThemePreference(document.documentElement, initialTheme);
applyUiFontSizePreference(document.documentElement, initialUiFontSize);
const state = {
  screen: initialScreen,
  theme: initialTheme,
  activeNetwork: 'instagram',
  selectedAccountId: null,
  search: '',
  statusFilter: 'all',
  language: 'pt-BR',
  uiFontSize: initialUiFontSize,
  fontSettingsOpen: false,
  accountResults: new Map(),
  publications: new Map(),
  commentSummary: null,
  commentSummaryError: false,
  publicationCursors: new Map(),
  publicationCursorHistory: new Map(),
  publicationPageIndexes: new Map(),
  publicationLoadingAccounts: new Set(),
  publicationPageSize: defaultPublicationPageSize,
  comments: new Map(),
  workflows: new Map(),
  workflowErrors: new Map(),
  workflowLoading: new Set(),
  expandedPublications: new Set(),
  expandedComments: new Set(),
  drafts: new Map(),
  busy: new Set(),
  toneProfile: { ...toneDefaults },
  toneAccountId: null,
  toneScope: 'account',
  toneSource: null,
  toneGlobalLoaded: false,
  verifiedSchedule: {
    scope: 'ACCOUNT',
    accountId: null,
    schedule: null,
    source: null,
    draft: { enabled: false, daysOfWeek: [], localTime: '', timeZone: 'America/Sao_Paulo' },
    open: false,
    loading: false,
    saving: false,
    dirty: false,
    error: null,
  },
  pageSyncProgress: null,
  pageSyncFeedback: null,
  loadingPublications: true,
  publicationsError: null,
  searchLoading: false,
  connectedAccounts: [],
  sentRepliesReport: {
    draft: { ...reportDates, platform: '', accountId: '', search: '' },
    filters: null,
    accounts: [],
    items: [],
    total: 0,
    nextCursor: null,
    retryCursor: null,
    loading: false,
    loadingMore: false,
    error: null,
  },
  analytics: {
    loading: false,
    error: null,
    report: null,
    rankingWindow: 30,
  },
  episodeReview: {
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    stage: 'SERIES',
    series: [],
    seriesProposals: [],
    seasonProposals: [],
    groups: [],
    unmatched: [],
    showUnidentifiedSeries: false,
    showUnmatchedEpisodes: false,
    recommendationsOpen: false,
    seriesPage: 0,
    selectedSeriesId: null,
    editingEpisodeId: null,
    editingLink: null,
    seriesEpisodes: [],
    seriesEpisodesLoading: false,
    seriesEpisodesError: false,
    seriesPendingSuggestions: [],
    seriesPendingSuggestionsLoading: false,
    seriesPendingSuggestionsError: false,
    seriesPendingEpisodeSelection: [],
    seriesPendingEpisodeNumberDrafts: {},
    seriesPendingEpisodeSaving: false,
    seriesSuggestionModal: {
      open: false,
      loading: false,
      error: false,
      saving: false,
      candidates: [],
      selectedSuggestionIds: [],
    },
    refreshResult: null,
    manualSeriesOpen: false,
    manualEpisodeOpen: false,
    manualEpisodeDraft: { selectedPublications: {} },
    manualPicker: { open: false, platform: null, loading: false, error: null, publications: [] },
  },
  connectionsLoading: false,
  connectionsError: null,
  connectingNetworks: new Set(),
  disconnectingAccounts: new Set(),
  facebookSelection: null,
  selectedFacebookPageId: null,
  aiSettings: {
    loading: false,
    saving: false,
    accessSaving: false,
    error: null,
    access: null,
    active: null,
    models: [],
  },
  bulkReply: null,
};
let searchTimer;
let bulkReplyReturnFocus = null;
let manualPickerReturnPlatform = null;

function messageFor(error) {
  if (error instanceof CreatorDeskApiError || typeof error?.code === 'string') return apiErrorMessage(error.code);
  return t('error.unexpected');
}

function showToast(message, { error = false } = {}) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('show'), 4200);
}

function formatLastSync(comments) {
  const latest = comments.map((comment) => comment.lastSyncedAt).filter(Boolean).sort().at(-1);
  return latest ? t('stats.syncTime', { date: formatDate(latest) }) : t('stats.neverSynced');
}

function activeAccounts() {
  return [...state.accountResults.values()]
    .filter((result) => result.account.platform === state.activeNetwork)
    .map((result) => result.account);
}

function activePublications() {
  const accounts = activeAccounts();
  return accounts.flatMap((account) => {
    const result = state.accountResults.get(account.id);
    const page = state.publications.get(account.id);
    return result?.status === 'available'
      ? (page?.items ?? []).map((item) => ({ account, item }))
      : [];
  });
}

function activeLoadedComments(publications = activePublications()) {
  return publications.flatMap(({ account, item }) => state.comments.get(publicationKey(account.id, item.externalPublicationId))?.items ?? []);
}

function ensureSelectedAccount() {
  state.selectedAccountId = resolveSelectedAccountId(activeAccounts(), state.selectedAccountId);
}

function renderAccountFailures() {
  return activeAccounts().map((account) => {
    const result = state.accountResults.get(account.id);
    if (result?.status === 'available') return '';
    const name = account.displayName || account.externalAccountId;
    return `<section class="account-error"><strong>${escapeHtml(name)}</strong><span>${apiErrorMessage(result?.errorCode ?? 'SOCIAL_PROVIDER_UNAVAILABLE')}</span><button class="button small" type="button" data-action="refresh-publications" data-account-id="${escapeHtml(account.id)}">${t('publication.retry')}</button></section>`;
  }).join('');
}

function visiblePublicationModel(publications) {
  const query = state.search.trim().toLocaleLowerCase(uiLocale);
  const filteredComments = new Map();
  const visible = [];
  for (const publication of publications) {
    const { account, item } = publication;
    const key = publicationKey(account.id, item.externalPublicationId);
    const comments = state.comments.get(key);
    const matchesPublication = `${item.title ?? ''} ${item.description ?? ''}`.toLocaleLowerCase(uiLocale).includes(query);
    let items = comments?.items ?? [];
    if (query && !matchesPublication) {
      items = items.filter((comment) => `${comment.authorDisplayName ?? ''} ${comment.text ?? ''}`.toLocaleLowerCase(uiLocale).includes(query));
    }
    if (state.statusFilter === 'pending') {
      items = items.filter((comment) => !comment.appReplied && comment.externalReplyStatus === 'NOT_REPLIED');
    } else if (state.statusFilter === 'replied') {
      items = items.filter((comment) => comment.appReplied || comment.externalReplyStatus === 'REPLIED');
    } else if (state.statusFilter === 'unevaluated') {
      items = items.filter((comment) => !effectiveAnalysis(state.workflows.get(commentKey(comment.socialAccountId, comment.externalCommentId)) ?? []));
    }
    if (comments) filteredComments.set(key, { ...comments, items });
    if (!query || matchesPublication || items.length || !comments) visible.push(publication);
  }
  return { visible, comments: filteredComments };
}

function syncGlobalFontSettingsControl() {
  const toggle = $('#globalFontSettingsToggle');
  const panel = $('#globalFontSettingsPanel');
  const select = $('#uiFontSizeSelect');
  if (toggle) toggle.setAttribute('aria-expanded', String(state.fontSettingsOpen));
  if (panel) panel.hidden = !state.fontSettingsOpen;
  if (select) select.value = state.uiFontSize;
}

function renderRepliesReportScreen() {
  const report = state.sentRepliesReport;
  const form = $('#repliesReportFilters');
  $('#repliesReportFrom').value = report.draft.from;
  $('#repliesReportTo').value = report.draft.to;
  const today = new Date().toISOString().slice(0, 10);
  $('#repliesReportFrom').min = defaultSentRepliesReportDates().from;
  $('#repliesReportFrom').max = today;
  $('#repliesReportTo').max = today;
  $('#repliesReportPlatform').value = report.draft.platform;
  $('#repliesReportAccount').innerHTML = [
    `<option value="">${t('report.allAccounts')}</option>`,
    ...report.accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.displayName || account.externalAccountId)}</option>`),
  ].join('');
  $('#repliesReportAccount').value = report.draft.accountId;
  $('#repliesReportSearch').value = report.draft.search;
  $('#repliesReportResults').setAttribute('aria-busy', String(report.loading || report.loadingMore));
  $('#repliesReportResults').innerHTML = renderSentRepliesReportRows({
    items: report.items,
    total: report.total,
    loading: report.loading,
    loadingMore: report.loadingMore,
    error: report.error,
    nextCursor: report.nextCursor,
  });
  $('#repliesReportCsv').disabled = report.loading || report.loadingMore;
  form.setAttribute('aria-busy', String(report.loading));
}

function renderEpisodeReview() {
  $('#episodesScreen').innerHTML = renderEpisodeReviewScreen(state.episodeReview);
}

let bulkFlushScheduled = false;
const progressRenderInterval = 120;
const bulkDirtyRows = new Set();

function scheduleBulkProgressRender(commentId) {
  if (commentId) bulkDirtyRows.add(commentId);
  if (bulkFlushScheduled) return;
  bulkFlushScheduled = true;
  setTimeout(() => {
    bulkFlushScheduled = false;
    flushBulkProgress();
  }, progressRenderInterval);
}

function bulkProgressText(bulk) {
  if (!bulk.progress) return t(bulk.status === 'sending' ? 'bulkReplies.sending' : 'bulkReplies.generating');
  return t(bulk.status === 'sending' ? 'bulkReplies.sendingProgress' : 'bulkReplies.progress', {
    current: formatNumber(bulk.progress.current),
    total: formatNumber(bulk.progress.total),
    comment: bulk.progress.commentName ?? '',
  });
}

function flushBulkProgress() {
  const bulk = state.bulkReply;
  const dialog = $('#bulkReplyDialog');
  if (!bulk?.open || !dialog || dialog.hidden) {
    bulkDirtyRows.clear();
    return;
  }
  const model = { ...bulk, sendableCount: eligibleSemiAutomaticReplyRows(bulk.rows).length };
  const template = document.createElement('template');
  for (const commentId of bulkDirtyRows) {
    const row = findBulkRow(bulk, commentId);
    const element = dialog.querySelector(`.bulk-reply-row[data-comment-id="${CSS.escape(commentId)}"]`);
    if (!row || !element) continue;
    template.innerHTML = renderBulkReplyRow(row, model);
    const next = template.content.firstElementChild;
    if (next && element.outerHTML !== next.outerHTML) element.replaceWith(next);
  }
  bulkDirtyRows.clear();
  const progressText = bulkProgressText(bulk);
  const progressElement = dialog.querySelector('.bulk-progress-bar span:last-child');
  if (progressElement && progressElement.textContent !== progressText) {
    progressElement.textContent = progressText;
  }
}

function render() {
  const settingsVisible = state.screen === 'connections';
  const reportVisible = state.screen === 'replies-report';
  const episodesVisible = state.screen === 'episodes';
  const dashboardVisible = state.screen === 'dashboard';
  $('#commentsScreen').hidden = settingsVisible || reportVisible || episodesVisible || dashboardVisible;
  $('#connectionsScreen').hidden = !settingsVisible;
  $('#repliesReportScreen').hidden = !reportVisible;
  $('#episodesScreen').hidden = !episodesVisible;
  $('#dashboardScreen').hidden = !dashboardVisible;
  syncGlobalFontSettingsControl();
  const bulkDialog = $('#bulkReplyDialog');
  const bulkDialogFocus = captureBulkDialogFocus(bulkDialog);
  const bulkModel = state.bulkReply
    ? { ...state.bulkReply, sendableCount: eligibleSemiAutomaticReplyRows(state.bulkReply.rows).length }
    : state.bulkReply;
  const bulkMarkup = settingsVisible || reportVisible || episodesVisible || dashboardVisible
    ? ''
    : renderBulkReplyDialog(bulkModel);
  if (lastRenderedMarkup.get(bulkDialog) !== bulkMarkup) {
    lastRenderedMarkup.set(bulkDialog, bulkMarkup);
    replaceHtmlPreservingScroll(
      bulkDialog,
      bulkMarkup,
      () => bulkDialog.querySelector('.bulk-dialog-content'),
    );
  }
  restoreBulkDialogFocus(bulkDialog, bulkDialogFocus);
  bulkDialog.hidden = settingsVisible || reportVisible || episodesVisible || dashboardVisible || !state.bulkReply?.open;
  $('#breadcrumbCurrent').textContent = t(settingsVisible
    ? 'settings.title'
    : reportVisible
      ? 'report.title'
      : episodesVisible
        ? 'episodes.title'
        : dashboardVisible
          ? 'analytics.title'
          : 'app.pageTitle');
  document.querySelectorAll('[data-view]').forEach((link) => {
    const active = link.dataset.view === state.screen;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (settingsVisible) {
    $('#appearanceSettings').innerHTML = renderAppearanceSettings(state.theme, uiLocale);
    $('#aiProviderSettings').innerHTML = renderAIProviderSettings(state.aiSettings);
    const key = state.connectedAccounts.length === 1 ? 'settings.accountsCount.one' : 'settings.accountsCount.other';
    $('#connectedAccountCount').textContent = t(key, { count: formatNumber(state.connectedAccounts.length) });
    $('#connectedAccounts').innerHTML = renderConnectionSettings(state.connectedAccounts, {
      loading: state.connectionsLoading,
      error: state.connectionsError,
      connecting: state.connectingNetworks,
      disconnectingAccounts: state.disconnectingAccounts,
      facebookSelection: state.facebookSelection,
      selectedFacebookPageId: state.selectedFacebookPageId,
    });
    return;
  }
  if (reportVisible) {
    renderRepliesReportScreen();
    return;
  }
  if (episodesVisible) {
    renderEpisodeReview();
    return;
  }
  if (dashboardVisible) {
    $('#dashboardScreen').innerHTML = renderAnalyticsDashboard({
      report: state.analytics.report,
      loading: state.analytics.loading,
      error: Boolean(state.analytics.error),
      rankingWindow: state.analytics.rankingWindow,
    });
    return;
  }
  ensureSelectedAccount();
  const tabs = $('#socialTabs');
  const summaryPlatforms = new Map((state.commentSummary?.platforms ?? []).map((entry) => [entry.platform, entry]));
  const networkCounts = Object.fromEntries(Object.keys(networkInfo).map((network) => [
    network,
    summaryPlatforms.get(network)?.unansweredComments ?? null,
  ]));
  setInnerHtmlIfChanged(tabs, renderSocialTabs(state.activeNetwork, networkCounts));

  const accounts = activeAccounts();
  const pageSyncing = state.busy.has('page-sync');
  const pageLoading = state.loadingPublications || state.publicationLoadingAccounts.size > 0;
  const pageInteractionLocked = pageSyncing || pageLoading || state.searchLoading;
  tabs.querySelectorAll('[data-network]').forEach((tab) => { tab.disabled = pageInteractionLocked; });
  const accountFilter = $('#accountFilter');
  setInnerHtmlIfChanged(accountFilter, renderAccountOptions(accounts, state.selectedAccountId));
  accountFilter.disabled = accounts.length === 0 || pageInteractionLocked;
  const scheduleToggle = $('#verifiedReleaseScheduleToggle');
  scheduleToggle.disabled = pageInteractionLocked;
  scheduleToggle.setAttribute('aria-expanded', String(state.verifiedSchedule.open));
  const schedulePanel = $('#verifiedReleaseSchedulePanel');
  const focusedScheduleControl = schedulePanel.contains(document.activeElement) ? document.activeElement : null;
  const focusedScheduleId = focusedScheduleControl?.id;
  const focusedScheduleDay = focusedScheduleControl?.dataset?.dayOfWeek;
  const focusedScheduleRole = focusedScheduleControl?.dataset?.role;
  const focusedScheduleAction = focusedScheduleControl?.dataset?.action;
  const selectionStart = typeof focusedScheduleControl?.selectionStart === 'number' ? focusedScheduleControl.selectionStart : null;
  const selectionEnd = typeof focusedScheduleControl?.selectionEnd === 'number' ? focusedScheduleControl.selectionEnd : null;
  schedulePanel.hidden = !state.verifiedSchedule.open;
  setInnerHtmlIfChanged(schedulePanel, renderVerifiedReleaseSchedulePanel({
    ...state.verifiedSchedule,
    accountSelected: Boolean(state.selectedAccountId),
    canSave: canSaveVerifiedSchedule(),
  }));
  if (focusedScheduleId || focusedScheduleDay || focusedScheduleRole || focusedScheduleAction) {
    const selector = focusedScheduleDay
      ? `[data-day-of-week="${focusedScheduleDay}"]`
      : focusedScheduleId
        ? `#${focusedScheduleId}`
        : focusedScheduleRole
          ? `[data-role="${focusedScheduleRole}"]`
          : `[data-action="${focusedScheduleAction}"]`;
    const nextControl = schedulePanel.querySelector(selector);
    nextControl?.focus({ preventScroll: true });
    if (selectionStart !== null && selectionEnd !== null) {
      try {
        nextControl?.setSelectionRange(selectionStart, selectionEnd);
      } catch {
        // Time inputs do not expose text selection in all browsers.
      }
    }
  }
  $('#publicationPageSize').value = String(state.publicationPageSize);
  $('#publicationPageSize').disabled = pageInteractionLocked;
  $('#searchInput').disabled = pageInteractionLocked;
  $('#statusFilter').disabled = pageInteractionLocked;
  const publicationLoadingStatus = $('#publicationLoadingStatus');
  const publicationIsLoading = state.loadingPublications || state.publicationLoadingAccounts.size > 0;
  publicationLoadingStatus.hidden = !publicationIsLoading;
  publicationLoadingStatus.textContent = state.publicationLoadingAccounts.size > 0
    ? t('publication.loadingPage')
    : state.loadingPublications
      ? t('publication.loading')
      : '';

  const allPublications = activePublications();
  const selectedPublications = state.selectedAccountId
    ? allPublications.filter(({ account }) => account.id === state.selectedAccountId)
    : allPublications;
  const filtered = visiblePublicationModel(selectedPublications);
  const syncButton = $('#syncPageButton');
  const syncProgress = state.pageSyncProgress;
  const syncLabel = $('#syncPageLabel');
  const syncIcon = $('#syncPageIcon');
  const syncSpinner = $('#syncPageSpinner');
  const syncStatus = $('#syncPageStatus');
  syncButton.disabled = filtered.visible.length === 0
    || state.loadingPublications
    || state.publicationLoadingAccounts.size > 0
    || state.searchLoading
    || state.busy.has('page-sync');
  syncButton.setAttribute('aria-busy', String(Boolean(syncProgress)));
  syncLabel.textContent = syncProgress ? t('toolbar.syncPageBusy') : t('toolbar.syncPage');
  syncButton.title = t(syncProgress ? 'toolbar.syncPageBusy' : 'toolbar.syncPage');
  syncIcon.hidden = Boolean(syncProgress);
  syncSpinner.hidden = !syncProgress;
  syncStatus.hidden = !syncProgress && !state.pageSyncFeedback;
  syncStatus.textContent = syncProgress
    ? t('toolbar.syncPageProgress', {
      completed: formatNumber(syncProgress.completed),
      total: formatNumber(syncProgress.total),
      name: syncProgress.currentName,
    })
    : state.pageSyncFeedback ?? '';
  const selectedComments = activeLoadedComments(selectedPublications);
  $('#networkTitle').textContent = t(networkInfo[state.activeNetwork]?.nameKey ?? 'nav.comments');
  const totalForNetwork = allPublications.length;
  const syncText = formatLastSync(selectedComments);
  const publicationCount = t(totalForNetwork === 1 ? 'stats.networkSummary.one' : 'stats.networkSummary.other', { count: formatNumber(totalForNetwork) });
  $('#networkSubtitle').textContent = `${state.searchLoading ? `${t('toolbar.searching')} · ` : ''}${publicationCount} · ${syncText}`;
  setInnerHtmlIfChanged($('#stats'), renderStats({
    summary: state.commentSummary?.totals ?? null,
    unavailable: state.commentSummaryError,
  }));

  const viewModel = { ...state, comments: filtered.comments };
  const pageControls = activeAccounts()
    .filter((account) => !state.selectedAccountId || account.id === state.selectedAccountId)
    .map((account) => renderPublicationPagination(account, {
      pageIndex: state.publicationPageIndexes.get(account.id) ?? 0,
      hasPrevious: (state.publicationPageIndexes.get(account.id) ?? 0) > 0,
      hasNext: Boolean(state.publicationCursors.get(account.id)),
        loading: pageInteractionLocked || state.publicationLoadingAccounts.has(account.id),
    }))
    .join('');
  let contentMarkup;
  if (state.loadingPublications && state.accountResults.size === 0) {
    contentMarkup = `<div class="loading-state"><span class="spinner"></span> ${t('publication.loading')}</div>`;
  } else if (state.publicationsError && state.accountResults.size === 0) {
    contentMarkup = `<div class="error-state">${escapeHtml(state.publicationsError)}<p class="error-message">${t('error.apiDownDetail')}</p><button class="button small" type="button" data-action="refresh-publications">${t('publication.retry')}</button></div>`;
  } else if (!accounts.length) {
    contentMarkup = renderEmptyState(
      t('empty.noAccountsTitle'),
      t('empty.noAccountsDescription'),
      t('empty.refresh'),
      'refresh-publications',
    ) + pageControls;
  } else if (filtered.visible.length === 0 && !allPublications.length && renderAccountFailures()) {
    contentMarkup = `${renderAccountFailures()}${pageControls}`;
  } else if (filtered.visible.length === 0) {
    contentMarkup = renderEmptyState(
      t(state.search || state.statusFilter !== 'all' ? 'empty.noResultsTitle' : 'empty.noPublicationsTitle'),
      t(state.search || state.statusFilter !== 'all' ? 'empty.noResultsDescription' : 'empty.noPublicationsDescription'),
      t(state.search || state.statusFilter !== 'all' ? 'empty.clearFilters' : ''),
      'clear-filters',
    ) + pageControls;
  } else {
    const cards = filtered.visible.map((publication) => renderPublicationCard(publication, viewModel)).join('');
    contentMarkup = `${renderAccountFailures()}${cards}${pageControls}`;
  }
  const contentList = $('#contentList');
  if (pageSyncing && filtered.visible.length > 0) {
    if (!contentList.querySelector('.page-sync-overlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'page-sync-overlay';
      overlay.setAttribute('role', 'status');
      overlay.innerHTML = `<span class="page-sync-teacup" aria-hidden="true">☕</span><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(t('toolbar.syncingComments'))}</span>`;
      contentList.prepend(overlay);
    }
  } else {
    contentList.querySelector('.page-sync-overlay')?.remove();
    if (lastRenderedMarkup.get(contentList) !== contentMarkup) {
      lastRenderedMarkup.set(contentList, contentMarkup);
      replaceHtmlPreservingScroll(contentList, contentMarkup, () => document.scrollingElement);
    }
  }

}

function prunePublicationPageCache() {
  const currentPublicationKeys = new Set();
  for (const [accountId, page] of state.publications) {
    for (const item of page.items) currentPublicationKeys.add(publicationKey(accountId, item.externalPublicationId));
  }

  for (const key of state.comments.keys()) {
    if (!currentPublicationKeys.has(key)) state.comments.delete(key);
  }

  const currentCommentKeys = new Set();
  for (const page of state.comments.values()) {
    for (const comment of page.items ?? []) currentCommentKeys.add(commentKey(comment.socialAccountId, comment.externalCommentId));
  }
  for (const cache of [state.workflows, state.workflowErrors]) {
    for (const key of cache.keys()) {
      if (!currentCommentKeys.has(key)) cache.delete(key);
    }
  }
  for (const cache of [state.expandedPublications]) {
    for (const key of cache) {
      if (!currentPublicationKeys.has(key)) cache.delete(key);
    }
  }
  for (const cache of [state.expandedComments, state.workflowLoading]) {
    for (const key of cache) {
      if (!currentCommentKeys.has(key)) cache.delete(key);
    }
  }
}

async function refreshPublications({ accountId, cursor } = {}) {
  if (accountId) {
    state.publicationLoadingAccounts.add(accountId);
  } else {
    state.loadingPublications = true;
  }
  state.pageSyncFeedback = null;
  render();
  try {
    const results = await api.listPublications({
      accountId,
      cursor,
      pageSize: state.publicationPageSize,
      platform: state.activeNetwork,
    });
    if (!accountId) state.publicationsError = null;
    if (!accountId) {
      state.accountResults.clear();
      state.publications.clear();
      state.publicationCursors.clear();
      state.publicationCursorHistory.clear();
      state.publicationPageIndexes.clear();
    }
    for (const result of results) {
      state.accountResults.set(result.account.id, result);
      if (result.status !== 'available') {
        state.publications.delete(result.account.id);
        state.publicationCursors.delete(result.account.id);
        state.publicationCursorHistory.delete(result.account.id);
        state.publicationPageIndexes.delete(result.account.id);
        continue;
      }
      state.publications.set(result.account.id, { items: result.items });
      if (result.nextCursor) state.publicationCursors.set(result.account.id, result.nextCursor);
      else state.publicationCursors.delete(result.account.id);
      if (!accountId) {
        state.publicationCursorHistory.set(result.account.id, [undefined]);
        state.publicationPageIndexes.set(result.account.id, 0);
      }
    }
    prunePublicationPageCache();
    return true;
  } catch (error) {
    if (!accountId) state.publicationsError = messageFor(error);
    showToast(messageFor(error), { error: true });
    return false;
  } finally {
    if (accountId) state.publicationLoadingAccounts.delete(accountId);
    else state.loadingPublications = false;
    render();
  }
}

async function loadCommentSummary() {
  try {
    state.commentSummary = await api.getCommentSummary();
    state.commentSummaryError = false;
  } catch {
    state.commentSummaryError = true;
  }
  render();
}

async function changePublicationPage(accountId, direction) {
  if (state.busy.has('page-sync') || state.searchLoading || state.loadingPublications || state.publicationLoadingAccounts.has(accountId)) return;
  const currentIndex = state.publicationPageIndexes.get(accountId) ?? 0;
  const history = state.publicationCursorHistory.get(accountId) ?? [undefined];
  const pageRequest = publicationPageRequest({
    direction,
    pageIndex: currentIndex,
    cursors: history,
    nextCursor: state.publicationCursors.get(accountId),
  });
  if (!pageRequest) return;

  const loaded = await refreshPublications({ accountId, cursor: pageRequest.cursor });
  if (!loaded) return;
  state.publicationCursorHistory.set(
    accountId,
    recordPublicationPageCursor(history, pageRequest.pageIndex, pageRequest.cursor),
  );
  state.publicationPageIndexes.set(accountId, pageRequest.pageIndex);
  prunePublicationPageCache();
  render();
  void syncCurrentPublicationPage();
}

async function loadConnectedAccounts() {
  state.connectionsLoading = true;
  state.connectionsError = null;
  render();
  try {
    state.connectedAccounts = await api.listAccounts();
  } catch (error) {
    state.connectionsError = messageFor(error);
  } finally {
    state.connectionsLoading = false;
    render();
  }
}

async function loadAIProviderSettings() {
  state.aiSettings.loading = true;
  state.aiSettings.error = null;
  render();
  try {
    const [access, settings] = await Promise.all([
      api.getAIProviderAccess(),
      api.getResponseGenerationSettings(),
    ]);
    state.aiSettings.access = access;
    state.aiSettings.active = settings.active;
    state.aiSettings.models = settings.models;
  } catch (error) {
    state.aiSettings.error = messageFor(error);
  } finally {
    state.aiSettings.loading = false;
    render();
  }
}

async function saveAIProviderModel(event) {
  event.preventDefault();
  const value = $('#responseGenerationModel')?.value ?? '';
  const separator = value.indexOf('/');
  if (separator < 1 || separator === value.length - 1) return;
  state.aiSettings.saving = true;
  render();
  try {
    state.aiSettings.active = await api.saveResponseGenerationSettings({
      provider: value.slice(0, separator),
      model: value.slice(separator + 1),
    });
    showToast(t('aiSettings.saved'));
  } catch (error) {
    showToast(t('aiSettings.saveFailed', { message: messageFor(error) }), { error: true });
  } finally {
    state.aiSettings.saving = false;
    render();
  }
}

async function saveAIProviderAccess(event) {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const update = {
    geminiDataUsePolicy: data.get('geminiDataUsePolicy'),
  };
  for (const key of ['jevApiKey', 'geminiApiKey', 'openaiApiKey']) {
    const clearName = `clear${key[0].toUpperCase()}${key.slice(1)}`;
    const secret = form.elements.namedItem(key);
    if (data.get(clearName) === 'true') update[key] = null;
    else if (typeof secret?.value === 'string' && secret.value.trim()) update[key] = secret.value;
  }

  const button = form.querySelector('button[type="submit"]');
  state.aiSettings.accessSaving = true;
  button.disabled = true;
  button.textContent = t('aiSettings.savingAccess');
  try {
    state.aiSettings.access = await api.saveAIProviderAccess(update);
    state.aiSettings.accessSaving = false;
    showToast(t('aiSettings.accessSaved'));
    render();
  } catch (error) {
    state.aiSettings.accessSaving = false;
    button.disabled = !state.aiSettings.access?.storageReady;
    button.textContent = t('aiSettings.saveAccess');
    showToast(t('aiSettings.accessSaveFailed', { message: messageFor(error) }), { error: true });
  }
}

async function loadSentRepliesReport({ cursor = null, append = false } = {}) {
  const report = state.sentRepliesReport;
  try {
    report.filters ??= buildSentRepliesReportFilters(report.draft);
  } catch {
    report.error = 'invalid-date-range';
    render();
    return;
  }
  if (append) report.loadingMore = true;
  else report.loading = true;
  report.error = null;
  report.retryCursor = cursor;
  render();
  try {
    const result = await api.getSentRepliesReport({
      ...report.filters,
      ...(cursor ? { cursor } : {}),
      pageSize: 25,
    });
    report.items = append ? [...report.items, ...result.items] : result.items;
    report.total = result.total;
    report.nextCursor = result.nextCursor;
    report.retryCursor = null;
  } catch (error) {
    report.error = error;
  } finally {
    report.loading = false;
    report.loadingMore = false;
    render();
  }
}

async function loadAnalyticsDashboard() {
  const dashboard = state.analytics;
  dashboard.loading = true;
  dashboard.error = null;
  render();
  try {
    dashboard.report = await api.getAnalyticsDashboard();
  } catch (error) {
    dashboard.error = error;
    dashboard.report = null;
  } finally {
    dashboard.loading = false;
    render();
  }
}

async function loadSentRepliesReportAccounts() {
  try {
    state.sentRepliesReport.accounts = await api.listAccounts();
  } catch {
    state.sentRepliesReport.accounts = [];
  } finally {
    if (state.screen === 'replies-report') render();
  }
}

async function loadEpisodeReview({ showLoading = true, autoSync = false, stage } = {}) {
  const review = state.episodeReview;
  if (showLoading) {
    review.loading = true;
    review.error = null;
    render();
  }
  try {
    if (autoSync) {
      review.refreshing = true;
      review.refreshResult = null;
      render();
      try {
        review.refreshResult = await api.refreshEpisodeSuggestions();
      } catch {
        review.refreshResult = { failures: [{}] };
      } finally {
        review.refreshing = false;
      }
    }
    const result = await api.getEpisodeReview(stage);
    review.stage = result.stage ?? 'EPISODES';
    review.series = result.series ?? [];
    review.seriesProposals = result.seriesProposals ?? [];
    review.seasonProposals = result.seasonProposals ?? [];
    review.groups = result.groups ?? [];
    review.unmatched = result.unmatched ?? [];
    review.error = null;
  } catch {
    review.error = true;
  } finally {
    review.loading = false;
    if (state.screen === 'episodes') render();
  }
}

async function loadSeriesEpisodes() {
  const review = state.episodeReview;
  const seriesId = review.selectedSeriesId;
  if (!seriesId) return;
  review.seriesEpisodesLoading = true;
  review.seriesEpisodesError = false;
  render();
  try {
    const episodes = await api.listAnalyticsSeriesEpisodes(seriesId);
    if (review.selectedSeriesId === seriesId) review.seriesEpisodes = Array.isArray(episodes) ? episodes : [];
  } catch {
    if (review.selectedSeriesId === seriesId) {
      review.seriesEpisodes = [];
      review.seriesEpisodesError = true;
    }
  } finally {
    if (review.selectedSeriesId === seriesId) {
      review.seriesEpisodesLoading = false;
      if (state.screen === 'episodes') render();
    }
  }
}

async function loadSeriesPendingSuggestions() {
  const review = state.episodeReview;
  const seriesId = review.selectedSeriesId;
  if (!seriesId) return;
  review.seriesPendingSuggestionsLoading = true;
  review.seriesPendingSuggestionsError = false;
  render();
  try {
    const result = await api.getEpisodeReview('SERIES');
    if (review.selectedSeriesId === seriesId) {
      review.seriesPendingSuggestions = (result.seriesProposals ?? [])
        .flatMap((proposal) => proposal.suggestions ?? [])
        .filter((suggestion) => suggestion.setupSeriesId === seriesId);
    }
  } catch {
    if (review.selectedSeriesId === seriesId) {
      review.seriesPendingSuggestions = [];
      review.seriesPendingSuggestionsError = true;
    }
  } finally {
    if (review.selectedSeriesId === seriesId) {
      review.seriesPendingSuggestionsLoading = false;
      if (state.screen === 'episodes') render();
    }
  }
}

function openSeriesDetails(seriesId) {
  const review = state.episodeReview;
  if (!review.series.some((series) => series.id === seriesId)) return;
  review.selectedSeriesId = seriesId;
  review.editingEpisodeId = null;
  review.seriesEpisodes = [];
  review.seriesEpisodesLoading = true;
  review.seriesEpisodesError = false;
  review.seriesPendingSuggestions = [];
  review.seriesPendingSuggestionsLoading = true;
  review.seriesPendingSuggestionsError = false;
  review.seriesPendingEpisodeSelection = [];
  review.seriesPendingEpisodeNumberDrafts = {};
  review.seriesPendingEpisodeSaving = false;
  render();
  void loadSeriesEpisodes();
  void loadSeriesPendingSuggestions();
}

function backToSeriesList() {
  const review = state.episodeReview;
  const seriesId = review.selectedSeriesId;
  review.selectedSeriesId = null;
  review.editingEpisodeId = null;
  review.seriesEpisodes = [];
  review.seriesEpisodesLoading = false;
  review.seriesEpisodesError = false;
  review.seriesPendingSuggestions = [];
  review.seriesPendingSuggestionsLoading = false;
  review.seriesPendingSuggestionsError = false;
  review.seriesPendingEpisodeSelection = [];
  review.seriesPendingEpisodeNumberDrafts = {};
  review.seriesPendingEpisodeSaving = false;
  render();
  document.querySelector(`#episodesScreen [data-action="open-series-details"][data-series-id="${CSS.escape(seriesId ?? '')}"]`)
    ?.focus({ preventScroll: true });
}

function focusSeriesSuggestionModal() {
  document.querySelector('#episodesScreen .episode-series-suggestion-modal')?.focus({ preventScroll: true });
}

async function loadSeriesSuggestions() {
  const review = state.episodeReview;
  if (!review.selectedSeriesId || !review.seriesSuggestionModal.open) return;
  review.seriesSuggestionModal.loading = true;
  review.seriesSuggestionModal.error = false;
  review.seriesSuggestionModal.candidates = [];
  review.seriesSuggestionModal.selectedSuggestionIds = [];
  render();
  focusSeriesSuggestionModal();
  try {
    const result = await api.getEpisodeReview('SERIES');
    const candidates = (result.seriesProposals ?? [])
      .flatMap((proposal) => proposal.suggestions ?? [])
      .filter((suggestion) => !suggestion.setupSeriesId && suggestion.classification !== 'NOT_EPISODE');
    review.seriesSuggestionModal.candidates = [...new Map(candidates.map((suggestion) => [suggestion.id, suggestion])).values()];
  } catch {
    review.seriesSuggestionModal.error = true;
  } finally {
    review.seriesSuggestionModal.loading = false;
    if (review.seriesSuggestionModal.open) {
      render();
      focusSeriesSuggestionModal();
    }
  }
}

function openSeriesSuggestionModal() {
  const review = state.episodeReview;
  if (!review.selectedSeriesId) return;
  review.seriesSuggestionModal = {
    open: true,
    loading: true,
    error: false,
    saving: false,
    candidates: [],
    selectedSuggestionIds: [],
  };
  void loadSeriesSuggestions();
}

function closeSeriesSuggestionModal() {
  const review = state.episodeReview;
  if (!review.seriesSuggestionModal.open || review.seriesSuggestionModal.saving) return;
  review.seriesSuggestionModal = {
    open: false,
    loading: false,
    error: false,
    saving: false,
    candidates: [],
    selectedSuggestionIds: [],
  };
  render();
  document.querySelector('#episodesScreen [data-action="open-series-suggestions"]')?.focus({ preventScroll: true });
}

function updateSeriesSuggestionSelection(form) {
  if (!form) return;
  const selected = form.querySelectorAll('[data-series-suggestion-id]:checked').length;
  const count = form.querySelector('[data-series-suggestion-count]');
  const addButton = form.querySelector('[data-action="add-series-suggestions"]');
  if (count) count.textContent = t('episodes.seriesSuggestionSelectedCount', { selected: formatNumber(selected) });
  if (addButton) addButton.disabled = selected === 0 || state.episodeReview.seriesSuggestionModal.saving;
}

function updateSeriesPendingEpisodeSelection(form) {
  if (!form) return;
  const checkboxes = [...form.querySelectorAll('[data-series-pending-episode-suggestion-id]')];
  for (const checkbox of checkboxes) {
    const item = checkbox.closest('[data-series-pending-suggestion-id]');
    const numberInput = item?.querySelector('[data-series-pending-episode-number]');
    const episodeNumber = Number(numberInput?.value ?? checkbox.dataset.episodeNumber);
    const episodeNumberReady = Number.isSafeInteger(episodeNumber) && episodeNumber > 0;
    const ready = checkbox.dataset.readyWithoutEpisodeNumber === 'true' && episodeNumberReady;
    checkbox.dataset.episodeNumber = episodeNumberReady ? String(episodeNumber) : '';
    checkbox.disabled = !ready || state.episodeReview.seriesPendingEpisodeSaving;
    if (numberInput) {
      state.episodeReview.seriesPendingEpisodeNumberDrafts[checkbox.dataset.seriesPendingEpisodeSuggestionId] = numberInput.value;
    }
    if (!ready && checkbox.checked) checkbox.checked = false;
    const label = item?.querySelector('[data-series-pending-episode-label]');
    if (label) {
      label.textContent = [
        checkbox.dataset.seasonNumber
          ? t('episodes.seasonLabel', { season: formatNumber(Number(checkbox.dataset.seasonNumber)) })
          : '',
        episodeNumberReady
          ? t('episodes.episodeLabel', { episode: formatNumber(episodeNumber) })
          : t('analytics.unavailable'),
      ].filter(Boolean).join(' · ');
    }
    const needsReview = item?.querySelector('.episode-series-pending-needs-review');
    if (needsReview) needsReview.hidden = ready;
  }
  const selectedInputs = [...form.querySelectorAll('[data-series-pending-episode-suggestion-id]:checked')];
  state.episodeReview.seriesPendingEpisodeSelection = selectedInputs
    .map((input) => input.dataset.seriesPendingEpisodeSuggestionId);
  const count = form.querySelector('[data-series-pending-episode-count]');
  const addButton = form.querySelector('[data-action="add-series-pending-episodes"]');
  if (count) {
    count.textContent = t('episodes.seriesPendingSelectionCount', {
      count: formatNumber(selectedInputs.length),
    });
  }
  if (addButton) {
    addButton.disabled = selectedInputs.length === 0
      || state.episodeReview.seriesPendingEpisodeSaving;
  }
}

async function addSelectedSeriesPendingEpisodes(event) {
  event.preventDefault();
  const review = state.episodeReview;
  const selected = [...event.target.querySelectorAll('[data-series-pending-episode-suggestion-id]:checked')];
  const seriesId = review.selectedSeriesId;
  if (!seriesId || !selected.length) return;

  const approvalGroups = new Map();
  for (const input of selected) {
    const seasonNumber = input.dataset.seasonNumber === '' ? null : Number(input.dataset.seasonNumber);
    const episodeNumber = Number(input.dataset.episodeNumber);
    if (!Number.isSafeInteger(episodeNumber) || episodeNumber < 1) return;
    const key = JSON.stringify([seasonNumber, episodeNumber]);
    const group = approvalGroups.get(key) ?? {
      seasonNumber,
      episodeNumber,
      suggestionIds: [],
    };
    group.suggestionIds.push(input.dataset.seriesPendingEpisodeSuggestionId);
    approvalGroups.set(key, group);
  }

  review.seriesPendingEpisodeSelection = selected.map((input) => input.dataset.seriesPendingEpisodeSuggestionId);
  review.seriesPendingEpisodeSaving = true;
  render();
  let added = 0;
  let failed = 0;
  for (const group of approvalGroups.values()) {
    try {
      await api.approveEpisodeSuggestionGroup({
        suggestionIds: group.suggestionIds,
        seriesId,
        seasonNumber: group.seasonNumber,
        episodeNumber: group.episodeNumber,
      });
      added += 1;
    } catch {
      failed += 1;
    }
  }

  review.seriesPendingEpisodeSaving = false;
  review.seriesPendingEpisodeSelection = [];
  review.seriesPendingEpisodeNumberDrafts = {};
  showToast(failed
    ? t('episodes.seriesEpisodesPartial', {
      added: formatNumber(added),
      failed: formatNumber(failed),
    })
    : t('episodes.seriesEpisodesAdded', { count: formatNumber(added) }), {
    error: added === 0,
  });
  await loadEpisodeReview({ showLoading: false });
  await Promise.all([loadSeriesEpisodes(), loadSeriesPendingSuggestions()]);
}

async function addSelectedSeriesSuggestions(event) {
  event.preventDefault();
  const review = state.episodeReview;
  const form = event.target;
  const suggestionIds = [...form.querySelectorAll('[data-series-suggestion-id]:checked')]
    .map((input) => input.dataset.seriesSuggestionId);
  if (!suggestionIds.length || !review.selectedSeriesId) return;
  review.seriesSuggestionModal.selectedSuggestionIds = suggestionIds;
  review.seriesSuggestionModal.saving = true;
  render();
  try {
    await api.confirmEpisodeSetupSeries({ suggestionIds, seriesId: review.selectedSeriesId });
    review.seriesSuggestionModal = {
      open: false,
      loading: false,
      error: false,
      saving: false,
      candidates: [],
      selectedSuggestionIds: [],
    };
    showToast(t('episodes.actionSaved'));
    await loadEpisodeReview({ showLoading: false });
    await Promise.all([loadSeriesEpisodes(), loadSeriesPendingSuggestions()]);
  } catch {
    review.seriesSuggestionModal.saving = false;
    showToast(t('episodes.actionFailed'), { error: true });
    render();
  }
}

async function refreshEpisodeSuggestions() {
  const review = state.episodeReview;
  review.refreshing = true;
  review.refreshResult = null;
  render();
  try {
    review.refreshResult = await api.refreshEpisodeSuggestions();
    showToast(t('episodes.refreshSuccess', {
      classified: formatNumber(review.refreshResult.classified ?? 0),
      skipped: formatNumber(review.refreshResult.skipped ?? 0),
      failed: formatNumber(review.refreshResult.failures?.length ?? 0),
    }));
  } catch {
    showToast(t('episodes.actionFailed'), { error: true });
  } finally {
    review.refreshing = false;
    await loadEpisodeReview({ showLoading: false });
  }
}

async function decideEpisodeGroup(button) {
  let suggestionIds;
  try {
    suggestionIds = JSON.parse(button.dataset.suggestionIds ?? '[]');
  } catch {
    suggestionIds = [];
  }
  const form = button.closest('form[data-setup-proposal], form[data-episode-group]');
  const selectedIds = form
    ? [...form.querySelectorAll('[data-review-publication]:checked')].map((input) => input.dataset.reviewPublication)
    : suggestionIds;
  if (!selectedIds.length) {
    showToast(t('episodes.selectAtLeastOne'), { error: true });
    return;
  }
  state.episodeReview.saving = true;
  render();
  try {
    const decision = button.dataset.action === 'reject-episode-group' ? 'REJECTED' : 'DEFERRED';
    await api.decideEpisodeSuggestions(selectedIds, decision);
    showToast(t('episodes.actionSaved'));
    await loadEpisodeReview({ showLoading: false });
  } catch {
    showToast(t('episodes.actionFailed'), { error: true });
  } finally {
    state.episodeReview.saving = false;
    render();
  }
}

async function confirmEpisodeSeriesProposal(event) {
  event.preventDefault();
  const form = event.target;
  const values = new FormData(form);
  const suggestionIds = [...form.querySelectorAll('[data-review-publication]:checked')]
    .map((input) => input.dataset.reviewPublication);
  if (!suggestionIds.length) {
    showToast(t('episodes.selectAtLeastOne'), { error: true });
    return;
  }
  const seriesId = values.get('seriesId') || '';
  const input = {
    suggestionIds,
    ...(seriesId ? { seriesId } : {
      newSeries: {
        name: String(values.get('newSeriesName') ?? '').trim(),
        aliases: String(values.get('seriesAliases') ?? '').split(',').map((alias) => alias.trim()).filter(Boolean),
        seasonMode: values.get('seasonMode'),
      },
    }),
  };
  await saveEpisodeSetupDecision(() => api.confirmEpisodeSetupSeries(input));
}

async function confirmEpisodeSeasonProposal(event) {
  event.preventDefault();
  const form = event.target;
  const values = new FormData(form);
  const suggestionIds = [...form.querySelectorAll('[data-review-publication]:checked')]
    .map((input) => input.dataset.reviewPublication);
  if (!suggestionIds.length) {
    showToast(t('episodes.selectAtLeastOne'), { error: true });
    return;
  }
  await saveEpisodeSetupDecision(() => api.confirmEpisodeSetupSeasons({
    suggestionIds,
    seasonNumber: Number(values.get('seasonNumber')),
  }));
}

async function saveEpisodeSetupDecision(action) {
  state.episodeReview.saving = true;
  render();
  try {
    await action();
    showToast(t('episodes.actionSaved'));
    await loadEpisodeReview({ showLoading: false });
  } catch {
    showToast(t('episodes.actionFailed'), { error: true });
  } finally {
    state.episodeReview.saving = false;
    render();
  }
}

async function approveEpisodeGroup(event) {
  event.preventDefault();
  const form = event.target;
  const values = new FormData(form);
  const suggestionIds = [...form.querySelectorAll('[data-review-publication]:checked')]
    .map((input) => input.dataset.reviewPublication);
  if (!suggestionIds.length) {
    showToast(t('episodes.selectAtLeastOne'), { error: true });
    return;
  }
  const seriesId = values.get('seriesId') || '';
  const selectedSeries = state.episodeReview.series.find((series) => series.id === seriesId);
  const seasonMode = selectedSeries?.seasonMode ?? values.get('seasonMode');
  const seasonNumberValue = values.get('seasonNumber');
  const episodeNumberValue = values.get('episodeNumber');
  const input = {
    suggestionIds,
    ...(seriesId
      ? { seriesId }
      : {
        newSeries: {
          name: values.get('newSeriesName'),
          aliases: String(values.get('seriesAliases') ?? '').split(',').map((alias) => alias.trim()).filter(Boolean),
          seasonMode,
        },
    }),
    seasonNumber: seasonMode === 'SEASONAL' && seasonNumberValue !== '' ? Number(seasonNumberValue) : null,
    episodeNumber: Number(episodeNumberValue),
  };
  state.episodeReview.saving = true;
  render();
  try {
    await api.approveEpisodeSuggestionGroup(input);
    showToast(t('episodes.actionSaved'));
    await loadEpisodeReview({ showLoading: false });
  } catch {
    showToast(t('episodes.actionFailed'), { error: true });
  } finally {
    state.episodeReview.saving = false;
    render();
  }
}

function emptyManualEpisodeDraft() {
  return { seriesId: '', seasonNumber: '', episodeNumber: '', selectedPublications: {} };
}

function captureManualEpisodeDraft() {
  const form = document.querySelector('#episodesScreen form[data-manual-episode-form]');
  if (!form) return;
  const values = new FormData(form);
  const draft = state.episodeReview.manualEpisodeDraft;
  draft.seriesId = String(values.get('seriesId') ?? '');
  draft.seasonNumber = String(values.get('seasonNumber') ?? '');
  draft.episodeNumber = String(values.get('episodeNumber') ?? '');
}

function openManualEpisodeForm() {
  const review = state.episodeReview;
  review.manualEpisodeDraft = emptyManualEpisodeDraft();
  review.manualEpisodeOpen = true;
  render();
  document.querySelector('#episodesScreen form[data-manual-episode-form] [name="seriesId"]')?.focus({ preventScroll: true });
}

function closeManualEpisodeForm() {
  const review = state.episodeReview;
  review.manualEpisodeOpen = false;
  review.manualEpisodeDraft = emptyManualEpisodeDraft();
  review.manualPicker = { open: false, platform: null, loading: false, error: null, publications: [] };
  render();
}

async function createManualSeries(event) {
  event.preventDefault();
  const values = new FormData(event.target);
  const input = {
    name: String(values.get('name') ?? '').trim(),
    aliases: String(values.get('aliases') ?? '').split(',').map((alias) => alias.trim()).filter(Boolean),
    seasonMode: values.get('seasonMode'),
  };
  state.episodeReview.saving = true;
  render();
  try {
    const createdSeries = await api.createAnalyticsSeries(input);
    if (createdSeries?.id) {
      state.episodeReview.series = [
        ...state.episodeReview.series.filter((series) => series.id !== createdSeries.id),
        createdSeries,
      ];
    }
    state.episodeReview.manualSeriesOpen = false;
    showToast(t('episodes.actionSaved'));
    await loadEpisodeReview({ showLoading: false });
  } catch {
    showToast(t('episodes.actionFailed'), { error: true });
  } finally {
    state.episodeReview.saving = false;
    render();
  }
}

function focusManualPublicationPicker() {
  document.querySelector('#episodesScreen .manual-publication-picker')?.focus({ preventScroll: true });
}

async function loadManualPickerPublications(platform) {
  const picker = state.episodeReview.manualPicker;
  if (!picker?.open || picker.platform !== platform) return;
  picker.loading = true;
  picker.error = null;
  picker.publications = [];
  render();
  focusManualPublicationPicker();
  try {
    const publications = await api.getAvailableEpisodePublications(platform);
    picker.publications = Array.isArray(publications) ? publications : [];
    picker.error = null;
  } catch {
    picker.publications = [];
    picker.error = true;
  } finally {
    picker.loading = false;
    render();
    focusManualPublicationPicker();
  }
}

async function openManualPublicationPicker(platform, trigger) {
  if (!platform) return;
  captureManualEpisodeDraft();
  manualPickerReturnPlatform = trigger?.dataset?.platform ?? platform;
  state.episodeReview.manualPicker = { open: true, platform, loading: true, error: null, publications: [] };
  render();
  focusManualPublicationPicker();
  await loadManualPickerPublications(platform);
}

function closeManualPublicationPicker() {
  const picker = state.episodeReview.manualPicker;
  if (!picker?.open) return;
  const returnPlatform = manualPickerReturnPlatform ?? picker.platform;
  state.episodeReview.manualPicker = { open: false, platform: null, loading: false, error: null, publications: [] };
  manualPickerReturnPlatform = null;
  render();
  document.querySelector(
    `#episodesScreen [data-manual-platform="${CSS.escape(returnPlatform)}"] [data-action="open-manual-publication-picker"]`,
  )?.focus({ preventScroll: true });
}

function selectManualPublication(button) {
  const review = state.episodeReview;
  const picker = review.manualPicker;
  const publication = (picker?.publications ?? []).find((item) => (
    item.socialAccountId === button.dataset.accountId
    && item.externalPublicationId === button.dataset.publicationId
  ));
  if (!publication) return;
  review.manualEpisodeDraft.selectedPublications[picker.platform] = {
    platform: picker.platform,
    socialAccountId: publication.socialAccountId,
    externalPublicationId: publication.externalPublicationId,
    socialAccountName: publication.socialAccountName ?? null,
    title: publication.title ?? '',
    thumbnailUrl: publication.thumbnailUrl ?? null,
  };
  closeManualPublicationPicker();
}

function removeManualPublication(platform) {
  const draft = state.episodeReview.manualEpisodeDraft;
  if (!platform || !draft?.selectedPublications?.[platform]) return;
  delete draft.selectedPublications[platform];
  render();
  document.querySelector(
    `#episodesScreen [data-manual-platform="${CSS.escape(platform)}"] [data-action="open-manual-publication-picker"]`,
  )?.focus({ preventScroll: true });
}

async function updateSeriesEpisode(event) {
  event.preventDefault();
  const review = state.episodeReview;
  const form = event.target;
  const episodeId = form.dataset.episodeId;
  const seriesId = review.selectedSeriesId;
  const selectedSeries = review.series.find((series) => series.id === seriesId);
  if (!episodeId || !seriesId || !selectedSeries) {
    showToast(t('episodes.actionFailed'), { error: true });
    return;
  }
  const data = new FormData(form);
  const episodeNumber = Number(data.get('episodeNumber'));
  const seasonField = data.get('seasonNumber');
  const seasonNumber = selectedSeries.seasonMode === 'SEASONAL'
    ? Number(seasonField)
    : null;
  const episodeCode = String(data.get('episodeCode') ?? '').trim();
  const costAmount = String(data.get('productionCostAmount') ?? '').trim();
  const timeSeconds = String(data.get('productionTimeSeconds') ?? '').trim();
  if (!Number.isSafeInteger(episodeNumber) || episodeNumber < 1
    || (selectedSeries.seasonMode === 'SEASONAL' && (!Number.isSafeInteger(seasonNumber) || seasonNumber < 1))) {
    showToast(t('episodes.actionFailed'), { error: true });
    return;
  }
  review.saving = true;
  render();
  try {
    await api.updateAnalyticsEpisode(episodeId, {
      seriesId,
      seasonNumber,
      episodeNumber,
      ...(episodeCode ? { episodeCode } : {}),
      productionCost: costAmount === '' ? null : { amount: costAmount, currency: 'BRL' },
      productionTimeSeconds: timeSeconds === '' ? null : Number(timeSeconds),
    });
    showToast(t('episodes.actionSaved'));
    review.editingEpisodeId = null;
    await loadSeriesEpisodes();
  } catch (error) {
    showToast(apiErrorMessage(error?.code ?? ''), { error: true });
  } finally {
    review.saving = false;
    render();
  }
}

async function moveEpisodePublicationLink(form) {
  const review = state.episodeReview;
  const { episodeId, accountId, publicationId } = form.dataset;
  const selectedSeries = review.series.find((series) => series.id === review.selectedSeriesId);
  if (!episodeId || !accountId || !publicationId || !selectedSeries) {
    showToast(t('episodes.actionFailed'), { error: true });
    return;
  }
  const data = new FormData(form);
  const episodeNumber = Number(data.get('episodeNumber'));
  const seasonNumber = selectedSeries.seasonMode === 'SEASONAL' ? Number(data.get('seasonNumber')) : null;
  if (!Number.isSafeInteger(episodeNumber) || episodeNumber < 1
    || (selectedSeries.seasonMode === 'SEASONAL' && (!Number.isSafeInteger(seasonNumber) || seasonNumber < 1))) {
    showToast(t('episodes.actionFailed'), { error: true });
    return;
  }
  review.saving = true;
  render();
  try {
    await api.updateEpisodePublicationLink(episodeId, {
      socialAccountId: accountId,
      externalPublicationId: publicationId,
      moveTo: { seasonNumber, episodeNumber },
    });
    showToast(t('episodes.actionSaved'));
    review.editingLink = null;
    await loadSeriesEpisodes();
  } catch (error) {
    showToast(apiErrorMessage(error?.code ?? ''), { error: true });
  } finally {
    review.saving = false;
    render();
  }
}

async function createManualEpisode(event) {
  event.preventDefault();
  const review = state.episodeReview;
  captureManualEpisodeDraft();
  const draft = review.manualEpisodeDraft;
  const selectedSeries = review.series.find((series) => series.id === draft.seriesId);
  if (!selectedSeries) {
    showToast(t('episodes.actionFailed'), { error: true });
    return;
  }
  const publicationSelections = Object.values(draft.selectedPublications ?? {}).map((selection) => ({
    socialAccountId: selection.socialAccountId,
    externalPublicationId: selection.externalPublicationId,
  }));
  review.saving = true;
  render();
  try {
    await api.createManualAnalyticsEpisode({
      seriesId: selectedSeries.id,
      seasonNumber: selectedSeries.seasonMode === 'SEASONAL' && draft.seasonNumber !== ''
        ? Number(draft.seasonNumber)
        : null,
      episodeNumber: Number(draft.episodeNumber),
      productionCost: null,
      productionTimeSeconds: null,
      publicationSelections,
    });
    showToast(t('episodes.actionSaved'));
    review.manualEpisodeOpen = false;
    review.manualEpisodeDraft = emptyManualEpisodeDraft();
    await loadEpisodeReview({ showLoading: false });
  } catch {
    showToast(t('episodes.actionFailed'), { error: true });
  } finally {
    review.saving = false;
    render();
  }
}

function trapManualPickerFocus(event) {
  const dialog = document.querySelector('#episodesScreen .manual-publication-picker');
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.offsetParent !== null);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function trapSeriesSuggestionModalFocus(event) {
  const dialog = document.querySelector('#episodesScreen .episode-series-suggestion-modal');
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.offsetParent !== null);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (document.activeElement === dialog) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function syncEpisodeSetupSeriesForm(form) {
  const seriesSelect = form?.querySelector('[data-role="setup-series"]');
  if (!seriesSelect) return;
  const selectedSeries = state.episodeReview.series.find((series) => series.id === seriesSelect.value);
  const selected = Boolean(selectedSeries);
  const newSeriesFields = form.querySelector('[data-role="setup-new-series-fields"]');
  newSeriesFields.hidden = selected;
  newSeriesFields.querySelectorAll('input').forEach((input) => { input.disabled = selected || state.episodeReview.saving; });
  const newSeriesName = newSeriesFields.querySelector('[name="newSeriesName"]');
  if (newSeriesName) newSeriesName.required = !selected;
  const seasonMode = form.querySelector('[data-role="setup-season-mode"]');
  seasonMode.disabled = selected || state.episodeReview.saving;
  if (selected) seasonMode.value = selectedSeries.seasonMode;
  else if (!seasonMode.value) seasonMode.value = '';
}

function navigateEpisodeCarousel(button) {
  const carousel = button.closest('[data-episode-carousel]');
  if (!carousel) return;
  const current = Number(carousel.dataset.carouselIndex) || 0;
  const delta = button.dataset.action === 'episode-carousel-next' ? 1 : -1;
  updateEpisodeCarousel(carousel, current + delta);
}

function syncEpisodeGroupForm(form, { resetSeasonMode = false } = {}) {
  const seriesSelect = form?.querySelector('[data-role="episode-series"]');
  if (!seriesSelect) return;
  const selectedSeries = state.episodeReview.series.find((series) => series.id === seriesSelect.value);
  const newSeriesSelected = !selectedSeries;
  const newSeriesFields = form.querySelector('[data-role="new-series-fields"]');
  const newSeriesName = newSeriesFields?.querySelector('[name="newSeriesName"]');
  newSeriesFields.hidden = !newSeriesSelected;
  newSeriesFields.querySelectorAll('input').forEach((input) => { input.disabled = !newSeriesSelected; });
  if (newSeriesName) newSeriesName.required = newSeriesSelected;

  const modeSelect = form.querySelector('[data-role="episode-season-mode"]');
  modeSelect.disabled = Boolean(selectedSeries);
  if (selectedSeries) modeSelect.value = selectedSeries.seasonMode;
  else if (resetSeasonMode) modeSelect.value = '';

  const seasonNumber = form.querySelector('[name="seasonNumber"]');
  const seasonMode = selectedSeries?.seasonMode ?? modeSelect.value;
  seasonNumber.disabled = seasonMode === 'NON_SEASONAL';
  seasonNumber.required = seasonMode === 'SEASONAL';
  if (seasonMode === 'NON_SEASONAL') seasonNumber.value = '';
}

function updateSentRepliesReportDraft(form) {
  const values = new FormData(form);
  state.sentRepliesReport.draft = {
    from: values.get('from'),
    to: values.get('to'),
    platform: values.get('platform') || '',
    accountId: values.get('accountId') || '',
    search: values.get('search') || '',
  };
}

async function applySentRepliesReportFilters(form) {
  updateSentRepliesReportDraft(form);
  const report = state.sentRepliesReport;
  try {
    report.filters = buildSentRepliesReportFilters(report.draft);
    report.items = [];
    report.total = 0;
    report.nextCursor = null;
    report.retryCursor = null;
    await loadSentRepliesReport();
  } catch {
    report.error = 'invalid-date-range';
    render();
  }
}

async function exportSentRepliesReportCsv() {
  const report = state.sentRepliesReport;
  const button = $('#repliesReportCsv');
  button.disabled = true;
  try {
    const filters = report.filters ?? buildSentRepliesReportFilters(report.draft);
    const { blob, filename } = await api.downloadSentRepliesReportCsv(filters);
    const objectUrl = URL.createObjectURL(blob);
    const download = document.createElement('a');
    download.href = objectUrl;
    download.download = filename;
    document.body.append(download);
    download.click();
    download.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    showToast(t('report.exportFailed'), { error: true });
  } finally {
    render();
  }
}

async function setScreen(screen) {
  if (state.busy.has('page-sync') || state.searchLoading || state.loadingPublications
    || state.publicationLoadingAccounts.size > 0 || state.bulkReply?.busy) return;
  if (screen !== 'dashboard' && screen !== 'episodes' && screen !== 'comments' && screen !== 'connections' && screen !== 'replies-report') return;
  if (state.bulkReply?.open) {
    closeBulkReply();
    if (state.bulkReply?.open) return;
  }
  state.screen = screen;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${screen}`);
  render();
  if (screen === 'dashboard') {
    if (!state.analytics.report && !state.analytics.loading) await loadAnalyticsDashboard();
    return;
  }
  if (screen === 'episodes') {
    await loadEpisodeReview({ autoSync: true });
    return;
  }
  if (screen === 'connections') {
    await Promise.all([loadConnectedAccounts(), loadAIProviderSettings()]);
    return;
  }
  if (screen === 'replies-report') {
    if (!state.sentRepliesReport.filters) {
      state.sentRepliesReport.filters = buildSentRepliesReportFilters(state.sentRepliesReport.draft);
    }
    await Promise.all([loadSentRepliesReportAccounts(), loadSentRepliesReport()]);
    return;
  }
  const [publicationsReady] = await Promise.all([refreshPublications(), loadCommentSummary()]);
  if (publicationsReady) void syncCurrentPublicationPage();
  await Promise.all([
    loadToneProfile(state.selectedAccountId),
    loadVerifiedReleaseSchedule(state.selectedAccountId),
  ]);
}

async function loadComments(accountId, publicationId, { force = false } = {}) {
  const key = publicationKey(accountId, publicationId);
  const previous = state.comments.get(key);
  if (previous?.loading || (previous && !force)) return previous;
  state.comments.set(key, {
    ...(previous ?? {}),
    items: previous?.items ?? [],
    loading: true,
    loadErrorCode: null,
  });
  render();
  try {
    const items = await api.listComments(accountId, publicationId);
    state.comments.set(key, { ...state.comments.get(key), items, loading: false, loadErrorCode: null });
    await loadWorkflowSummaries(items);
  } catch (error) {
    const errorCode = error?.code ?? 'SOCIAL_COMMENT_SYNC_FAILED';
    state.comments.set(key, {
      ...state.comments.get(key),
      loading: false,
      loadErrorCode: errorCode,
    });
  }
  render();
  return state.comments.get(key);
}

async function loadCommentsForSearchScope() {
  const publications = activePublications().filter(({ account }) => !state.selectedAccountId || account.id === state.selectedAccountId);
  const unloaded = publications.filter(({ account, item }) => !state.comments.has(publicationKey(account.id, item.externalPublicationId)));
  if (!unloaded.length) return;
  state.searchLoading = true;
  render();
  try {
    for (let offset = 0; offset < unloaded.length; offset += 4) {
      await Promise.all(unloaded.slice(offset, offset + 4).map(({ account, item }) =>
        loadComments(account.id, item.externalPublicationId)));
    }
  } finally {
    state.searchLoading = false;
    render();
  }
}

async function loadWorkflowSummaries(comments) {
  const pending = comments.filter((comment) => !state.workflows.has(commentKey(comment.socialAccountId, comment.externalCommentId)));
  for (let offset = 0; offset < pending.length; offset += 5) {
    await Promise.all(pending.slice(offset, offset + 5).map(async (comment) => {
      const key = commentKey(comment.socialAccountId, comment.externalCommentId);
      state.workflowLoading.add(key);
      state.workflowErrors.delete(key);
      try {
        state.workflows.set(key, await api.getWorkflow(comment.socialAccountId, comment.externalCommentId));
      } catch (error) {
        state.workflowErrors.set(key, messageFor(error));
      } finally {
        state.workflowLoading.delete(key);
      }
    }));
  }
}

async function loadWorkflow(accountId, externalCommentId) {
  const key = commentKey(accountId, externalCommentId);
  state.workflowLoading.add(key);
  state.workflowErrors.delete(key);
  render();
  try {
    state.workflows.set(key, await api.getWorkflow(accountId, externalCommentId));
    return state.workflows.get(key);
  } catch (error) {
    state.workflowErrors.set(key, messageFor(error));
    showToast(messageFor(error), { error: true });
    return [];
  } finally {
    state.workflowLoading.delete(key);
    render();
  }
}

async function refreshWorkflowQuietly(accountId, externalCommentId) {
  const key = commentKey(accountId, externalCommentId);
  try {
    state.workflows.set(key, await api.getWorkflow(accountId, externalCommentId));
    state.workflowErrors.delete(key);
  } catch (error) {
    state.workflowErrors.set(key, messageFor(error));
  }
}

async function loadToneProfile(accountId, { force = false } = {}) {
  if (state.toneScope === 'global' && !force && state.toneGlobalLoaded) {
    syncToneControls();
    return;
  }
  state.toneAccountId = accountId;
  state.toneProfile = { ...toneDefaults };
  state.toneSource = null;
  if (state.toneScope === 'account' && !accountId) {
    syncToneControls();
    return;
  }
  const scope = state.toneScope;
  syncToneControls(t('tone.loading'));
  try {
    const view = scope === 'global'
      ? await api.getGlobalToneProfile()
      : await api.getToneProfileView(accountId);
    if (state.toneScope !== scope || (scope === 'account' && state.selectedAccountId !== accountId)) return;
    state.toneProfile = view?.profile ?? { ...toneDefaults };
    state.toneSource = view?.source ?? 'DEFAULT';
    if (scope === 'global') state.toneGlobalLoaded = true;
    syncToneControls();
  } catch (error) {
    if (state.toneScope !== scope || (scope === 'account' && state.selectedAccountId !== accountId)) return;
    syncToneControls(t('tone.loadFailed', { message: messageFor(error) }));
  }
}

function setToneScope(scope) {
  if (scope !== 'account' && scope !== 'global') return;
  if (state.toneScope === scope) return;
  state.toneScope = scope;
  void loadToneProfile(state.selectedAccountId, { force: true });
}

function defaultToneStatus() {
  if (state.toneScope === 'global') {
    return t(state.toneSource === 'TENANT' ? 'tone.globalLoaded' : 'tone.globalDefault');
  }
  if (!state.toneAccountId) return t('tone.noAccount');
  if (state.toneSource === 'TENANT') return t('tone.inheritedStatus');
  return t(state.toneSource === 'DEFAULT' ? 'tone.defaultStatus' : 'tone.loadedStatus');
}

function syncToneControls(status) {
  const globalScope = state.toneScope === 'global';
  const available = globalScope || Boolean(state.selectedAccountId);
  $('#saveToneProfile').disabled = !available || state.busy.has('tone-save');
  $('#toneSettingsToggle').disabled = false;
  const toneHeading = $('#toneHeading');
  const toneDescription = $('#toneDescription');
  toneHeading.dataset.i18n = globalScope ? 'tone.headingGlobal' : 'tone.heading';
  toneDescription.dataset.i18n = globalScope ? 'tone.descriptionGlobal' : 'tone.description';
  toneHeading.textContent = t(toneHeading.dataset.i18n);
  toneDescription.textContent = t(toneDescription.dataset.i18n);
  document.querySelectorAll('[data-tone-scope]').forEach((button) => {
    const active = button.dataset.toneScope === state.toneScope;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#tonePrimary').value = state.toneProfile.primaryTone ?? toneDefaults.primaryTone;
  $('#toneNote').value = state.toneProfile.customNote ?? '';
  $('#toneNoteCount').textContent = `${$('#toneNote').value.length}/500`;
  const selected = new Set(state.toneProfile.modifiers ?? []);
  document.querySelectorAll('[data-tone-modifier]').forEach((input) => {
    input.checked = selected.has(input.dataset.toneModifier);
    input.disabled = !input.checked && selected.size >= 2;
  });
  $('#toneProfileStatus').textContent = status ?? defaultToneStatus();
}

function emptyVerifiedScheduleDraft() {
  return { enabled: false, daysOfWeek: [], localTime: '', timeZone: 'America/Sao_Paulo' };
}

function verifiedScheduleDraft(schedule) {
  return schedule
    ? {
      enabled: schedule.enabled,
      daysOfWeek: [...schedule.daysOfWeek],
      localTime: schedule.localTime,
      timeZone: schedule.timeZone,
    }
    : emptyVerifiedScheduleDraft();
}

function isValidVerifiedScheduleDraft(draft) {
  if (!draft || typeof draft.enabled !== 'boolean'
    || !Array.isArray(draft.daysOfWeek)
    || draft.daysOfWeek.some((day) => !verifiedScheduleDays.includes(day))
    || new Set(draft.daysOfWeek).size !== draft.daysOfWeek.length
    || (draft.enabled && draft.daysOfWeek.length === 0)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.localTime)) {
    return false;
  }
  try {
    return typeof draft.timeZone === 'string'
      && draft.timeZone.length > 0
      && draft.timeZone.trim() === draft.timeZone
      && Boolean(new Intl.DateTimeFormat('en-US', { timeZone: draft.timeZone }).format(0));
  } catch {
    return false;
  }
}

function canSaveVerifiedSchedule() {
  return (state.verifiedSchedule.scope === 'GLOBAL' || Boolean(state.selectedAccountId))
    && !state.verifiedSchedule.loading
    && !state.verifiedSchedule.saving
    && state.verifiedSchedule.error?.kind !== 'load';
}

function updateVerifiedScheduleDraftFromPanel(panel) {
  const daysOfWeek = [...panel.querySelectorAll('[data-day-of-week]:checked')]
    .map((input) => input.dataset.dayOfWeek);
  state.verifiedSchedule.draft = {
    enabled: panel.querySelector('[data-role="verified-schedule-enabled"]').checked,
    daysOfWeek,
    localTime: panel.querySelector('#verifiedScheduleLocalTime').value,
    timeZone: panel.querySelector('#verifiedScheduleTimeZone').value,
  };
  state.verifiedSchedule.dirty = true;
  state.verifiedSchedule.error = null;
  const status = panel.querySelector('.verified-schedule-status');
  if (status) {
    status.classList.remove('has-error');
    status.textContent = t(state.verifiedSchedule.schedule ? 'schedule.unsavedWithSaved' : 'schedule.unsaved');
  }
  const saveButton = panel.querySelector('[data-role="verified-schedule-save"]');
  if (saveButton) saveButton.disabled = !canSaveVerifiedSchedule();
}

function setVerifiedScheduleScope(scope) {
  if (scope !== 'ACCOUNT' && scope !== 'GLOBAL') return;
  if (state.verifiedSchedule.scope === scope) return;
  state.verifiedSchedule.scope = scope;
  void loadVerifiedReleaseSchedule(state.selectedAccountId, { force: true });
}

async function loadVerifiedReleaseSchedule(accountId, { force = false } = {}) {
  const scope = state.verifiedSchedule.scope;
  if (scope === 'GLOBAL' && !force && state.verifiedSchedule.source !== null) return;
  if (scope === 'ACCOUNT' && accountId && accountId === state.verifiedSchedule.accountId
    && state.verifiedSchedule.dirty && !force) return;
  const open = state.verifiedSchedule.open;
  state.verifiedSchedule = {
    scope,
    accountId,
    schedule: null,
    source: null,
    draft: emptyVerifiedScheduleDraft(),
    open,
    loading: scope === 'GLOBAL' || Boolean(accountId),
    saving: false,
    dirty: false,
    error: null,
  };
  render();
  if (scope === 'ACCOUNT' && !accountId) return;

  const isStale = () => state.verifiedSchedule.scope !== scope
    || (scope === 'ACCOUNT' && (state.selectedAccountId !== accountId || state.verifiedSchedule.accountId !== accountId));
  try {
    const view = scope === 'GLOBAL'
      ? await api.getGlobalVerifiedReleaseSchedule()
      : await api.getVerifiedReleaseScheduleView(accountId);
    if (isStale()) return;
    state.verifiedSchedule.schedule = view?.schedule ?? null;
    state.verifiedSchedule.source = view?.source ?? 'UNCONFIGURED';
    state.verifiedSchedule.draft = verifiedScheduleDraft(view?.schedule ?? null);
    state.verifiedSchedule.loading = false;
  } catch (error) {
    if (isStale()) return;
    state.verifiedSchedule.loading = false;
    state.verifiedSchedule.error = { kind: 'load', code: error?.code ?? 'VERIFIED_RELEASE_SCHEDULE_FAILED' };
  }
  render();
}

async function saveVerifiedReleaseSchedule(event) {
  event.preventDefault();
  const globalScope = state.verifiedSchedule.scope === 'GLOBAL';
  const accountId = state.selectedAccountId;
  const panel = $('#verifiedReleaseSchedulePanel');
  updateVerifiedScheduleDraftFromPanel(panel);
  if ((!globalScope && !accountId) || !canSaveVerifiedSchedule()) return;
  if (!isValidVerifiedScheduleDraft(state.verifiedSchedule.draft)) {
    state.verifiedSchedule.error = { kind: 'validation', key: 'schedule.invalid' };
    render();
    return;
  }

  const config = {
    enabled: state.verifiedSchedule.draft.enabled,
    daysOfWeek: [...state.verifiedSchedule.draft.daysOfWeek],
    localTime: state.verifiedSchedule.draft.localTime,
    timeZone: state.verifiedSchedule.draft.timeZone,
  };
  state.verifiedSchedule.saving = true;
  state.verifiedSchedule.error = null;
  render();
  try {
    const savedView = globalScope
      ? await api.saveGlobalVerifiedReleaseSchedule(config)
      : await api.saveVerifiedReleaseSchedule(accountId, config);
    const saved = savedView?.schedule ?? savedView;
    if (state.verifiedSchedule.scope !== (globalScope ? 'GLOBAL' : 'ACCOUNT')
      || (!globalScope && (state.selectedAccountId !== accountId || state.verifiedSchedule.accountId !== accountId))) return;
    state.verifiedSchedule.schedule = saved;
    state.verifiedSchedule.source = globalScope ? 'TENANT' : 'ACCOUNT';
    state.verifiedSchedule.draft = verifiedScheduleDraft(saved);
    state.verifiedSchedule.dirty = false;
    state.verifiedSchedule.open = false;
    showToast(t(globalScope ? 'schedule.globalSavedToast' : 'schedule.savedToast'));
  } catch (error) {
    if (state.verifiedSchedule.scope !== (globalScope ? 'GLOBAL' : 'ACCOUNT')
      || (!globalScope && (state.selectedAccountId !== accountId || state.verifiedSchedule.accountId !== accountId))) return;
    state.verifiedSchedule.error = { kind: 'save', code: error?.code ?? 'VERIFIED_RELEASE_SCHEDULE_FAILED' };
  } finally {
    if (globalScope || state.verifiedSchedule.accountId === accountId) {
      state.verifiedSchedule.saving = false;
      render();
    }
  }
}

function latestAnalysisEvent(events = []) {
  return [...events].reverse().find((event) => event.eventType === 'COMMENT_ANALYSIS_CREATED') ?? null;
}

function responseFor(accountId, externalCommentId) {
  const key = commentKey(accountId, externalCommentId);
  return responseVersionDetails(state.workflows.get(key) ?? [], state.language);
}

function draftFor(accountId, externalCommentId, textarea) {
  const key = commentKey(accountId, externalCommentId);
  return state.drafts.has(key) ? state.drafts.get(key) : textarea?.value ?? '';
}

async function saveResponse(accountId, externalCommentId, text) {
  const key = commentKey(accountId, externalCommentId);
  const normalized = text.trim();
  if (!normalized) throw new Error(t('toast.emptyResponse'));
  const response = responseFor(accountId, externalCommentId);
  if (response?.version.payload.text?.trim() === normalized) return response.version;

  state.busy.add(`save:${key}`);
  render();
  try {
    const saved = !response
      ? await api.saveManualResponse(accountId, externalCommentId, normalized)
      : response.kind === 'suggestion'
        ? await api.reviseSuggestion(accountId, externalCommentId, response.rootId, {
          text: normalized,
          ...(response.isRevision ? { previousRevisionId: response.version.id } : {}),
        })
        : await api.reviseManualResponse(accountId, externalCommentId, response.rootId, {
          text: normalized,
          ...(response.isRevision ? { previousRevisionId: response.version.id } : {}),
        });
    state.drafts.delete(key);
    state.workflows.set(key, await api.getWorkflow(accountId, externalCommentId));
    return saved;
  } finally {
    state.busy.delete(`save:${key}`);
    render();
  }
}

async function classifyComment(accountId, externalCommentId) {
  const key = commentKey(accountId, externalCommentId);
  state.busy.add(`classify:${key}`);
  render();
  try {
    await api.classify(accountId, externalCommentId);
    state.workflows.set(key, await api.getWorkflow(accountId, externalCommentId));
    void loadCommentSummary();
    showToast(t('toast.analysisComplete'));
  } catch (error) {
    await refreshWorkflowQuietly(accountId, externalCommentId);
    showToast(messageFor(error), { error: true });
  } finally {
    state.busy.delete(`classify:${key}`);
    render();
  }
}

async function generateResponse(accountId, externalCommentId) {
  const key = commentKey(accountId, externalCommentId);
  const events = state.workflows.get(key) ?? [];
  const analysisEvent = latestAnalysisEvent(events);
  if (!analysisEvent) {
    showToast(t('error.analysisRequired'), { error: true });
    return;
  }
  const response = responseFor(accountId, externalCommentId);
  const draft = state.drafts.get(key);
  if (draft && draft.trim() && draft.trim() !== response?.version.payload.text?.trim()
    && !window.confirm(t('toast.replaceDraft'))) return;

  state.busy.add(`generate:${key}`);
  render();
  try {
    const generation = await api.generateResponse(accountId, externalCommentId, {
      analysisEventId: analysisEvent.id,
    });
    state.drafts.delete(key);
    state.workflows.set(key, await api.getWorkflow(accountId, externalCommentId));
    showToast(generation.failures?.length
      ? t('toast.suggestionPartial', { count: generation.variants?.length ?? 0, languages: generation.failures.map(({ language }) => language).join(', ') })
      : t('toast.suggestionComplete'));
  } catch (error) {
    await refreshWorkflowQuietly(accountId, externalCommentId);
    showToast(messageFor(error), { error: true });
  } finally {
    state.busy.delete(`generate:${key}`);
    render();
  }
}

async function evaluateResponse(accountId, externalCommentId) {
  const key = commentKey(accountId, externalCommentId);
  let response = responseFor(accountId, externalCommentId);
  const draft = state.drafts.get(key);
  const textarea = document.querySelector(`.reply-box[data-account-id="${CSS.escape(accountId)}"][data-comment-id="${CSS.escape(externalCommentId)}"]`);
  const text = draft ?? textarea?.value ?? '';
  if (!text.trim()) {
    showToast(t('toast.emptyEvaluation'), { error: true });
    return;
  }

  state.busy.add(`evaluate:${key}`);
  render();
  try {
    if (!response || text.trim() !== response.version.payload.text?.trim()) {
      await saveResponse(accountId, externalCommentId, text);
      response = responseFor(accountId, externalCommentId);
    }
    if (!response) throw new Error(t('toast.noSavedVersion'));
    await api.evaluateResponse(accountId, externalCommentId, response.version.id);
    state.workflows.set(key, await api.getWorkflow(accountId, externalCommentId));
    showToast(t('toast.responseEvaluationComplete'));
  } catch (error) {
    await refreshWorkflowQuietly(accountId, externalCommentId);
    showToast(messageFor(error), { error: true });
  } finally {
    state.busy.delete(`evaluate:${key}`);
    render();
  }
}

async function sendResponse(accountId, externalCommentId) {
  const key = commentKey(accountId, externalCommentId);
  const textarea = document.querySelector(`.reply-box[data-account-id="${CSS.escape(accountId)}"][data-comment-id="${CSS.escape(externalCommentId)}"]`);
  const text = state.drafts.get(key) ?? textarea?.value ?? '';
  if (!text.trim()) {
    showToast(t('toast.emptyResponseAction'), { error: true });
    return;
  }
  if (!window.confirm(t('toast.confirmSend', { response: text.trim() }))) return;

  state.busy.add(`send:${key}`);
  render();
  try {
    await saveResponse(accountId, externalCommentId, text);
    const latest = latestResponseVersion(state.workflows.get(key) ?? [], state.language);
    if (!latest) throw new Error(t('toast.saveBeforeSend'));
    await api.sendResponse(accountId, externalCommentId, latest.id);
    state.workflows.set(key, await api.getWorkflow(accountId, externalCommentId));
    const publication = findPublication(accountId, externalCommentId);
    if (publication) await loadComments(accountId, publication.externalPublicationId, { force: true });
    await loadCommentSummary();
    showToast(t('toast.sendRecorded'));
  } catch (error) {
    await refreshWorkflowQuietly(accountId, externalCommentId);
    showToast(messageFor(error), { error: true });
  } finally {
    state.busy.delete(`send:${key}`);
    render();
  }
}

function updateCommentLikeState(accountId, externalCommentId, appLiked) {
  for (const [key, page] of state.comments) {
    if (!page.items?.some((comment) => (
      comment.socialAccountId === accountId && comment.externalCommentId === externalCommentId
    ))) continue;
    state.comments.set(key, {
      ...page,
      items: page.items.map((comment) => (
        comment.socialAccountId === accountId && comment.externalCommentId === externalCommentId
          ? { ...comment, appLiked }
          : comment
      )),
    });
  }
}

async function toggleCommentLike(accountId, externalCommentId) {
  const key = commentKey(accountId, externalCommentId);
  const comment = findComment(accountId, externalCommentId);
  if (!comment?.canLike || state.busy.has(`like:${key}`)) return;

  const action = comment.appLiked ? 'UNLIKE' : 'LIKE';
  state.busy.add(`like:${key}`);
  render();
  try {
    const result = await api.setCommentLike(accountId, externalCommentId, action);
    updateCommentLikeState(accountId, externalCommentId, result.appLiked);
    if (state.workflows.has(key)) {
      state.workflows.set(key, await api.getWorkflow(accountId, externalCommentId));
    }
    showToast(t(result.appLiked ? 'toast.commentLiked' : 'toast.commentUnliked'));
  } catch (error) {
    await refreshWorkflowQuietly(accountId, externalCommentId);
    showToast(messageFor(error), { error: true });
  } finally {
    state.busy.delete(`like:${key}`);
    render();
  }
}

function findPublication(accountId, externalCommentId) {
  for (const [key, commentPage] of state.comments) {
    const comment = commentPage.items?.find((item) => item.socialAccountId === accountId && item.externalCommentId === externalCommentId);
    if (!comment) continue;
    const [storedAccountId, publicationId] = key.split('\u0000');
    return { accountId: storedAccountId, externalPublicationId: publicationId };
  }
  return null;
}

function findComment(accountId, externalCommentId) {
  for (const commentPage of state.comments.values()) {
    const comment = commentPage.items?.find((item) => item.socialAccountId === accountId && item.externalCommentId === externalCommentId);
    if (comment) return comment;
  }
  return null;
}

function updateDraftButtons(textarea) {
  const accountId = textarea.dataset.accountId;
  const externalCommentId = textarea.dataset.commentId;
  const key = commentKey(accountId, externalCommentId);
  const detail = textarea.closest('.comment-detail');
  const response = responseFor(accountId, externalCommentId);
  const comment = findComment(accountId, externalCommentId);
  const events = state.workflows.get(key) ?? [];
  const currentText = textarea.value.trim();
  state.drafts.set(key, textarea.value);
  const saveButton = detail.querySelector('[data-action="save-response"]');
  const sendButton = detail.querySelector('[data-action="send-response"]');
  const attemptRecorded = response ? events.some((event) => event.eventType === 'MANUAL_REPLY_ATTEMPTED'
    && (event.parentEventId === response.version.id || event.payload.revisionEventId === response.version.id || event.payload.responseVersionEventId === response.version.id)) : false;
  saveButton.disabled = !currentText || currentText === (response?.version.payload.text ?? '').trim() || state.busy.has(`save:${key}`);
  sendButton.disabled = !currentText || !comment?.canReply || attemptRecorded || state.busy.has(`send:${key}`);
}

async function syncPublication(accountId, publicationId, cursor, { showFeedback = true, refreshSummary = true } = {}) {
  const key = publicationKey(accountId, publicationId);
  if (showFeedback) state.pageSyncFeedback = null;
  const previous = state.comments.get(key) ?? { items: [] };
  state.comments.set(key, { ...previous, syncing: true, syncErrorCode: null, loadErrorCode: null });
  render();
  try {
    const page = await api.syncComments(accountId, publicationId, cursor);
    state.comments.set(key, {
      ...state.comments.get(key),
      syncing: false,
      syncErrorCode: null,
      loadErrorCode: null,
      nextSyncCursor: page.nextCursor,
      lastSyncAt: page.synchronizedAt,
    });
    const loaded = await loadComments(accountId, publicationId, { force: true });
    if (refreshSummary) await loadCommentSummary();
    if (showFeedback) {
      showToast(t('toast.syncPublication', { count: formatNumber(loaded?.items?.length ?? 0) }));
    }
    return { success: true, commentsSynced: loaded?.items?.length ?? 0 };
  } catch (error) {
    const errorCode = error?.code ?? 'SOCIAL_COMMENT_SYNC_FAILED';
    const platform = state.accountResults.get(accountId)?.account.platform ?? state.activeNetwork;
    state.comments.set(key, { ...state.comments.get(key), syncing: false, syncErrorCode: errorCode });
    const message = socialSyncFailureMessage(platform, errorCode);
    if (showFeedback) showToast(message, { error: true });
    return { success: false, errorCode };
  } finally {
    render();
  }
}

function visiblePagePublications() {
  const publications = activePublications().filter(({ account }) => (
    !state.selectedAccountId || account.id === state.selectedAccountId
  ));
  return visiblePublicationModel(publications).visible;
}

async function syncCurrentPublicationPage() {
  if (state.searchLoading || state.loadingPublications || state.publicationLoadingAccounts.size > 0) return;
  const publications = visiblePagePublications();
  if (!publications.length) {
    state.pageSyncFeedback = t('toolbar.syncPageEmpty');
    render();
    return;
  }
  state.busy.add('page-sync');
  state.pageSyncFeedback = null;
  state.pageSyncProgress = { completed: 0, total: publications.length, currentName: '' };
  render();
  try {
    const results = await syncPublicationPage(
      publications,
      ({ account, item }) => syncPublication(account.id, item.externalPublicationId, undefined, { showFeedback: false, refreshSummary: false }),
      ({ completed, total, current }) => {
        state.pageSyncProgress = {
          completed,
          total,
          currentName: current
            ? `${current.item.title || current.item.externalPublicationId} · ${current.account.displayName || current.account.externalAccountId}`
            : '',
        };
        render();
      },
    );
    const success = results.filter(({ result }) => result?.success).length;
    const failures = results.length - success;
    await loadCommentSummary();
    state.pageSyncFeedback = t('toolbar.syncPageComplete', {
      success: formatNumber(success),
      failures: formatNumber(failures),
    });
    showToast(state.pageSyncFeedback, { error: failures > 0 && success === 0 });
  } catch (error) {
    showToast(messageFor(error), { error: true });
  } finally {
    state.busy.delete('page-sync');
    state.pageSyncProgress = null;
    render();
  }
}

async function openBulkReply(accountId, publicationId) {
  if (state.busy.has('page-sync') || state.searchLoading || state.loadingPublications || state.publicationLoadingAccounts.size > 0) return;
  const publication = activePublications().find(({ account, item }) => (
    account.id === accountId && item.externalPublicationId === publicationId
  ));
  if (!publication) return;

  bulkReplyReturnFocus = document.activeElement;
  const { account, item } = publication;
  state.bulkReply = {
    open: true,
    busy: true,
    accountId,
    publicationId,
    videoTitle: item.title || t('publication.untitled'),
    accountName: account.displayName || account.externalAccountId,
    status: 'syncing',
    rows: [],
    selectedIds: new Set(),
    progress: null,
    syncWarning: false,
    errorCode: null,
    toneProfile: null,
  };
  render();
  focusBulkDialog();

  try {
    const loaded = await loadSemiAutomaticReplyComments(api, accountId, publicationId);
    state.comments.set(publicationKey(accountId, publicationId), {
      items: loaded.allComments,
      loading: false,
      syncing: false,
      nextSyncCursor: undefined,
      lastSyncAt: new Date().toISOString(),
      syncErrorCode: null,
      loadErrorCode: null,
    });
    const toneProfile = await api.getToneProfile(accountId);
    void loadCommentSummary();
    state.bulkReply.toneProfile = copyToneProfile(toneProfile);
    state.bulkReply.syncWarning = loaded.syncResult.status !== 'SUCCEEDED';
    state.bulkReply.rows = loaded.comments.map((comment) => ({
      comment,
      status: 'pending',
      language: state.language,
      toneProfile: copyToneProfile(toneProfile),
      events: [],
      failures: [],
      drafts: new Map(),
      draft: '',
      errorCode: null,
      approved: false,
    }));
    state.bulkReply.status = 'ready';
    state.bulkReply.busy = false;
  } catch (error) {
    state.bulkReply.status = 'error';
    state.bulkReply.errorCode = error?.code ?? 'COMMENT_WORKFLOW_BATCH_FAILED';
    state.bulkReply.busy = false;
  }
  render();
  focusBulkDialog();
}

function focusBulkDialog() {
  const closeButton = $('#bulkReplyDialog .bulk-dialog-close');
  if (closeButton && !closeButton.disabled) closeButton.focus({ preventScroll: true });
  else $('#bulkReplyDialog .bulk-reply-dialog')?.focus({ preventScroll: true });
}

function captureBulkDialogFocus(dialog) {
  const active = document.activeElement;
  if (!dialog.contains(active)) return null;
  return {
    id: active.id || null,
    role: active.dataset?.role ?? null,
    action: active.dataset?.action ?? null,
    commentId: active.dataset?.commentId
      ?? active.closest?.('.bulk-reply-row')?.dataset?.commentId
      ?? null,
    selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
  };
}

function restoreBulkDialogFocus(dialog, focus) {
  if (!focus || dialog.hidden) return;
  const commentSelector = focus.commentId
    ? `[data-comment-id="${CSS.escape(focus.commentId)}"]`
    : '';
  const selector = focus.id
    ? `#${CSS.escape(focus.id)}`
    : focus.action
      ? `[data-action="${CSS.escape(focus.action)}"]${commentSelector}`
      : focus.role
        ? `[data-role="${CSS.escape(focus.role)}"]${commentSelector}`
        : '';
  let target = selector ? dialog.querySelector(selector) : null;
  if (target?.disabled) target = null;
  target ??= focus.commentId
    ? dialog.querySelector(`.bulk-reply-row[data-comment-id="${CSS.escape(focus.commentId)}"]`)
    : null;
  target ??= dialog.querySelector('.bulk-reply-dialog');
  target?.focus({ preventScroll: true });
  if (target && focus.selectionStart !== null && focus.selectionEnd !== null) {
    try {
      target.setSelectionRange(focus.selectionStart, focus.selectionEnd);
    } catch {
      // Some form controls do not support text selection.
    }
  }
}

function closeBulkReply() {
  const bulk = state.bulkReply;
  if (!bulk?.open || bulk.busy) return;
  if (hasUnsavedBulkEdits(bulk) && !window.confirm(t('bulkReplies.confirmCloseDirty'))) return;
  bulk.open = false;
  render();
  const selector = `button[data-action="bulk-reply"][data-account-id="${CSS.escape(bulk.accountId)}"][data-publication-id="${CSS.escape(bulk.publicationId)}"]`;
  const trigger = document.querySelector(selector);
  if (trigger) trigger.focus({ preventScroll: true });
  else bulkReplyReturnFocus?.focus({ preventScroll: true });
  bulkReplyReturnFocus = null;
}

function hasUnsavedBulkEdits(bulk) {
  return bulk.rows.some(hasUnsavedBulkRowEdits);
}

function hasUnsavedBulkRowEdits(row) {
  const languages = new Set([...(row.drafts?.keys() ?? []), row.language]);
  return [...languages].some((language) => {
    const response = responseVersionDetails(row.events ?? [], language);
    if (!response) return false;
    const draft = row.drafts?.has(language)
      ? row.drafts.get(language)
      : language === row.language
        ? row.draft
        : response.version.payload.text;
    return String(draft ?? '').trim() !== (response.version.payload.text ?? '').trim();
  });
}

async function generateBulkReplies() {
  const bulk = state.bulkReply;
  if (!bulk || bulk.status !== 'ready' || !bulk.rows.length || bulk.busy) return;
  bulk.status = 'processing';
  bulk.busy = true;
  bulk.progress = null;
  render();

  try {
    const generatedRows = await generateSemiAutomaticReplies(api, {
      accountId: bulk.accountId,
      comments: bulk.rows.map((row) => row.comment),
      toneProfile: bulk.toneProfile,
      toneProfileForComment: (comment) => findBulkRow(bulk, comment.externalCommentId)?.toneProfile ?? bulk.toneProfile,
      languageForComment: (comment) => findBulkRow(bulk, comment.externalCommentId)?.language ?? state.language,
      eventsForComment: (comment) => state.workflows.get(commentKey(bulk.accountId, comment.externalCommentId)),
      onProgress: (update) => {
        const current = findBulkRow(bulk, update.commentId);
        if (!current) return;
        Object.assign(current, update.row, {
          language: current.language,
          toneProfile: current.toneProfile,
          drafts: current.drafts,
          approved: current.approved,
        });
        current.drafts ??= new Map();
        const key = commentKey(bulk.accountId, update.commentId);
        state.workflows.set(key, update.row.events ?? []);
        bulk.progress = {
          current: update.index,
          total: update.total,
          commentName: current.comment.authorDisplayName || current.comment.externalCommentId,
        };
        scheduleBulkProgressRender(update.commentId);
      },
    });

    bulk.rows = generatedRows.map((row) => {
      const current = findBulkRow(bulk, row.comment.externalCommentId);
      const merged = {
        ...current,
        ...row,
        language: current?.language ?? row.language,
        toneProfile: current?.toneProfile ?? row.toneProfile,
        drafts: current?.drafts ?? new Map(),
        approved: false,
      };
      const response = responseVersionDetails(merged.events, merged.language);
      if (!response) {
        merged.language = ['pt-BR', 'en-US', 'es-ES'].find((language) => responseVersionDetails(merged.events, language)) ?? merged.language;
      }
      const latest = responseVersionDetails(merged.events, merged.language);
      merged.draft = merged.drafts.get(merged.language) ?? latest?.version.payload.text ?? '';
      return merged;
    });
    bulk.status = 'review';
    void loadCommentSummary();
  } catch (error) {
    showToast(messageFor(error), { error: true });
    bulk.status = 'review';
  } finally {
    bulk.busy = false;
    bulk.progress = null;
    render();
  }
}

function findBulkRow(bulk, externalCommentId) {
  return bulk?.rows.find((row) => row.comment.externalCommentId === externalCommentId) ?? null;
}

function copyToneProfile(profile) {
  return {
    primaryTone: profile?.primaryTone ?? toneDefaults.primaryTone,
    modifiers: [...(profile?.modifiers ?? toneDefaults.modifiers)],
    customNote: profile?.customNote ?? null,
  };
}

function canApproveBulkRow(row) {
  return ['ready', 'partial', 'approved'].includes(row.status)
    && Boolean(responseVersionDetails(row.events ?? [], row.language));
}

function updateBulkSelection(commentId, selected) {
  const bulk = state.bulkReply;
  const row = findBulkRow(bulk, commentId);
  if (!bulk || !row || !canApproveBulkRow(row) || row.approved) return;
  if (selected) bulk.selectedIds.add(commentId);
  else bulk.selectedIds.delete(commentId);
  render();
  focusBulkControl('bulk-selection', commentId);
}

function updateAllBulkSelection(selected) {
  const bulk = state.bulkReply;
  if (!bulk || bulk.busy) return;
  for (const row of bulk.rows) {
    if (!canApproveBulkRow(row) || row.approved) continue;
    if (selected) bulk.selectedIds.add(row.comment.externalCommentId);
    else bulk.selectedIds.delete(row.comment.externalCommentId);
  }
  render();
  focusBulkControl('bulk-select-all');
}

function updateBulkLanguage(commentId, language) {
  const row = findBulkRow(state.bulkReply, commentId);
  if (!row || row.approved) return;
  row.language = language;
  row.draft = row.drafts?.get(language) ?? responseVersionDetails(row.events ?? [], language)?.version.payload.text ?? '';
  render();
  focusBulkControl('bulk-response-language', commentId);
}

async function updateBulkTone(commentId, primaryTone) {
  const row = findBulkRow(state.bulkReply, commentId);
  if (!row || row.approved || row.toneProfile?.primaryTone === primaryTone) return;
  row.toneProfile = { ...copyToneProfile(row.toneProfile), primaryTone };
  render();
  focusBulkControl('bulk-response-tone', commentId);
  const response = responseVersionDetails(row.events ?? [], row.language);
  const generatedRoot = response?.rootId
    ? (row.events ?? []).find((event) => event.id === response.rootId)
    : null;
  const generatedTone = response?.version?.payload?.toneProfile?.primaryTone
    ?? generatedRoot?.payload?.toneProfile?.primaryTone
    ?? 'FRIENDLY';
  if (response && primaryTone !== generatedTone) {
    await regenerateBulkRow(commentId);
    focusBulkControl('bulk-response-tone', commentId);
  }
}

function focusBulkControl(role, commentId) {
  const commentSelector = commentId ? `[data-comment-id="${CSS.escape(commentId)}"]` : '';
  document.querySelector(`#bulkReplyDialog [data-role="${role}"]${commentSelector}`)?.focus({ preventScroll: true });
}

async function regenerateBulkRow(commentId) {
  const bulk = state.bulkReply;
  const row = findBulkRow(bulk, commentId);
  if (!bulk || !row || bulk.busy || !row.toneProfile) return;
  const previous = responseVersionDetails(row.events ?? [], row.language);
  if (hasUnsavedBulkRowEdits(row)
    && !window.confirm(t('bulkReplies.confirmRegenerate'))) return;
  if (!latestAnalysisEvent(row.events ?? [])) {
    showToast(t('error.analysisRequired'), { error: true });
    return;
  }

  bulk.busy = true;
  row.status = 'generating';
  render();
  try {
    const regenerated = await regenerateSemiAutomaticReply(api, {
      accountId: bulk.accountId,
      commentId,
      events: row.events ?? [],
      toneOverride: row.toneProfile.primaryTone,
    });
    row.events = regenerated.events;
    row.historyWarning = regenerated.historyWarning;
    row.failures = regenerated.failures;
    row.errorCode = row.failures[0]?.errorCode ?? null;
    row.status = regenerated.variants.length ? (row.failures.length ? 'partial' : 'ready') : 'failed';
    row.drafts?.clear();
    row.approved = false;
    if (!responseVersionDetails(row.events, row.language)) {
      row.language = ['pt-BR', 'en-US', 'es-ES'].find((language) => responseVersionDetails(row.events, language)) ?? row.language;
    }
    row.draft = responseVersionDetails(row.events, row.language)?.version.payload.text ?? '';
    state.workflows.set(commentKey(bulk.accountId, commentId), row.events);
  } catch (error) {
    row.status = previous ? 'ready' : 'failed';
    if (error?.code === 'COMMENT_ANALYSIS_NOT_FOUND') {
      row.errorCode = null;
      showToast(t('error.analysisRequired'), { error: true });
    } else {
      row.errorCode = error?.code ?? 'COMMENT_WORKFLOW_FAILED';
      await refreshWorkflowQuietly(bulk.accountId, commentId);
      row.events = state.workflows.get(commentKey(bulk.accountId, commentId)) ?? row.events;
    }
  } finally {
    bulk.busy = false;
    render();
  }
}

async function approveBulkReplies(commentIds) {
  const bulk = state.bulkReply;
  if (!bulk || bulk.status !== 'review' || bulk.busy) return;
  if (!commentIds.length) return;

  bulk.busy = true;
  render();
  let result = { approved: 0, failed: 0 };
  let failedUnexpectedly = false;
  try {
    result = await approveSemiAutomaticReplies(api, {
      accountId: bulk.accountId,
      rows: bulk.rows,
      commentIds,
      onProgress: ({ phase, row }) => {
        const key = commentKey(bulk.accountId, row.comment.externalCommentId);
        state.workflows.set(key, row.events ?? []);
        if (row.approved) bulk.selectedIds.delete(row.comment.externalCommentId);
        scheduleBulkProgressRender(row.comment.externalCommentId);
      },
    });
  } catch (error) {
    failedUnexpectedly = true;
    showToast(messageFor(error), { error: true });
  } finally {
    bulk.busy = false;
    render();
  }
  if (failedUnexpectedly) return;
  showToast(result.failed
    ? t('bulkReplies.approvalPartial', { approved: formatNumber(result.approved), failed: formatNumber(result.failed) })
    : t('bulkReplies.approvalComplete', { count: formatNumber(result.approved) }), { error: result.failed > 0 && result.approved === 0 });
}

async function sendAllApprovedBulkReplies() {
  const bulk = state.bulkReply;
  if (!bulk || bulk.status !== 'review' || bulk.busy) return;
  const sendableRows = eligibleSemiAutomaticReplyRows(bulk.rows);
  if (!sendableRows.length) return;
  if (!window.confirm(t('bulkReplies.confirmSendAll', { count: formatNumber(sendableRows.length) }))) return;

  bulk.status = 'sending';
  bulk.busy = true;
  bulk.progress = null;
  render();

  let result;
  let failedUnexpectedly = false;
  try {
    result = await sendApprovedSemiAutomaticReplies(api, {
      accountId: bulk.accountId,
      rows: bulk.rows,
      onProgress: ({ index, total, row }) => {
        const key = commentKey(bulk.accountId, row.comment.externalCommentId);
        state.workflows.set(key, row.events ?? []);
        bulk.progress = {
          current: index,
          total,
          commentName: row.comment.authorDisplayName || row.comment.externalCommentId,
        };
        scheduleBulkProgressRender(row.comment.externalCommentId);
      },
    });
  } catch (error) {
    failedUnexpectedly = true;
    showToast(messageFor(error), { error: true });
  } finally {
    bulk.status = 'review';
    bulk.busy = false;
    bulk.progress = null;
    render();
  }

  if (failedUnexpectedly) return;
  if (result.sent > 0) await loadCommentSummary();
  if (result.stoppedByRateLimit) {
    showToast(t('bulkReplies.sendPaused', {
      sent: formatNumber(result.sent),
      failed: formatNumber(result.failed),
      remaining: formatNumber(result.remaining),
    }), { error: true });
  } else if (result.failed) {
    showToast(t('bulkReplies.sendPartial', {
      sent: formatNumber(result.sent),
      failed: formatNumber(result.failed),
    }), { error: result.sent === 0 });
  } else {
    showToast(t('bulkReplies.sendComplete', { count: formatNumber(result.sent) }));
  }
}

async function handleBulkReplyAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, commentId } = button.dataset;
  if (action === 'close-bulk-reply') {
    closeBulkReply();
  } else if (action === 'generate-bulk-replies') {
    await generateBulkReplies();
  } else if (action === 'approve-bulk-row') {
    await approveBulkReplies([commentId]);
  } else if (action === 'approve-selected') {
    await approveBulkReplies([...state.bulkReply.selectedIds]);
  } else if (action === 'approve-all') {
    await approveBulkReplies(state.bulkReply.rows.filter((row) => !row.approved && canApproveBulkRow(row)).map((row) => row.comment.externalCommentId));
  } else if (action === 'send-all-approved') {
    await sendAllApprovedBulkReplies();
  } else if (action === 'regenerate-bulk-row') {
    await regenerateBulkRow(commentId);
  }
}

function clearPublicationPageData() {
  state.accountResults.clear();
  state.publications.clear();
  state.publicationCursors.clear();
  state.publicationCursorHistory.clear();
  state.publicationPageIndexes.clear();
  state.comments.clear();
  state.workflows.clear();
  state.workflowErrors.clear();
  state.workflowLoading.clear();
  state.expandedPublications.clear();
  state.expandedComments.clear();
}

async function changePublicationPageSize(value) {
  if (!isPublicationPageSize(value)) {
    $('#publicationPageSize').value = String(state.publicationPageSize);
    return;
  }
  const pageSize = Number(value);
  if (pageSize === state.publicationPageSize) return;
  if (state.busy.has('page-sync') || state.searchLoading || state.loadingPublications || state.publicationLoadingAccounts.size > 0) {
    $('#publicationPageSize').value = String(state.publicationPageSize);
    return;
  }
  state.publicationPageSize = pageSize;
  state.pageSyncFeedback = null;
  state.publicationsError = null;
  clearPublicationPageData();
  render();
  await refreshPublications();
}

async function saveToneProfile() {
  const globalScope = state.toneScope === 'global';
  const accountId = state.selectedAccountId;
  if (!globalScope && !accountId) return;
  const modifiers = [...document.querySelectorAll('[data-tone-modifier]:checked')].map((input) => input.dataset.toneModifier);
  if (modifiers.length > 2) {
    showToast(t('toast.modifierLimit'), { error: true });
    return;
  }
  const profile = {
    primaryTone: $('#tonePrimary').value,
    modifiers,
    customNote: $('#toneNote').value.trim() || null,
  };
  state.busy.add('tone-save');
  syncToneControls(t('tone.saving'));
  try {
    const savedView = globalScope
      ? await api.saveGlobalToneProfile(profile)
      : await api.saveToneProfile(accountId, profile);
    state.toneProfile = savedView?.profile ?? savedView;
    state.toneSource = globalScope ? 'TENANT' : 'ACCOUNT';
    $('#toneSettings').hidden = true;
    $('#toneSettingsToggle').setAttribute('aria-expanded', 'false');
    syncToneControls(t(globalScope ? 'tone.savedGlobal' : 'tone.saved'));
    showToast(t('tone.savedToast'));
  } catch (error) {
    syncToneControls(t('tone.saveFailed', { message: messageFor(error) }));
    showToast(messageFor(error), { error: true });
  } finally {
    state.busy.delete('tone-save');
    syncToneControls($('#toneProfileStatus').textContent);
  }
}

async function connectSocialNetwork(platform, enableReplies = false) {
  state.connectingNetworks.add(platform);
  state.connectionsError = null;
  render();
  try {
    const result = await openOAuthPopup(platform, { enableReplies });
    if (result.type === 'facebook-pages') {
      state.facebookSelection = result;
      state.selectedFacebookPageId = result.pages[0]?.pageId ?? null;
      showToast(t('settings.facebookPagesReady'));
      return;
    }
    await loadConnectedAccounts();
    showToast(t('settings.oauthConnected'));
  } catch (error) {
    showToast(messageFor(error), { error: true });
  } finally {
    state.connectingNetworks.delete(platform);
    render();
  }
}

function removeDisconnectedAccountState(accountId) {
  const prefix = `${accountId}\u0000`;
  state.accountResults.delete(accountId);
  state.publications.delete(accountId);
  state.publicationCursors.delete(accountId);
  for (const cache of [state.comments, state.workflows, state.workflowErrors, state.drafts]) {
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  }
  for (const cache of [state.expandedPublications, state.expandedComments, state.workflowLoading]) {
    for (const key of cache) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  }
  if (state.selectedAccountId === accountId) {
    state.selectedAccountId = null;
    state.toneAccountId = null;
    if (state.toneScope === 'account') {
      state.toneProfile = { ...toneDefaults };
      state.toneSource = null;
    }
    if (state.verifiedSchedule.scope !== 'GLOBAL') {
      state.verifiedSchedule = {
        scope: 'ACCOUNT',
        accountId: null,
        schedule: null,
        source: null,
        draft: emptyVerifiedScheduleDraft(),
        open: state.verifiedSchedule.open,
        loading: false,
        saving: false,
        dirty: false,
        error: null,
      };
    }
    syncToneControls();
  }
}

async function disconnectSocialAccount(accountId) {
  const account = state.connectedAccounts.find((item) => item.id === accountId);
  if (!account || state.disconnectingAccounts.has(accountId)) return;
  const name = account.displayName || account.externalAccountId;
  if (!window.confirm(t('settings.disconnectConfirm', { name }))) return;

  state.disconnectingAccounts.add(accountId);
  render();
  try {
    await api.disconnectAccount(accountId);
    state.connectedAccounts = state.connectedAccounts.filter((item) => item.id !== accountId);
    removeDisconnectedAccountState(accountId);
    showToast(t('settings.disconnectSuccess'));
  } catch (error) {
    showToast(messageFor(error), { error: true });
  } finally {
    state.disconnectingAccounts.delete(accountId);
    render();
  }
}

async function selectFacebookPage() {
  const selection = state.facebookSelection;
  const pageId = state.selectedFacebookPageId;
  if (!selection || !pageId) return;
  state.connectingNetworks.add('facebook-select');
  render();
  try {
    await api.selectFacebookPage(selection.selectionId, pageId);
    state.facebookSelection = null;
    state.selectedFacebookPageId = null;
    await loadConnectedAccounts();
    showToast(t('settings.oauthConnected'));
  } catch (error) {
    showToast(messageFor(error), { error: true });
  } finally {
    state.connectingNetworks.delete('facebook-select');
    render();
  }
}

async function handleContentAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, accountId, publicationId, commentId } = button.dataset;
  if (action === 'bulk-reply') {
    await openBulkReply(accountId, publicationId);
    return;
  }
  if (action === 'toggle-publication') {
    const key = publicationKey(accountId, publicationId);
    if (state.expandedPublications.has(key)) {
      state.expandedPublications.delete(key);
      render();
    } else {
      state.expandedPublications.add(key);
      render();
      await loadComments(accountId, publicationId);
    }
    return;
  }
  if (action === 'toggle-comment') {
    const key = commentKey(accountId, commentId);
    if (state.expandedComments.has(key)) state.expandedComments.delete(key);
    else state.expandedComments.add(key);
    render();
    if (state.expandedComments.has(key) && !state.workflows.has(key)) await loadWorkflow(accountId, commentId);
    return;
  }
  if (action === 'sync-publication') {
    await syncPublication(accountId, publicationId);
    return;
  }
  if (action === 'sync-publication-next') {
    const cursor = state.comments.get(publicationKey(accountId, publicationId))?.nextSyncCursor;
    if (cursor) await syncPublication(accountId, publicationId, cursor);
    return;
  }
  if (action === 'publication-page') {
    await changePublicationPage(accountId, button.dataset.direction);
    return;
  }
  if (action === 'refresh-publications') {
    await refreshPublications();
    return;
  }
  if (action === 'clear-filters') {
    window.clearTimeout(searchTimer);
    state.search = '';
    state.statusFilter = 'all';
    state.searchLoading = false;
    $('#searchInput').value = '';
    $('#statusFilter').value = 'all';
    render();
    return;
  }
  if (action === 'classify') {
    await classifyComment(accountId, commentId);
    return;
  }
  if (action === 'toggle-comment-like') {
    await toggleCommentLike(accountId, commentId);
    return;
  }
  if (action === 'generate') {
    await generateResponse(accountId, commentId);
    return;
  }
  if (action === 'save-response') {
    const textarea = button.closest('.comment-detail').querySelector('.reply-box');
    try {
      await saveResponse(accountId, commentId, textarea.value);
      showToast(t('toast.draftSaved'));
    } catch (error) {
      showToast(messageFor(error), { error: true });
    }
    return;
  }
  if (action === 'evaluate-response') {
    await evaluateResponse(accountId, commentId);
    return;
  }
  if (action === 'send-response') await sendResponse(accountId, commentId);
}

async function handleProfileAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, platform, enableReplies } = button.dataset;
  if (action === 'back-to-comments') {
    await setScreen('comments');
  } else if (action === 'refresh-connected-accounts') {
    await loadConnectedAccounts();
  } else if (action === 'reload-ai-settings') {
    await loadAIProviderSettings();
  } else if (action === 'connect-social-network') {
    await connectSocialNetwork(platform, enableReplies === 'true');
  } else if (action === 'disconnect-social-account') {
    await disconnectSocialAccount(button.dataset.accountId);
  } else if (action === 'select-facebook-page') {
    await selectFacebookPage();
  } else if (action === 'cancel-facebook-selection') {
    state.facebookSelection = null;
    state.selectedFacebookPageId = null;
    render();
  }
}

function handleBulkDialogKeydown(event) {
  if (!state.bulkReply?.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeBulkReply();
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = $('#bulkReplyDialog .bulk-reply-dialog');
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.offsetParent !== null);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function attachEvents() {
  $('.topbar').addEventListener('click', (event) => {
    if (!event.target.closest?.('[data-action="toggle-global-font-settings"]')) return;
    state.fontSettingsOpen = !state.fontSettingsOpen;
    syncGlobalFontSettingsControl();
    if (state.fontSettingsOpen) $('#uiFontSizeSelect')?.focus({ preventScroll: true });
  });
  $('.topbar').addEventListener('change', (event) => {
    const select = event.target.closest?.('[data-ui-font-size-option]');
    if (!select || !isSupportedUiFontSize(select.value)) return;
    state.uiFontSize = select.value;
    applyUiFontSizePreference(document.documentElement, state.uiFontSize);
    writeUiFontSizePreference(state.uiFontSize);
  });
  document.addEventListener('click', (event) => {
    if (!state.fontSettingsOpen || event.target.closest?.('.global-font-settings')) return;
    state.fontSettingsOpen = false;
    syncGlobalFontSettingsControl();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.fontSettingsOpen) return;
    event.preventDefault();
    state.fontSettingsOpen = false;
    syncGlobalFontSettingsControl();
    $('#globalFontSettingsToggle')?.focus({ preventScroll: true });
  });
  document.querySelectorAll('[data-view]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    void setScreen(link.dataset.view);
  }));
  window.addEventListener('hashchange', () => {
    const screen = window.location.hash === '#connections'
      ? 'connections'
      : window.location.hash === '#replies-report'
        ? 'replies-report'
        : window.location.hash === '#episodes'
          ? 'episodes'
        : window.location.hash === '#comments'
          ? 'comments'
          : 'dashboard';
    if (screen !== state.screen) void setScreen(screen);
  });
  $('#repliesReportFilters').addEventListener('input', (event) => {
    if (!event.target.name) return;
    updateSentRepliesReportDraft(event.currentTarget);
  });
  $('#repliesReportFilters').addEventListener('submit', (event) => {
    event.preventDefault();
    void applySentRepliesReportFilters(event.currentTarget);
  });
  $('#repliesReportCsv').addEventListener('click', () => { void exportSentRepliesReportCsv(); });
  $('#dashboardScreen').addEventListener('click', (event) => {
    if (event.target.closest?.('[data-action="retry-analytics-dashboard"]')) {
      void loadAnalyticsDashboard();
    }
  });
  $('#dashboardScreen').addEventListener('change', (event) => {
    const select = event.target.closest?.('[data-analytics-ranking-window]');
    if (!select) return;
    state.analytics.rankingWindow = Number(select.value) || 30;
    render();
  });
  $('#repliesReportResults').addEventListener('click', (event) => {
    const action = event.target.closest?.('[data-action]')?.dataset.action;
    if (action === 'report-more' && state.sentRepliesReport.nextCursor) {
      void loadSentRepliesReport({ cursor: state.sentRepliesReport.nextCursor, append: true });
    } else if (action === 'report-retry') {
      const cursor = state.sentRepliesReport.retryCursor;
      void loadSentRepliesReport({ cursor, append: Boolean(cursor) });
    }
  });
  $('#episodesScreen').addEventListener('click', (event) => {
    if (event.target.matches?.('[data-series-suggestions-backdrop]')) {
      closeSeriesSuggestionModal();
      return;
    }
    if (event.target.matches?.('[data-manual-picker-backdrop]')) {
      closeManualPublicationPicker();
      return;
    }
    const button = event.target.closest?.('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'refresh-episode-suggestions') void refreshEpisodeSuggestions();
    else if (button.dataset.action === 'retry-episode-review') void loadEpisodeReview();
    else if (button.dataset.action === 'series-list-page') {
      state.episodeReview.seriesPage = Number(button.dataset.page) || 0;
      render();
    }
    else if (button.dataset.action === 'open-series-details') openSeriesDetails(button.dataset.seriesId);
    else if (button.dataset.action === 'back-to-series-list') backToSeriesList();
    else if (button.dataset.action === 'retry-series-episodes') void loadSeriesEpisodes();
    else if (button.dataset.action === 'retry-series-pending-suggestions') void loadSeriesPendingSuggestions();
    else if (button.dataset.action === 'open-series-suggestions') openSeriesSuggestionModal();
    else if (button.dataset.action === 'retry-series-suggestions') void loadSeriesSuggestions();
    else if (button.dataset.action === 'close-series-suggestions') closeSeriesSuggestionModal();
    else if (button.dataset.action === 'episode-review-stage') void loadEpisodeReview({ stage: button.dataset.stage });
    else if (button.dataset.action === 'toggle-episode-recommendations') {
      state.episodeReview.recommendationsOpen = !state.episodeReview.recommendationsOpen;
      render();
    }
    else if (button.dataset.action === 'toggle-unidentified-series') {
      state.episodeReview.showUnidentifiedSeries = !state.episodeReview.showUnidentifiedSeries;
      render();
    } else if (button.dataset.action === 'toggle-unmatched-episodes') {
      state.episodeReview.showUnmatchedEpisodes = !state.episodeReview.showUnmatchedEpisodes;
      render();
    }
    else if (button.dataset.action === 'episode-carousel-prev' || button.dataset.action === 'episode-carousel-next') {
      navigateEpisodeCarousel(button);
    }
    else if (button.dataset.action === 'reject-episode-group' || button.dataset.action === 'defer-episode-group') {
      void decideEpisodeGroup(button);
    }
    else if (button.dataset.action === 'toggle-manual-series-form') {
      state.episodeReview.manualSeriesOpen = !state.episodeReview.manualSeriesOpen;
      render();
      if (state.episodeReview.manualSeriesOpen) {
        document.querySelector('#episodesScreen form[data-manual-series-form] [name="name"]')?.focus({ preventScroll: true });
      }
    }
    else if (button.dataset.action === 'cancel-manual-series') {
      state.episodeReview.manualSeriesOpen = false;
      render();
    }
    else if (button.dataset.action === 'toggle-manual-episode-form') openManualEpisodeForm();
    else if (button.dataset.action === 'cancel-manual-episode') closeManualEpisodeForm();
    else if (button.dataset.action === 'open-manual-publication-picker') {
      void openManualPublicationPicker(button.dataset.platform, button);
    }
    else if (button.dataset.action === 'retry-manual-publication-picker') {
      void loadManualPickerPublications(button.dataset.platform);
    }
    else if (button.dataset.action === 'close-manual-publication-picker') closeManualPublicationPicker();
    else if (button.dataset.action === 'select-manual-publication') selectManualPublication(button);
    else if (button.dataset.action === 'remove-manual-publication') removeManualPublication(button.dataset.platform);
    else if (button.dataset.action === 'edit-series-episode') {
      state.episodeReview.editingEpisodeId = state.episodeReview.editingEpisodeId === button.dataset.episodeId
        ? null
        : button.dataset.episodeId;
      render();
    }
    else if (button.dataset.action === 'cancel-series-episode-edit') {
      state.episodeReview.editingEpisodeId = null;
      render();
    }
    else if (button.dataset.action === 'edit-episode-publication') {
      const { episodeId, accountId, publicationId } = button.dataset;
      const key = `${episodeId}\u0000${accountId}\u0000${publicationId}`;
      state.episodeReview.editingLink = state.episodeReview.editingLink?.key === key
        ? null
        : { key, episodeId, socialAccountId: accountId, externalPublicationId: publicationId };
      render();
    }
    else if (button.dataset.action === 'cancel-episode-publication-edit') {
      state.episodeReview.editingLink = null;
      render();
    }
  });
  $('#episodesScreen').addEventListener('error', (event) => {
    const image = event.target;
    if (image?.dataset?.thumbFallbacks !== undefined) {
      try {
        const fallbacks = JSON.parse(image.dataset.thumbFallbacks);
        const nextSrc = Array.isArray(fallbacks) ? fallbacks.shift() : null;
        if (nextSrc) {
          image.dataset.thumbFallbacks = JSON.stringify(fallbacks);
          image.src = nextSrc;
          return;
        }
      } catch { /* fall through to hide */ }
      image.hidden = true;
      return;
    }
    const pendingImage = event.target.closest?.('[data-series-pending-thumbnail]');
    if (!pendingImage) return;
    pendingImage.hidden = true;
    const fallback = pendingImage.nextElementSibling;
    if (fallback) fallback.hidden = false;
  }, true);
  $('#episodesScreen').addEventListener('input', (event) => {
    if (event.target.matches?.('[data-series-pending-episode-number]')) {
      updateSeriesPendingEpisodeSelection(event.target.closest('form[data-series-pending-episode-form]'));
    }
  });
  $('#episodesScreen').addEventListener('submit', (event) => {
    if (event.target.matches('form[data-series-pending-episode-form]')) void addSelectedSeriesPendingEpisodes(event);
    else if (event.target.matches('form[data-series-suggestion-form]')) void addSelectedSeriesSuggestions(event);
    else if (event.target.matches('form[data-series-proposal]')) void confirmEpisodeSeriesProposal(event);
    else if (event.target.matches('form[data-season-proposal]')) void confirmEpisodeSeasonProposal(event);
    else if (event.target.matches('form[data-episode-group]')) void approveEpisodeGroup(event);
    else if (event.target.matches('form[data-manual-series-form]')) void createManualSeries(event);
    else if (event.target.matches('form[data-manual-episode-form]')) void createManualEpisode(event);
    else if (event.target.matches('form[data-series-episode-edit-form]')) void updateSeriesEpisode(event);
    else if (event.target.matches('form[data-episode-link-edit-form]')) {
      event.preventDefault();
      void moveEpisodePublicationLink(event.target);
    }
  });
  $('#episodesScreen').addEventListener('keydown', (event) => {
    if (state.episodeReview.seriesSuggestionModal?.open) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSeriesSuggestionModal();
      } else if (event.key === 'Tab') {
        trapSeriesSuggestionModalFocus(event);
      }
      return;
    }
    if (!state.episodeReview.manualPicker?.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeManualPublicationPicker();
    } else if (event.key === 'Tab') {
      trapManualPickerFocus(event);
    }
  });
  $('#episodesScreen').addEventListener('change', (event) => {
    if (event.target.matches?.('[data-series-pending-episode-suggestion-id]')) {
      updateSeriesPendingEpisodeSelection(event.target.closest('form[data-series-pending-episode-form]'));
      return;
    }
    if (event.target.matches?.('[data-series-suggestion-id]')) {
      updateSeriesSuggestionSelection(event.target.closest('form[data-series-suggestion-form]'));
      return;
    }
    const control = event.target.closest?.('[data-review-publication], [data-role="setup-series"], [data-role="episode-series"], [data-role="episode-season-mode"], [data-role="manual-episode-series"]');
    if (!control) return;
    if (control.matches('[data-review-publication]')) {
      updateEpisodeSelectionSummary(control.closest('form[data-setup-proposal], form[data-episode-group]'));
      return;
    }
    if (control.matches('[data-role="manual-episode-series"]')) {
      captureManualEpisodeDraft();
      render();
      return;
    }
    if (control.matches('[data-role="setup-series"]')) {
      syncEpisodeSetupSeriesForm(control.closest('form[data-series-proposal]'));
      return;
    }
    syncEpisodeGroupForm(control.closest('form[data-episode-group]'), {
      resetSeasonMode: control.matches('[data-role="episode-series"]'),
    });
  });
  let episodeCarouselTouchStart = null;
  $('#episodesScreen').addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || event.target.closest?.('a, button, input, select, textarea, label')) return;
    const carousel = event.target.closest?.('[data-episode-carousel]');
    if (!carousel) return;
    episodeCarouselTouchStart = { carousel, x: event.clientX, y: event.clientY };
  });
  $('#episodesScreen').addEventListener('pointerup', (event) => {
    const start = episodeCarouselTouchStart;
    episodeCarouselTouchStart = null;
    if (!start || event.pointerType !== 'touch' || event.target.closest?.('a, button, input, select, textarea, label')) return;
    const horizontalDistance = event.clientX - start.x;
    const verticalDistance = event.clientY - start.y;
    if (Math.abs(horizontalDistance) < 45 || Math.abs(horizontalDistance) <= Math.abs(verticalDistance)) return;
    const current = Number(start.carousel.dataset.carouselIndex) || 0;
    updateEpisodeCarousel(start.carousel, current + (horizontalDistance < 0 ? 1 : -1));
  });
  $('#episodesScreen').addEventListener('pointercancel', () => { episodeCarouselTouchStart = null; });
  $('#connectionsScreen').addEventListener('click', (event) => { void handleProfileAction(event); });
  $('#aiProviderSettings').addEventListener('submit', (event) => {
    if (event.target.matches('#responseGenerationSettingsForm')) void saveAIProviderModel(event);
    else if (event.target.matches('#aiProviderAccessForm')) void saveAIProviderAccess(event);
  });
  $('#connectedAccounts').addEventListener('change', (event) => {
    if (event.target.matches('#facebookPageSelect')) state.selectedFacebookPageId = event.target.value;
  });
  $('#appearanceSettings').addEventListener('change', (event) => {
    const locale = event.target.closest('[data-locale-option]')?.value;
    if (locale && setUiLocale(locale)) {
      writeUiLocale(locale);
      document.documentElement.lang = locale;
      applyStaticTranslations();
      render();
      return;
    }
    const theme = event.target.closest('[data-theme-option]')?.dataset.themeOption;
    if (theme !== 'light' && theme !== 'dark') return;
    state.theme = theme;
    applyThemePreference(document.documentElement, theme);
    writeThemePreference(theme);
    render();
  });
  $('#socialTabs').addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-network]');
    if (!tab || state.busy.has('page-sync') || state.searchLoading || state.loadingPublications
      || state.publicationLoadingAccounts.size > 0 || tab.dataset.network === state.activeNetwork) return;
    state.activeNetwork = tab.dataset.network;
    state.selectedAccountId = null;
    void loadVerifiedReleaseSchedule(null);
    state.pageSyncFeedback = null;
    state.publicationsError = null;
    clearPublicationPageData();
    if (await refreshPublications()) void syncCurrentPublicationPage();
    await Promise.all([
      loadToneProfile(state.selectedAccountId),
      loadVerifiedReleaseSchedule(state.selectedAccountId),
    ]);
    if (state.search.trim() || state.statusFilter !== 'all') await loadCommentsForSearchScope();
  });
  $('#accountFilter').addEventListener('change', async (event) => {
    if (state.busy.has('page-sync') || state.searchLoading || state.loadingPublications || state.publicationLoadingAccounts.size > 0) return;
    state.selectedAccountId = event.target.value || null;
    state.pageSyncFeedback = null;
    const toneLoad = loadToneProfile(state.selectedAccountId);
    const scheduleLoad = loadVerifiedReleaseSchedule(state.selectedAccountId);
    render();
    await Promise.all([toneLoad, scheduleLoad]);
    if (state.search.trim() || state.statusFilter !== 'all') await loadCommentsForSearchScope();
  });
  $('#searchInput').addEventListener('input', (event) => {
    if (state.busy.has('page-sync') || state.searchLoading || state.loadingPublications || state.publicationLoadingAccounts.size > 0) return;
    state.search = event.target.value;
    state.pageSyncFeedback = null;
    render();
    window.clearTimeout(searchTimer);
    if (state.search.trim()) searchTimer = window.setTimeout(() => { void loadCommentsForSearchScope(); }, 300);
  });
  $('#statusFilter').addEventListener('change', (event) => {
    if (state.busy.has('page-sync') || state.searchLoading || state.loadingPublications || state.publicationLoadingAccounts.size > 0) return;
    state.statusFilter = event.target.value;
    state.pageSyncFeedback = null;
    render();
    if (state.statusFilter !== 'all') void loadCommentsForSearchScope();
  });
  $('#publicationPageSize').addEventListener('change', (event) => {
    void changePublicationPageSize(event.target.value);
  });
  $('#syncPageButton').addEventListener('click', syncCurrentPublicationPage);
  $('#toneSettingsToggle').addEventListener('click', () => {
    const panel = $('#toneSettings');
    panel.hidden = !panel.hidden;
    $('#toneSettingsToggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
  $('#verifiedReleaseScheduleToggle').addEventListener('click', () => {
    state.verifiedSchedule.open = !state.verifiedSchedule.open;
    render();
    if (state.verifiedSchedule.open
      && ((state.verifiedSchedule.scope !== 'GLOBAL' && state.verifiedSchedule.accountId !== state.selectedAccountId)
        || state.verifiedSchedule.error?.kind === 'load')) {
      void loadVerifiedReleaseSchedule(state.selectedAccountId, { force: true });
    }
  });
  $('#verifiedReleaseSchedulePanel').addEventListener('submit', (event) => {
    if (event.target.matches('#verifiedReleaseScheduleForm')) void saveVerifiedReleaseSchedule(event);
  });
  $('#verifiedReleaseSchedulePanel').addEventListener('click', (event) => {
    if (event.target.closest('[data-action="retry-verified-schedule"]')) {
      void loadVerifiedReleaseSchedule(state.selectedAccountId, { force: true });
    }
    const scopeButton = event.target.closest('[data-action="verified-schedule-scope"]');
    if (scopeButton) setVerifiedScheduleScope(scopeButton.dataset.scope);
  });
  $('#toneSettings').addEventListener('click', (event) => {
    const scopeButton = event.target.closest('[data-tone-scope]');
    if (scopeButton) setToneScope(scopeButton.dataset.toneScope);
  });
  for (const eventName of ['input', 'change']) {
    $('#verifiedReleaseSchedulePanel').addEventListener(eventName, (event) => {
      if (event.target.matches('[data-role="verified-schedule-enabled"], [data-day-of-week], #verifiedScheduleLocalTime, #verifiedScheduleTimeZone')) {
        updateVerifiedScheduleDraftFromPanel($('#verifiedReleaseSchedulePanel'));
      }
    });
  }
  $('#saveToneProfile').addEventListener('click', saveToneProfile);
  $('#toneNote').addEventListener('input', (event) => {
    $('#toneNoteCount').textContent = `${event.target.value.length}/500`;
  });
  document.querySelectorAll('[data-tone-modifier]').forEach((input) => input.addEventListener('change', () => {
    const selected = [...document.querySelectorAll('[data-tone-modifier]:checked')];
    if (selected.length > 2) {
      input.checked = false;
      showToast(t('toast.modifierLimit'), { error: true });
    }
    const count = document.querySelectorAll('[data-tone-modifier]:checked').length;
    document.querySelectorAll('[data-tone-modifier]').forEach((option) => {
      option.disabled = !option.checked && count >= 2;
    });
  }));
  $('#contentList').addEventListener('click', (event) => { void handleContentAction(event); });
  $('#contentList').addEventListener('input', (event) => {
    if (event.target.matches('[data-role="response-draft"]')) updateDraftButtons(event.target);
  });
  $('#contentList').addEventListener('change', (event) => {
    if (event.target.matches('[data-role="response-language"]')) {
      const nextLanguage = event.target.value;
      if (nextLanguage === state.language) return;
      if (state.drafts.size > 0 && !window.confirm(t('toast.discardDraftForLanguage'))) {
        event.target.value = state.language;
        return;
      }
      state.drafts.clear();
      state.language = nextLanguage;
      render();
    }
  });
  $('#bulkReplyDialog').addEventListener('click', (event) => {
    if (event.target.matches('[data-bulk-backdrop]')) {
      closeBulkReply();
      return;
    }
    void handleBulkReplyAction(event);
  });
  $('#bulkReplyDialog').addEventListener('change', (event) => {
    const target = event.target;
    const { commentId } = target.dataset;
    if (target.matches('[data-role="bulk-selection"]')) {
      updateBulkSelection(commentId, target.checked);
    } else if (target.matches('[data-role="bulk-select-all"]')) {
      updateAllBulkSelection(target.checked);
    } else if (target.matches('[data-role="bulk-response-language"]')) {
      updateBulkLanguage(commentId, target.value);
    } else if (target.matches('[data-role="bulk-response-tone"]')) {
      void updateBulkTone(commentId, target.value);
    }
  });
  $('#bulkReplyDialog').addEventListener('input', (event) => {
    const target = event.target;
    if (!target.matches('[data-role="bulk-response-draft"]')) return;
    const row = findBulkRow(state.bulkReply, target.dataset.commentId);
    if (!row) return;
    row.drafts ??= new Map();
    row.drafts.set(row.language, target.value);
    row.draft = target.value;
    const approveButton = target.closest('.bulk-response-pane')?.querySelector('[data-action="approve-bulk-row"]');
    if (approveButton) approveButton.disabled = !target.value.trim() || state.bulkReply.busy || row.approved || !canApproveBulkRow(row);
  });
  $('#bulkReplyDialog').addEventListener('keydown', handleBulkDialogKeydown);
}

async function start() {
  document.documentElement.lang = uiLocale;
  applyStaticTranslations();
  attachEvents();
  render();
  if (state.screen === 'dashboard') {
    state.loadingPublications = false;
    await loadAnalyticsDashboard();
    return;
  }
  if (state.screen === 'episodes') {
    state.loadingPublications = false;
    await loadEpisodeReview({ autoSync: true });
    return;
  }
  if (state.screen === 'replies-report') {
    state.loadingPublications = false;
    state.sentRepliesReport.filters = buildSentRepliesReportFilters(state.sentRepliesReport.draft);
    await Promise.all([loadSentRepliesReportAccounts(), loadSentRepliesReport()]);
    return;
  }
  const summaryLoad = loadCommentSummary();
  if (state.screen === 'connections') {
    await Promise.all([summaryLoad, loadConnectedAccounts(), loadAIProviderSettings()]);
  } else {
    if (await refreshPublications()) void syncCurrentPublicationPage();
    await Promise.all([
      summaryLoad,
      loadToneProfile(state.selectedAccountId),
      loadVerifiedReleaseSchedule(state.selectedAccountId),
    ]);
  }
}

void start();
