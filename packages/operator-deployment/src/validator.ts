/**
 * Build item 2 — Environment Validator. Before any deployment, verifies that credentials exist and that
 * Kubernetes, DNS, the TLS issuer, the registry, and storage are reachable. Each check reports the command
 * that would verify it; a check is `verified` only when a real reachability probe (out-of-band) confirms
 * it. In this control plane no external system is reachable, so validation STOPS and returns
 * 'PENDING - OPERATOR ACTION REQUIRED' with the unverified checks. It never fabricates reachability.
 */
import { PENDING_OPERATOR_ACTION, VALIDATION_CHECKS, type ValidationCheck } from './constants';
import type { WizardConfig } from './types';
import type { OperatorDeploymentGovernance } from './governance';

const VALIDATION_COMMANDS: Record<ValidationCheck, string> = {
  credentials: 'verify cloud credentials (e.g. aws sts get-caller-identity)',
  'kubernetes-reachable': 'kubectl cluster-info',
  'dns-available': 'dig +short <domain>',
  'tls-issuer-available': 'kubectl get clusterissuer',
  'registry-reachable': 'docker login <registry> && docker pull <registry>/hello',
  'storage-reachable': 'object-storage write/read/delete round-trip',
};

export interface ValidationResult {
  ready: boolean;
  status: 'READY' | typeof PENDING_OPERATOR_ACTION;
  checks: Array<{ check: ValidationCheck; verified: false; command: string }>;
}

export class EnvironmentValidator {
  constructor(
    private readonly gov: OperatorDeploymentGovernance,
    private readonly operator: string,
  ) {}

  checks(): readonly ValidationCheck[] {
    return VALIDATION_CHECKS;
  }

  /**
   * Runs the pre-deployment checks. Without a real reachability probe every check is unverified, so the
   * result is PENDING - OPERATOR ACTION REQUIRED. Nothing proceeds until an operator's probe verifies each.
   */
  async validate(_config: WizardConfig): Promise<ValidationResult> {
    const checks = VALIDATION_CHECKS.map((check) => ({ check, verified: false as const, command: VALIDATION_COMMANDS[check] }));
    await this.gov.record({ operator: this.operator, environment: 'production', target: 'validation', operation: 'validate-environment', result: PENDING_OPERATOR_ACTION, evidence: 'infrastructure-pending' });
    return { ready: false, status: PENDING_OPERATOR_ACTION, checks };
  }
}
