/**
 * P14 — Autonomous Enterprise Intelligence service.
 *
 * Orchestrates the pure strategy model over a memoized snapshot composed from the EXISTING platform
 * intelligence via a single injected `readState` reader. It caches BOTH the snapshot AND each
 * projection, so repeated reads are O(1) cache hits; the composition root invalidates on any backing
 * signal change. The service holds no state of record, executes nothing, and adds no store or runtime.
 */
import type {
  DecisionQueue,
  GoalManager,
  OptimizationEngine,
  PlanningEngine,
  ReasoningReport,
  SimulationReport,
  StrategyOverview,
} from '@neuropause/shared';
import {
  buildDecisionQueue,
  buildGoalManager,
  buildOptimizationEngine,
  buildPlanningEngine,
  buildReasoningReport,
  buildSimulationReport,
  buildStrategyOverview,
  type StrategyState,
} from './strategyModel';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';

export interface StrategyServiceDeps {
  /**
   * P13C ROUND 3 — H-2. THE TENANT BOUNDARY, AND IT IS REQUIRED.
   *
   * This service memoises a composed snapshot of tenant-derived data. The memo
   * had no key, so a snapshot built while one organization was active was served
   * to the next caller — including the next tenant's pass of a fanned-out
   * background job, which announces no switch and therefore defeated the switch
   * listener the sibling platforms rely on.
   *
   * Required rather than optional so a composition root that forgets it fails to
   * COMPILE. That is a stronger gate than failing at startup, and strictly
   * stronger than being caught by a later audit.
   */
  scope: () => TenantScope | null;
  /** Compose the strategy snapshot from the existing platform signals (injected → testable). */
  readState: () => StrategyState;
  /**
   * Snapshot freshness window (ms). The store-'changed' subscriptions cover most sources, but the
   * injected Enterprise Intelligence report (3s pull-TTL) and Cloud Control Plane change WITHOUT
   * emitting a hooked event, so a TTL guarantees the snapshot recomposes and the Refresh control
   * reflects fresh upstream data. Defaults to 3000ms (mirrors the report TTL).
   */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}


export class StrategyService {
  /**
   * One tenant-keyed cell holding the snapshot AND its projections.
   *
   * The projections are inside the cell rather than beside it because they
   * are derived from that snapshot: keeping the snapshot keyed while leaving
   * the derived values in a separate object would leak exactly the composed,
   * human-readable half — which is the half worth stealing.
   */
  private readonly cache: TenantMemo<StrategyState>;

  constructor(private readonly deps: StrategyServiceDeps) {
    this.cache = new TenantMemo<StrategyState>('strategy-projections', {
      ttlMs: deps.ttlMs ?? 3000,
      ...(deps.now ? { now: deps.now } : {}),
    }).bindScope(deps.scope);
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private state(): StrategyState {
    return this.cache.state(() => this.deps.readState());
  }

  // The projection name is the memo key, and it lives INSIDE the tenant-keyed cell
  // established by `state()`. Resolving `state()` on its own line first is what puts
  // the right cell in place; it also removes the `??=` base-object footgun this
  // comment used to warn about, because there is no longer an object to capture.
  overview(): StrategyOverview {
    const s = this.state();
    return this.cache.projection('overview', () => buildStrategyOverview(s));
  }

  goals(): GoalManager {
    const s = this.state();
    return this.cache.projection('goals', () => buildGoalManager(s));
  }

  planning(): PlanningEngine {
    const s = this.state();
    return this.cache.projection('planning', () => buildPlanningEngine(s));
  }

  reasoning(): ReasoningReport {
    const s = this.state();
    return this.cache.projection('reasoning', () => buildReasoningReport(s));
  }

  optimization(): OptimizationEngine {
    const s = this.state();
    return this.cache.projection('optimization', () => buildOptimizationEngine(s));
  }

  simulation(): SimulationReport {
    const s = this.state();
    return this.cache.projection('simulation', () => buildSimulationReport(s));
  }

  decisions(): DecisionQueue {
    const s = this.state();
    return this.cache.projection('decisions', () => buildDecisionQueue(s));
  }
}
