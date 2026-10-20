import assert from 'node:assert/strict';
import test from 'node:test';
import { CreatorDeskApi, CreatorDeskApiError } from '../../web/api.mjs';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
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

  await api.listPublications({ accountId: 'account / 1', cursor: 'cursor + 1' });
  await api.listComments('account/1', 'video?2');
  await api.syncComments('account/1', 'video?2', 'next cursor');
  await api.getWorkflow('account/1', 'comment#3');

  assert.deepEqual(calls.map(([url]) => url), [
    'http://127.0.0.1:3000/social/publications?accountId=account+%2F+1&cursor=cursor+%2B+1',
    'http://127.0.0.1:3000/social/accounts/account%2F1/publications/video%3F2/comments',
    'http://127.0.0.1:3000/social/accounts/account%2F1/publications/video%3F2/comments/sync?cursor=next%20cursor',
    'http://127.0.0.1:3000/social/accounts/account%2F1/comments/comment%233/workflow',
  ]);
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
  await api.classify('account-1', 'comment-1');
  await api.generateResponse('account-1', 'comment-1', { language: 'pt-BR', analysisEventId: 'analysis-1' });
  await api.saveManualResponse('account-1', 'comment-1', 'Minha resposta');
  await api.reviseSuggestion('account-1', 'comment-1', 'suggestion-1', { text: 'Resposta revisada', previousRevisionId: 'revision-1' });
  await api.reviseManualResponse('account-1', 'comment-1', 'manual-1', { text: 'Resposta manual revisada' });
  await api.evaluateResponse('account-1', 'comment-1', 'revision-1');
  await api.sendResponse('account-1', 'comment-1', 'revision-1');

  assert.deepEqual(calls.map(([url, options]) => [url, options.method, options.body]), [
    ['/social/workflow-batches', 'POST', JSON.stringify({ operation: 'sync', scope: 'platform', platform: 'tiktok' })],
    ['/social/accounts/account-1/comments/comment-1/classification', 'POST', undefined],
    ['/social/accounts/account-1/comments/comment-1/responses/generate', 'POST', JSON.stringify({ language: 'pt-BR', analysisEventId: 'analysis-1' })],
    ['/social/accounts/account-1/comments/comment-1/responses/manual', 'POST', JSON.stringify({ text: 'Minha resposta' })],
    ['/social/accounts/account-1/comments/comment-1/suggestions/suggestion-1/revisions', 'POST', JSON.stringify({ text: 'Resposta revisada', previousRevisionId: 'revision-1' })],
    ['/social/accounts/account-1/comments/comment-1/responses/manual/manual-1/revisions', 'POST', JSON.stringify({ text: 'Resposta manual revisada' })],
    ['/social/accounts/account-1/comments/comment-1/revisions/revision-1/evaluation', 'POST', undefined],
    ['/social/accounts/account-1/comments/comment-1/revisions/revision-1/send', 'POST', undefined],
  ]);
  assert.equal(calls.at(-1)[1].body, undefined);
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
