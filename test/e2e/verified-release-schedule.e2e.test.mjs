import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { createVerifiedReleaseScheduleE2eModule } = require('../../dist-e2e/test/e2e/support/verified-release-schedule-e2e.module.js');
const { GetTenantVerifiedReleaseSchedule, GetVerifiedReleaseSchedule, UpdateTenantVerifiedReleaseSchedule, UpdateVerifiedReleaseSchedule } = require('../../dist/application/social/verified-release-schedule.js');
const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400201';
const secondAccountId = '5b7f1f84-25a8-4bd8-a7df-680dc4400202';
const config = {
  enabled: true,
  daysOfWeek: ['MONDAY', 'WEDNESDAY'],
  localTime: '20:30',
  timeZone: 'America/Sao_Paulo',
};
const schedule = {
  ...config,
  version: 1,
  updatedAt: '2026-10-15T12:00:00.000Z',
  confirmedAt: '2026-10-15T12:00:00.000Z',
};

async function withApp(useCases, run) {
  const app = await NestFactory.create(createVerifiedReleaseScheduleE2eModule(useCases), { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    return await run(await app.getUrl());
  } finally {
    await app.close();
  }
}

function createScheduleUseCases() {
  const accounts = {
    findById: async (scope, id) => scope === tenantId && [accountId, secondAccountId].includes(id)
      ? { id, tenantId: scope }
      : null,
  };
  const stored = new Map();
  let tenantStored = null;
  const repository = {
    get: async (scope, id) => scope === tenantId ? stored.get(id) ?? null : null,
    save: async (scope, id, value) => {
      const previous = stored.get(id);
      const next = {
        ...value,
        daysOfWeek: [...value.daysOfWeek],
        version: (previous?.version ?? 0) + 1,
        updatedAt: '2026-10-15T12:00:00.000Z',
        confirmedAt: '2026-10-15T12:00:00.000Z',
      };
      stored.set(id, next);
      return next;
    },
  };
  const tenantRepository = {
    get: async () => tenantStored,
    save: async (scope, value) => {
      tenantStored = {
        ...value,
        daysOfWeek: [...value.daysOfWeek],
        version: (tenantStored?.version ?? 0) + 1,
        updatedAt: '2026-10-15T11:00:00.000Z',
        confirmedAt: '2026-10-15T11:00:00.000Z',
      };
      return tenantStored;
    },
  };
  const tenant = { resolveTenantId: async () => tenantId };
  return {
    get: new GetVerifiedReleaseSchedule(accounts, repository, tenantRepository, tenant),
    update: new UpdateVerifiedReleaseSchedule(accounts, repository, tenant),
    getTenant: new GetTenantVerifiedReleaseSchedule(tenantRepository, tenant),
    updateTenant: new UpdateTenantVerifiedReleaseSchedule(tenantRepository, tenant),
  };
}

test('verified release schedule HTTP journey reads, confirms, and isolates account settings', async () => {
  await withApp(createScheduleUseCases(), async (baseUrl) => {
    const empty = await fetch(`${baseUrl}/social/accounts/${accountId}/verified-release-schedule`);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { schedule: null, source: 'UNCONFIGURED' });

    const response = await fetch(`${baseUrl}/social/accounts/${accountId}/verified-release-schedule`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { schedule, source: 'ACCOUNT' });

    const reread = await fetch(`${baseUrl}/social/accounts/${accountId}/verified-release-schedule`);
    assert.deepEqual(await reread.json(), { schedule, source: 'ACCOUNT' });

    const otherAccount = await fetch(`${baseUrl}/social/accounts/${secondAccountId}/verified-release-schedule`);
    assert.deepEqual(await otherAccount.json(), { schedule: null, source: 'UNCONFIGURED' });

    const extra = await fetch(`${baseUrl}/social/accounts/${accountId}/verified-release-schedule`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...config, tenantId: 'caller-controlled' }),
    });
    assert.equal(extra.status, 400);
    assert.deepEqual(await extra.json(), { code: 'VERIFIED_RELEASE_SCHEDULE_INVALID' });

    const invalidTimeZone = await fetch(`${baseUrl}/social/accounts/${accountId}/verified-release-schedule`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...config, timeZone: 'Mars/Olympus_Mons' }),
    });
    assert.equal(invalidTimeZone.status, 400);
    assert.deepEqual(await invalidTimeZone.json(), { code: 'VERIFIED_RELEASE_SCHEDULE_INVALID' });
    const unchanged = await fetch(`${baseUrl}/social/accounts/${accountId}/verified-release-schedule`);
    assert.deepEqual(await unchanged.json(), { schedule, source: 'ACCOUNT' });

    const invalidAccount = await fetch(`${baseUrl}/social/accounts/5b7f1f84-25a8-4bd8-a7df-680dc4400299/verified-release-schedule`);
    assert.equal(invalidAccount.status, 404);
    assert.deepEqual(await invalidAccount.json(), { code: 'SOCIAL_ACCOUNT_NOT_FOUND' });
  });
});

test('tenant verified release schedule endpoint stores the global default and accounts inherit it', async () => {
  await withApp(createScheduleUseCases(), async (baseUrl) => {
    const empty = await fetch(`${baseUrl}/social/settings/verified-release-schedule`);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { schedule: null, source: 'UNCONFIGURED' });

    const saved = await fetch(`${baseUrl}/social/settings/verified-release-schedule`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    });
    assert.equal(saved.status, 200);
    const tenantSchedule = { ...schedule, updatedAt: '2026-10-15T11:00:00.000Z', confirmedAt: '2026-10-15T11:00:00.000Z' };
    assert.deepEqual(await saved.json(), { schedule: tenantSchedule, source: 'TENANT' });

    const inherited = await fetch(`${baseUrl}/social/accounts/${accountId}/verified-release-schedule`);
    assert.deepEqual(await inherited.json(), { schedule: tenantSchedule, source: 'TENANT' });

    const accountOverride = await fetch(`${baseUrl}/social/accounts/${accountId}/verified-release-schedule`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...config, enabled: false, daysOfWeek: [] }),
    });
    assert.equal(accountOverride.status, 200);
    const disabledRow = { ...config, enabled: false, daysOfWeek: [], version: 1, updatedAt: '2026-10-15T12:00:00.000Z', confirmedAt: '2026-10-15T12:00:00.000Z' };
    assert.deepEqual(await accountOverride.json(), { schedule: disabledRow, source: 'ACCOUNT' });

    const effective = await fetch(`${baseUrl}/social/accounts/${accountId}/verified-release-schedule`);
    assert.deepEqual(await effective.json(), { schedule: disabledRow, source: 'ACCOUNT' });

    const stillInherited = await fetch(`${baseUrl}/social/accounts/${secondAccountId}/verified-release-schedule`);
    assert.deepEqual(await stillInherited.json(), { schedule: tenantSchedule, source: 'TENANT' });

    const extra = await fetch(`${baseUrl}/social/settings/verified-release-schedule`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...config, tenantId: 'caller-controlled' }),
    });
    assert.equal(extra.status, 400);
    assert.deepEqual(await extra.json(), { code: 'VERIFIED_RELEASE_SCHEDULE_INVALID' });
  });
});
