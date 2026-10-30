import { defaultPublicationPageSize } from './publication-pagination.mjs';

const encode = encodeURIComponent;

export class CreatorDeskApiError extends Error {
  constructor(status, code) {
    super(code);
    this.name = 'CreatorDeskApiError';
    this.status = status;
    this.code = code;
  }
}

export class CreatorDeskApi {
  constructor({ baseUrl = '', fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
    if (typeof fetcher !== 'function') throw new TypeError('A fetch implementation is required.');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetcher = fetcher;
  }

  async request(path, { method = 'GET', body, signal } = {}) {
    const options = { method, credentials: 'same-origin', signal };
    if (body !== undefined) {
      options.headers = { 'content-type': 'application/json' };
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, options);
    } catch {
      throw new CreatorDeskApiError(0, 'API_UNAVAILABLE');
    }

    let payload = null;
    if (response.status !== 204) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const code = payload && typeof payload.code === 'string' ? payload.code : 'API_REQUEST_FAILED';
      throw new CreatorDeskApiError(response.status, code);
    }
    return payload;
  }

  listPublications({ accountId, cursor, pageSize = defaultPublicationPageSize, platform } = {}) {
    const query = new URLSearchParams();
    if (accountId) query.set('accountId', accountId);
    if (cursor) query.set('cursor', cursor);
    query.set('pageSize', String(pageSize));
    if (platform) query.set('platform', platform);
    const suffix = `?${query}`;
    return this.request(`/social/publications${suffix}`);
  }

  listAccounts() {
    return this.request('/social/accounts');
  }

  getEpisodeReview(stage) {
    const query = stage ? `?stage=${encodeURIComponent(stage)}` : '';
    return this.request(`/analytics/episodes/review${query}`);
  }

  createAnalyticsSeries(input) {
    return this.request('/analytics/series', { method: 'POST', body: input });
  }

  getAvailableEpisodePublications(platform) {
    const query = new URLSearchParams({ platform });
    return this.request(`/analytics/episodes/manual/publications?${query}`);
  }

  createManualAnalyticsEpisode(input) {
    return this.request('/analytics/episodes/manual', { method: 'POST', body: input });
  }

  refreshEpisodeSuggestions() {
    return this.request('/analytics/episodes/review/refresh', { method: 'POST' });
  }

  confirmEpisodeSetupSeries(input) {
    return this.request('/analytics/episodes/setup/series/confirm', { method: 'POST', body: input });
  }

  confirmEpisodeSetupSeasons(input) {
    return this.request('/analytics/episodes/setup/seasons/confirm', { method: 'POST', body: input });
  }

  approveEpisodeSuggestionGroup(input) {
    return this.request('/analytics/episodes/review/approve', { method: 'POST', body: input });
  }

  decideEpisodeSuggestions(suggestionIds, decision) {
    return this.request('/analytics/episodes/review/decision', {
      method: 'POST',
      body: { suggestionIds, decision },
    });
  }

  disconnectAccount(accountId) {
    return this.request(`/social/accounts/${encode(accountId)}`, { method: 'DELETE' });
  }

  selectFacebookPage(selectionId, pageId) {
    return this.request('/social/connections/facebook/select', {
      method: 'POST',
      body: { selectionId, pageId },
    });
  }

  listComments(accountId, publicationId) {
    return this.request(`/social/accounts/${encode(accountId)}/publications/${encode(publicationId)}/comments`);
  }

  syncComments(accountId, publicationId, cursor) {
    const query = cursor ? `?cursor=${encode(cursor)}` : '';
    return this.request(`/social/accounts/${encode(accountId)}/publications/${encode(publicationId)}/comments/sync${query}`, { method: 'POST' });
  }

  getCommentSummary() {
    return this.request('/social/comments/summary');
  }

  getSentRepliesReport(filters = {}) {
    return this.request(`/social/replies/report?${this.sentRepliesReportQuery(filters, true)}`);
  }

  sentRepliesReportCsvUrl(filters = {}) {
    return `${this.baseUrl}/social/replies/report.csv?${this.sentRepliesReportQuery(filters, false)}`;
  }

  async downloadSentRepliesReportCsv(filters = {}) {
    const url = this.sentRepliesReportCsvUrl(filters);
    let response;
    try {
      response = await this.fetcher(url, { method: 'GET', credentials: 'same-origin' });
    } catch {
      throw new CreatorDeskApiError(0, 'API_UNAVAILABLE');
    }
    if (!response.ok) {
      let code = 'API_REQUEST_FAILED';
      try {
        const payload = await response.json();
        if (typeof payload?.code === 'string') code = payload.code;
      } catch {
        // Keep only a stable fallback when the server response is not JSON.
      }
      throw new CreatorDeskApiError(response.status, code);
    }
    const disposition = response.headers?.get('content-disposition') ?? '';
    const candidate = disposition.match(/filename="([^"]+)"/i)?.[1] ?? 'sent-replies.csv';
    const filename = candidate.replace(/[^a-zA-Z0-9._-]/g, '') || 'sent-replies.csv';
    return { blob: await response.blob(), filename };
  }

  sentRepliesReportQuery(filters, includePagination) {
    const query = new URLSearchParams();
    for (const key of ['from', 'to', 'platform', 'accountId', 'search']) {
      if (filters[key]) query.set(key, filters[key]);
    }
    if (includePagination && filters.cursor) query.set('cursor', filters.cursor);
    if (includePagination && filters.pageSize) query.set('pageSize', String(filters.pageSize));
    return query.toString();
  }

  setCommentLike(accountId, externalCommentId, action) {
    return this.request(`/social/accounts/${encode(accountId)}/comments/${encode(externalCommentId)}/like`, {
      method: 'POST',
      body: { action },
    });
  }

  syncNetwork(platform) {
    return this.request('/social/workflow-batches', {
      method: 'POST',
      body: { operation: 'sync', scope: 'platform', platform },
    });
  }

  runWorkflowBatch(input) {
    return this.request('/social/workflow-batches', {
      method: 'POST',
      body: input,
    });
  }

  classify(accountId, externalCommentId) {
    return this.request(`/social/accounts/${encode(accountId)}/comments/${encode(externalCommentId)}/classification`, { method: 'POST' });
  }

  generateResponse(accountId, externalCommentId, { analysisEventId, toneOverride } = {}) {
    return this.request(`/social/accounts/${encode(accountId)}/comments/${encode(externalCommentId)}/responses/generate`, {
      method: 'POST',
      body: {
        ...(analysisEventId ? { analysisEventId } : {}),
        ...(toneOverride ? { toneOverride } : {}),
      },
    });
  }

  saveManualResponse(accountId, externalCommentId, text) {
    return this.request(`/social/accounts/${encode(accountId)}/comments/${encode(externalCommentId)}/responses/manual`, {
      method: 'POST',
      body: { text },
    });
  }

  reviseSuggestion(accountId, externalCommentId, suggestionId, { text, previousRevisionId }) {
    return this.request(`/social/accounts/${encode(accountId)}/comments/${encode(externalCommentId)}/suggestions/${encode(suggestionId)}/revisions`, {
      method: 'POST',
      body: { text, ...(previousRevisionId ? { previousRevisionId } : {}) },
    });
  }

  reviseManualResponse(accountId, externalCommentId, responseId, { text, previousRevisionId }) {
    return this.request(`/social/accounts/${encode(accountId)}/comments/${encode(externalCommentId)}/responses/manual/${encode(responseId)}/revisions`, {
      method: 'POST',
      body: { text, ...(previousRevisionId ? { previousRevisionId } : {}) },
    });
  }

  evaluateResponse(accountId, externalCommentId, revisionId) {
    return this.request(`/social/accounts/${encode(accountId)}/comments/${encode(externalCommentId)}/revisions/${encode(revisionId)}/evaluation`, { method: 'POST' });
  }

  sendResponse(accountId, externalCommentId, revisionId) {
    return this.request(`/social/accounts/${encode(accountId)}/comments/${encode(externalCommentId)}/revisions/${encode(revisionId)}/send`, { method: 'POST' });
  }

  getWorkflow(accountId, externalCommentId) {
    return this.request(`/social/accounts/${encode(accountId)}/comments/${encode(externalCommentId)}/workflow`);
  }

  getToneProfile(accountId) {
    return this.request(`/social/accounts/${encode(accountId)}/response-tone`)
      .then((view) => view?.profile ?? view);
  }

  getToneProfileView(accountId) {
    return this.request(`/social/accounts/${encode(accountId)}/response-tone`);
  }

  saveToneProfile(accountId, profile) {
    return this.request(`/social/accounts/${encode(accountId)}/response-tone`, { method: 'PUT', body: profile })
      .then((view) => view?.profile ?? view);
  }

  getGlobalToneProfile() {
    return this.request('/social/settings/response-tone');
  }

  saveGlobalToneProfile(profile) {
    return this.request('/social/settings/response-tone', { method: 'PUT', body: profile });
  }

  getVerifiedReleaseSchedule(accountId) {
    return this.request(`/social/accounts/${encode(accountId)}/verified-release-schedule`)
      .then((view) => view?.schedule ?? null);
  }

  getVerifiedReleaseScheduleView(accountId) {
    return this.request(`/social/accounts/${encode(accountId)}/verified-release-schedule`);
  }

  saveVerifiedReleaseSchedule(accountId, schedule) {
    return this.request(`/social/accounts/${encode(accountId)}/verified-release-schedule`, { method: 'PUT', body: schedule })
      .then((view) => view?.schedule ?? null);
  }

  getGlobalVerifiedReleaseSchedule() {
    return this.request('/social/settings/verified-release-schedule');
  }

  saveGlobalVerifiedReleaseSchedule(schedule) {
    return this.request('/social/settings/verified-release-schedule', { method: 'PUT', body: schedule });
  }

  getAIProviderAccess() {
    return this.request('/ai/provider-access');
  }

  saveAIProviderAccess(settings) {
    return this.request('/ai/provider-access', { method: 'PUT', body: settings });
  }

  getResponseGenerationSettings() {
    return this.request('/ai/response-generation/settings');
  }

  saveResponseGenerationSettings(selection) {
    return this.request('/ai/response-generation/settings', { method: 'PUT', body: selection });
  }
}
