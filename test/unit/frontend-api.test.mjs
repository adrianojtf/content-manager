import assert from 'node:assert/strict';
import test from 'node:test';
import { CreatorDeskApi, CreatorDeskApiError } from '../../web/api.mjs';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)]),
    headers: { get: (name) => name.toLowerCase() === 'content-disposition' ? 'attachment; filename="sent-replies.csv"' : null },
  };
}

test('publication, comment, and workflow requests encode provider IDs as path/query data', async () => {
  const calls = [];
  const api = new CreatorDeskApi({
    baseUrl: 'http://127.0.0.1:3000',
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse([]);
    },
  });

  await api.listPublications({ accountId: 'account / 1', cursor: 'cursor + 1', pageSize: 10, platform: 'youtube' });
  await api.listComments('account/1', 'video?2');
  await api.syncComments('account/1', 'video?2', 'next cursor');
  await api.getWorkflow('account/1', 'comment#3');

  assert.deepEqual(calls.map(([url]) => url), [
    'http://127.0.0.1:3000/social/publications?accountId=account+%2F+1&cursor=cursor+%2B+1&pageSize=10&platform=youtube',
    'http://127.0.0.1:3000/social/accounts/account%2F1/publications/video%3F2/comments',
    'http://127.0.0.1:3000/social/accounts/account%2F1/publications/video%3F2/comments/sync?cursor=next%20cursor',
    'http://127.0.0.1:3000/social/accounts/account%2F1/comments/comment%233/workflow',
  ]);
});

test('comment summary request hits the tenant-wide summary route', async () => {
  const calls = [];
  const summary = {
    platforms: [{ platform: 'youtube', totalComments: 3, unansweredComments: 2, unevaluatedComments: 1, sentRepliesToday: 1 }],
    totals: { totalComments: 3, unansweredComments: 2, unevaluatedComments: 1, sentRepliesToday: 1 },
  };
  const api = new CreatorDeskApi({
    baseUrl: 'http://127.0.0.1:3000',
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse(summary);
    },
  });

  assert.deepEqual(await api.getCommentSummary(), summary);
  assert.deepEqual(calls.map(([url]) => url), ['http://127.0.0.1:3000/social/comments/summary']);
});

test('sent-replies report serializes filters and CSV export targets the full filtered result', async () => {
  const calls = [];
  const api = new CreatorDeskApi({
    baseUrl: 'http://127.0.0.1:3000',
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse({ items: [], total: 0, nextCursor: null });
    },
  });
  const filters = {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-28T12:00:00.000Z',
    platform: 'youtube',
    accountId: 'account/1',
    search: 'comment & reply',
  };

  const result = await api.getSentRepliesReport({ ...filters, cursor: 'opaque cursor', pageSize: 10 });
  const csvUrl = api.sentRepliesReportCsvUrl(filters);
  const download = await api.downloadSentRepliesReportCsv(filters);

  assert.deepEqual(result, { items: [], total: 0, nextCursor: null });
  assert.equal(calls[0][0], 'http://127.0.0.1:3000/social/replies/report?from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-28T12%3A00%3A00.000Z&platform=youtube&accountId=account%2F1&search=comment+%26+reply&cursor=opaque+cursor&pageSize=10');
  assert.equal(csvUrl, 'http://127.0.0.1:3000/social/replies/report.csv?from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-28T12%3A00%3A00.000Z&platform=youtube&accountId=account%2F1&search=comment+%26+reply');
  assert.equal(download.filename, 'sent-replies.csv');
  assert.equal(await download.blob.text(), JSON.stringify(result));
  assert.deepEqual(calls[1][1], { method: 'GET', credentials: 'same-origin' });
});

test('publication listing defaults to a five-video page', async () => {
  const calls = [];
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse([]);
    },
  });

  await api.listPublications();

  assert.equal(calls[0][0], '/social/publications?pageSize=5');
});

test('profile settings list connected accounts through the provider-free account endpoint', async () => {
  const calls = [];
  const accounts = [{ id: 'account-1', platform: 'facebook', externalAccountId: 'page-1', displayName: 'Creator Page' }];
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse(accounts);
    },
  });

  assert.deepEqual(await api.listAccounts(), accounts);
  assert.deepEqual(calls, [['/social/accounts', { method: 'GET', credentials: 'same-origin', signal: undefined }]]);
});

test('profile settings disconnects one encoded account ID with DELETE', async () => {
  const calls = [];
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse(null, 204);
    },
  });

  await api.disconnectAccount('account/1');

  assert.deepEqual(calls, [[
    '/social/accounts/account%2F1',
    { method: 'DELETE', credentials: 'same-origin', signal: undefined },
  ]]);
});

