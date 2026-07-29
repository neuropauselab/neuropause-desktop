/**
 * Module 4 — Zero-Downtime Upgrade Platform. Rolling, blue-green, canary, and progressive rollout
 * strategies with automatic rollback planning. The strategies are REPRESENTED honestly: this module
 * produces the real, ordered step plan and the rollback plan for each strategy, but it shifts no
 * live traffic and mutates no real infrastructure (that is the reused cloud-ops/deployment plane's
 * job once configured). In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import { UPGRADE_STRATEGIES, type UpgradeStrategy } from './constants';

export interface UpgradePlan {
  id: string;
  strategy: UpgradeStrategy;
  environmentId: string;
  fromVersion: string;
  toVersion: string;
  steps: string[];
  rollbackSteps: string[];
  canaryPercent?: number;
  note: string;
  createdAt: number;
}

const stepsFor = (s: UpgradeStrategy, to: string, canary: number): string[] => {
  switch (s) {
    case 'rolling': return ['drain batch', `update batch → ${to}`, 'health-check batch', 'repeat until complete'];
    case 'blue-green': return [`stand up green (${to})`, 'validate green health', 'switch traffic blue→green', 'retire blue'];
    case 'canary': return [`route ${canary}% to ${to}`, 'observe error/latency', 'increase gradually', 'promote to 100%'];
    case 'progressive': return [`stage 1: ${canary}%`, 'stage 2: 25%', 'stage 3: 50%', 'stage 4: 100%'];
  }
};

export class ZeroDowntimeUpgrade {
  private readonly plans = new Map<string, UpgradePlan>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
  ) {}

  async plan(input: { strategy: UpgradeStrategy; environmentId: string; fromVersion: string; toVersion: string; canaryPercent?: number; org?: string }): Promise<UpgradePlan> {
    if (!UPGRADE_STRATEGIES.includes(input.strategy)) throw new Error(`unknown upgrade strategy: ${input.strategy}`);
    const canary = input.canaryPercent ?? 10;
    const plan: UpgradePlan = {
      id: randomId('upl'),
      strategy: input.strategy,
      environmentId: input.environmentId,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      steps: stepsFor(input.strategy, input.toVersion, canary),
      rollbackSteps: ['halt rollout', `revert to ${input.fromVersion}`, 'validate health', 'resume'],
      ...(input.strategy === 'canary' || input.strategy === 'progressive' ? { canaryPercent: canary } : {}),
      note: `${input.strategy} strategy represented — real traffic is shifted by the reused deployment plane once configured, not here`,
      createdAt: this.clock.now(),
    };
    this.plans.set(plan.id, plan);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: input.environmentId, operation: `upgrade.${input.strategy}`, targetId: plan.id, evidence: 'live-verified', version: input.toVersion });
    return plan;
  }

  get(id: string): UpgradePlan | undefined { return this.plans.get(id); }
  list(): UpgradePlan[] { return [...this.plans.values()]; }
  count(): number { return this.plans.size; }
}
