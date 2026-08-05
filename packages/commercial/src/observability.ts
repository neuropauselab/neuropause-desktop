/**
 * Module 15 — Commercial Observability. Tenant health, platform/service health, usage, capacity, and
 * incidents. REUSES the operations base package (incident registry) for platform incidents — no new
 * incident store — and reads REAL tenant state and usage from this package's own runtime and metering.
 * With nothing to report it says so ('No commercial data available'), never a fabricated status.
 */
import { NO_COMMERCIAL_DATA } from './constants';
import type { CommercialContext } from './types';
import type { CommercialRuntime } from './runtime';
import type { UsageMetering } from './usage';

export class CommercialObservability {
  constructor(
    private readonly ctx: CommercialContext,
    private readonly runtime: CommercialRuntime,
    private readonly usage: UsageMetering,
  ) {}

  /** Tenant health from REAL tenant state. */
  tenantHealth(customerId: string): { tenants: number; active: number; status: string } {
    const c = this.runtime.context(customerId);
    return { tenants: c.tenants, active: c.active, status: c.tenants === 0 ? NO_COMMERCIAL_DATA : c.active === c.tenants ? 'all-active' : 'degraded' };
  }

  /** Platform incidents reused from the operations base package — 'No commercial data available' when absent. */
  platformHealth(): { connected: boolean; openIncidents: number | string; note: string } {
    const ops = this.ctx.operations;
    if (!ops) return { connected: false, openIncidents: NO_COMMERCIAL_DATA, note: 'no operations platform connected' };
    const open = ops.incidents().status().open;
    return { connected: true, openIncidents: open, note: 'incidents reused from the operations base package' };
  }

  /** Real aggregate usage across all metered tenants. */
  usageSummary(): { meteredTenants: number; note: string } {
    const n = this.usage.meteredTenants();
    return { meteredTenants: n, note: n > 0 ? 'real metered usage' : NO_COMMERCIAL_DATA };
  }

  /** Capacity from the real tenant count — a fact, not a projection. */
  capacity(): { tenants: number; customers: number } {
    return { tenants: this.runtime.tenantCount(), customers: this.runtime.customerCount() };
  }
}
