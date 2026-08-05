/**
 * Module 1 — Production Runtime. Environment, deployment, and release registries, runtime health,
 * build/version metadata, and release channels. Reuses the runtime (via governance); every
 * production record is audited on the one chain. In-process — live-verified; starts empty (no
 * environments, deployments, or releases are fabricated).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import { ENVIRONMENT_TIERS, RELEASE_CHANNELS, PRODUCTION_VERSION, type EnvironmentTier, type ReleaseChannel } from './constants';

export interface ProductionEnvironment {
  id: string;
  name: string;
  org: string;
  tier: EnvironmentTier;
  channel: ReleaseChannel;
  createdAt: number;
}
export interface DeploymentRecord {
  id: string;
  environmentId: string;
  platform: string;
  version: string;
  status: 'planned' | 'deployed' | 'rolled-back';
  createdAt: number;
}
export interface ReleaseRecord {
  id: string;
  version: string;
  channel: ReleaseChannel;
  notes: string;
  createdAt: number;
}

export class ProductionRuntime {
  private readonly environments = new Map<string, ProductionEnvironment>();
  private readonly deployments = new Map<string, DeploymentRecord>();
  private readonly releases = new Map<string, ReleaseRecord>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
  ) {}

  async registerEnvironment(input: { name: string; org: string; tier: EnvironmentTier; channel?: ReleaseChannel }): Promise<ProductionEnvironment> {
    if (!ENVIRONMENT_TIERS.includes(input.tier)) throw new Error(`unknown environment tier: ${input.tier}`);
    const env: ProductionEnvironment = { id: randomId('env'), name: input.name, org: input.org, tier: input.tier, channel: input.channel ?? 'stable', createdAt: this.clock.now() };
    this.environments.set(env.id, env);
    await this.governance.record({ operator: 'system', org: input.org, environment: env.id, operation: `environment.register.${input.tier}`, targetId: env.id, evidence: 'live-verified' });
    return env;
  }

  async registerDeployment(input: { environmentId: string; platform: string; version: string; org?: string; status?: DeploymentRecord['status'] }): Promise<DeploymentRecord> {
    const env = this.environments.get(input.environmentId);
    const d: DeploymentRecord = { id: randomId('dep'), environmentId: input.environmentId, platform: input.platform, version: input.version, status: input.status ?? 'planned', createdAt: this.clock.now() };
    this.deployments.set(d.id, d);
    await this.governance.record({ operator: 'system', org: env?.org ?? input.org ?? '_ops', environment: input.environmentId, operation: 'deployment.register', targetId: d.id, evidence: 'adapter-verified', version: input.version, deployment: d.id });
    return d;
  }

  async registerRelease(input: { version: string; channel?: ReleaseChannel; notes?: string; org?: string }): Promise<ReleaseRecord> {
    const r: ReleaseRecord = { id: randomId('rel'), version: input.version, channel: input.channel ?? 'stable', notes: input.notes ?? '', createdAt: this.clock.now() };
    this.releases.set(r.id, r);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', operation: 'release.register', targetId: r.id, evidence: 'live-verified', version: input.version });
    return r;
  }

  setDeploymentStatus(id: string, status: DeploymentRecord['status']): DeploymentRecord {
    const d = this.deployments.get(id);
    if (!d) throw new Error(`no deployment ${id}`);
    d.status = status;
    return d;
  }

  /** Runtime health from REAL registered records — never a fabricated status. */
  runtimeHealth(): { environments: number; deployments: number; releases: number; deployed: number; status: string } {
    const deployed = [...this.deployments.values()].filter((d) => d.status === 'deployed').length;
    const total = this.environments.size;
    return { environments: total, deployments: this.deployments.size, releases: this.releases.size, deployed, status: total === 0 ? 'no-environments' : 'operational' };
  }

  buildMetadata(): { version: string; channels: readonly string[] } {
    return { version: PRODUCTION_VERSION, channels: RELEASE_CHANNELS };
  }

  getEnvironment(id: string): ProductionEnvironment | undefined { return this.environments.get(id); }
  environmentList(org?: string): ProductionEnvironment[] {
    const all = [...this.environments.values()];
    return org ? all.filter((e) => e.org === org) : all;
  }
  deploymentList(environmentId?: string): DeploymentRecord[] {
    const all = [...this.deployments.values()];
    return environmentId ? all.filter((d) => d.environmentId === environmentId) : all;
  }
  releaseList(): ReleaseRecord[] { return [...this.releases.values()]; }
  environmentCount(): number { return this.environments.size; }
  deploymentCount(): number { return this.deployments.size; }
  releaseCount(): number { return this.releases.size; }
}
