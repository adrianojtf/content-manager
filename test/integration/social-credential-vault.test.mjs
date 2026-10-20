import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DataType, newDb } = require('pg-mem');
const { PostgresPersistenceAdapter } = require('../../dist/infrastructure/persistence/postgres-persistence.adapter.js');
const { PostgresSocialCredentialVault } = require('../../dist/infrastructure/persistence/postgres-social-credential-vault.js');
const { SocialCredentialVaultError } = require('../../dist/infrastructure/persistence/social-credential-vault-error.js');
const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/infrastructure/persistence/migrations');
const tenantId = '30000000-0000-4000-8000-000000000001';
const otherTenantId = '10000000-0000-4000-8000-000000000001';
const encryptionKey = Buffer.alloc(32, 23).toString('base64');
const readonlyScope = 'https://www.googleapis.com/auth/youtube.readonly';
const replyScope = 'https://www.googleapis.com/auth/youtube.force-ssl';

async function createVault(key = encryptionKey) {
  const memory = newDb();
  memory.public.registerFunction({ name: 'btrim', args: [DataType.text], returns: DataType.text, implementation: (value) => value.trim() });
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (value) => value.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  for (const migration of ['002_create_tenant_identity.sql', '003_add_localization_preferences.sql', '005_create_social_accounts.sql', '006_create_social_credentials.sql']) {
    await pool.query(await readFile(path.join(migrationDirectory, migration), 'utf8'));
  }
  await pool.query('INSERT INTO tenants (id, name, currency) VALUES ($1, $2, $3)', [otherTenantId, 'Other tenant', 'USD']);
  const database = new PostgresPersistenceAdapter(pool);
  return { pool, database, vault: new PostgresSocialCredentialVault(database, { SOCIAL_CREDENTIAL_ENCRYPTION_KEY: key }) };
}

const credentialInput = {
  tenantId,
  platform: 'youtube',
  accessToken: 'access-token-secret',
  refreshToken: 'refresh-token-secret',
  grantedScopes: [readonlyScope],
  expiresAt: '2099-01-01T00:00:00.000Z',
};

test('credential vault encrypts tokens at rest and resolves access tokens only within tenant/platform scope', async () => {
  const { pool, vault } = await createVault();
  try {
    const reference = await vault.storeCredentials(credentialInput);
    const { rows } = await pool.query('SELECT ciphertext, nonce, auth_tag FROM social_credentials WHERE tenant_id = $1 AND credential_reference = $2', [tenantId, reference]);
    assert.equal(typeof rows[0].ciphertext, 'string');
    assert.equal(typeof rows[0].nonce, 'string');
    assert.equal(typeof rows[0].auth_tag, 'string');
    assert.equal(Buffer.from(rows[0].nonce, 'base64').length, 12);
    assert.equal(Buffer.from(rows[0].auth_tag, 'base64').length, 16);
    assert.ok(rows[0].ciphertext.length > 0);
    assert.equal(rows[0].ciphertext.includes(credentialInput.accessToken), false);
    assert.equal(rows[0].ciphertext.includes(credentialInput.refreshToken), false);
    assert.equal(await vault.resolveAccessToken(tenantId, reference, 'youtube'), credentialInput.accessToken);
    assert.equal(await vault.resolveAccessToken(otherTenantId, reference, 'youtube'), null);
    assert.equal(await vault.resolveAccessToken(tenantId, reference, 'instagram'), null);
    assert.equal(await vault.hasScopes(tenantId, reference, 'youtube', [readonlyScope]), true);
    assert.equal(await vault.hasScopes(tenantId, reference, 'youtube', [replyScope]), false);
    assert.equal(await vault.hasScopes(otherTenantId, reference, 'youtube', [readonlyScope]), false);

    assert.equal(rows.length, 1);
  } finally {
    await pool.end();
  }
});

test('credential vault encrypts and resolves TikTok Business account credentials with platform isolation', async () => {
  const { pool, vault } = await createVault();
  try {
    const input = { ...credentialInput, platform: 'tiktok', accessToken: 'tiktok-test-token', grantedScopes: ['test-tiktok-business-scope'] };
    const reference = await vault.storeCredentials(input);
    assert.equal(await vault.resolveAccessToken(tenantId, reference, 'tiktok'), input.accessToken);
    assert.equal(await vault.resolveAccessToken(tenantId, reference, 'youtube'), null);
    assert.equal(await vault.hasScopes(tenantId, reference, 'tiktok', ['test-tiktok-business-scope']), true);
  } finally {
    await pool.end();
  }
});

test('credential vault does not require the encryption key until a credential operation needs it', async () => {
  const { pool, database } = await createVault('');
  try {
    const vault = new PostgresSocialCredentialVault(database, {});
    await assert.rejects(vault.storeCredentials(credentialInput), (error) => error instanceof SocialCredentialVaultError && error.code === 'SOCIAL_CREDENTIAL_ENCRYPTION_KEY_REQUIRED');
    assert.equal(await vault.resolveAccessToken(tenantId, 'not-found', 'youtube'), null);
    const configuredVault = new PostgresSocialCredentialVault(database, { SOCIAL_CREDENTIAL_ENCRYPTION_KEY: encryptionKey });
    const reference = await configuredVault.storeCredentials(credentialInput);
    await assert.rejects(vault.resolveAccessToken(tenantId, reference, 'youtube'), (error) => error instanceof SocialCredentialVaultError && error.code === 'SOCIAL_CREDENTIAL_ENCRYPTION_KEY_REQUIRED');
  } finally {
    await pool.end();
  }
});

