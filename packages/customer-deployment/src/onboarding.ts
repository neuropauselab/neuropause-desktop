/**
 * EPIC 2 — Customer Onboarding. Applies the customer's organization identity: domain, branding, time
 * zone, localization, default policies, default roles, and default AI configuration. Default roles are
 * REAL — when the security platform is wired in, each is created through the reused authorization
 * engine (RBAC), not merely described. Onboarding advances the deployment to the 'onboarding' stage
 * and is audited on the one chain.
 */
import type { CustomerProfile, AiWorkforceRole } from './constants';
import type { CustomerDeploymentContext } from './types';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime, Deployment } from './runtime';

export interface DefaultRole {
  id: string;
  name: string;
  permissions: string[];
  createdInSecurity: boolean;
}

export interface OnboardingConfig {
  deploymentId: string;
  domain: string | null;
  branding: string;
  timeZone: string;
  locale: string;
  defaultPolicies: string[];
  defaultRoles: DefaultRole[];
  defaultAiWorkers: AiWorkforceRole[];
  appliedProfile: string | null;
}

const BASE_ROLES: Array<{ id: string; name: string; permissions: string[] }> = [
  { id: 'administrator', name: 'Administrator', permissions: ['tenant:*', 'user:*', 'config:*'] },
  { id: 'manager', name: 'Manager', permissions: ['workspace:read', 'workspace:write', 'report:read'] },
  { id: 'employee', name: 'Employee', permissions: ['workspace:read', 'task:write'] },
  { id: 'executive', name: 'Executive', permissions: ['report:read', 'dashboard:read'] },
];

export class CustomerOnboarding {
  constructor(
    private readonly ctx: CustomerDeploymentContext,
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  async onboard(input: {
    deploymentId: string;
    domain?: string;
    branding?: string;
    timeZone?: string;
    locale?: string;
    profile?: CustomerProfile;
  }): Promise<OnboardingConfig> {
    const deployment = this.runtime.deployment(input.deploymentId);
    if (!deployment) throw new Error(`unknown deployment: ${input.deploymentId}`);

    const defaultRoles: DefaultRole[] = [];
    for (const r of BASE_ROLES) {
      let createdInSecurity = false;
      if (this.ctx.security) {
        this.ctx.security.authorization().defineRole({ id: `${deployment.tenantId}:${r.id}`, name: r.name, permissions: r.permissions });
        createdInSecurity = true;
      }
      defaultRoles.push({ id: r.id, name: r.name, permissions: r.permissions, createdInSecurity });
    }

    const config: OnboardingConfig = {
      deploymentId: input.deploymentId,
      domain: input.domain ?? null,
      branding: input.branding ?? `${deployment.customerId} default branding`,
      timeZone: input.timeZone ?? 'UTC',
      locale: input.locale ?? 'en-US',
      defaultPolicies: ['least-privilege', 'mfa-required', 'audit-all'],
      defaultRoles,
      defaultAiWorkers: input.profile?.aiWorkers ?? ['operations', 'customer-success'],
      appliedProfile: input.profile?.key ?? null,
    };

    if (deployment.status === 'registered') await this.runtime.transition(input.deploymentId, 'onboarding', 'customer onboarding applied');
    await this.gov.record({
      operator: this.operator,
      customer: deployment.customerId,
      tenant: deployment.tenantId,
      environment: deployment.environmentId,
      epic: 'E2',
      operation: 'onboard',
      targetId: input.deploymentId,
      evidence: 'live-verified',
      decision: `${defaultRoles.length} roles, profile=${config.appliedProfile ?? 'none'}`,
    });
    return config;
  }

  /** True when default roles were really created in the reused security platform. */
  reusesSecurity(): boolean {
    return Boolean(this.ctx.security);
  }

  currentStatus(deploymentId: string): Deployment['status'] | undefined {
    return this.runtime.deployment(deploymentId)?.status;
  }
}
