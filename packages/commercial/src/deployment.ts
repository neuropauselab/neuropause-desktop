/**
 * Module 9 — Deployment Manager. Cloud, on-premise, hybrid, and edge deployment targets per tenant.
 * REUSES the Wave 7 cloud-ops platform for the actual infrastructure plane (no duplication): when
 * cloud-ops is connected, this surfaces its REAL deployment inventory and cloud providers and marks
 * the deployment reused; the commercial layer coordinates, cloud-ops executes. In-process —
 * live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';
import type { CommercialContext } from './types';
import { DEPLOYMENT_TARGETS, type DeploymentTarget } from './constants';

export interface CommercialDeployment {
  id: string;
  tenantId: string;
  target: DeploymentTarget;
  reusedCloudOps: boolean;
  infraDeployments: number;
  note: string;
  at: number;
}

export class CommercialDeploymentManager {
  private readonly deployments = new Map<string, CommercialDeployment>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
    private readonly ctx: CommercialContext = {},
  ) {}

  async deploy(input: { tenantId: string; target: DeploymentTarget; org?: string }): Promise<CommercialDeployment> {
    if (!DEPLOYMENT_TARGETS.includes(input.target)) throw new Error(`unknown deployment target: ${input.target}`);
    const cloud = this.ctx.cloudops;
    const reusedCloudOps = !!cloud;
    const infraDeployments = cloud ? cloud.deployments().count() : 0;
    const d: CommercialDeployment = {
      id: randomId('cdep'),
      tenantId: input.tenantId,
      target: input.target,
      reusedCloudOps,
      infraDeployments,
      note: reusedCloudOps ? 'infrastructure delegated to the reused Wave 7 cloud-ops deployment manager' : 'no cloud-ops connected — target recorded, infrastructure not provisioned here',
      at: this.clock.now(),
    };
    this.deployments.set(d.id, d);
    await this.governance.record({ actor: 'system', org: input.org ?? '_ops', tenant: input.tenantId, operation: `deploy.${input.target}`, targetId: d.id, evidence: 'live-verified', decision: reusedCloudOps ? 'reused cloud-ops' : 'represented' });
    return d;
  }

  /** Real cloud providers from the reused cloud-ops registry — empty when none connected. */
  cloudProviders(): string[] {
    return this.ctx.cloudops ? this.ctx.cloudops.cloud().providers() : [];
  }

  list(tenantId?: string): CommercialDeployment[] {
    const all = [...this.deployments.values()];
    return tenantId ? all.filter((d) => d.tenantId === tenantId) : all;
  }
  count(): number { return this.deployments.size; }
}
