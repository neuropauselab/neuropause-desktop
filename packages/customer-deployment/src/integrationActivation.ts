/**
 * EPIC 5 — Customer Integration Activation. Activates configured adapters for ERP / CRM / HR / finance
 * / manufacturing / healthcare / collaboration / storage / messaging. An integration only becomes
 * 'active' when the customer's CREDENTIALS are supplied AND a verification passes — never on the
 * strength of a category alone. When the integration platform is wired in, the connector is registered
 * there (represented, not contacted). Credentials are handled as references, never stored as values.
 */
import { INTEGRATION_CATEGORIES, type IntegrationCategory, type ActivationStatus } from './constants';
import type { CustomerDeploymentContext } from './types';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export interface ActivationRecord {
  id: string;
  category: IntegrationCategory;
  system: string;
  status: ActivationStatus;
  credentialRef: string | null;
  verified: boolean;
  reusedIntegrationPlatform: boolean;
  note: string;
}

export class IntegrationActivation {
  private readonly activations = new Map<string, ActivationRecord>();

  constructor(
    private readonly ctx: CustomerDeploymentContext,
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  categories(): readonly IntegrationCategory[] {
    return INTEGRATION_CATEGORIES;
  }

  /** Activate an integration. 'active' requires BOTH a credential reference and a passed verification. */
  async activate(input: { deploymentId: string; category: IntegrationCategory; system: string; credentialRef?: string; verified?: boolean }): Promise<ActivationRecord> {
    const deployment = this.require(input.deploymentId);
    let reusedIntegrationPlatform = false;
    if (this.ctx.integrationPlatform) {
      await this.ctx.integrationPlatform.runtime().register({ name: input.system, category: input.category, system: input.system });
      reusedIntegrationPlatform = true;
    }

    const hasCred = Boolean(input.credentialRef);
    const verified = Boolean(input.verified) && hasCred;
    const status: ActivationStatus = verified ? 'active' : hasCred ? 'configured' : 'represented';

    const record: ActivationRecord = {
      id: `${input.category}:${input.system}`,
      category: input.category,
      system: input.system,
      status,
      credentialRef: input.credentialRef ?? null, // a reference only — never a secret value
      verified,
      reusedIntegrationPlatform,
      note:
        status === 'active'
          ? 'credentials referenced and verification passed — integration active'
          : status === 'configured'
            ? 'credentials referenced; verification pending — not active'
            : 'represented; no customer credentials supplied — not active',
    };
    this.activations.set(record.id, record);
    await this.gov.record({
      operator: this.operator,
      customer: deployment.customerId,
      tenant: deployment.tenantId,
      environment: deployment.environmentId,
      epic: 'E5',
      operation: 'activate-integration',
      targetId: record.id,
      evidence: status === 'active' ? 'live-verified' : 'adapter-verified',
      decision: status,
    });
    return record;
  }

  get(id: string): ActivationRecord | undefined {
    return this.activations.get(id);
  }
  list(category?: IntegrationCategory): ActivationRecord[] {
    const all = [...this.activations.values()];
    return category ? all.filter((a) => a.category === category) : all;
  }
  activeCount(): number {
    return [...this.activations.values()].filter((a) => a.status === 'active').length;
  }

  private require(deploymentId: string): { customerId: string; tenantId: string; environmentId: string } {
    const d = this.runtime.deployment(deploymentId);
    if (!d) throw new Error(`unknown deployment: ${deploymentId}`);
    return d;
  }
}