test('credential vault rejects invalid keys and maps failed decryption without revealing payloads', async () => {
  const { pool, database, vault } = await createVault();
  try {
    await assert.rejects(
      new PostgresSocialCredentialVault(database, { SOCIAL_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }).storeCredentials(credentialInput),
      (error) => error instanceof SocialCredentialVaultError && error.code === 'SOCIAL_CREDENTIAL_ENCRYPTION_KEY_INVALID',
    );
    const reference = await vault.storeCredentials(credentialInput);
    const wrongKeyVault = new PostgresSocialCredentialVault(database, { SOCIAL_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 24).toString('base64') });
    await assert.rejects(
      wrongKeyVault.resolveAccessToken(tenantId, reference, 'youtube'),
      (error) => error instanceof SocialCredentialVaultError && error.code === 'SOCIAL_CREDENTIAL_DECRYPTION_FAILED' && !error.message.includes(credentialInput.accessToken),
    );
  } finally {
    await pool.end();
  }
});

test('credential vault deletes only the credential in the matching tenant/platform scope', async () => {
  const { pool, vault } = await createVault();
  try {
    const reference = await vault.storeCredentials(credentialInput);
    await vault.deleteCredentials(otherTenantId, reference, 'youtube');
    assert.equal(await vault.resolveAccessToken(tenantId, reference, 'youtube'), credentialInput.accessToken);
    await vault.deleteCredentials(tenantId, reference, 'instagram');
    assert.equal(await vault.resolveAccessToken(tenantId, reference, 'youtube'), credentialInput.accessToken);
    await vault.deleteCredentials(tenantId, reference, 'youtube');
    assert.equal(await vault.resolveAccessToken(tenantId, reference, 'youtube'), null);
  } finally {
    await pool.end();
  }
});

test('credential vault rotates TikTok access/refresh tokens and scopes inside the encrypted payload', async () => {
  const { pool, vault } = await createVault();
  try {
    const input = { ...credentialInput, platform: 'tiktok', accessToken: 'old-tiktok-access', refreshToken: 'old-tiktok-refresh', grantedScopes: ['video.list'], refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' };
    const reference = await vault.storeCredentials(input);
    await vault.updateAccessToken(tenantId, reference, 'tiktok', 'new-tiktok-access', '2099-01-01T00:00:00.000Z', 'new-tiktok-refresh', ['video.list', 'comment.list', 'comment.list.manage'], '2100-01-01T00:00:00.000Z');

    assert.equal(await vault.resolveAccessToken(tenantId, reference, 'tiktok'), 'new-tiktok-access');
    assert.equal(await vault.resolveRefreshToken(tenantId, reference, 'tiktok'), 'new-tiktok-refresh');
    assert.equal(await vault.resolveRefreshTokenExpiresAt(tenantId, reference, 'tiktok'), '2100-01-01T00:00:00.000Z');
    assert.equal(await vault.hasScopes(tenantId, reference, 'tiktok', ['comment.list.manage']), true);
    const { rows } = await pool.query('SELECT ciphertext FROM social_credentials WHERE tenant_id = $1 AND credential_reference = $2', [tenantId, reference]);
    assert.equal(rows[0].ciphertext.includes('new-tiktok-access'), false);
    assert.equal(rows[0].ciphertext.includes('new-tiktok-refresh'), false);
    assert.equal(rows[0].ciphertext.includes('2100-01-01T00:00:00.000Z'), false);
  } finally {
    await pool.end();
  }
});

test('credential vault returns unavailable for expired access tokens and rejects invalid credential input', async () => {
  const { pool, vault } = await createVault();
  try {
    const reference = await vault.storeCredentials({ ...credentialInput, expiresAt: '2000-01-01T00:00:00.000Z' });
    assert.equal(await vault.resolveAccessToken(tenantId, reference, 'youtube'), null);
    assert.equal(await vault.resolveRefreshToken(tenantId, reference, 'youtube'), credentialInput.refreshToken);
    assert.equal(await vault.resolveAccessTokenExpiresAt(tenantId, reference, 'youtube'), '2000-01-01T00:00:00.000Z');
    await vault.updateAccessToken(tenantId, reference, 'youtube', 'refreshed-access-token', '2099-01-01T00:00:00.000Z');
    assert.equal(await vault.resolveAccessToken(tenantId, reference, 'youtube'), 'refreshed-access-token');
    assert.equal(await vault.resolveAccessTokenExpiresAt(tenantId, reference, 'youtube'), '2099-01-01T00:00:00.000Z');
    assert.equal(await vault.hasScopes(tenantId, reference, 'youtube', [readonlyScope]), true);
    await assert.rejects(
      vault.storeCredentials({ ...credentialInput, accessToken: ' ' }),
      (error) => error instanceof SocialCredentialVaultError && error.code === 'SOCIAL_CREDENTIAL_INPUT_INVALID',
    );
  } finally {
    await pool.end();
  }
});
