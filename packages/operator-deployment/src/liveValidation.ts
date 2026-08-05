/**
 * Build item 4 — Live Validation. Runs kubectl rollout status, API health, database health, Redis, TLS,
 * monitoring, and logging checks and collects every output. It REUSES the 1C acceptance validator; with no
 * real deployment every check is pending — no output is fabricated.
 */
import type { OdContext } from './types';
import type { OperatorDeploymentGovernance } from './governance';

export interface LiveValidationResult {
  reused: boolean;
  allPending: boolean;
  checks: Array<{ check: string; status: string; command: string }>;
}

export class LiveValidation {
  constructor(
    private readonly ctx: OdContext,
    private readonly gov: OperatorDeploymentGovernance,
    private readonly operator: string,
  ) {}

  async run(): Promise<LiveValidationResult> {
    if (this.ctx.environmentProvisioning) {
      const report = await this.ctx.environmentProvisioning.acceptance().report();
      await this.gov.record({ operator: this.operator, environment: 'production', target: 'live-validation', operation: 'run-live-validation', result: 'pending', evidence: 'business-data-pending' });
      return { reused: true, allPending: report.checks.every((c) => c.status === 'pending'), checks: report.checks.map((c) => ({ check: c.check, status: c.status, command: c.command })) };
    }
    return { reused: false, allPending: true, checks: [] };
  }
}
