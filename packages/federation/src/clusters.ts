/**
 * Module 5 — Cluster Manager. Clusters / nodes / services / deployment topology as
 * SIMULATION ONLY. No real cluster is created; records are adapter-verified metadata.
 */
import { randomId } from '@neuropause/cloud-core';
import type { FederationGovernance } from './governance';
import type { Cluster, ClusterNode } from './types';

export class ClusterManager {
  private readonly clusters = new Map<string, Cluster>();

  constructor(private readonly governance: FederationGovernance) {}

  async register(input: { regionId: string; name: string; nodes?: ClusterNode[]; services?: string[] }): Promise<Cluster> {
    const cluster: Cluster = { id: randomId('cluster'), regionId: input.regionId, name: input.name, nodes: input.nodes ?? [], services: input.services ?? [], evidence: 'adapter-verified' };
    this.clusters.set(cluster.id, cluster);
    await this.governance.record({ federationId: '_platform', actor: 'system', operation: 'cluster.register', targetId: cluster.id, evidence: 'adapter-verified', detail: 'simulation only — no real cluster' });
    return cluster;
  }

  get(id: string): Cluster | undefined {
    return this.clusters.get(id);
  }
  list(): Cluster[] {
    return [...this.clusters.values()];
  }
  inRegion(regionId: string): Cluster[] {
    return this.list().filter((c) => c.regionId === regionId);
  }
  topology(): Array<{ cluster: string; regionId: string; nodes: number; services: number }> {
    return this.list().map((c) => ({ cluster: c.name, regionId: c.regionId, nodes: c.nodes.length, services: c.services.length }));
  }
  count(): number {
    return this.clusters.size;
  }
}
