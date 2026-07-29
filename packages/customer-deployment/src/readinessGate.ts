/**
 * EPIC 19 — Production Readiness Gate. Evaluates six readiness dimensions (infrastructure, security,
 * integration, identity, performance, customer) and produces an evidence-based Go/No-Go. The decision
 * is DERIVED from measured evidence: each dimension carries a real passed/failed signal, and the gate
 * REUSES the Sprint-4 release-candidate gate + readiness scoring to aggregate them. The ceiling is
 * 'go' for a PILOT — `ga` is hard-coded false and no path here declares General Availability.
 */
import { randomId } from '@neuropause/cloud-core';
import { READINESS_DIMENSIONS, type ReadinessDimension, type GoNoGo } from './constants';
import type { CustomerDeploymentContext } from './types';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export interface DimensionSignal {
  dimension: ReadinessDimension;
  passed: boolean;
  detail?: string;
}

export interface GoNoGoDecision {
  id: string;
  deploymentId: string;
  decision: GoNoGo;
  dimensions: DimensionSignal[];
  passedDimensions: number;
  readinessScore: number | null;
  reusedReliability: boolean;
  ga: false;
  note: string;
}

export class ProductionReadinessGate {
  private readonly decisions = new Map<string, GoNoGoDecision>();

  constructor(
    private readonly ctx: CustomerDeploymentContext,
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  dimensions(): readonly ReadinessDimension[] {
    return READINESS_DIMENSIONS;
  }

  /** Evaluate Go/No-Go from measured dimension signals. Never declares GA. */
  async evaluate(input: { deploymentId: string; signals: DimensionSignal[] }): Promise<GoNoGoDecision> {
    const deployment = this.require(input.deploymentId);
    const passedDimensions = input.signals.filter((s) => s.passed).length;
    const allPassed = input.signals.length === READINESS_DIMENSIONS.length && passedDimensions === input.signals.length;

    let reusedReliability = false;
    let readinessScore: number | null = null;
    if (this.ctx.reliability) {
      // Aggregate through the reused Sprint-4 RC gate + readiness scoring.
      const rc = await this.ctx.reliability.releaseCandidate().evaluate({ version: `pilot-${input.deploymentId}`, gates: input.signals.map((s) => ({ name: s.dimension, passed: s.passed })) });
      const score = await this.ctx.reliability.readinessScoring().score({
        validation: { passed: passedDimensions, failed: input.signals.length - passedDimensions },
        securityFindings: input.signals.find((s) => s.dimension === 'security')?.passed ? 0 : 1,
        recovery: { recovered: passedDimensions, total: input.signals.length },
        operationalCompleteness: passedDimensions / Math.max(1, input.signals.length),
        complianceCoverage: passedDimensions / Math.max(1, input.signals.length),
      });
      readinessScore = score.overall;
      reusedReliability = true;
      // Go requires every dimension measured-passed AND the reused RC gate approving.
      const decision: GoNoGo = allPassed && rc.decision === 'rc-approved' ? 'go' : 'no-go';
      return this.finish(deployment, input.deploymentId, input.signals, passedDimensions, decision, readinessScore, reusedReliability);
    }
    const decision: GoNoGo = allPassed ? 'go' : 'no-go';
    return this.finish(deployment, input.deploymentId, input.signals, passedDimensions, decision, readinessScore, reusedReliability);
  }

  private async finish(
    deployment: { customerId: string; tenantId: string; environmentId: string },
    deploymentId: string,
    signals: DimensionSignal[],
    passedDimensions: number,
    decision: GoNoGo,
    readinessScore: number | null,
    reusedReliability: boolean,
  ): Promise<GoNoGoDecision> {
    const result: GoNoGoDecision = {
      id: randomId('gonogo'),
      deploymentId,
      decision,
      dimensions: signals,
      passedDimensions,
      readinessScore,
      reusedReliability,
      ga: false,
      note:
        decision === 'go'
          ? `GO for pilot: ${passedDimensions}/${signals.length} readiness dimensions passed. This authorizes a PILOT deployment only — NOT General Availability.`
          : `NO-GO: ${passedDimensions}/${signals.length} readiness dimensions passed. Not GA.`,
    };
    this.decisions.set(result.id, result);
    await this.gov.record({
      operator: this.operator,
      customer: deployment.customerId,
      tenant: deployment.tenantId,
      environment: deployment.environmentId,
      epic: 'E19',
      operation: 'go-no-go',
      targetId: deploymentId,
      evidence: 'live-verified',
      decision,
    });
    return result;
  }

  list(): GoNoGoDecision[] {
    return [...this.decisions.values()];
  }

  private require(deploymentId: string): { customerId: string; tenantId: string; environmentId: string } {
    const d = this.runtime.deployment(deploymentId);
    if (!d) throw new Error(`unknown deployment: ${deploymentId}`);
    return d;
  }
}
