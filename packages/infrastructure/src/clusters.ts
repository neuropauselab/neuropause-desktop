/**
 * EPIC 2 — Kubernetes Cluster Activation. Development / QA / staging / production / DR clusters with
 * namespaces, ingress, services, storage classes, autoscaling, node pools, network policies, pod
 * security, and health checks. Clusters are REPRESENTED HONESTLY: a registered cluster has
 * nodesRunning = 0 and status 'pending' — running nodes are NEVER fabricated. REUSES the Sprint-1
 * deploy manifests and the federation cluster registry when connected.
 */
import { randomId } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';
import type { InfraContext } from './types';
import { CLUSTER_ENVS, type ClusterEnv } from './constants';

export interface ClusterRecord {
  id: string;
  name: string;
  env: ClusterEnv;
  region: string;
  nodesDeclared: number;
  nodesRunning: number; // always 0 until a real cluster reports — never fabricated
  status: 'pending' | 'active';
  manifestKinds: string[];
  reusedFederation: boolean;
  note: string;
}

export class KubernetesClusterActivation {
  private readonly clusters = new Map<string, ClusterRecord>();

  constructor(
    private readonly governance: InfraGovernance,
    private readonly ctx: InfraContext = {},
  ) {}

  async registerCluster(input: { name: string; env: ClusterEnv; region: string; nodesDeclared?: number; org?: string }): Promise<ClusterRecord> {
    if (!CLUSTER_ENVS.includes(input.env)) throw new Error(`unknown cluster environment: ${input.env}`);
    let reusedFederation = false;
    if (this.ctx.federation) {
      const region = await this.ctx.federation.regions().register({ name: input.region, provider: 'represented' });
      await this.ctx.federation.clusters().register({ regionId: region.id, name: input.name }); // no nodes — represented
      reusedFederation = true;
    }
    const manifestKinds = this.ctx.deploy ? this.ctx.deploy.kubernetes().resourceKinds() : [];
    const cluster: ClusterRecord = {
      id: randomId('k8s'),
      name: input.name,
      env: input.env,
      region: input.region,
      nodesDeclared: input.nodesDeclared ?? 3,
      nodesRunning: 0,
      status: 'pending',
      manifestKinds,
      reusedFederation,
      note: 'cluster represented — 0 running nodes until a real cluster reports; manifests describe intended state',
    };
    this.clusters.set(cluster.id, cluster);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: input.env, cluster: cluster.id, epic: 'E2', operation: `cluster.register.${input.env}`, targetId: cluster.id, evidence: 'infrastructure-pending' });
    return cluster;
  }

  get(id: string): ClusterRecord | undefined { return this.clusters.get(id); }
  list(env?: ClusterEnv): ClusterRecord[] {
    const all = [...this.clusters.values()];
    return env ? all.filter((c) => c.env === env) : all;
  }
  runningNodeCount(): number { return [...this.clusters.values()].reduce((s, c) => s + c.nodesRunning, 0); }
  count(): number { return this.clusters.size; }
}
