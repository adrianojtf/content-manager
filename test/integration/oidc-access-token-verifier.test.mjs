import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';

const jose = await import('jose');
const require = createRequire(import.meta.url);
const { JoseOidcAccessTokenVerifier } = require('../../dist/infrastructure/identity/jose-oidc-access-token-verifier.js');

async function withLocalJwks(run) {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const publicJwk = await jose.exportJWK(publicKey);
  Object.assign(publicJwk, { kid: 'local-key', alg: 'RS256', use: 'sig' });
  const server = createServer((request, response) => {
    if (request.url !== '/jwks') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const config = {
    issuer: 'https://issuer.example',
    audience: 'content-manager-api',
    jwksUri: `http://127.0.0.1:${port}/jwks`,
    allowedAlgorithms: ['RS256'],
    allowInsecureLocalhost: true,
  };
  const verifier = new JoseOidcAccessTokenVerifier(config);
  const issueToken = async (overrides = {}, signingKey = privateKey) => new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'local-key' })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject('oidc-subject-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .setIssuer(overrides.issuer ?? config.issuer)
    .setAudience(overrides.audience ?? config.audience)
    .setSubject(overrides.subject ?? 'oidc-subject-1')
    .setExpirationTime(overrides.expiration ?? '5m')
    .sign(signingKey);

  try {
    await run({ config, issueToken, privateKey, verifier });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('OIDC verifier validates signature, issuer, audience, subject, and token expiry using local JWKS', async () => {
  await withLocalJwks(async ({ config, issueToken, privateKey, verifier }) => {
    const token = await issueToken();
    assert.deepEqual(await verifier.verifyAccessToken(token), {
      issuer: 'https://issuer.example',
      subject: 'oidc-subject-1',
    });

    await assert.rejects(verifier.verifyAccessToken(await issueToken({ issuer: 'https://other.example' })), (error) => error.code === 'ACCESS_TOKEN_INVALID');
    await assert.rejects(verifier.verifyAccessToken(await issueToken({ audience: 'other-api' })), (error) => error.code === 'ACCESS_TOKEN_INVALID');
    await assert.rejects(verifier.verifyAccessToken(await issueToken({ expiration: '0s' })), (error) => error.code === 'ACCESS_TOKEN_INVALID');
    const { privateKey: otherKey } = await jose.generateKeyPair('RS256');
    await assert.rejects(verifier.verifyAccessToken(await issueToken({}, otherKey)), (error) => error.code === 'ACCESS_TOKEN_INVALID');
    assert.throws(() => new JoseOidcAccessTokenVerifier({ ...config, jwksUri: 'http://idp.example/jwks' }), /HTTPS/);
    assert.throws(() => new JoseOidcAccessTokenVerifier({ ...config, allowedAlgorithms: ['HS256'] }), /configuration/);
  });
});
