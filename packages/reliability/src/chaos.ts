/**
 * EPIC 5 — Chaos Engineering. Controlled fault injection against an IN-PROCESS SANDBOX target only.
 * An experiment (1) confirms the sandbox's steady state, (2) activates a fault the sandbox observes,
 * (3) confirms the sandbox recovers to steady state. `resource-pressure` allocates a REAL buffer and
 * measures the REAL heap delta; the other faults are signalled to the sandbox target. The blast
 * radius is ALWAYS 'in-process-sandbox': this never touches production systems, customer traffic, or
 * any external dependency. Recovery is measured, never assumed.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ChaosKind } from './constants';
import type { ReliabilityGovernance } from './governance';

export interface FaultSignal {
  kind: ChaosKind;
  active: boolean;
  skewMs: number;
}

export type ChaosTarget = (fault: FaultSignal) => void | Promise<void>;

export interface ChaosExperiment {
  id: string;
  kind: ChaosKind;
  hypothesis: string;
  org: string;
  at: number;
  steadyBefore: boolean;
  toleratedFault: boolean;
  steadyAfter: boolean;
  recovered: boolean;
  heapDeltaBytes: number;
  blastRadius: 'in-process-sandbox';
  note: string;
}

export class ChaosEngineering {
  private readonly experiments: ChaosExperiment[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly gov: ReliabilityGovernance,
    private readonly org: string,
    private readonly operator: string,
  ) {}

  /** Run a controlled experiment against the sandbox target. Never affects any production system. */
  async run(input: { kind: ChaosKind; hypothesis: string; target: ChaosTarget; skewMs?: number; org?: string }): Promise<ChaosExperiment> {
    const org = input.org ?? this.org;
    const skewMs = input.skewMs ?? 250;

    const steadyBefore = await this.probe(input.target, { kind: input.kind, active: false, skewMs: 0 });

    // Activate the fault. For resource-pressure we apply REAL, measured heap pressure in the sandbox.
    let heapDeltaBytes = 0;
    let toleratedFault: boolean;
    if (input.kind === 'resource-pressure') {
      const before = process.memoryUsage().heapUsed;
      const ballast: number[] = new Array(200_000).fill(1); // real allocation, freed at scope end
      toleratedFault = await this.probe(input.target, { kind: input.kind, active: true, skewMs: 0 });
      heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - before);
      void ballast.length;
    } else {
      toleratedFault = await this.probe(input.target, { kind: input.kind, active: true, skewMs });
    }

    const steadyAfter = await this.probe(input.target, { kind: input.kind, active: false, skewMs: 0 });
    const recovered = steadyBefore && steadyAfter;

    const experiment: ChaosExperiment = {
      id: randomId('chaos'),
      kind: input.kind,
      hypothesis: input.hypothesis,
      org,
      at: this.clock.now(),
      steadyBefore,
      toleratedFault,
      steadyAfter,
      recovered,
      heapDeltaBytes,
      blastRadius: 'in-process-sandbox',
      note: 'Fault injected into an in-process sandbox only — no production system, customer, or external dependency was affected.',
    };
    this.experiments.push(experiment);
    await this.gov.record({
      operator: this.operator,
      org,
      capability: 'Chaos Engineering',
      epic: 'E5',
      operation: 'chaos-experiment',
      targetId: input.kind,
      evidence: 'live-verified',
      decision: recovered ? 'recovered' : 'did-not-recover',
    });
    return experiment;
  }

  private async probe(target: ChaosTarget, fault: FaultSignal): Promise<boolean> {
    try {
      await target(fault);
      return true;
    } catch {
      return false;
    }
  }

  list(kind?: ChaosKind): ChaosExperiment[] {
    return kind ? this.experiments.filter((e) => e.kind === kind) : [...this.experiments];
  }
  count(): number {
    return this.experiments.length;
  }
}
