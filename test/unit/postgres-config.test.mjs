import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { postgresPoolConfigFromEnvironment } = require('../../dist/infrastructure/persistence/postgres-persistence.config.js');
const { PostgresPersistenceModule, AI_PROVIDER_SETTINGS_REPOSITORY, SOCIAL_ACCOUNT_REPOSITORY, SOCIAL_CREDENTIAL_VAULT } = require('../../dist/infrastructure/persistence/postgres-persistence.module.js');
const { AppModule } = require('../../dist/presentation/http/app.module.js');
const { ConnectSocialAccount } = require('../../dist/application/social/connect-social-account.js');
const { ListSocialPublications } = require('../../dist/application/social/list-social-publications.js');
const { GetAIProviderAccessStatus } = require('../../dist/application/social/ai-provider-access-settings.js');
const { UpdateAIProviderAccessSettings } = require('../../dist/application/social/ai-provider-access-settings.js');

test('PostgreSQL configuration reads and trims DATABASE_URL', () => {
  assert.deepEqual(postgresPoolConfigFromEnvironment({ DATABASE_URL: ' postgresql://localhost:5432/content_manager ' }), {
    connectionString: 'postgresql://localhost:5432/content_manager',
  });
});

test('PostgreSQL configuration requires a PostgreSQL connection URL', () => {
  assert.throws(() => postgresPoolConfigFromEnvironment({}), /DATABASE_URL/);
  assert.throws(() => postgresPoolConfigFromEnvironment({ DATABASE_URL: 'http://localhost:5432/content_manager' }), /DATABASE_URL/);
});

test('HTTP application composition imports the configured Postgres persistence module', () => {
  const module = AppModule.withPostgres({ connectionString: 'postgresql://localhost:5432/content_manager' });

  assert.equal(module.module, AppModule);
  assert.equal(module.imports[0].module, PostgresPersistenceModule);
});

test('Postgres persistence module exposes the tenant-scoped social account repository', () => {
  const module = PostgresPersistenceModule.register({ connectionString: 'postgresql://localhost:5432/content_manager' });

  assert.ok(module.providers.some((provider) => typeof provider === 'object' && provider.provide === SOCIAL_ACCOUNT_REPOSITORY));
  assert.ok(module.exports.includes(SOCIAL_ACCOUNT_REPOSITORY));
  assert.ok(module.providers.some((provider) => typeof provider === 'object' && provider.provide === ConnectSocialAccount));
  assert.ok(module.exports.includes(ConnectSocialAccount));
  assert.ok(module.providers.some((provider) => typeof provider === 'object' && provider.provide === SOCIAL_CREDENTIAL_VAULT));
  assert.ok(module.providers.some((provider) => typeof provider === 'object' && provider.provide === ListSocialPublications));
  assert.ok(module.exports.includes(ListSocialPublications));
  assert.ok(module.providers.some((provider) => typeof provider === 'object' && provider.provide === GetAIProviderAccessStatus));
  assert.ok(module.exports.includes(GetAIProviderAccessStatus));
  assert.ok(module.providers.some((provider) => typeof provider === 'object' && provider.provide === AI_PROVIDER_SETTINGS_REPOSITORY));
  assert.ok(module.exports.includes(UpdateAIProviderAccessSettings));
});
