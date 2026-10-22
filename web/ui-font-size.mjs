const storageKey = 'creatordesk.ui-font-size';
const legacyStorageKey = 'creatordesk.bulk-reply-font-size';

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const uiFontSizeOptions = Object.freeze(['small', 'default', 'large', 'very-large']);

export function isSupportedUiFontSize(size) {
  return uiFontSizeOptions.includes(size);
}

export function readUiFontSizePreference(storage = browserStorage()) {
  try {
    const size = storage?.getItem(storageKey);
    if (isSupportedUiFontSize(size)) return size;
    const legacySize = storage?.getItem(legacyStorageKey);
    return isSupportedUiFontSize(legacySize) ? legacySize : 'default';
  } catch {
    return 'default';
  }
}

export function writeUiFontSizePreference(size, storage = browserStorage()) {
  if (!isSupportedUiFontSize(size)) return false;
  try {
    if (!storage) return false;
    storage.setItem(storageKey, size);
    return true;
  } catch {
    return false;
  }
}

export function applyUiFontSizePreference(documentElement, size) {
  documentElement.dataset.fontSize = isSupportedUiFontSize(size) ? size : 'default';
}
