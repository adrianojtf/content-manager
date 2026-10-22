import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyThemePreference,
  readThemePreference,
  writeThemePreference,
} from '../../web/theme.mjs';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test('theme preference defaults to light and ignores unsupported stored values', () => {
  assert.equal(readThemePreference(createStorage()), 'light');
  assert.equal(readThemePreference(createStorage({ 'creatordesk.theme': 'system' })), 'light');
  assert.equal(readThemePreference(createStorage({ 'creatordesk.theme': 'dark' })), 'dark');
});

test('theme preference writes only light/dark choices and applies the selected document theme', () => {
  const storage = createStorage();
  const documentElement = { dataset: {} };

  assert.equal(writeThemePreference('dark', storage), true);
  assert.equal(storage.values.get('creatordesk.theme'), 'dark');
  applyThemePreference(documentElement, 'dark');
  assert.equal(documentElement.dataset.theme, 'dark');

  assert.equal(writeThemePreference('system', storage), false);
  applyThemePreference(documentElement, 'light');
  assert.equal(documentElement.dataset.theme, 'light');
});

test('theme preference remains usable when browser storage is unavailable', () => {
  const unavailableStorage = {
    getItem: () => { throw new Error('storage unavailable'); },
    setItem: () => { throw new Error('storage unavailable'); },
  };

  assert.equal(readThemePreference(unavailableStorage), 'light');
  assert.equal(writeThemePreference('dark', unavailableStorage), false);
});

test('creator reply styling uses semantic theme tokens shared by light and dark themes', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.creator-reply\s*\{[^}]*var\(--green\)[^}]*var\(--green-soft\)/s);
  assert.match(styles, /\[data-theme="dark"\]\s*\{[^}]*--green:/s);
  assert.match(styles, /\[data-theme="dark"\]\s*\{[^}]*--green-soft:/s);
});

test('comment like heart uses the theme-aware red token for selected state', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.comment-like-button\.is-liked\s*\{[^}]*var\(--red\)/s);
  assert.match(styles, /\[data-theme="dark"\]\s*\{[^}]*--red:/s);
  assert.match(styles, /\.comment-like-button:hover:not\(:disabled\)\s*\{[^}]*var\(--red-soft\)/s);
});

test('semi-automatic reply dialog uses theme tokens and stacks its review rows on narrow screens', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.bulk-reply-dialog\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.bulk-response-editor,\s*\.bulk-field select\s*\{[^}]*var\(--text\)/s);
  assert.match(styles, /\[data-theme="dark"\]\s*\.bulk-row-status/);
  const mobileStyles = styles.slice(styles.indexOf('@media (max-width: 720px)'), styles.indexOf('@media (prefers-reduced-motion'));
  assert.match(mobileStyles, /\.bulk-reply-row\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('global typography scales across the interface while the dialog wraps responsively', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');
  const tabletStyles = styles.slice(styles.indexOf('@media (max-width: 1180px)'), styles.indexOf('@media (max-width: 720px)'));
  const mobileStyles = styles.slice(styles.indexOf('@media (max-width: 720px)'), styles.indexOf('@media (prefers-reduced-motion'));
  const boundaryNoteRule = styles.match(/\.bulk-boundary-note\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(boundaryNoteRule, /width:\s*100%/);
  assert.match(boundaryNoteRule, /min-width:\s*0/);
  assert.match(boundaryNoteRule, /overflow-wrap:\s*anywhere/);
  assert.match(boundaryNoteRule, /white-space:\s*normal/);
  assert.doesNotMatch(boundaryNoteRule, /\b(?:background|border(?:-[\w-]+)?|padding)\s*:/);
  assert.match(styles, /:root\s*\{[^}]*font-size:\s*14px/s);
  assert.match(styles, /:root\[data-font-size="small"\]\s*\{[^}]*font-size:\s*12px/s);
  assert.match(styles, /:root\[data-font-size="large"\]\s*\{[^}]*font-size:\s*16px/s);
  assert.match(styles, /:root\[data-font-size="very-large"\]\s*\{[^}]*font-size:\s*18px/s);
  assert.match(styles, /body\s*\{[^}]*font:\s*1rem\/1\.45/s);
  assert.match(styles, /\.video-title\s*\{[^}]*font-size:\s*\.9286rem/s);
  assert.match(styles, /\.bulk-comment-text\s*\{[^}]*font-size:\s*\.8571rem/s);
  assert.match(styles, /@media \(min-width:\s*1000px\)\s*\{\s*:root\[data-font-size="large"\]\s+\.toolbar-controls,\s*:root\[data-font-size="very-large"\]\s+\.toolbar-controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*\.9fr\)\s+max-content\s+minmax\(0,\s*1\.1fr\)\s+minmax\(0,\s*\.7fr\)\s+max-content\s+40px\s+40px/s);
  assert.match(styles, /@media \(max-width:\s*999px\)\s*\{\s*:root\[data-font-size="large"\]\s+\.toolbar-controls,\s*:root\[data-font-size="very-large"\]\s+\.toolbar-controls\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*12rem\),\s*1fr\)\)/s);
  assert.match(styles, /\.page-size-control\s*\{[^}]*flex-wrap:\s*wrap[^}]*white-space:\s*normal/);
  assert.match(styles, /\.global-font-settings-panel\s*\{[^}]*background:\s*var\(--surface\)[^}]*color:\s*var\(--text\)/s);
  assert.match(styles, /\.toolbar-icon-button\s*\{[^}]*width:\s*40px[^}]*height:\s*38px/s);
  assert.match(styles, /\.toolbar-action-icon\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/s);
  assert.match(styles, /\[data-theme="dark"\]\s*\{[^}]*--surface:/s);
  assert.match(tabletStyles, /\.app-shell\s*\{\s*grid-template-columns:\s*160px/);
  assert.match(tabletStyles, /\.nav-list a\.active span:last-child\s*\{[^}]*text-align:\s*left/);
  assert.doesNotMatch(tabletStyles, /\.nav-list a\.active\s*\{[^}]*font-size:\s*0/);
  assert.match(mobileStyles, /\.topbar\s*\{[^}]*height:\s*auto[^}]*flex-wrap:\s*wrap/s);
  assert.match(mobileStyles, /\.global-font-settings-panel\s*\{[^}]*width:\s*min\(/);
  assert.match(mobileStyles, /\.connection-grid\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(mobileStyles, /\.appearance-card\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(mobileStyles, /\.ai-settings-grid\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(mobileStyles, /\.bulk-reply-row\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  const mobileVideoDescriptionRule = mobileStyles.match(/\.video-desc\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(mobileVideoDescriptionRule, /(?:^|[\s;])line-clamp:\s*2/);
  assert.match(mobileVideoDescriptionRule, /-webkit-line-clamp:\s*2/);
  const fixedPixelFontSizes = [...styles.matchAll(/font-size:\s*([^;]+);/g)]
    .map((match) => match[1].trim())
    .filter((value) => /\b\d+(?:\.\d+)?px\b/.test(value));
  assert.deepEqual(new Set(fixedPixelFontSizes), new Set(['14px', '12px', '16px', '18px']));
});
