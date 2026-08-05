/**
 * EPIC 4 — Enterprise Rollout Framework. Single-tenant and multi-tenant deployment, regional and global
 * rollout, rollout waves, and controlled releases. A rollout is a PLAN: waves carry target percentages
 * and are advanced through a controlled-release sequence in the plan — this never shifts real production
 * traffic. A real production rollout is infrastructure-pending. Wave percentages are validated (0–100);
 * the wave sequence is real, deny-by-default in order.
 */
import { randomId } from '@neuropause/cloud-core';
import { type RolloutMode } from './constants';
import type { DeploymentOrchestratorGovernance } from './governance';

export interface RolloutWave {
  name: string;
  targetPercentage: number;
  released: boolean;
}
export interface Rollout {
  id: string;
  deploymentId: string;
  mode: RolloutMode;
  regions: string[];
  waves: RolloutWave[];
  releasedWaves: number;
}

export class EnterpriseRollout {
  private readonly rollouts = new Map<string, Rollout>();

  constructor(
    private readonly gov: DeploymentOrchestratorGovernance,
    private readonly operator: string,
  ) {}

  async planRollout(input: { deploymentId: string; mode: RolloutMode; regions?: string[] }): Promise<Rollout> {
    const rollout: Rollout = { id: randomId('rollout'), deploymentId: input.deploymentId, mode: input.mode, regions: input.regions ?? [], waves: [], releasedWaves: 0 };
    this.rollouts.set(rollout.id, rollout);
    await this.gov.record({ operator: this.operator, organization: '_rollout', environment: '-', version: '-', epic: 'E4', operation: 'plan-rollout', targetId: rollout.id, evidence: 'live-verified', decision: input.mode });
    return rollout;
  }

  async addWave(input: { rolloutId: string; name: string; targetPercentage: number }): Promise<RolloutWave> {
    const rollout = this.require(input.rolloutId);
    const pct = Math.max(0, Math.min(100, input.targetPercentage));
    const wave: RolloutWave = { name: input.name, targetPercentage: pct, released: false };
    rollout.waves.push(wave);
    await this.gov.record({ operator: this.operator, organization: '_rollout', environment: '-', version: '-', epic: 'E4', operation: 'add-wave', targetId: input.rolloutId, evidence: 'live-verified', decision: `${input.name}@${pct}%` });
    return wave;
  }

  /** Controlled release — advances the NEXT wave in the plan. Represented; no real traffic is shifted. */
  async controlledRelease(rolloutId: string): Promise<{ rollout: Rollout; released: RolloutWave | null; note: string }> {
    const rollout = this.require(rolloutId);
    const next = rollout.waves.find((w) => !w.released);
    if (!next) return { rollout, released: null, note: 'all planned waves released (in plan); production rollout remains infrastructure-pending' };
    next.released = true;
    rollout.releasedWaves += 1;
    await this.gov.record({ operator: this.operator, organization: '_rollout', environment: 'production-target', version: '-', epic: 'E4', operation: 'controlled-release', targetId: rolloutId, evidence: 'infrastructure-pending', decision: `${next.name} (plan only)` });
    return { rollout, released: next, note: 'controlled release advanced in the plan; no real production traffic is shifted' };
  }

  status(rolloutId: string): { mode: RolloutMode; waves: number; releasedWaves: number; regions: number } {
    const rollout = this.require(rolloutId);
    return { mode: rollout.mode, waves: rollout.waves.length, releasedWaves: rollout.releasedWaves, regions: rollout.regions.length };
  }

  rolloutCount(): number {
    return this.rollouts.size;
  }

  private require(id: string): Rollout {
    const r = this.rollouts.get(id);
    if (!r) throw new Error(`unknown rollout: ${id}`);
    return r;
  }
}
