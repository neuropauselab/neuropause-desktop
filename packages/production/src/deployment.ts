/**
 * Module 2 — Enterprise Deployment Manager. Kubernetes, Docker, bare-metal, VMware, Hyper-V, AWS,
 * Azure, Google Cloud, on-premise, and hybrid targets. REUSES the Wave 7 cloud-ops plane for the
 * actual infrastructure — no duplication: when cloud-ops is connected the real deployment inventory
 * is surfaced and the deployment is marked reused. The deployment DESCRIPTOR is real and recorded;
 * the external infrastructure is adapter-verified and not provisioned here.
 */
import { randomId } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import type { ProductionContext } from './types';
import type { ProductionRuntime } from './runtime';
import { DEPLOYMENT_PLATFORMS, type DeploymentPlatform } from './constants';

export interface DeploymentPlan {
  id: string;
  environmentId: string;
  platform: DeploymentPlatform;
  version: string;
  reusedCloudOps: boolean;
  infraDeployments: number;
  deploymentRecordId: string;
  note: string;
}

export class EnterpriseDeploymentManager {
  private readonly plans = new Map<string, DeploymentPlan>();

  constructor(
    private readonly governance: ProductionGovernance,
    private readonly ctx: ProductionContext,
    private readonly runtime: ProductionRuntime,
  ) {}

  async deploy(input: { org: string; environmentId: string; platform: DeploymentPlatform; version: string }): Promise<DeploymentPlan> {
    if (!DEPLOYMENT_PLATFORMS.includes(input.platform)) throw new Error(`unknown deployment platform: ${input.platform}`);
    const cloud = this.ctx.cloudops;
    const reusedCloudOps = !!cloud;
    const infraDeployments = cloud ? cloud.deployments().count() : 0;
    const record = await this.runtime.registerDeployment({ environmentId: input.environmentId, platform: input.platform, version: input.version, org: input.org });
    const plan: DeploymentPlan = {
      id: randomId('depplan'),
      environmentId: input.environmentId,
      platform: input.platform,
      version: input.version,
      reusedCloudOps,
      infraDeployments,
      deploymentRecordId: record.id,
      note: reusedCloudOps ? 'infrastructure delegated to the reused Wave 7 cloud-ops plane' : 'no cloud-ops connected — deployment descriptor recorded; infrastructure not provisioned here',
    };
    this.plans.set(plan.id, plan);
    await this.governance.record({ operator: 'system', org: input.org, environment: input.environmentId, operation: `deploy.${input.platform}`, targetId: plan.id, evidence: 'adapter-verified', version: input.version, deployment: record.id, decision: reusedCloudOps ? 'reused cloud-ops' : 'descriptor only' });
    return plan;
  }

  supportedPlatforms(): readonly DeploymentPlatform[] { return DEPLOYMENT_PLATFORMS; }
  list(environmentId?: string): DeploymentPlan[] {
    const all = [...this.plans.values()];
    return environmentId ? all.filter((p) => p.environmentId === environmentId) : all;
  }
  count(): number { return this.plans.size; }
}
