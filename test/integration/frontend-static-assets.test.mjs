import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { mountCreatorDeskFrontend } = require('../../dist/presentation/http/frontend-static-assets.js');

class StaticFrontendTestModule {}
Module({})(StaticFrontendTestModule);

test('Nest serves the CreatorDesk frontend and its static assets from the application origin', async () => {
  const app = await NestFactory.create(StaticFrontendTestModule, { logger: false });
  mountCreatorDeskFrontend(app);
  await app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await app.getUrl();
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /CreatorDesk/);
    assert.match(html, /id="publicationPageSize"/);
    assert.match(html, /<option value="5" selected>5<\/option>/);
    assert.match(html, /<option value="10">10<\/option>/);
    assert.match(html, /<option value="25">25<\/option>/);
    assert.match(html, /id="syncPageStatus"[^>]*aria-live="polite"/);
    assert.match(html, /id="aiProviderSettings"/);
    assert.match(html, /data-i18n="settings.aiHeading"/);
    assert.match(html, /id="verifiedReleaseScheduleToggle"/);
    assert.match(html, /id="verifiedReleaseSchedulePanel"[^>]*hidden/);
    assert.match(html, /data-view="replies-report"/);
    assert.match(html, /id="repliesReportFilters"/);
    assert.match(html, /data-view="dashboard"/);
    assert.match(html, /mobile-dashboard-link/);
    assert.match(html, /id="dashboardScreen"/);
    assert.match(html, /data-view="episodes"/);
    assert.match(html, /id="episodesScreen"/);

    const stylesheet = await fetch(`${baseUrl}/styles.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/);
    const css = await stylesheet.text();
    assert.match(css, /\.verified-schedule-panel/);
    assert.match(css, /color-scheme: light dark/);

    const themeModule = await fetch(`${baseUrl}/theme.mjs`);
    assert.equal(themeModule.status, 200);
    assert.match(themeModule.headers.get('content-type') ?? '', /javascript/);

    const bulkReplyModule = await fetch(`${baseUrl}/bulk-replies.mjs`);
    assert.equal(bulkReplyModule.status, 200);
    assert.match(bulkReplyModule.headers.get('content-type') ?? '', /javascript/);

    const uiFontSizeModule = await fetch(`${baseUrl}/ui-font-size.mjs`);
    assert.equal(uiFontSizeModule.status, 200);
    assert.match(uiFontSizeModule.headers.get('content-type') ?? '', /javascript/);

    const reportModule = await fetch(`${baseUrl}/sent-replies-report.mjs`);
    assert.equal(reportModule.status, 200);
    assert.match(reportModule.headers.get('content-type') ?? '', /javascript/);

    const analysisVisualsModule = await fetch(`${baseUrl}/analysis-visuals.mjs`);
    assert.equal(analysisVisualsModule.status, 200);
    assert.match(analysisVisualsModule.headers.get('content-type') ?? '', /javascript/);

    const dashboardModule = await fetch(`${baseUrl}/dashboard.mjs`);
    assert.equal(dashboardModule.status, 200);
    assert.match(dashboardModule.headers.get('content-type') ?? '', /javascript/);

    const episodeReviewModule = await fetch(`${baseUrl}/episode-review.mjs`);
    assert.equal(episodeReviewModule.status, 200);
    assert.match(episodeReviewModule.headers.get('content-type') ?? '', /javascript/);

    const accountSelectionModule = await fetch(`${baseUrl}/account-selection.mjs`);
    assert.equal(accountSelectionModule.status, 200);
    assert.match(accountSelectionModule.headers.get('content-type') ?? '', /javascript/);

    for (const locale of ['en-US', 'es-ES']) {
      for (const catalogPath of [
        `/locales/${locale}.mjs`,
        `/locales/${locale}/common.mjs`,
        `/locales/${locale}/settings.mjs`,
        `/locales/${locale}/comments.mjs`,
        `/locales/${locale}/errors.mjs`,
      ]) {
        const catalog = await fetch(`${baseUrl}${catalogPath}`);
        assert.equal(catalog.status, 200, `${catalogPath} should be served`);
        assert.match(catalog.headers.get('content-type') ?? '', /javascript/);
      }
    }
  } finally {
    await app.close();
  }
});
