import type { PilotTenantContext } from '../../application/ports/pilot-tenant-context.port';

export const LOCAL_PILOT_TENANT_ID = '30000000-0000-4000-8000-000000000001';

export class LocalPilotTenantContext implements PilotTenantContext {
  async resolveTenantId(): Promise<string> {
    return LOCAL_PILOT_TENANT_ID;
  }
}
