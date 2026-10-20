export interface PilotTenantContext {
  resolveTenantId(): Promise<string>;
}
