import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { httpHostFromEnvironment } = require('../../dist/presentation/http/http-host-config.js');

test('HTTP host defaults to loopback for local use', () => {
  assert.equal(httpHostFromEnvironment({}), '127.0.0.1');
});

test('blank HTTP host configuration defaults to loopback', () => {
  assert.equal(httpHostFromEnvironment({ HOST: '  ' }), '127.0.0.1');
});

test('HTTP host can bind to the container network interface', () => {
  assert.equal(httpHostFromEnvironment({ HOST: ' 0.0.0.0 ' }), '0.0.0.0');
});
