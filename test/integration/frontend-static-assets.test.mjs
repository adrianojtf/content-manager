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
    assert.match(await page.text(), /CreatorDesk/);

    const stylesheet = await fetch(`${baseUrl}/styles.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/);
  } finally {
    await app.close();
  }
});
