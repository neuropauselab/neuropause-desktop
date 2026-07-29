/**
 * Shared NEMS types (Wave 1). The mutation context threads tenant + actor +
 * session + correlation through every write, so audit and events carry full
 * attribution. Every entity is tenant-aware — `tenantId` is the organization id.
 */
export interface MutationContext {
  /** The organization id — the tenant boundary for every NEMS entity. */
  tenantId: string;
  /** The acting user id (or 'system'). */
  actorId: string;
  sessionId?: string;
  correlationId?: string;
  deviceId?: string;
}

export function systemContext(tenantId: string): MutationContext {
  return { tenantId, actorId: 'system' };
}
