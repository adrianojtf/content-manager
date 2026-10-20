import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LOCAL_PILOT_TENANT_ID, LocalPilotTenantContext } = require('../../dist/infrastructure/persistence/local-pilot-tenant-context.js');

test('local pilot tenant context resolves a fixed server-owned tenant without OIDC settings', async () => {
  const tenant = new LocalPilotTenantContext();

  assert.equal(await tenant.resolveTenantId(), LOCAL_PILOT_TENANT_ID);
  assert.equal(LOCAL_PILOT_TENANT_ID, '30000000-0000-4000-8000-000000000001');
});
