/**
 * External operations-system adapters — monitoring, incident, IoT, MES, and ERP platforms. Each is
 * a DESCRIPTOR that stays ADAPTER-VERIFIED until configured; none is executed here.
 */
import { randomId } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';
import type { EvidenceLevel } from './types';
import { OPS_ADAPTER_CATALOG } from './constants';

export interface OpsAdapterDescriptor {
  id: string;
  system: string;
  category: string;
  configured: boolean;
  evidence: EvidenceLevel;
  note: string;
}

export class OpsAdapterRegistry {
  private readonly adapters = new Map<string, OpsAdapterDescriptor>();

  constructor(private readonly governance: OperationsGovernance) {}

  async register(system: string, category: string): Promise<OpsAdapterDescriptor> {
    const a: OpsAdapterDescriptor = { id: randomId('opsad'), system, category, configured: false, evidence: 'adapter-verified', note: `${system} (${category}) represented — adapter-verified until configured; never executed here` };
    this.adapters.set(a.id, a);
    await this.governance.record({ user: 'system', org: '_platform', mission: '_platform', operation: `adapter.register.${category}`, targetId: a.id, evidence: 'adapter-verified' });
    return a;
  }

  async seed(): Promise<void> {
    for (const entry of OPS_ADAPTER_CATALOG) await this.register(entry.system, entry.category);
  }

  list(category?: string): OpsAdapterDescriptor[] {
    const all = [...this.adapters.values()];
    return category ? all.filter((a) => a.category === category) : all;
  }
  systems(): string[] {
    return [...this.adapters.values()].map((a) => a.system);
  }
  count(): number {
    return this.adapters.size;
  }
}
