/**
 * External infrastructure adapters — AWS, Azure, Google Cloud, DigitalOcean, Hetzner, VMware,
 * Kubernetes, MinIO, and Vault. Each is a DESCRIPTOR that stays ADAPTER-VERIFIED until configured;
 * no cloud resource, cluster, bucket, or secret backend is created or contacted here.
 */
import { randomId } from '@neuropause/cloud-core';
import type { DeployGovernance } from './governance';
import type { DeployEvidenceLevel } from './types';
import { INFRA_ADAPTER_CATALOG } from './constants';

export interface InfraAdapterDescriptor {
  id: string;
  system: string;
  category: string;
  configured: boolean;
  evidence: DeployEvidenceLevel;
  note: string;
}

export class InfraAdapterRegistry {
  private readonly adapters = new Map<string, InfraAdapterDescriptor>();

  constructor(private readonly governance: DeployGovernance) {}

  async register(system: string, category: string): Promise<InfraAdapterDescriptor> {
    const a: InfraAdapterDescriptor = { id: randomId('infrad'), system, category, configured: false, evidence: 'adapter-verified', note: `${system} (${category}) represented — adapter-verified until configured; no resource created here` };
    this.adapters.set(a.id, a);
    await this.governance.record({ operator: 'system', org: '_platform', environment: '_platform', epic: 'E5', operation: `adapter.register.${category}`, targetId: a.id, evidence: 'adapter-verified' });
    return a;
  }

  async seed(): Promise<void> {
    for (const entry of INFRA_ADAPTER_CATALOG) await this.register(entry.system, entry.category);
  }

  list(category?: string): InfraAdapterDescriptor[] {
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
