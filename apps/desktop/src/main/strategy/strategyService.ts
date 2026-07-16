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

export interface StrategyServiceDeps {
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

interface ProjectionMemo {
  overview?: StrategyOverview;
  goals?: GoalManager;
  planning?: PlanningEngine;
  reasoning?: ReasoningReport;
  optimization?: OptimizationEngine;
  simulation?: SimulationReport;
  decisions?: DecisionQueue;
}

export class StrategyService {
  private snapshot: StrategyState | null = null;
  private snapshotAt = 0;
  private memo: ProjectionMemo = {};
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: StrategyServiceDeps) {
    this.ttlMs = deps.ttlMs ?? 3000;
    this.now = deps.now ?? Date.now;
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): StrategyState {
    const t = this.now();
    if (!this.snapshot || t - this.snapshotAt >= this.ttlMs) {
      this.snapshot = this.deps.readState();
      this.snapshotAt = t;
      this.memo = {};
    }
    return this.snapshot;
  }

  // NOTE: `this.state()` MUST be resolved on its own line before the `??=` — `state()` may reset
  // `this.memo` on first read, and `a.b ??= f()` captures the base object BEFORE evaluating `f()`.
  overview(): StrategyOverview {
    const s = this.state();
    return (this.memo.overview ??= buildStrategyOverview(s));
  }

  goals(): GoalManager {
    const s = this.state();
    return (this.memo.goals ??= buildGoalManager(s));
  }

  planning(): PlanningEngine {
    const s = this.state();
    return (this.memo.planning ??= buildPlanningEngine(s));
  }

  reasoning(): ReasoningReport {
    const s = this.state();
    return (this.memo.reasoning ??= buildReasoningReport(s));
  }

  optimization(): OptimizationEngine {
    const s = this.state();
    return (this.memo.optimization ??= buildOptimizationEngine(s));
  }

  simulation(): SimulationReport {
    const s = this.state();
    return (this.memo.simulation ??= buildSimulationReport(s));
  }

  decisions(): DecisionQueue {
    const s = this.state();
    return (this.memo.decisions ??= buildDecisionQueue(s));
  }
}
