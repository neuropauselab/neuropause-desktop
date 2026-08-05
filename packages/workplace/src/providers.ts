/**
 * External workplace providers — email, calendar, video, storage, and messaging. Each is a
 * DESCRIPTOR that stays ADAPTER-VERIFIED until a tenant configures real credentials; it is never
 * executed here. Real email hosting, video infrastructure, public cloud storage, and public
 * messaging are regulated-external and are represented, never operated.
 */
import { randomId } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';
import type { EvidenceLevel } from './types';
import { PROVIDER_CATALOG } from './constants';

export interface ProviderDescriptor {
  id: string;
  system: string;
  category: string;
  configured: boolean;
  evidence: EvidenceLevel;
  note: string;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderDescriptor>();

  constructor(private readonly governance: WorkspaceGovernance) {}

  async register(system: string, category: string): Promise<ProviderDescriptor> {
    const p: ProviderDescriptor = { id: randomId('prov'), system, category, configured: false, evidence: 'adapter-verified', note: `${system} ${category} provider represented — adapter-verified until configured; real ${category} infrastructure is regulated-external` };
    this.providers.set(p.id, p);
    await this.governance.record({ actor: 'system', module: 'providers', operation: `register.${category}`, targetId: p.id, evidence: 'adapter-verified', detail: system });
    return p;
  }

  async seed(): Promise<void> {
    for (const entry of PROVIDER_CATALOG) await this.register(entry.system, entry.category);
  }

  get(id: string): ProviderDescriptor | undefined {
    return this.providers.get(id);
  }
  list(category?: string): ProviderDescriptor[] {
    const all = [...this.providers.values()];
    return category ? all.filter((p) => p.category === category) : all;
  }
  systems(): string[] {
    return [...this.providers.values()].map((p) => p.system);
  }
  count(): number {
    return this.providers.size;
  }
}
