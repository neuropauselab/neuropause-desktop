/**
 * EPIC 13 — Release Candidate Platform. Aggregates the real validation gates (end-to-end, performance,
 * recovery, security, compliance readiness, operational readiness) into a single RC decision. The
 * ceiling is 'rc-approved' — a recommendation that this build is a viable RELEASE CANDIDATE. It does
 * NOT declare general availability: `ga` is hard-coded false, and no path here can flip it. A single
 * failed gate blocks the RC; the decision is derived from the gate results, never asserted.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { RcDecision } from './constants';
import type { ReliabilityGovernance } from './governance';

export interface RcGate {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface RcEvaluation {
  id: string;
  version: string;
  org: string;
  at: number;
  gates: RcGate[];
  passedGates: number;
  decision: RcDecision;
  ga: false;
  note: string;
}

export class ReleaseCandidatePlatform {
  private readonly evaluations: RcEvaluation[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly gov: ReliabilityGovernance,
    private readonly org: string,
    private readonly operator: string,
  ) {}

  /** Derive an RC decision from the supplied real gate results. Never declares GA. */
  async evaluate(input: { version: string; gates: RcGate[]; org?: string }): Promise<RcEvaluation> {
    const org = input.org ?? this.org;
    const passedGates = input.gates.filter((g) => g.passed).length;
    const allPassed = input.gates.length > 0 && passedGates === input.gates.length;
    const decision: RcDecision = allPassed ? 'rc-approved' : 'rc-blocked';
    const evaluation: RcEvaluation = {
      id: randomId('rc'),
      version: input.version,
      org,
      at: this.clock.now(),
      gates: input.gates,
      passedGates,
      decision,
      ga: false,
      note:
        decision === 'rc-approved'
          ? `${input.version} is a viable release candidate (${passedGates}/${input.gates.length} gates passed). This is NOT a GA declaration — production GA requires customer infrastructure, real production data, and an external audit.`
          : `${input.version} is blocked as a release candidate (${passedGates}/${input.gates.length} gates passed). Not GA.`,
    };
    this.evaluations.push(evaluation);
    await this.gov.record({
      operator: this.operator,
      org,
      capability: 'Release Candidate Platform',
      epic: 'E13',
      operation: 'evaluate-rc',
      targetId: input.version,
      evidence: 'live-verified',
      decision,
    });
    return evaluation;
  }

  list(): RcEvaluation[] {
    return [...this.evaluations];
  }
  count(): number {
    return this.evaluations.length;
  }
}
