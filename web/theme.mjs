const storageKey = 'creatordesk.theme';

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isSupportedTheme(theme) {
  return theme === 'light' || theme === 'dark';
}

export function readThemePreference(storage = browserStorage()) {
  try {
    const theme = storage?.getItem(storageKey);
    return isSupportedTheme(theme) ? theme : 'light';
  } catch {
    return 'light';
  }
}

export function writeThemePreference(theme, storage = browserStorage()) {
  if (!isSupportedTheme(theme)) return false;
  try {
    storage?.setItem(storageKey, theme);
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function applyThemePreference(documentElement, theme) {
  documentElement.dataset.theme = isSupportedTheme(theme) ? theme : 'light';
}
