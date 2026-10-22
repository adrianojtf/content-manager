import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { localHttpsOptionsFromEnvironment } = require('../../dist/presentation/http/local-https-config.js');

test('local HTTPS stays off by default', () => {
  assert.equal(localHttpsOptionsFromEnvironment({}), undefined);
});

test('local HTTPS reads the configured certificate and key without returning paths', () => {
  const paths = [];
  const options = localHttpsOptionsFromEnvironment({
    LOCAL_HTTPS_KEY_PATH: ' /private/localhost.key.pem ',
    LOCAL_HTTPS_CERT_PATH: ' /private/localhost.crt.pem ',
  }, (path) => {
    paths.push(path);
    return Buffer.from(path);
  });

  assert.deepEqual(paths, ['/private/localhost.key.pem', '/private/localhost.crt.pem']);
  assert.deepEqual(options, {
    key: Buffer.from('/private/localhost.key.pem'),
    cert: Buffer.from('/private/localhost.crt.pem'),
  });
});

test('local HTTPS refuses partial configuration and unreadable credentials', () => {
  assert.throws(
    () => localHttpsOptionsFromEnvironment({ LOCAL_HTTPS_KEY_PATH: '/private/key.pem' }),
    /LOCAL_HTTPS_KEY_PATH.*LOCAL_HTTPS_CERT_PATH/,
  );
  assert.throws(
    () => localHttpsOptionsFromEnvironment({ LOCAL_HTTPS_CERT_PATH: '/private/cert.pem' }),
    /LOCAL_HTTPS_KEY_PATH.*LOCAL_HTTPS_CERT_PATH/,
  );
  assert.throws(
    () => localHttpsOptionsFromEnvironment({
      LOCAL_HTTPS_KEY_PATH: '/private/key.pem',
      LOCAL_HTTPS_CERT_PATH: '/private/cert.pem',
    }, () => { throw new Error('certificate unavailable'); }),
    /certificate unavailable/,
  );
});
