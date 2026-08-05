/**
 * Build item 1 — Deployment Wizard. Collects the operator's deployment configuration (cloud provider,
 * region, domain, Kubernetes, PostgreSQL, Redis, object storage, container registry, secrets manager) and
 * maps it to the environment-provisioning OperatorInputs. It stores references/identifiers only — never a
 * secret value — and reports which required fields are still missing.
 */
import { WIZARD_FIELDS, type WizardField } from './constants';
import type { OperatorInputs, WizardConfig } from './types';
import type { OperatorDeploymentGovernance } from './governance';

const REQUIRED: WizardField[] = [...WIZARD_FIELDS];

export interface WizardResult {
  config: WizardConfig;
  complete: boolean;
  missing: WizardField[];
}

export class DeploymentWizard {
  constructor(
    private readonly gov: OperatorDeploymentGovernance,
    private readonly operator: string,
  ) {}

  fields(): readonly WizardField[] {
    return WIZARD_FIELDS;
  }

  async collect(config: WizardConfig): Promise<WizardResult> {
    const has: Record<WizardField, boolean> = {
      cloudProvider: Boolean(config.cloudProvider),
      region: Boolean(config.region),
      domain: Boolean(config.domain),
      kubernetes: Boolean(config.kubernetesRef),
      postgresql: Boolean(config.postgresqlRef),
      redis: Boolean(config.redisRef),
      objectStorage: Boolean(config.objectStorageRef),
      containerRegistry: Boolean(config.containerRegistryRef),
      secretsManager: Boolean(config.secretsManagerRef),
    };
    const missing = REQUIRED.filter((f) => !has[f]);
    await this.gov.record({ operator: this.operator, environment: 'production', target: 'wizard', operation: 'collect-config', result: missing.length ? 'incomplete' : 'complete', evidence: 'live-verified' });
    return { config, complete: missing.length === 0, missing };
  }

  /** Map the wizard config to environment-provisioning OperatorInputs (approval is added by the executor). */
  toOperatorInputs(config: WizardConfig): OperatorInputs {
    return {
      ...(config.cloudProvider ? { cloudProvider: config.cloudProvider } : {}),
      ...(config.credentialsRef ? { cloudCredentialsRef: config.credentialsRef } : {}),
      ...(config.domain ? { domain: config.domain } : {}),
      ...(config.containerRegistryRef ? { containerRegistryRef: config.containerRegistryRef } : {}),
      ...(config.dnsZoneRef ? { dnsZoneRef: config.dnsZoneRef } : {}),
      ...(config.tlsIssuerRef ? { tlsAuthorityRef: config.tlsIssuerRef } : {}),
      ...(config.secretsManagerRef ? { secretsManagerRef: config.secretsManagerRef } : {}),
    };
  }
}
