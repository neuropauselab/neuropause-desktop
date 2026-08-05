/**
 * Build item 3 — Deployment Executor. REUSES Program 1B (via the 1C environment-provisioning
 * orchestration). It runs ONLY after (a) explicit operator approval AND (b) successful environment
 * validation. Even then it does not apply anything itself: it PREPARES the exact commands the operator
 * runs (terraform apply / helm upgrade / kubectl apply) and returns `executed:false`, `deployed:false`.
 * It NEVER fabricates success — no result ever reads 'succeeded' or 'deployed'.
 */
import type { OdContext, OperatorInputs } from './types';
import type { OperatorDeploymentGovernance } from './governance';

export interface ExecuteResult {
  status: 'blocked' | 'pending' | 'prepared';
  executed: false;
  deployed: false;
  commands: string[];
  reason: string;
}

export class DeploymentExecutor {
  constructor(
    private readonly ctx: OdContext,
    private readonly gov: OperatorDeploymentGovernance,
    private readonly operator: string,
  ) {}

  async execute(input: { inputs: OperatorInputs; approval: { operator: string; approved: boolean }; validationPassed: boolean }): Promise<ExecuteResult> {
    if (!input.approval.approved) {
      await this.gov.record({ operator: this.operator, environment: 'production', target: 'executor', operation: 'execute-blocked', result: 'approval-required', evidence: 'infrastructure-pending' });
      return { status: 'blocked', executed: false, deployed: false, commands: [], reason: 'operator approval required' };
    }
    if (!input.validationPassed) {
      await this.gov.record({ operator: this.operator, environment: 'production', target: 'executor', operation: 'execute-blocked', result: 'validation-required', evidence: 'infrastructure-pending' });
      return { status: 'blocked', executed: false, deployed: false, commands: [], reason: 'environment validation must pass before deployment' };
    }
    if (!this.ctx.environmentProvisioning) {
      return { status: 'pending', executed: false, deployed: false, commands: [], reason: 'no environment-provisioning engine wired in' };
    }
    // Reuse the 1C orchestration to PREPARE the phase artifacts + commands. Nothing is applied here.
    const outcome = await this.ctx.environmentProvisioning.cloud().provision({ ...input.inputs, approval: input.approval });
    const commands = outcome.steps.flatMap((s) => s.applyCommands);
    await this.gov.record({ operator: input.approval.operator, environment: 'production', target: 'executor', operation: 'execute-prepared', result: outcome.status === 'prepared' ? 'prepared' : 'pending', evidence: 'infrastructure-pending' });
    return {
      status: outcome.status === 'prepared' ? 'prepared' : 'pending',
      executed: false,
      deployed: false,
      commands,
      reason: 'commands prepared — the operator runs terraform apply / helm upgrade / kubectl apply with real credentials; this executor applied nothing',
    };
  }
}
