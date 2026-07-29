/**
 * EPIC 9 — AI Workforce Activation. Activates the Executive / Operations / Sales / HR / Finance /
 * Customer-Success AI workers. Only LICENSED workers are enabled: a worker is registered in the reused
 * workforce platform only when a license is present (verified through the reused commercial licensing
 * platform when wired in). An unlicensed worker is recorded represented/not-enabled — never silently
 * activated.
 */
import { AI_WORKFORCE_ROLES, type AiWorkforceRole } from './constants';
import type { CustomerDeploymentContext } from './types';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export interface AiWorkerActivation {
  role: AiWorkforceRole;
  enabled: boolean;
  licensed: boolean;
  agentId: string | null;
  reusedWorkforce: boolean;
  note: string;
}

export class AiWorkforceActivation {
  private readonly activations = new Map<string, AiWorkerActivation>();

  constructor(
    private readonly ctx: CustomerDeploymentContext,
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  roles(): readonly AiWorkforceRole[] {
    return AI_WORKFORCE_ROLES;
  }

  /** Enable an AI worker only if licensed. Registers a real agent in the reused workforce platform. */
  async activate(input: { deploymentId: string; role: AiWorkforceRole; licensed: boolean }): Promise<AiWorkerActivation> {
    const deployment = this.require(input.deploymentId);
    const tenant = this.runtime.tenant(deployment.tenantId);
    const orgId = tenant?.customerId ?? deployment.customerId;

    let agentId: string | null = null;
    let enabled = false;
    let reusedWorkforce = false;
    if (input.licensed && this.ctx.workforce) {
      const agent = await this.ctx.workforce.agents().register({ name: `${input.role}-ai`, role: input.role, orgId });
      agentId = agent.id;
      enabled = Boolean(agent.id);
      reusedWorkforce = true;
    }

    const activation: AiWorkerActivation = {
      role: input.role,
      enabled,
      licensed: input.licensed,
      agentId,
      reusedWorkforce,
      note: !input.licensed
        ? 'not licensed — worker represented, not enabled'
        : this.ctx.workforce
          ? 'licensed — worker enabled via the reused workforce platform'
          : 'licensed but workforce platform not wired in — represented',
    };
    this.activations.set(input.role, activation);
    await this.gov.record({
      operator: this.operator,
      customer: deployment.customerId,
      tenant: deployment.tenantId,
      environment: deployment.environmentId,
      epic: 'E9',
      operation: 'activate-ai-worker',
      targetId: input.role,
      evidence: enabled ? 'live-verified' : 'business-data-pending',
      decision: enabled ? 'enabled' : 'not-enabled',
    });
    return activation;
  }

  list(): AiWorkerActivation[] {
    return [...this.activations.values()];
  }
  enabledCount(): number {
    return [...this.activations.values()].filter((a) => a.enabled).length;
  }

  private require(deploymentId: string): { customerId: string; tenantId: string; environmentId: string } {
    const d = this.runtime.deployment(deploymentId);
    if (!d) throw new Error(`unknown deployment: ${deploymentId}`);
    return d;
  }
}
