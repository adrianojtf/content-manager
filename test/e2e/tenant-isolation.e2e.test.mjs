import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createTenantIsolationE2eModule } = require('../../dist-e2e/test/e2e/support/tenant-isolation-e2e.module.js');
const { NestFactory } = require('@nestjs/core');
const { exportJWK, generateKeyPair, SignJWT } = await import('jose');

const tenantOneId = '10000000-0000-4000-8000-000000000001';
const tenantTwoId = '10000000-0000-4000-8000-000000000002';
const userOneId = '20000000-0000-4000-8000-000000000001';
const userTwoId = '20000000-0000-4000-8000-000000000002';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function bearerToken(privateKey, subject, issuer) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'iam-e2e-key' })
    .setIssuer(issuer)
    .setAudience('content-manager-api')
    .setSubject(subject)
    .setExpirationTime('2m')
    .sign(privateKey);
}

test('authenticated tenant requests isolate Content and resolve persisted localization preferences', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'iam-e2e-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const jwksServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  const jwksBaseUrl = await listen(jwksServer);
  const localIssuer = `${jwksBaseUrl}/`;
  const tenantPreferences = new Map([
    [tenantOneId, { defaultLocale: 'en-US', timezone: 'America/Los_Angeles', currency: 'USD' }],
    [tenantTwoId, { defaultLocale: 'es-ES', timezone: null, currency: 'EUR' }],
  ]);
  const userPreferences = new Map([
    [`${tenantOneId}:${userOneId}`, { locale: 'pt-BR', timezone: null }],
    [`${tenantTwoId}:${userTwoId}`, { locale: null, timezone: null }],
  ]);
  const records = new Map();
  const contentRepository = {
    save: async (tenantId, content) => records.set(`${tenantId}:${content.id}`, structuredClone(content)),
    findById: async (tenantId, id) => records.get(`${tenantId}:${id}`) ?? null,
  };
  const app = await NestFactory.create(createTenantIsolationE2eModule({
    issuer: localIssuer,
    jwksUri: `${jwksBaseUrl}/jwks`,
    identities: {
      findByIssuerAndSubject: async (identityIssuer, subject) => {
        if (identityIssuer !== localIssuer) return null;
        if (subject === 'user-one-subject') {
          return { userId: userOneId, isActive: true, tenantId: tenantOneId, tenantRole: 'OWNER', tenantIsActive: true, isPlatformAdmin: false };
        }
        if (subject === 'user-two-subject') {
          return { userId: userTwoId, isActive: true, tenantId: tenantTwoId, tenantRole: 'OWNER', tenantIsActive: true, isPlatformAdmin: false };
        }
        return null;
      },
    },
    tenantPreferences: { findByTenantId: async (tenantId) => tenantPreferences.get(tenantId) ?? null },
    userPreferences: {
      findByUserId: async (tenantId, userId) => userPreferences.get(`${tenantId}:${userId}`) ?? null,
    },
    contentRepository,
  }), { logger: false });

  try {
    await app.listen(0, '127.0.0.1');
    const baseUrl = await app.getUrl();
    const tokenOne = await bearerToken(privateKey, 'user-one-subject', localIssuer);
    const tokenTwo = await bearerToken(privateKey, 'user-two-subject', localIssuer);
    const request = (token, path, options = {}) => fetch(`${baseUrl}/_test/iam${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
    });

    const createResponse = await request(tokenOne, '/content', {
      method: 'POST',
      body: JSON.stringify({
        id: 'content-shared-id',
        tenantId: tenantTwoId,
        title: 'Tenant One',
        description: 'Private content',
        mediaReference: 'media/one',
      }),
    });
    assert.equal(createResponse.status, 201);
    assert.equal((await createResponse.json()).tenantId, tenantOneId);

    const foreignRead = await request(tokenTwo, '/content/content-shared-id');
    assert.equal(foreignRead.status, 404);

    const foreignMutation = await request(tokenTwo, '/content/content-shared-id', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Tampered by tenant two', description: 'Must not change' }),
    });
    assert.equal(foreignMutation.status, 404);

    const ownerRead = await request(tokenOne, '/content/content-shared-id');
    assert.equal(ownerRead.status, 200);
    assert.equal((await ownerRead.json()).title, 'Tenant One');

    const userLocalization = await request(tokenOne, '/localization', {
      headers: { 'accept-language': 'es-ES' },
    });
    assert.equal(userLocalization.status, 200);
    assert.deepEqual(await userLocalization.json(), { locale: 'pt-BR', timezone: 'America/Los_Angeles' });

    const tenantLocalization = await request(tokenTwo, '/localization', {
      headers: { 'accept-language': 'pt-BR' },
    });
    assert.equal(tenantLocalization.status, 200);
    assert.deepEqual(await tenantLocalization.json(), { locale: 'es-ES', timezone: 'UTC' });
  } finally {
    await app.close();
    await new Promise((resolve) => jwksServer.close(resolve));
  }
});
