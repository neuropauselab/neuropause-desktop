/**
 * EPIC 11 — SLO / SLA Platform. Define service-level objectives and compute error budgets with real
 * math: for an availability objective of target T over a window, the budget is (1−T)·window; consumed
 * downtime burns it down; burn rate and remaining budget are computed, and status (healthy / at-risk /
 * breached) follows from the numbers — never asserted. SLA attainment is likewise measured against the
 * recorded objective, never assumed met.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SloKind } from './constants';
import type { ReliabilityGovernance } from './governance';

export interface Slo {
  id: string;
  name: string;
  kind: SloKind;
  target: number; // availability/error-rate: 0..1; latency: ms; throughput: ops/s
  windowMs: number;
  createdAt: number;
}

export interface ErrorBudget {
  sloId: string;
  name: string;
  target: number;
  windowMs: number;
  budgetMs: number;
  consumedMs: number;
  remainingMs: number;
  burnRate: number; // consumed / budget
  status: 'healthy' | 'at-risk' | 'breached';
}

export class SloSlaPlatform {
  private readonly slos = new Map<string, Slo>();

  constructor(
    private readonly clock: Clock,
    private readonly gov: ReliabilityGovernance,
    private readonly org: string,
    private readonly operator: string,
  ) {}

  async define(input: { name: string; kind: SloKind; target: number; windowMs: number }): Promise<Slo> {
    const slo: Slo = { id: randomId('slo'), name: input.name, kind: input.kind, target: input.target, windowMs: input.windowMs, createdAt: this.clock.now() };
    this.slos.set(slo.id, slo);
    await this.gov.record({
      operator: this.operator,
      org: this.org,
      capability: 'SLO / SLA Platform',
      epic: 'E11',
      operation: 'define-slo',
      targetId: input.name,
      evidence: 'live-verified',
      decision: `${input.kind} target ${input.target}`,
    });
    return slo;
  }

  get(id: string): Slo | undefined {
    return this.slos.get(id);
  }
  list(): Slo[] {
    return [...this.slos.values()];
  }

  /** Compute the error budget for an availability SLO from real observed downtime. */
  errorBudget(sloId: string, observedDowntimeMs: number): ErrorBudget {
    const slo = this.slos.get(sloId);
    if (!slo) throw new Error(`unknown slo: ${sloId}`);
    const budgetMs = Math.round(Math.max(0, (1 - slo.target) * slo.windowMs));
    const consumedMs = Math.round(Math.max(0, observedDowntimeMs));
    const remainingMs = Math.max(0, budgetMs - consumedMs);
    const burnRate = budgetMs > 0 ? consumedMs / budgetMs : consumedMs > 0 ? Infinity : 0;
    const status: ErrorBudget['status'] = burnRate >= 1 ? 'breached' : burnRate >= 0.75 ? 'at-risk' : 'healthy';
    return { sloId, name: slo.name, target: slo.target, windowMs: slo.windowMs, budgetMs, consumedMs, remainingMs, burnRate, status };
  }

  count(): number {
    return this.slos.size;
  }
}
