/**
 * EPIC 1 — Cloud Provisioning Runtime. Orchestrates provisioning across AWS/Azure/GCP/self-hosted with
 * three operations:
 *   • PREVIEW    — generates every phase's artifact; provisions nothing (`mutated:false`).
 *   • PROVISION  — runs the FULL prerequisite gate first; if any input is missing it returns
 *                  'PENDING - OPERATOR INPUT REQUIRED' and stops. When satisfied it PREPARES each phase
 *                  (artifacts + apply commands); it applies nothing, so `provisioned` is always false.
 *   • ROLLBACK   — returns a reverse-order rollback plan; it executes nothing.
 */
import { CLOUD_PROVIDERS, PENDING_OPERATOR_INPUT, PROVISIONING_PHASES, type CloudProvider } from './constants';
import type { OperatorInputs, ProvisioningStep } from './types';
import type { PrerequisiteGate } from './prerequisites';
import type { PhaseProvisioner } from './provisioners';
import type { EnvironmentProvisioningGovernance } from './governance';

export interface PreviewOutcome {
  mode: 'preview';
  mutated: false;
  steps: ProvisioningStep[];
}

export interface ProvisionOutcome {
  status: 'prepared' | typeof PENDING_OPERATOR_INPUT;
  ready: boolean;
  missing: string[];
  provisioned: false;
  appliedToInfrastructure: false;
  steps: ProvisioningStep[];
}

export interface RollbackPlan {
  executed: false;
  steps: string[];
}

const ROLLBACK_BY_PHASE: Record<string, string> = {
  monitoring: 'kubectl delete -f monitoring.yaml',
  deployment: 'helm rollback np <previous-revision> -n neuropause',
  secrets: 'kubectl delete externalsecret neuropause-backend-secrets -n neuropause',
  'dns-tls': 'revert the DNS record; delete the Certificate (cert-manager)',
  databases: 'restore from backup (scripts/restore-db.sh) — never delete data',
  kubernetes: 'kubectl delete -f neuropause-production.yaml (namespace last)',
  infrastructure: 'terraform destroy -target=... (reviewed plan only)',
};

export class CloudProvisioningRuntime {
  constructor(
    private readonly gate: PrerequisiteGate,
    private readonly provisioner: PhaseProvisioner,
    private readonly gov: EnvironmentProvisioningGovernance,
    private readonly operator: string,
  ) {}

  providers(): readonly CloudProvider[] {
    return CLOUD_PROVIDERS;
  }

  /** PREVIEW — never provisions. */
  async preview(inputs: OperatorInputs): Promise<PreviewOutcome> {
    const steps = await this.provisioner.previewAll(inputs);
    return { mode: 'preview', mutated: false, steps };
  }

  /** PROVISION — full gate first; stop at PENDING if any input is missing; otherwise prepare each phase. */
  async provision(inputs: OperatorInputs): Promise<ProvisionOutcome> {
    const gate = this.gate.check(inputs);
    if (!gate.ready) {
      await this.gov.record({ operator: this.operator, environment: 'production', target: 'all', epic: 'E1', operation: 'provision-blocked', result: PENDING_OPERATOR_INPUT, evidence: 'infrastructure-pending' });
      return { status: PENDING_OPERATOR_INPUT, ready: false, missing: gate.missing, provisioned: false, appliedToInfrastructure: false, steps: [] };
    }
    const steps = await this.provisioner.provisionAll(inputs);
    await this.gov.record({ operator: inputs.approval!.operator, environment: 'production', target: 'all', epic: 'E1', operation: 'provision-prepared', result: 'prepared', evidence: 'infrastructure-pending' });
    return { status: 'prepared', ready: true, missing: [], provisioned: false, appliedToInfrastructure: false, steps };
  }

  /** ROLLBACK — returns a reverse-order plan; executes nothing. */
  async rollback(): Promise<RollbackPlan> {
    const steps = [...PROVISIONING_PHASES].reverse().map((p) => `${p}: ${ROLLBACK_BY_PHASE[p]}`);
    await this.gov.record({ operator: this.operator, environment: 'production', target: 'all', epic: 'E1', operation: 'rollback-plan', result: 'planned', evidence: 'live-verified' });
    return { executed: false, steps };
  }
}
