/**
 * Build item 5 — Rollback. Automatically generates a rollback plan when a failure condition is met
 * (rollout timeout, failed pods, unhealthy API, or failed migrations). It REUSES the 1C rollback plan; it
 * generates the plan but executes nothing — the operator runs the reverse steps.
 */
import { ROLLBACK_TRIGGERS, type RollbackTrigger } from './constants';
import type { OdContext } from './types';
import type { OperatorDeploymentGovernance } from './governance';

export interface RollbackOutcome {
  triggered: boolean;
  reasons: RollbackTrigger[];
  plan: { executed: false; steps: string[] } | null;
}

export class RollbackEngine {
  constructor(
    private readonly ctx: OdContext,
    private readonly gov: OperatorDeploymentGovernance,
    private readonly operator: string,
  ) {}

  triggers(): readonly RollbackTrigger[] {
    return ROLLBACK_TRIGGERS;
  }

  shouldRollback(conditions: Partial<Record<RollbackTrigger, boolean>>): boolean {
    return ROLLBACK_TRIGGERS.some((t) => conditions[t] === true);
  }

  /** Generate a rollback plan if any trigger fired. Executes nothing. */
  async autoRollback(conditions: Partial<Record<RollbackTrigger, boolean>>): Promise<RollbackOutcome> {
    const reasons = ROLLBACK_TRIGGERS.filter((t) => conditions[t] === true);
    if (reasons.length === 0) return { triggered: false, reasons: [], plan: null };
    const plan = this.ctx.environmentProvisioning ? await this.ctx.environmentProvisioning.cloud().rollback() : { executed: false as const, steps: [] };
    await this.gov.record({ operator: this.operator, environment: 'production', target: 'rollback', operation: 'auto-rollback', result: `triggered:${reasons.join(',')}`, evidence: 'live-verified' });
    return { triggered: true, reasons, plan };
  }
}
