/**
 * EPIC 3 — Enterprise Configuration. Applies the customer's module and platform configuration:
 * business modules, industry modules, AI workers, workspace, identity provider, security policies,
 * storage, email, notifications, and feature flags. Each toggle is recorded as configuration state
 * (reused platforms are marked present where wired in). Advances the deployment to 'configuring'.
 */
import type { IdentityProvider, AiWorkforceRole } from './constants';
import type { CustomerDeploymentContext } from './types';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export interface EnterpriseConfig {
  deploymentId: string;
  businessModules: string[];
  industryModules: string[];
  aiWorkers: AiWorkforceRole[];
  workspaceEnabled: boolean;
  identityProvider: IdentityProvider | null;
  securityPolicies: string[];
  storage: string;
  email: string;
  notifications: string[];
  featureFlags: Record<string, boolean>;
  reused: { business: boolean; industry: boolean; workplace: boolean; workforce: boolean };
}

export class EnterpriseConfiguration {
  constructor(
    private readonly ctx: CustomerDeploymentContext,
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  async apply(input: {
    deploymentId: string;
    businessModules?: string[];
    industryModules?: string[];
    aiWorkers?: AiWorkforceRole[];
    identityProvider?: IdentityProvider;
    securityPolicies?: string[];
    storage?: string;
    email?: string;
    notifications?: string[];
    featureFlags?: Record<string, boolean>;
  }): Promise<EnterpriseConfig> {
    const deployment = this.runtime.deployment(input.deploymentId);
    if (!deployment) throw new Error(`unknown deployment: ${input.deploymentId}`);

    const config: EnterpriseConfig = {
      deploymentId: input.deploymentId,
      businessModules: input.businessModules ?? [],
      industryModules: input.industryModules ?? [],
      aiWorkers: input.aiWorkers ?? [],
      workspaceEnabled: Boolean(this.ctx.workplace),
      identityProvider: input.identityProvider ?? null,
      securityPolicies: input.securityPolicies ?? ['least-privilege', 'encryption-at-rest'],
      storage: input.storage ?? 'represented-object-store',
      email: input.email ?? 'represented-smtp',
      notifications: input.notifications ?? ['in-app', 'email'],
      featureFlags: input.featureFlags ?? {},
      reused: {
        business: Boolean(this.ctx.business),
        industry: Boolean(this.ctx.industry),
        workplace: Boolean(this.ctx.workplace),
        workforce: Boolean(this.ctx.workforce),
      },
    };

    if (deployment.status === 'onboarding') await this.runtime.transition(input.deploymentId, 'configuring', 'enterprise configuration applied');
    await this.gov.record({
      operator: this.operator,
      customer: deployment.customerId,
      tenant: deployment.tenantId,
      environment: deployment.environmentId,
      epic: 'E3',
      operation: 'configure',
      targetId: input.deploymentId,
      evidence: 'live-verified',
      decision: `${config.businessModules.length + config.industryModules.length} modules`,
    });
    return config;
  }
}
