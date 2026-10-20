import { CreatorDeskApi, CreatorDeskApiError } from './api.mjs';
import { apiErrorMessage, applyStaticTranslations, formatNumber, t, uiLocale } from './i18n.mjs';
import {
  commentKey,
  effectiveAnalysis,
  escapeHtml,
  formatDate,
  latestResponseVersion,
  networkInfo,
  publicationKey,
  renderAccountOptions,
  renderEmptyState,
  renderPublicationCard,
  renderSocialTabs,
  renderStats,
  responseVersionDetails,
} from './view.mjs';

const $ = (selector) => document.querySelector(selector);
const toneDefaults = Object.freeze({ primaryTone: 'FRIENDLY', modifiers: [], customNote: null });
const apiBaseUrl = document.querySelector('meta[name="api-base-url"]')?.content ?? '';
const api = new CreatorDeskApi({ baseUrl: apiBaseUrl });
const state = {
  activeNetwork: 'instagram',
  selectedAccountId: null,
  search: '',
  statusFilter: 'all',
  language: 'pt-BR',
  accountResults: new Map(),
  publications: new Map(),
  publicationCursors: new Map(),
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
  lastNetworkSync: new Map(),
  loadingPublications: true,
  publicationsError: null,
  searchLoading: false,
};
let searchTimer;