test('workflow actions preserve manual boundaries and send no client-authored text', async () => {
  const calls = [];
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse({ id: 'event-1' }, 201);
    },
  });

  await api.syncNetwork('tiktok');
  await api.runWorkflowBatch({ operation: 'sync', scope: 'publication', accountId: 'account / 1', publicationId: 'video?2' });
  await api.classify('account-1', 'comment-1');
  const toneOverride = 'EMPATHETIC';
  await api.generateResponse('account-1', 'comment-1', { analysisEventId: 'analysis-1', toneOverride });
  await api.saveManualResponse('account-1', 'comment-1', 'Minha resposta');
  await api.reviseSuggestion('account-1', 'comment-1', 'suggestion-1', { text: 'Resposta revisada', previousRevisionId: 'revision-1' });
  await api.reviseManualResponse('account-1', 'comment-1', 'manual-1', { text: 'Resposta manual revisada' });
  await api.evaluateResponse('account-1', 'comment-1', 'revision-1');
  await api.sendResponse('account-1', 'comment-1', 'revision-1');

  assert.deepEqual(calls.map(([url, options]) => [url, options.method, options.body]), [
    ['/social/workflow-batches', 'POST', JSON.stringify({ operation: 'sync', scope: 'platform', platform: 'tiktok' })],
    ['/social/workflow-batches', 'POST', JSON.stringify({ operation: 'sync', scope: 'publication', accountId: 'account / 1', publicationId: 'video?2' })],
    ['/social/accounts/account-1/comments/comment-1/classification', 'POST', undefined],
    ['/social/accounts/account-1/comments/comment-1/responses/generate', 'POST', JSON.stringify({ analysisEventId: 'analysis-1', toneOverride })],
    ['/social/accounts/account-1/comments/comment-1/responses/manual', 'POST', JSON.stringify({ text: 'Minha resposta' })],
    ['/social/accounts/account-1/comments/comment-1/suggestions/suggestion-1/revisions', 'POST', JSON.stringify({ text: 'Resposta revisada', previousRevisionId: 'revision-1' })],
    ['/social/accounts/account-1/comments/comment-1/responses/manual/manual-1/revisions', 'POST', JSON.stringify({ text: 'Resposta manual revisada' })],
    ['/social/accounts/account-1/comments/comment-1/revisions/revision-1/evaluation', 'POST', undefined],
    ['/social/accounts/account-1/comments/comment-1/revisions/revision-1/send', 'POST', undefined],
  ]);
  assert.equal(calls.at(-1)[1].body, undefined);
});

test('comment like API sends only an explicit like or unlike action', async () => {
  const calls = [];
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse({ appLiked: JSON.parse(options.body).action === 'LIKE' });
    },
  });

  await api.setCommentLike('account/1', 'comment?2', 'LIKE');
  await api.setCommentLike('account/1', 'comment?2', 'UNLIKE');

  assert.deepEqual(calls.map(([url, options]) => [url, options.method, options.body]), [
    ['/social/accounts/account%2F1/comments/comment%3F2/like', 'POST', JSON.stringify({ action: 'LIKE' })],
    ['/social/accounts/account%2F1/comments/comment%3F2/like', 'POST', JSON.stringify({ action: 'UNLIKE' })],
  ]);
});

test('tone profile requests use the account-scoped contract', async () => {
  const calls = [];
  const profile = { primaryTone: 'EMPATHETIC', modifiers: ['CONCISE'], customNote: 'Sem promessas.' };
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse({ profile, updatedAt: null, customized: true });
    },
  });

  assert.deepEqual(await api.getToneProfile('account-1'), profile);
  assert.deepEqual(await api.saveToneProfile('account-1', profile), profile);

  assert.equal(calls[0][0], '/social/accounts/account-1/response-tone');
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[1][0], '/social/accounts/account-1/response-tone');
  assert.equal(calls[1][1].method, 'PUT');
  assert.equal(calls[1][1].body, JSON.stringify(profile));
});

