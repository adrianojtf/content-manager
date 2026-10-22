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