function messageFor(error) {
  if (error instanceof CreatorDeskApiError) {
    return apiErrorMessage(error.code);
  }
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
  const accounts = activeAccounts();
  if (state.selectedAccountId && !accounts.some((account) => account.id === state.selectedAccountId)) {
    state.selectedAccountId = null;
  }
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

function render() {
  ensureSelectedAccount();
  const tabs = $('#socialTabs');
  const networkCounts = Object.fromEntries(Object.keys(networkInfo).map((network) => [
    network,
    [...state.accountResults.values()]
      .filter((result) => result.account.platform === network)
      .reduce((count, result) => count + (state.publications.get(result.account.id)?.items.length ?? 0), 0),
  ]));
  tabs.innerHTML = renderSocialTabs(state.activeNetwork, networkCounts);

  const accounts = activeAccounts();
  const accountFilter = $('#accountFilter');
  accountFilter.innerHTML = renderAccountOptions(accounts, state.selectedAccountId);
  accountFilter.disabled = accounts.length === 0;
  $('#syncNetwork').disabled = accounts.length === 0 || state.busy.has('network-sync');

  const allPublications = activePublications();
  const selectedPublications = state.selectedAccountId
    ? allPublications.filter(({ account }) => account.id === state.selectedAccountId)
    : allPublications;
  const selectedComments = activeLoadedComments(selectedPublications);
  $('#networkTitle').textContent = t(networkInfo[state.activeNetwork]?.nameKey ?? 'nav.comments');
  const totalForNetwork = allPublications.length;
  const syncText = state.lastNetworkSync.get(state.activeNetwork)
    ? t('stats.syncTime', { date: formatDate(state.lastNetworkSync.get(state.activeNetwork)) })
    : formatLastSync(selectedComments);
  const publicationCount = t(totalForNetwork === 1 ? 'stats.networkSummary.one' : 'stats.networkSummary.other', { count: formatNumber(totalForNetwork) });
  $('#networkSubtitle').textContent = `${state.searchLoading ? `${t('toolbar.searching')} · ` : ''}${publicationCount} · ${syncText}`;
  $('#stats').innerHTML = renderStats({
    publications: selectedPublications.length,
    comments: selectedComments,
    workflows: state.workflows,
    unavailable: Boolean(state.publicationsError),
  });

  const filtered = visiblePublicationModel(selectedPublications);
  const viewModel = { ...state, comments: filtered.comments };
  if (state.loadingPublications && state.accountResults.size === 0) {
    $('#contentList').innerHTML = `<div class="loading-state"><span class="spinner"></span> ${t('publication.loading')}</div>`;
  } else if (state.publicationsError && state.accountResults.size === 0) {
    $('#contentList').innerHTML = `<div class="error-state">${escapeHtml(state.publicationsError)}<p class="error-message">${t('error.apiDownDetail')}</p><button class="button small" type="button" data-action="refresh-publications">${t('publication.retry')}</button></div>`;
  } else if (!accounts.length) {
    $('#contentList').innerHTML = renderEmptyState(
      t('empty.noAccountsTitle'),
      t('empty.noAccountsDescription'),
      t('empty.refresh'),
      'refresh-publications',
    );
  } else if (filtered.visible.length === 0 && !allPublications.length && renderAccountFailures()) {
    $('#contentList').innerHTML = renderAccountFailures();
  } else if (filtered.visible.length === 0) {
    $('#contentList').innerHTML = renderEmptyState(
      t(state.search || state.statusFilter !== 'all' ? 'empty.noResultsTitle' : 'empty.noPublicationsTitle'),
      t(state.search || state.statusFilter !== 'all' ? 'empty.noResultsDescription' : 'empty.noPublicationsDescription'),
      t(state.search || state.statusFilter !== 'all' ? 'empty.clearFilters' : ''),
      'clear-filters',
    );
  } else {
    const cards = filtered.visible.map((publication) => renderPublicationCard(publication, viewModel)).join('');
    const moreAccounts = activeAccounts().filter((account) => state.publicationCursors.get(account.id));
    const loadMore = moreAccounts.map((account) => `<div class="load-more"><button class="button small" type="button" data-action="load-more-publications" data-account-id="${escapeHtml(account.id)}">${t('publication.pagination', { name: escapeHtml(account.displayName || account.externalAccountId) })}</button></div>`).join('');
    $('#contentList').innerHTML = `${renderAccountFailures()}${cards}${loadMore}`;
  }

}

async function refreshPublications({ accountId, append = false, quiet = false } = {}) {
  if (!quiet) {
    state.loadingPublications = true;
    render();
  }
  try {
    const cursor = accountId ? state.publicationCursors.get(accountId) : undefined;
    const results = await api.listPublications({ accountId, cursor });
    if (!accountId) state.publicationsError = null;
    if (!accountId && !append) {
      state.accountResults.clear();
      state.publications.clear();
      state.publicationCursors.clear();
    }
    for (const result of results) {
      state.accountResults.set(result.account.id, result);
      if (result.status !== 'available') continue;
      const previous = append ? state.publications.get(result.account.id)?.items ?? [] : [];
      state.publications.set(result.account.id, { items: [...previous, ...result.items] });
      if (result.nextCursor) state.publicationCursors.set(result.account.id, result.nextCursor);
      else state.publicationCursors.delete(result.account.id);
    }
  } catch (error) {
    if (!accountId) state.publicationsError = messageFor(error);
    showToast(messageFor(error), { error: true });
  } finally {
    state.loadingPublications = false;
    render();
  }
}

async function loadComments(accountId, publicationId, { force = false } = {}) {
  const key = publicationKey(accountId, publicationId);
  const previous = state.comments.get(key);
  if (previous?.loading || (previous && !force)) return previous;
  state.comments.set(key, { ...(previous ?? {}), items: previous?.items ?? [], loading: true, error: null });
  render();
  try {
    const items = await api.listComments(accountId, publicationId);
    state.comments.set(key, { ...state.comments.get(key), items, loading: false, error: null });
    await loadWorkflowSummaries(items);
  } catch (error) {
    state.comments.set(key, { ...state.comments.get(key), loading: false, error: messageFor(error) });
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

async function loadToneProfile(accountId) {
  state.toneAccountId = accountId;
  state.toneProfile = { ...toneDefaults };
  if (!accountId) {
    syncToneControls();
    return;
  }
  syncToneControls(t('tone.loading'));
  try {
    state.toneProfile = await api.getToneProfile(accountId);
    syncToneControls();
  } catch (error) {
    syncToneControls(t('tone.loadFailed', { message: messageFor(error) }));
  }
}

function syncToneControls(status) {
  const available = Boolean(state.selectedAccountId);
  $('#saveToneProfile').disabled = !available || state.busy.has('tone-save');
  $('#toneSettingsToggle').disabled = !available;
  $('#tonePrimary').value = state.toneProfile.primaryTone ?? toneDefaults.primaryTone;
  $('#toneNote').value = state.toneProfile.customNote ?? '';
  $('#toneNoteCount').textContent = `${$('#toneNote').value.length}/500`;
  const selected = new Set(state.toneProfile.modifiers ?? []);
  document.querySelectorAll('[data-tone-modifier]').forEach((input) => {
    input.checked = selected.has(input.dataset.toneModifier);
    input.disabled = !input.checked && selected.size >= 2;
  });
  $('#toneProfileStatus').textContent = status
    ?? t(state.toneAccountId ? 'tone.loadedStatus' : 'tone.noAccount');
}

function latestAnalysisEvent(events = []) {
  return [...events].reverse().find((event) => event.eventType === 'COMMENT_ANALYSIS_CREATED') ?? null;
}

function responseFor(accountId, externalCommentId) {
  const key = commentKey(accountId, externalCommentId);
  return responseVersionDetails(state.workflows.get(key) ?? []);
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
    await api.generateResponse(accountId, externalCommentId, {
      language: state.language,
      analysisEventId: analysisEvent.id,
    });
    state.drafts.delete(key);
    state.workflows.set(key, await api.getWorkflow(accountId, externalCommentId));
    showToast(t('toast.suggestionComplete'));
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
    const latest = latestResponseVersion(state.workflows.get(key) ?? []);
    if (!latest) throw new Error(t('toast.saveBeforeSend'));
    await api.sendResponse(accountId, externalCommentId, latest.id);
    state.workflows.set(key, await api.getWorkflow(accountId, externalCommentId));
    const publication = findPublication(accountId, externalCommentId);
    if (publication) await loadComments(accountId, publication.externalPublicationId, { force: true });
    showToast(t('toast.sendRecorded'));
  } catch (error) {
    await refreshWorkflowQuietly(accountId, externalCommentId);
    showToast(messageFor(error), { error: true });
  } finally {
    state.busy.delete(`send:${key}`);
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

async function syncPublication(accountId, publicationId, cursor) {
  const key = publicationKey(accountId, publicationId);
  const previous = state.comments.get(key) ?? { items: [] };
  state.comments.set(key, { ...previous, syncing: true, error: null });
  render();
  try {
    const page = await api.syncComments(accountId, publicationId, cursor);
    state.comments.set(key, {
      ...state.comments.get(key),
      syncing: false,
      nextSyncCursor: page.nextCursor,
      lastSyncAt: page.synchronizedAt,
    });
    const loaded = await loadComments(accountId, publicationId, { force: true });
      showToast(t('toast.syncPublication', { count: formatNumber(loaded?.items?.length ?? 0) }));
  } catch (error) {
    state.comments.set(key, { ...state.comments.get(key), syncing: false, error: messageFor(error) });
    showToast(messageFor(error), { error: true });
  }
  render();
}

async function syncSelectedNetwork() {
  const platform = state.activeNetwork;
  state.busy.add('network-sync');
  render();
  try {
    const result = await api.syncNetwork(platform);
    state.lastNetworkSync.set(platform, result.completedAt ?? new Date().toISOString());
    await refreshPublications({ quiet: true });
    const publications = activePublications();
    for (let offset = 0; offset < publications.length; offset += 4) {
      await Promise.all(publications.slice(offset, offset + 4).map(({ account, item }) =>
        loadComments(account.id, item.externalPublicationId, { force: true })));
    }
    const outcomes = result.results ?? [];
    const success = outcomes.filter((item) => item.status === 'SUCCEEDED').length;
    const failures = outcomes.length - success;
    showToast(failures
      ? t('toast.syncNetworkPartial', { success: formatNumber(success), failures: formatNumber(failures) })
      : t('toast.syncNetworkComplete', { network: t(networkInfo[platform].nameKey) }));
  } catch (error) {
    showToast(messageFor(error), { error: true });
  } finally {
    state.busy.delete('network-sync');
    render();
  }
}

async function saveToneProfile() {
  const accountId = state.selectedAccountId;
  if (!accountId) return;
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
    state.toneProfile = await api.saveToneProfile(accountId, profile);
    syncToneControls(t('tone.saved'));
    showToast(t('tone.savedToast'));
  } catch (error) {
    syncToneControls(t('tone.saveFailed', { message: messageFor(error) }));
    showToast(messageFor(error), { error: true });
  } finally {
    state.busy.delete('tone-save');
    syncToneControls($('#toneProfileStatus').textContent);
  }
}

async function handleContentAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, accountId, publicationId, commentId } = button.dataset;
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
  if (action === 'load-more-publications') {
    await refreshPublications({ accountId, append: true });
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

function attachEvents() {
  $('#socialTabs').addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-network]');
    if (!tab || tab.dataset.network === state.activeNetwork) return;
    state.activeNetwork = tab.dataset.network;
    ensureSelectedAccount();
    render();
    await loadToneProfile(state.selectedAccountId);
    if (state.search.trim() || state.statusFilter !== 'all') await loadCommentsForSearchScope();
  });
  $('#accountFilter').addEventListener('change', async (event) => {
    state.selectedAccountId = event.target.value || null;
    render();
    await loadToneProfile(state.selectedAccountId);
    if (state.search.trim() || state.statusFilter !== 'all') await loadCommentsForSearchScope();
  });
  $('#searchInput').addEventListener('input', (event) => {
    state.search = event.target.value;
    render();
    window.clearTimeout(searchTimer);
    if (state.search.trim()) searchTimer = window.setTimeout(() => { void loadCommentsForSearchScope(); }, 300);
  });
  $('#statusFilter').addEventListener('change', (event) => {
    state.statusFilter = event.target.value;
    render();
    if (state.statusFilter !== 'all') void loadCommentsForSearchScope();
  });
  $('#syncNetwork').addEventListener('click', syncSelectedNetwork);
  $('#toneSettingsToggle').addEventListener('click', () => {
    const panel = $('#toneSettings');
    panel.hidden = !panel.hidden;
    $('#toneSettingsToggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
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
    if (event.target.matches('[data-role="response-language"]')) state.language = event.target.value;
  });
}

async function start() {
  document.documentElement.lang = uiLocale;
  applyStaticTranslations();
  attachEvents();
  await refreshPublications();
  await loadToneProfile(state.selectedAccountId);
}

void start();
