/**
 * Module 4 — Region Manager. Region / availability-zone / edge-node / deployment metadata
 * as DESCRIPTORS ONLY. No real cloud region is provisioned; records are adapter-verified
 * simulation metadata. Cross-region replication is infra-pending (never executed).
 */
import { randomId } from '@neuropause/cloud-core';
import type { FederationGovernance } from './governance';
import type { Region } from './types';

export class RegionManager {
  private readonly regions = new Map<string, Region>();

  constructor(private readonly governance: FederationGovernance) {}

  async register(input: { name: string; provider: string; zones?: string[]; edgeNodes?: string[] }): Promise<Region> {
    const region: Region = { id: randomId('region'), name: input.name, provider: input.provider, zones: input.zones ?? [], edgeNodes: input.edgeNodes ?? [], evidence: 'adapter-verified' };
    this.regions.set(region.id, region);
    await this.governance.record({ federationId: '_platform', actor: 'system', operation: 'region.register', targetId: region.id, evidence: 'adapter-verified', detail: 'descriptor only — no real region provisioned' });
    return region;
  }

  get(id: string): Region | undefined {
    return this.regions.get(id);
  }
  list(): Region[] {
    return [...this.regions.values()];
  }
  count(): number {
    return this.regions.size;
  }
}
