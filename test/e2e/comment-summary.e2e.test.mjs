import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createCommentSummaryE2eModule } = require('../../dist-e2e/test/e2e/support/comment-summary-e2e.module.js');
const { SocialProviderError } = require('../../dist/application/social/social-provider-error.js');

async function runWithUseCase(useCase, request) {
  const app = await NestFactory.create(createCommentSummaryE2eModule(useCase), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await request(await app.getUrl());
  } finally {
    await app.close();
  }
}

test('comment summary route returns per-platform counts and tenant-wide totals', async () => {
  const summary = {
    platforms: [
      { platform: 'instagram', totalComments: 2, unansweredComments: 2, unevaluatedComments: 2, sentRepliesToday: 0 },
      { platform: 'youtube', totalComments: 3, unansweredComments: 1, unevaluatedComments: 2, sentRepliesToday: 1 },
    ],
    totals: { totalComments: 5, unansweredComments: 3, unevaluatedComments: 4, sentRepliesToday: 1 },
  };
  let executed = 0;

  const response = await runWithUseCase({ execute: async () => { executed += 1; return summary; } }, async (baseUrl) => fetch(`${baseUrl}/social/comments/summary`));

  assert.equal(response.status, 200);
  assert.equal(executed, 1);
  assert.deepEqual(await response.json(), summary);
});

test('comment summary route maps provider failures and unexpected errors', async () => {
  const unavailable = await runWithUseCase({ execute: async () => { throw new SocialProviderError('SOCIAL_PROVIDER_UNAVAILABLE'); } }, async (baseUrl) => fetch(`${baseUrl}/social/comments/summary`));
  assert.equal(unavailable.status, 502);
  assert.deepEqual(await unavailable.json(), { code: 'SOCIAL_PROVIDER_UNAVAILABLE' });

  const invalid = await runWithUseCase({ execute: async () => { throw new SocialProviderError('SOCIAL_PROVIDER_RESPONSE_INVALID'); } }, async (baseUrl) => fetch(`${baseUrl}/social/comments/summary`));
  assert.equal(invalid.status, 502);

  const unexpected = await runWithUseCase({ execute: async () => { throw new Error('boom'); } }, async (baseUrl) => fetch(`${baseUrl}/social/comments/summary`));
  assert.equal(unexpected.status, 500);
  assert.deepEqual(await unexpected.json(), { code: 'SOCIAL_COMMENT_SUMMARY_FAILED' });
});
