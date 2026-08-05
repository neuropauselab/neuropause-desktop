/**
 * External provider adapters — cloud providers (AWS/Azure/GCP/DigitalOcean/Hetzner/VMware), the
 * Vault secret backend, and enterprise identity providers (Entra ID / Google Workspace / Okta).
 * Each is a DESCRIPTOR that stays ADAPTER-VERIFIED until configured; no cloud resource is created,
 * no secret backend is contacted, and no identity provider is called here.
 */
import { randomId } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';
import type { InfraEvidenceLevel } from './types';
import { PROVIDER_ADAPTER_CATALOG } from './constants';

export interface ProviderAdapterDescriptor {
  id: string;
  system: string;
  category: string;
  configured: boolean;
  evidence: InfraEvidenceLevel;
  note: string;
}

export class ProviderAdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapterDescriptor>();

  constructor(private readonly governance: InfraGovernance) {}

  async register(system: string, category: string): Promise<ProviderAdapterDescriptor> {
    const a: ProviderAdapterDescriptor = { id: randomId('provad'), system, category, configured: false, evidence: 'adapter-verified', note: `${system} (${category}) represented — adapter-verified until configured; not contacted here` };
    this.adapters.set(a.id, a);
    await this.governance.record({ operator: 'system', org: '_platform', environment: '_platform', epic: 'E21', operation: `adapter.register.${category}`, targetId: a.id, evidence: 'adapter-verified' });
    return a;
  }

  async seed(): Promise<void> {
    for (const entry of PROVIDER_ADAPTER_CATALOG) await this.register(entry.system, entry.category);
  }

  list(category?: string): ProviderAdapterDescriptor[] {
    const all = [...this.adapters.values()];
    return category ? all.filter((a) => a.category === category) : all;
  }
  systems(): string[] { return [...this.adapters.values()].map((a) => a.system); }
  count(): number { return this.adapters.size; }
}
