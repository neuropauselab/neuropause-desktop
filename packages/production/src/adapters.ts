/**
 * External deployment / monitoring adapters — Kubernetes, Docker, AWS, Azure, Google Cloud, VMware,
 * Hyper-V, and monitoring providers. Each is a DESCRIPTOR that stays ADAPTER-VERIFIED until
 * configured; no cluster is created, no infrastructure is provisioned, and no external monitoring is
 * queried here.
 */
import { randomId } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import type { ProductionEvidenceLevel } from './types';
import { DEPLOY_ADAPTER_CATALOG } from './constants';

export interface DeploymentAdapterDescriptor {
  id: string;
  system: string;
  category: string;
  configured: boolean;
  evidence: ProductionEvidenceLevel;
  note: string;
}

export class DeploymentAdapterRegistry {
  private readonly adapters = new Map<string, DeploymentAdapterDescriptor>();

  constructor(private readonly governance: ProductionGovernance) {}

  async register(system: string, category: string): Promise<DeploymentAdapterDescriptor> {
    const a: DeploymentAdapterDescriptor = { id: randomId('depad'), system, category, configured: false, evidence: 'adapter-verified', note: `${system} (${category}) represented — adapter-verified until configured; no infrastructure provisioned here` };
    this.adapters.set(a.id, a);
    await this.governance.record({ operator: 'system', org: '_platform', environment: '_platform', operation: `adapter.register.${category}`, targetId: a.id, evidence: 'adapter-verified' });
    return a;
  }

  async seed(): Promise<void> {
    for (const entry of DEPLOY_ADAPTER_CATALOG) await this.register(entry.system, entry.category);
  }

  list(category?: string): DeploymentAdapterDescriptor[] {
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
