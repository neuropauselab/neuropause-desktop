/**
 * EPIC 1 — Production Cloud Environment. Environment / region / cluster / resource inventory with a
 * lifecycle and health status. Cluster registration REUSES the Sprint-2 infrastructure activation, which
 * records clusters with 0 running nodes until a real cluster reports — so health is honest: an
 * environment is 'active' only when real running nodes exist. This NEVER claims infrastructure exists
 * unless it is configured and a real cluster reports.
 */
import { randomId } from '@neuropause/cloud-core';
import { type CloudProvider, type EnvironmentTier, type EnvStatus } from './constants';
import type { PlatformOpsContext } from './types';
import type { PlatformOpsGovernance } from './governance';

export interface CloudEnvironment {
  id: string;
  provider: CloudProvider;
  tier: EnvironmentTier;
  region: string;
  status: EnvStatus;
}

export interface ClusterInventoryRecord {
  id: string;
  environmentId: string;
  name: string;
  runningNodes: number; // 0 until a real cluster reports — never fabricated
  reusedInfrastructure: boolean;
}

const TIER_TO_CLUSTER_ENV: Record<EnvironmentTier, 'development' | 'staging' | 'production' | 'disaster-recovery'> = {
  development: 'development',
  staging: 'staging',
  production: 'production',
  'disaster-recovery': 'disaster-recovery',
};

export class CloudEnvironmentRuntime {
  private readonly environments = new Map<string, CloudEnvironment>();
  private readonly clusters = new Map<string, ClusterInventoryRecord>();

  constructor(
    private readonly ctx: PlatformOpsContext,
    private readonly gov: PlatformOpsGovernance,
    private readonly operator: string,
  ) {}

  async registerEnvironment(input: { provider: CloudProvider; tier: EnvironmentTier; region: string }): Promise<CloudEnvironment> {
    const env: CloudEnvironment = { id: randomId('env'), provider: input.provider, tier: input.tier, region: input.region, status: 'declared' };
    this.environments.set(env.id, env);
    await this.gov.record({ operator: this.operator, environment: input.tier, deployment: '_none', cluster: '_none', version: '_platform', epic: 'E1', operation: 'register-environment', targetId: env.id, evidence: 'live-verified', decision: `${input.provider}/${input.region}` });
    return env;
  }

  /** Register a cluster — REUSES infrastructure; running nodes are 0 until a real cluster reports. */
  async registerCluster(input: { environmentId: string; name: string; region?: string }): Promise<ClusterInventoryRecord> {
    const env = this.environments.get(input.environmentId);
    if (!env) throw new Error(`unknown environment: ${input.environmentId}`);
    let runningNodes = 0;
    let reusedInfrastructure = false;
    if (this.ctx.infrastructure) {
      const rec = await this.ctx.infrastructure.clusters().registerCluster({ name: input.name, env: TIER_TO_CLUSTER_ENV[env.tier], region: input.region ?? env.region });
      runningNodes = rec.nodesRunning; // 0 — infrastructure never fabricates running nodes
      reusedInfrastructure = true;
    }
    const cluster: ClusterInventoryRecord = { id: randomId('cluster'), environmentId: input.environmentId, name: input.name, runningNodes, reusedInfrastructure };
    this.clusters.set(cluster.id, cluster);
    await this.gov.record({ operator: this.operator, environment: env.tier, deployment: '_none', cluster: input.name, version: '_platform', epic: 'E1', operation: 'register-cluster', targetId: cluster.id, evidence: runningNodes > 0 ? 'live-verified' : 'infrastructure-pending', decision: `${runningNodes} running nodes` });
    return cluster;
  }

  /** Honest health: 'active' only if real running nodes exist across the fleet. */
  health(): { environments: number; clusters: number; runningNodes: number; status: 'active' | 'infrastructure-pending' } {
    const runningNodes = [...this.clusters.values()].reduce((s, c) => s + c.runningNodes, 0);
    return { environments: this.environments.size, clusters: this.clusters.size, runningNodes, status: runningNodes > 0 ? 'active' : 'infrastructure-pending' };
  }

  environmentList(): CloudEnvironment[] { return [...this.environments.values()]; }
  clusterList(): ClusterInventoryRecord[] { return [...this.clusters.values()]; }
}
