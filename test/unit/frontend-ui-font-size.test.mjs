import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyUiFontSizePreference,
  isSupportedUiFontSize,
  readUiFontSizePreference,
  uiFontSizeOptions,
  writeUiFontSizePreference,
} from '../../web/ui-font-size.mjs';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test('global font size defaults to current typography and accepts only supported choices', () => {
  assert.deepEqual(uiFontSizeOptions, ['small', 'default', 'large', 'very-large']);
  assert.equal(readUiFontSizePreference(createStorage()), 'default');
  assert.equal(readUiFontSizePreference(createStorage({ 'creatordesk.ui-font-size': 'large' })), 'large');
  assert.equal(readUiFontSizePreference(createStorage({ 'creatordesk.ui-font-size': 'huge' })), 'default');
  assert.equal(readUiFontSizePreference(createStorage({ 'creatordesk.bulk-reply-font-size': 'small' })), 'small');
  assert.equal(isSupportedUiFontSize('very-large'), true);
  assert.equal(isSupportedUiFontSize('huge'), false);
});

test('global font size persists supported choices locally and applies them to the document', () => {
  const storage = createStorage();
  const documentElement = { dataset: {} };

  assert.equal(writeUiFontSizePreference('very-large', storage), true);
  assert.equal(storage.values.get('creatordesk.ui-font-size'), 'very-large');
  applyUiFontSizePreference(documentElement, 'very-large');
  assert.equal(documentElement.dataset.fontSize, 'very-large');
  assert.equal(writeUiFontSizePreference('huge', storage), false);
  applyUiFontSizePreference(documentElement, 'huge');
  assert.equal(documentElement.dataset.fontSize, 'default');
  assert.equal(storage.values.get('creatordesk.ui-font-size'), 'very-large');
});

test('global font preference falls back safely when browser storage is unavailable', () => {
  const unavailableStorage = {
    getItem: () => { throw new Error('storage unavailable'); },
    setItem: () => { throw new Error('storage unavailable'); },
  };

  assert.equal(readUiFontSizePreference(unavailableStorage), 'default');
  assert.equal(writeUiFontSizePreference('large', unavailableStorage), false);
});
