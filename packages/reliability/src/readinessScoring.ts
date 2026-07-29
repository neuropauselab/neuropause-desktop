/**
 * EPIC 16 — Production Readiness Scoring. Aggregates the real measured sub-signals (validation pass
 * rate, security findings, recovery success, operational-readiness completeness, compliance coverage)
 * into a single production-readiness score with a deterministic weighted formula. The top band is
 * 'ready-for-rc' — it is explicitly NOT a GA/production-ready declaration. Every input must come from
 * a real sub-result; the score reflects what was measured, nothing more.
 */
import { type Clock } from '@neuropause/cloud-core';
import type { ReliabilityGovernance } from './governance';

export interface ReadinessInput {
  validation: { passed: number; failed: number };
  securityFindings: number;
  recovery: { recovered: number; total: number };
  operationalCompleteness: number; // 0..1
  complianceCoverage: number; // 0..1
}

export interface ReadinessScore {
  overall: number; // 0..100
  band: 'ready-for-rc' | 'conditional' | 'not-ready';
  components: Record<string, number>;
  ga: false;
  at: number;
  note: string;
}

export class ProductionReadinessScoring {
  constructor(
    private readonly clock: Clock,
    private readonly gov: ReliabilityGovernance,
    private readonly org: string,
    private readonly operator: string,
  ) {}

  async score(input: ReadinessInput, org?: string): Promise<ReadinessScore> {
    const vTotal = input.validation.passed + input.validation.failed;
    const validationScore = vTotal > 0 ? input.validation.passed / vTotal : 1;
    const securityScore = input.securityFindings === 0 ? 1 : Math.max(0, 1 - input.securityFindings * 0.1);
    const recoveryScore = input.recovery.total > 0 ? input.recovery.recovered / input.recovery.total : 1;
    const operationalScore = Math.max(0, Math.min(1, input.operationalCompleteness));
    const complianceScore = Math.max(0, Math.min(1, input.complianceCoverage));

    const components = {
      validation: Math.round(validationScore * 100),
      security: Math.round(securityScore * 100),
      recovery: Math.round(recoveryScore * 100),
      operational: Math.round(operationalScore * 100),
      compliance: Math.round(complianceScore * 100),
    };
    // Weights: validation .30, security .25, recovery .20, operational .15, compliance .10.
    const overall = Math.round(
      validationScore * 30 + securityScore * 25 + recoveryScore * 20 + operationalScore * 15 + complianceScore * 10,
    );
    const band: ReadinessScore['band'] = overall >= 90 ? 'ready-for-rc' : overall >= 70 ? 'conditional' : 'not-ready';
    await this.gov.record({
      operator: this.operator,
      org: org ?? this.org,
      capability: 'Production Readiness Scoring',
      epic: 'E16',
      operation: 'score-readiness',
      targetId: 'readiness',
      evidence: 'live-verified',
      decision: `${overall}/100 (${band})`,
    });
    return {
      overall,
      band,
      components,
      ga: false,
      at: this.clock.now(),
      note: `Readiness ${overall}/100 (${band}). This is a release-candidate readiness signal, NOT a GA declaration.`,
    };
  }
}
