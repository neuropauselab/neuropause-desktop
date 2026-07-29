/**
 * Module 9 — Enterprise Simulation Engine. What-if / capacity / resource / financial-scenario /
 * demand / disaster simulations. EVERY result is CLEARLY MARKED AS A PROJECTION (projection: true)
 * and is never presented as real operational state. The arithmetic is real; the inputs are
 * hypothetical.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';
import { SIMULATION_KINDS, type SimulationKind } from './constants';

export interface SimulationResult {
  id: string;
  kind: SimulationKind;
  name: string;
  baseline: number;
  projected: number;
  factor: number;
  projection: true; // always a projection — never real operational state
  note: string;
  at: number;
}

export class SimulationEngine {
  private readonly results = new Map<string, SimulationResult>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: OperationsGovernance,
  ) {}

  async run(input: { kind: SimulationKind; name: string; baseline: number; factor?: number }): Promise<SimulationResult> {
    if (!SIMULATION_KINDS.includes(input.kind)) throw new Error(`unknown simulation kind: ${input.kind}`);
    const factor = input.factor ?? 1;
    const result: SimulationResult = {
      id: randomId('sim'),
      kind: input.kind,
      name: input.name,
      baseline: input.baseline,
      projected: Math.round(input.baseline * factor * 100) / 100,
      factor,
      projection: true,
      note: `PROJECTION — a modelled ${input.kind} scenario, NOT real operational state`,
      at: this.clock.now(),
    };
    this.results.set(result.id, result);
    await this.governance.record({ user: 'system', org: '_ops', mission: '_simulation', operation: `simulate.${input.kind}`, targetId: result.id, evidence: 'business-data-pending', decision: 'projection only' });
    return result;
  }

  list(kind?: SimulationKind): SimulationResult[] {
    const all = [...this.results.values()];
    return kind ? all.filter((r) => r.kind === kind) : all;
  }
  count(): number { return this.results.size; }
}