test('verified release schedule requests use an account-scoped read and explicit save contract', async () => {
  const calls = [];
  const schedule = {
    enabled: true,
    daysOfWeek: ['MONDAY', 'WEDNESDAY'],
    localTime: '20:30',
    timeZone: 'America/Sao_Paulo',
    version: 2,
    updatedAt: '2026-10-15T12:00:00.000Z',
    confirmedAt: '2026-10-15T12:00:00.000Z',
  };
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse({ schedule });
    },
  });

  assert.deepEqual(await api.getVerifiedReleaseSchedule('account/1'), schedule);
  assert.deepEqual(await api.saveVerifiedReleaseSchedule('account/1', {
    enabled: true,
    daysOfWeek: ['MONDAY', 'WEDNESDAY'],
    localTime: '20:30',
    timeZone: 'America/Sao_Paulo',
  }), schedule);
  assert.deepEqual(calls.map(([url, options]) => [url, options.method, options.body]), [
    ['/social/accounts/account%2F1/verified-release-schedule', 'GET', undefined],
    ['/social/accounts/account%2F1/verified-release-schedule', 'PUT', JSON.stringify({
      enabled: true,
      daysOfWeek: ['MONDAY', 'WEDNESDAY'],
      localTime: '20:30',
      timeZone: 'America/Sao_Paulo',
    })],
  ]);
});

test('tenant-scoped tone and schedule requests use the global settings contract', async () => {
  const calls = [];
  const profile = { primaryTone: 'EMPATHETIC', modifiers: ['WARM'], customNote: null };
  const schedule = { enabled: true, daysOfWeek: ['FRIDAY'], localTime: '18:00', timeZone: 'UTC', version: 1 };
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      if (url.endsWith('/response-tone')) return jsonResponse({ profile, updatedAt: null, customized: true, source: 'TENANT' });
      return jsonResponse({ schedule, source: 'TENANT' });
    },
  });

  const toneView = await api.getGlobalToneProfile();
  assert.equal(toneView.source, 'TENANT');
  await api.saveGlobalToneProfile(profile);
  const scheduleView = await api.getGlobalVerifiedReleaseSchedule();
  assert.deepEqual(scheduleView.schedule, schedule);
  await api.saveGlobalVerifiedReleaseSchedule({ enabled: true, daysOfWeek: ['FRIDAY'], localTime: '18:00', timeZone: 'UTC' });

  assert.deepEqual(calls.map(([url, options]) => [url, options.method]), [
    ['/social/settings/response-tone', 'GET'],
    ['/social/settings/response-tone', 'PUT'],
    ['/social/settings/verified-release-schedule', 'GET'],
    ['/social/settings/verified-release-schedule', 'PUT'],
  ]);
  assert.equal(calls[1][1].body, JSON.stringify(profile));
  assert.equal(calls[3][1].body, JSON.stringify({ enabled: true, daysOfWeek: ['FRIDAY'], localTime: '18:00', timeZone: 'UTC' }));
});

test('AI preferences read provider readiness and model options, then save only the selected provider/model', async () => {
  const calls = [];
  const access = { jev: { apiKeyConfigured: true }, textGeneration: { google: { credentialsConfigured: true } } };
  const responseSettings = {
    active: { provider: 'google', model: 'gemini-3.5-flash-lite' },
    models: [{ provider: 'google', model: 'gemini-3.5-flash-lite', displayName: 'Gemini Flash-Lite' }],
  };
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse(url === '/ai/provider-access' ? access : responseSettings);
    },
  });

  assert.deepEqual(await api.getAIProviderAccess(), access);
  assert.deepEqual(await api.getResponseGenerationSettings(), responseSettings);
  assert.deepEqual(await api.saveResponseGenerationSettings({ provider: 'google', model: 'gemini-3.5-flash-lite' }), responseSettings);

  assert.deepEqual(calls.map(([url, options]) => [url, options.method, options.body]), [
    ['/ai/provider-access', 'GET', undefined],
    ['/ai/response-generation/settings', 'GET', undefined],
    ['/ai/response-generation/settings', 'PUT', JSON.stringify({ provider: 'google', model: 'gemini-3.5-flash-lite' })],
  ]);
});

test('AI access preferences read write-only fields and submit provider access updates', async () => {
  const calls = [];
  const settings = { jev: { apiKeyConfigured: true } };
  const update = { jevApiKey: 'new-secret' };
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse(settings);
    },
  });

  assert.deepEqual(await api.getAIProviderAccess(), settings);
  assert.deepEqual(await api.saveAIProviderAccess(update), settings);

  assert.deepEqual(calls.map(([url, options]) => [url, options.method, options.body]), [
    ['/ai/provider-access', 'GET', undefined],
    ['/ai/provider-access', 'PUT', JSON.stringify(update)],
  ]);
});

