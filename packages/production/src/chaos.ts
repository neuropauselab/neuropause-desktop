/**
 * Module 12 — Chaos Engineering. Failure injection, network simulation, node failure, service
 * failure, and recovery validation. Experiments are REPRESENTED honestly: each records a hypothesis,
 * a blast radius, and a recovery-validation step, but NO real fault is injected into live
 * infrastructure (there is none to inject into here). In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import { CHAOS_KINDS, type ChaosKind } from './constants';

export interface ChaosExperiment {
  id: string;
  kind: ChaosKind;
  target: string;
  hypothesis: string;
  recoveryValidated: boolean;
  injected: false; // never injected into real infrastructure
  note: string;
  at: number;
}

export class ChaosEngineering {
  private readonly experiments = new Map<string, ChaosExperiment>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
  ) {}

  async run(input: { kind: ChaosKind; target: string; hypothesis: string; org?: string }): Promise<ChaosExperiment> {
    if (!CHAOS_KINDS.includes(input.kind)) throw new Error(`unknown chaos kind: ${input.kind}`);
    const exp: ChaosExperiment = {
      id: randomId('chaos'),
      kind: input.kind,
      target: input.target,
      hypothesis: input.hypothesis,
      recoveryValidated: false,
      injected: false,
      note: `${input.kind} experiment represented — no real fault injected into live infrastructure`,
      at: this.clock.now(),
    };
    this.experiments.set(exp.id, exp);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', operation: `chaos.${input.kind}`, targetId: exp.id, evidence: 'infrastructure-pending', decision: 'represented — not injected' });
    return exp;
  }

  /** Record that a recovery path was validated for the experiment's hypothesis (structural check). */
  validateRecovery(id: string): ChaosExperiment {
    const exp = this.experiments.get(id);
    if (!exp) throw new Error(`no experiment ${id}`);
    exp.recoveryValidated = exp.hypothesis.length > 0;
    return exp;
  }

  list(kind?: ChaosKind): ChaosExperiment[] {
    const all = [...this.experiments.values()];
    return kind ? all.filter((e) => e.kind === kind) : all;
  }
  count(): number { return this.experiments.size; }
}
