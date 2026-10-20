import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { SocialAccountInvariantError } = require('../../dist/domain/social/social-account-invariant-error.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');

const validInput = {
  id: parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001'),
  tenantId: '10000000-0000-4000-8000-000000000001',
  platform: 'youtube',
  externalAccountId: 'UC-channel-1',
  displayName: '  Creator channel  ',
  credentialReference: 'vault/social/youtube/account-1',
};

test('SocialAccount normalizes provider metadata while retaining tenant and credential reference', () => {
  const account = SocialAccount.create(validInput);

  assert.equal(account.id, validInput.id);
  assert.equal(account.tenantId, validInput.tenantId);
  assert.equal(account.platform, 'youtube');
  assert.equal(account.externalAccountId, validInput.externalAccountId);
  assert.equal(account.displayName, 'Creator channel');
  assert.equal(account.credentialReference, validInput.credentialReference);
});

test('SocialAccount accepts the TikTok Business platform while rejecting unknown platforms', () => {
  const tiktokAccount = SocialAccount.create({ ...validInput, platform: 'tiktok', externalAccountId: 'tiktok-business-1' });
  assert.equal(tiktokAccount.platform, 'tiktok');
  assert.equal(tiktokAccount.externalAccountId, 'tiktok-business-1');
});

test('SocialAccount rejects missing tenant/account identity, blank credential references, and unknown platforms', () => {
  assert.throws(() => parseSocialAccountId('not-a-uuid'), (error) => error instanceof SocialAccountInvariantError && error.code === 'SOCIAL_ACCOUNT_ID_INVALID');
  assert.throws(() => SocialAccount.create({ ...validInput, tenantId: ' ' }), (error) => error.code === 'SOCIAL_ACCOUNT_TENANT_REQUIRED');
  assert.throws(() => SocialAccount.create({ ...validInput, platform: 'myspace' }), (error) => error.code === 'SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
  assert.throws(() => SocialAccount.create({ ...validInput, externalAccountId: ' ' }), (error) => error.code === 'SOCIAL_ACCOUNT_EXTERNAL_ID_REQUIRED');
  assert.throws(() => SocialAccount.create({ ...validInput, credentialReference: ' ' }), (error) => error.code === 'SOCIAL_ACCOUNT_CREDENTIAL_REFERENCE_REQUIRED');
});

test('SocialAccount.restore rejects unknown persisted platform values', () => {
  assert.throws(() => SocialAccount.restore({ ...validInput, platform: 'myspace' }), (error) => error.code === 'SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
});
