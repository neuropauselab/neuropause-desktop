/**
 * Module 8 — Release Platform. Represents rolling / blue-green / canary / recreate / progressive
 * delivery and rollback. The release WORKFLOW is validated in-process (weights monotonic, ends at
 * 100, gates well-formed) — the rollout is NEVER executed. Reuses the Wave 4 HITL gate so an
 * AI-initiated production release cannot self-approve; a human must approve.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { HumanInTheLoopGate } from '@neuropause/automation';
import type { CloudOpsGovernance } from './governance';
import type { ReleasePlan, ReleaseStep } from './types';
import { RELEASE_STRATEGIES, type ReleaseStrategy } from './constants';

export interface PlanReleaseInput {
  deploymentId: string;
  strategy: ReleaseStrategy;
  production?: boolean;
  steps?: ReleaseStep[];
}

export interface ReleaseValidation {
  id: string;
  valid: boolean;
  problems: string[];
}

function defaultSteps(strategy: ReleaseStrategy): ReleaseStep[] {
  switch (strategy) {
    case 'rolling':
      return [{ name: 'roll', weight: 100, gate: 'auto' }];
    case 'blue-green':
      return [{ name: 'green-up', weight: 50, gate: 'auto' }, { name: 'switch', weight: 100, gate: 'manual' }];
    case 'canary':
      return [{ name: 'canary-10', weight: 10, gate: 'manual' }, { name: 'canary-50', weight: 50, gate: 'manual' }, { name: 'full', weight: 100, gate: 'auto' }];
    case 'recreate':
      return [{ name: 'up', weight: 100, gate: 'manual' }];
    case 'progressive':
      return [{ name: 's5', weight: 5, gate: 'auto' }, { name: 's25', weight: 25, gate: 'auto' }, { name: 's50', weight: 50, gate: 'manual' }, { name: 's100', weight: 100, gate: 'auto' }];
  }
}

export class ReleasePlatform {
  private readonly plans = new Map<string, ReleasePlan>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CloudOpsGovernance,
    private readonly hitl: HumanInTheLoopGate,
  ) {}

  async plan(input: PlanReleaseInput): Promise<ReleasePlan> {
    if (!RELEASE_STRATEGIES.includes(input.strategy)) throw new Error(`unknown release strategy: ${input.strategy}`);
    const steps = input.steps ?? defaultSteps(input.strategy);
    const plan: ReleasePlan = {
      id: randomId('rel'),
      deploymentId: input.deploymentId,
      strategy: input.strategy,
      steps,
      requiresApproval: input.production === true,
      approved: false,
      createdAt: this.clock.now(),
      evidence: 'live-verified',
      note: 'release workflow validated in-process — the rollout is never executed (real rollout is INFRA-PENDING)',
    };
    this.plans.set(plan.id, plan);
    await this.governance.record({ actor: 'system', operation: `release.plan.${input.strategy}`, targetId: plan.id, evidence: 'live-verified', scope: input.deploymentId });
    return plan;
  }

  /** Real workflow validation: weights strictly increasing, final step 100, gates well-formed. */
  validate(id: string): ReleaseValidation {
    const plan = this.require(id);
    const problems: string[] = [];
    let prev = -1;
    for (const s of plan.steps) {
      if (s.weight <= prev) problems.push(`non-increasing weight at ${s.name}`);
      if (s.weight < 0 || s.weight > 100) problems.push(`weight out of range at ${s.name}`);
      if (s.gate !== 'auto' && s.gate !== 'manual') problems.push(`invalid gate at ${s.name}`);
      prev = s.weight;
    }
    const last = plan.steps[plan.steps.length - 1];
    if (!last || last.weight !== 100) problems.push('final step must reach weight 100');
    return { id, valid: problems.length === 0, problems };
  }

  /** Approve a release. Reuses HITL: an AI-initiated production approval is refused. */
  async approve(id: string, opts: { actor: string; aiInitiated?: boolean }): Promise<ReleasePlan> {
    const plan = this.require(id);
    if (plan.requiresApproval) {
      const cls = this.hitl.classify('release.promote.production');
      if (opts.aiInitiated && !cls.aiAllowed) {
        throw new Error('production release approval requires a human — AI may not self-approve');
      }
    }
    plan.approved = true;
    await this.governance.record({ actor: opts.actor, operation: 'release.approve', targetId: id, evidence: 'live-verified', scope: plan.deploymentId });
    return plan;
  }

  private require(id: string): ReleasePlan {
    const plan = this.plans.get(id);
    if (!plan) throw new Error(`no release plan ${id}`);
    return plan;
  }

  get(id: string): ReleasePlan | undefined {
    return this.plans.get(id);
  }
  list(): ReleasePlan[] {
    return [...this.plans.values()];
  }
  strategies(): readonly ReleaseStrategy[] {
    return RELEASE_STRATEGIES;
  }
  count(): number {
    return this.plans.size;
  }
}
