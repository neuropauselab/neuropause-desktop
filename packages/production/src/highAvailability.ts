/**
 * Module 7 — High Availability Platform. Cluster registry, node health, load distribution, replica
 * registry, health checks, and quorum models. REUSES the Wave 7 cloud-ops fleet/kubernetes surfaces
 * when connected. The quorum arithmetic and cluster descriptors are real and computed; a REAL HA
 * cluster with real node health is INFRASTRUCTURE-PENDING — represented via descriptors until a real
 * cluster is configured, never claimed as running.
 */
import { randomId } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import type { ProductionContext } from './types';

export interface HaCluster {
  id: string;
  name: string;
  nodes: number;
  replicas: number;
  quorum: number;
  reusedCloudOps: boolean;
  note: string;
}

/** Quorum for a cluster of n nodes = floor(n/2)+1; it tolerates n - quorum node failures. */
export const quorumModel = (nodes: number): { nodes: number; quorum: number; tolerates: number } => {
  const quorum = Math.floor(nodes / 2) + 1;
  return { nodes, quorum, tolerates: Math.max(0, nodes - quorum) };
};

export class HighAvailabilityPlatform {
  private readonly clusters = new Map<string, HaCluster>();

  constructor(
    private readonly governance: ProductionGovernance,
    private readonly ctx: ProductionContext = {},
  ) {}

  async registerCluster(input: { name: string; nodes: number; replicas: number; org?: string }): Promise<HaCluster> {
    if (input.nodes <= 0) throw new Error('a cluster must have at least one node');
    const q = quorumModel(input.nodes);
    const cluster: HaCluster = {
      id: randomId('cluster'),
      name: input.name,
      nodes: input.nodes,
      replicas: input.replicas,
      quorum: q.quorum,
      reusedCloudOps: !!this.ctx.cloudops,
      note: 'cluster descriptor + quorum computed; a real HA cluster with real node health is infrastructure-pending until configured',
    };
    this.clusters.set(cluster.id, cluster);
    // real HA infrastructure is not provisioned here — evidence is infrastructure-pending
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', operation: 'ha.cluster.register', targetId: cluster.id, evidence: 'infrastructure-pending', decision: `quorum ${q.quorum}/${input.nodes}` });
    return cluster;
  }

  /** Node health is represented — real per-node health requires a real cluster. */
  nodeHealth(clusterId: string): { clusterId: string; nodes: number; quorum: number; note: string } {
    const c = this.clusters.get(clusterId);
    if (!c) throw new Error(`no cluster ${clusterId}`);
    return { clusterId, nodes: c.nodes, quorum: c.quorum, note: 'node health is infrastructure-pending — represented until a real cluster reports' };
  }

  list(): HaCluster[] { return [...this.clusters.values()]; }
  count(): number { return this.clusters.size; }
}
