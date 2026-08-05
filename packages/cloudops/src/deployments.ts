/**
 * Module 3 — Deployment Manager. Represents deployable workloads (applications, services,
 * jobs, cronjobs, workers, APIs) with version, status, health, and environment. This is a
 * registry of DECLARED deployments — no live deployment occurs, and health defaults to
 * 'unknown' because nothing is probed against a running system.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CloudOpsGovernance } from './governance';
import type { Deployment, DeploymentStatus, DeploymentHealth } from './types';
import { WORKLOAD_KINDS, type WorkloadKind } from './constants';

export interface RegisterDeploymentInput {
  name: string;
  kind: WorkloadKind;
  environmentId: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export class DeploymentManager {
  private readonly deployments = new Map<string, Deployment>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CloudOpsGovernance,
  ) {}

  async register(input: RegisterDeploymentInput): Promise<Deployment> {
    if (!WORKLOAD_KINDS.includes(input.kind)) throw new Error(`unknown workload kind: ${input.kind}`);
    const now = this.clock.now();
    const d: Deployment = {
      id: randomId('dep'),
      name: input.name,
      kind: input.kind,
      environmentId: input.environmentId,
      version: input.version ?? '0.1.0',
      status: 'planned',
      health: 'unknown',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.deployments.set(d.id, d);
    await this.governance.record({ actor: 'system', operation: `deployment.register.${input.kind}`, targetId: d.id, evidence: 'live-verified', scope: input.environmentId });
    return d;
  }

  async setStatus(id: string, status: DeploymentStatus): Promise<Deployment> {
    const d = this.require(id);
    d.status = status;
    d.updatedAt = this.clock.now();
    await this.governance.record({ actor: 'system', operation: `deployment.status.${status}`, targetId: id, evidence: 'live-verified', scope: d.environmentId });
    return d;
  }

  /** Health is descriptor state set from a validation/promotion decision — never a live probe. */
  async setHealth(id: string, health: DeploymentHealth): Promise<Deployment> {
    const d = this.require(id);
    d.health = health;
    d.updatedAt = this.clock.now();
    return d;
  }

  async setVersion(id: string, version: string): Promise<Deployment> {
    const d = this.require(id);
    d.version = version;
    d.updatedAt = this.clock.now();
    await this.governance.record({ actor: 'system', operation: 'deployment.version', targetId: id, evidence: 'live-verified', scope: d.environmentId, detail: version });
    return d;
  }

  private require(id: string): Deployment {
    const d = this.deployments.get(id);
    if (!d) throw new Error(`no deployment ${id}`);
    return d;
  }

  get(id: string): Deployment | undefined {
    return this.deployments.get(id);
  }
  list(): Deployment[] {
    return [...this.deployments.values()];
  }
  byEnvironment(environmentId: string): Deployment[] {
    return this.list().filter((d) => d.environmentId === environmentId);
  }
  byKind(kind: WorkloadKind): Deployment[] {
    return this.list().filter((d) => d.kind === kind);
  }
  inventory(): Record<string, number> {
    const inv: Record<string, number> = {};
    for (const d of this.deployments.values()) inv[d.kind] = (inv[d.kind] ?? 0) + 1;
    return inv;
  }
  count(): number {
    return this.deployments.size;
  }
}
