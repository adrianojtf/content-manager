import assert from 'node:assert/strict';
import test from 'node:test';
import { syncPublicationPage } from '../../web/publication-page-sync.mjs';

test('publication page sync processes only supplied videos sequentially and reports progress', async () => {
  const page = [
    { account: { id: 'account-1' }, item: { externalPublicationId: 'video-1' } },
    { account: { id: 'account-2' }, item: { externalPublicationId: 'video-2' } },
  ];
  const calls = [];
  const progress = [];

  const results = await syncPublicationPage(page, async ({ item }) => {
    calls.push(item.externalPublicationId);
    return { success: item.externalPublicationId === 'video-1' };
  }, (status) => progress.push(status));

  assert.deepEqual(calls, ['video-1', 'video-2']);
  assert.deepEqual(results.map(({ result }) => result.success), [true, false]);
  assert.deepEqual(progress.map(({ completed, total }) => [completed, total]), [[0, 2], [1, 2], [1, 2], [2, 2]]);
});

test('publication page sync continues after one video fails', async () => {
  const page = [
    { account: { id: 'account-1' }, item: { externalPublicationId: 'video-1' } },
    { account: { id: 'account-1' }, item: { externalPublicationId: 'video-2' } },
  ];
  const calls = [];

  const results = await syncPublicationPage(page, async ({ item }) => {
    calls.push(item.externalPublicationId);
    if (item.externalPublicationId === 'video-1') throw new Error('provider unavailable');
    return { success: true };
  });

  assert.deepEqual(calls, ['video-1', 'video-2']);
  assert.equal(results[0].result.success, false);
  assert.equal(results[1].result.success, true);
  assert.equal(results[0].error.message, 'provider unavailable');
});
