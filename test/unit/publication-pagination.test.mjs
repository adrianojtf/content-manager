import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultPublicationPageSize,
  isPublicationPageSize,
  publicationPageRequest,
  recordPublicationPageCursor,
} from '../../web/publication-pagination.mjs';

test('publication page sizes default to five and accept only 5, 10, and 25', () => {
  assert.equal(defaultPublicationPageSize, 5);
  assert.equal(isPublicationPageSize('5'), true);
  assert.equal(isPublicationPageSize(10), true);
  assert.equal(isPublicationPageSize('25'), true);
  assert.equal(isPublicationPageSize('7'), false);
  assert.equal(isPublicationPageSize('10px'), false);
});

test('publication page navigation uses opaque cursors and can move backward', () => {
  const cursors = [undefined, 'opaque-page-two'];
  assert.deepEqual(publicationPageRequest({
    direction: 'next',
    pageIndex: 1,
    cursors,
    nextCursor: 'opaque-page-three',
  }), { pageIndex: 2, cursor: 'opaque-page-three' });
  assert.deepEqual(publicationPageRequest({
    direction: 'previous',
    pageIndex: 2,
    cursors,
    nextCursor: null,
  }), { pageIndex: 1, cursor: 'opaque-page-two' });
  assert.equal(publicationPageRequest({
    direction: 'previous',
    pageIndex: 0,
    cursors,
    nextCursor: null,
  }), null);
  assert.equal(publicationPageRequest({
    direction: 'next',
    pageIndex: 0,
    cursors,
    nextCursor: null,
  }), null);
});

test('recording a page cursor truncates stale forward history', () => {
  assert.deepEqual(
    recordPublicationPageCursor([undefined, 'page-two', 'stale-page-three'], 1, 'new-page-two'),
    [undefined, 'new-page-two'],
  );
});
