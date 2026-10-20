import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { Content } = require('../../dist/domain/content/content.js');
const { parseContentId } = require('../../dist/domain/content/content-id.js');
const { ContentInvariantError } = require('../../dist/domain/content/content-invariant-error.js');
const validInput = {
  id: parseContentId('5b7f1f84-25a8-4bd8-a7df-680dc4400001'),
  tenantId: '10000000-0000-4000-8000-000000000001',
  title: '  Library title  ',
  description: '  Editorial description  ',
  mediaReference: 'media/content-1/video',
};

test('Content trims required editorial metadata and starts as draft', () => {
  const content = Content.create(validInput);

  assert.equal(content.id, validInput.id);
  assert.equal(content.tenantId, validInput.tenantId);
  assert.equal(content.title, 'Library title');
  assert.equal(content.description, 'Editorial description');
  assert.equal(content.mediaReference, validInput.mediaReference);
  assert.equal(content.status, 'draft');
  assert.equal(content.isPublishable, false);
});

test('Content rejects invalid identifiers, blank metadata, and missing media references', () => {
  assert.throws(() => parseContentId('not-a-uuid'), (error) => error instanceof ContentInvariantError && error.code === 'CONTENT_ID_INVALID');
  assert.throws(() => Content.create({ ...validInput, tenantId: '  ' }), (error) => error.code === 'CONTENT_TENANT_REQUIRED');
  assert.throws(() => Content.create({ ...validInput, title: '  ' }), (error) => error.code === 'CONTENT_TITLE_REQUIRED');
  assert.throws(() => Content.create({ ...validInput, description: '\n\t' }), (error) => error.code === 'CONTENT_DESCRIPTION_REQUIRED');
  assert.throws(() => Content.create({ ...validInput, mediaReference: ' ' }), (error) => error.code === 'CONTENT_MEDIA_REFERENCE_REQUIRED');
});

test('Content editorial metadata can be updated without changing identity or readiness', () => {
  const content = Content.create(validInput);
  content.markReady();

  content.updateEditorialMetadata('  Revised title  ', '  Revised description  ');

  assert.equal(content.id, validInput.id);
  assert.equal(content.title, 'Revised title');
  assert.equal(content.description, 'Revised description');
  assert.equal(content.mediaReference, validInput.mediaReference);
  assert.equal(content.status, 'ready');
  assert.throws(() => content.updateEditorialMetadata('Invalid replacement', '  '), (error) => error.code === 'CONTENT_DESCRIPTION_REQUIRED');
  assert.equal(content.title, 'Revised title');
  assert.equal(content.description, 'Revised description');
});

test('Content readiness is manually reversible and gates publication', () => {
  const content = Content.create(validInput);

  content.markReady();
  assert.equal(content.status, 'ready');
  assert.equal(content.isPublishable, true);
  content.markDraft();
  assert.equal(content.status, 'draft');
  assert.equal(content.isPublishable, false);
});
