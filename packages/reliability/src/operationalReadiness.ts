/**
 * EPIC 12 — Operational Readiness. A registry of the operational artifacts a production launch needs:
 * runbooks, playbooks, DR plans, on-call rosters, escalation policies, and maintenance windows. DR
 * artifacts REUSE the production DR platform when wired in. Completeness is computed from what is
 * actually registered — an empty registry honestly reports 0% ready, never a fabricated green.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import { READINESS_ARTIFACTS, type ReadinessArtifact } from './constants';
import type { ReliabilityContext } from './types';
import type { ReliabilityGovernance } from './governance';

export interface ReadinessEntry {
  id: string;
  kind: ReadinessArtifact;
  name: string;
  reusedProduction: boolean;
  at: number;
}

export class OperationalReadiness {
  private readonly entries: ReadinessEntry[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly ctx: ReliabilityContext,
    private readonly gov: ReliabilityGovernance,
    private readonly org: string,
    private readonly operator: string,
  ) {}

  artifactKinds(): readonly ReadinessArtifact[] {
    return READINESS_ARTIFACTS;
  }

  async add(input: { kind: ReadinessArtifact; name: string; org?: string }): Promise<ReadinessEntry> {
    let reusedProduction = false;
    if (input.kind === 'dr-plan' && this.ctx.production) {
      await this.ctx.production.disasterRecovery().createPlan({ name: input.name, drRegion: 'dr-1', rpoMinutes: 15, rtoMinutes: 60, org: input.org ?? this.org });
      reusedProduction = true;
    }
    const entry: ReadinessEntry = { id: randomId('ready'), kind: input.kind, name: input.name, reusedProduction, at: this.clock.now() };
    this.entries.push(entry);
    await this.gov.record({
      operator: this.operator,
      org: input.org ?? this.org,
      capability: 'Operational Readiness',
      epic: 'E12',
      operation: `add.${input.kind}`,
      targetId: input.name,
      evidence: 'live-verified',
      decision: reusedProduction ? 'reused production DR' : 'registered',
    });
    return entry;
  }

  list(kind?: ReadinessArtifact): ReadinessEntry[] {
    return kind ? this.entries.filter((e) => e.kind === kind) : [...this.entries];
  }

  /** Fraction of the six artifact kinds that have at least one registered entry. */
  completeness(): { present: number; total: number; ratio: number; missing: ReadinessArtifact[] } {
    const present = READINESS_ARTIFACTS.filter((k) => this.entries.some((e) => e.kind === k));
    const missing = READINESS_ARTIFACTS.filter((k) => !this.entries.some((e) => e.kind === k));
    return { present: present.length, total: READINESS_ARTIFACTS.length, ratio: present.length / READINESS_ARTIFACTS.length, missing };
  }
}