test('Facebook Page selection sends only the selected candidate and transient selection ID', async () => {
  const calls = [];
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse({ id: 'facebook-account-1' });
    },
  });

  await api.selectFacebookPage('selection-1', 'page-3');

  assert.equal(calls[0][0], '/social/connections/facebook/select');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { selectionId: 'selection-1', pageId: 'page-3' });
});

test('episode review API refreshes imported metadata and sends only creator review decisions', async () => {
  const calls = [];
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse({ ok: true });
    },
  });

  await api.getEpisodeReview();
  await api.getEpisodeReview('SERIES');
  await api.refreshEpisodeSuggestions();
  await api.confirmEpisodeSetupSeries({
    suggestionIds: ['suggestion-1', 'suggestion-2'],
    newSeries: { name: 'FQA', aliases: ['Fiction Quest'], seasonMode: 'SEASONAL' },
  });
  await api.confirmEpisodeSetupSeasons({ suggestionIds: ['suggestion-1', 'suggestion-2'], seasonNumber: 2 });
  await api.approveEpisodeSuggestionGroup({
    suggestionIds: ['suggestion-1'],
    newSeries: { name: 'FQA', aliases: [], seasonMode: 'SEASONAL' },
    seasonNumber: 2,
    episodeNumber: 8,
    episodeCode: 'FQA-S02-E08',
  });
  await api.decideEpisodeSuggestions(['suggestion-2'], 'DEFERRED');

  assert.deepEqual(calls.map(([url, options]) => [url, options.method, options.body]), [
    ['/analytics/episodes/review', 'GET', undefined],
    ['/analytics/episodes/review?stage=SERIES', 'GET', undefined],
    ['/analytics/episodes/review/refresh', 'POST', undefined],
    ['/analytics/episodes/setup/series/confirm', 'POST', JSON.stringify({
      suggestionIds: ['suggestion-1', 'suggestion-2'],
      newSeries: { name: 'FQA', aliases: ['Fiction Quest'], seasonMode: 'SEASONAL' },
    })],
    ['/analytics/episodes/setup/seasons/confirm', 'POST', JSON.stringify({
      suggestionIds: ['suggestion-1', 'suggestion-2'],
      seasonNumber: 2,
    })],
    ['/analytics/episodes/review/approve', 'POST', JSON.stringify({
      suggestionIds: ['suggestion-1'],
      newSeries: { name: 'FQA', aliases: [], seasonMode: 'SEASONAL' },
      seasonNumber: 2,
      episodeNumber: 8,
      episodeCode: 'FQA-S02-E08',
    })],
    ['/analytics/episodes/review/decision', 'POST', JSON.stringify({ suggestionIds: ['suggestion-2'], decision: 'DEFERRED' })],
  ]);
});

test('manual episode API creates series, loads local unlinked publications, and submits selected sources', async () => {
  const calls = [];
  const api = new CreatorDeskApi({
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse({ ok: true });
    },
  });
  const episodeInput = {
    seriesId: 'series-1',
    seasonNumber: 2,
    episodeNumber: 20,
    episodeCode: 'OBS-S02-E20',
    productionCost: null,
    productionTimeSeconds: null,
    publicationSelections: [
      { socialAccountId: 'account-ig', externalPublicationId: 'ig-20' },
      { socialAccountId: 'account-yt', externalPublicationId: 'yt-20' },
    ],
  };

  await api.createAnalyticsSeries({ name: 'Obsidiana', aliases: [], seasonMode: 'SEASONAL' });
  await api.getAvailableEpisodePublications('instagram');
  await api.createManualAnalyticsEpisode(episodeInput);

  assert.deepEqual(calls.map(([url, options]) => [url, options.method, options.body]), [
    ['/analytics/series', 'POST', JSON.stringify({ name: 'Obsidiana', aliases: [], seasonMode: 'SEASONAL' })],
    ['/analytics/episodes/manual/publications?platform=instagram', 'GET', undefined],
    ['/analytics/episodes/manual', 'POST', JSON.stringify(episodeInput)],
  ]);
});

test('API errors preserve only stable code/status for presentation', async () => {
  const api = new CreatorDeskApi({
    fetcher: async () => jsonResponse({ code: 'MANUAL_REPLY_REVISION_STALE', detail: 'private provider text' }, 409),
  });

  await assert.rejects(api.sendResponse('account-1', 'comment-1', 'revision-1'), (error) => {
    assert.ok(error instanceof CreatorDeskApiError);
    assert.equal(error.code, 'MANUAL_REPLY_REVISION_STALE');
    assert.equal(error.status, 409);
    assert.equal(error.message.includes('private provider text'), false);
    return true;
  });
});
