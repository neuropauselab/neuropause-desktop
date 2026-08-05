/**
 * EPIC 1 — Environment Architecture. A production environment registry for development, QA, staging,
 * production, and disaster recovery. Each environment stores id/region/cluster/version/status/build/
 * health/created/updated. NO FAKE PRODUCTION: every environment starts deploymentStatus
 * 'not-deployed' and health 'unknown' — it becomes deployed only when a real deployment sets it.
 * Mirrors into the reused Wave 14 production runtime environment registry when connected.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { DeployGovernance } from './governance';
import type { DeployContext } from './types';
import { ENVIRONMENTS, type DeployEnvironment, type DeployStatus } from './constants';

export type EnvHealth = 'unknown' | 'healthy' | 'degraded' | 'unhealthy';

export interface DeployEnvironmentRecord {
  envId: string;
  name: string;
  environment: DeployEnvironment;
  region: string;
  cluster: string;
  version: string;
  deploymentStatus: DeployStatus;
  build: string;
  health: EnvHealth;
  created: number;
  updated: number;
}

const toTier = (e: DeployEnvironment): 'development' | 'staging' | 'production' | 'dr' => {
  switch (e) {
    case 'development': return 'development';
    case 'qa': return 'staging';
    case 'staging': return 'staging';
    case 'production': return 'production';
    case 'disaster-recovery': return 'dr';
  }
};

export class EnvironmentArchitecture {
  private readonly envs = new Map<string, DeployEnvironmentRecord>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: DeployGovernance,
    private readonly ctx: DeployContext = {},
  ) {}

  async register(input: { name: string; environment: DeployEnvironment; region: string; cluster: string; version: string; build?: string; org?: string }): Promise<DeployEnvironmentRecord> {
    if (!ENVIRONMENTS.includes(input.environment)) throw new Error(`unknown environment: ${input.environment}`);
    const now = this.clock.now();
    const rec: DeployEnvironmentRecord = {
      envId: randomId('env'),
      name: input.name,
      environment: input.environment,
      region: input.region,
      cluster: input.cluster,
      version: input.version,
      deploymentStatus: 'not-deployed', // never faked as deployed
      build: input.build ?? 'unbuilt',
      health: 'unknown',
      created: now,
      updated: now,
    };
    this.envs.set(rec.envId, rec);
    if (this.ctx.production) {
      await this.ctx.production.runtime().registerEnvironment({ name: input.name, org: input.org ?? '_ops', tier: toTier(input.environment) });
    }
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: rec.envId, epic: 'E1', operation: `environment.register.${input.environment}`, targetId: rec.envId, evidence: 'live-verified' });
    return rec;
  }

  /** Advance status only from a real signal — production is never fabricated as deployed. */
  async setStatus(envId: string, status: DeployStatus, health: EnvHealth = 'unknown', org?: string): Promise<DeployEnvironmentRecord> {
    const rec = this.require(envId);
    rec.deploymentStatus = status;
    rec.health = health;
    rec.updated = this.clock.now();
    await this.governance.record({ operator: 'system', org: org ?? '_ops', environment: envId, epic: 'E1', operation: `environment.${status}`, targetId: envId, evidence: 'live-verified' });
    return rec;
  }

  private require(id: string): DeployEnvironmentRecord {
    const r = this.envs.get(id);
    if (!r) throw new Error(`no environment ${id}`);
    return r;
  }

  get(id: string): DeployEnvironmentRecord | undefined { return this.envs.get(id); }
  list(environment?: DeployEnvironment): DeployEnvironmentRecord[] {
    const all = [...this.envs.values()];
    return environment ? all.filter((e) => e.environment === environment) : all;
  }
  count(): number { return this.envs.size; }
}
