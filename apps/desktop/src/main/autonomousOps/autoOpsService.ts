/**
 * P19 — Autonomous Enterprise Operations service.
 *
 * Orchestrates the pure operations model over a memoized snapshot composed from the EXISTING platform via a
 * single injected `readState` reader. It caches BOTH the snapshot AND each projection, so repeated reads
 * are O(1) cache hits; a short TTL (matching the upstream 3s pull-TTLs) plus backing-store events keep it
 * fresh. The service holds no state of record, executes nothing, approves nothing, and adds no store.
 */
import type {
  AutoOpsAnalytics,
  AutoOpsApprovals,
  AutoOpsExecution,
  AutoOpsGovernance,
  AutoOpsIncidents,
  AutoOpsMonitoring,
  AutoOpsOptimization,
  AutoOpsOverview,
  AutoOpsPlans,
  AutoOpsRecovery,
} from '@neuropause/shared';
import {
  buildAutoOpsAnalytics,
  buildAutoOpsApprovals,
  buildAutoOpsExecution,
  buildAutoOpsGovernance,
  buildAutoOpsIncidents,
  buildAutoOpsMonitoring,
  buildAutoOpsOptimization,
  buildAutoOpsOverview,
  buildAutoOpsPlans,
  buildAutoOpsRecovery,
  type AutoOpsState,
} from './autoOpsModel';

export interface AutonomousOperationsServiceDeps {
  /** Compose the sanitized operations snapshot from the existing platform signals (injected → testable). */
  readState: () => AutoOpsState;
  /**
   * Snapshot freshness window (ms). The injected execution/supervisor/knowledge/strategy/cloud accessors
   * change WITHOUT emitting a hooked event, so a TTL guarantees the snapshot recomposes and Refresh
   * reflects fresh upstream data.
   */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

interface ProjectionMemo {
  overview?: AutoOpsOverview;
  plans?: AutoOpsPlans;
  execution?: AutoOpsExecution;
  recovery?: AutoOpsRecovery;
  optimization?: AutoOpsOptimization;
  incidents?: AutoOpsIncidents;
  approvals?: AutoOpsApprovals;
  monitoring?: AutoOpsMonitoring;
  analytics?: AutoOpsAnalytics;
  governance?: AutoOpsGovernance;
}

export class AutonomousOperationsService {
  private snapshot: AutoOpsState | null = null;
  private snapshotAt = 0;
  private memo: ProjectionMemo = {};
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: AutonomousOperationsServiceDeps) {
    this.ttlMs = deps.ttlMs ?? 3000;
    this.now = deps.now ?? Date.now;
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): AutoOpsState {
    const t = this.now();
    if (!this.snapshot || t - this.snapshotAt >= this.ttlMs) {
      this.snapshot = this.deps.readState();
      this.snapshotAt = t;
      this.memo = {};
    }
    return this.snapshot;
  }

  // NOTE: `this.state()` MUST be resolved on its own line before the `??=` — `state()` may reset the
  // memo, and `a.b ??= f()` captures the base object BEFORE evaluating `f()`.
  overview(): AutoOpsOverview {
    const s = this.state();
    return (this.memo.overview ??= buildAutoOpsOverview(s));
  }

  plans(): AutoOpsPlans {
    const s = this.state();
    return (this.memo.plans ??= buildAutoOpsPlans(s));
  }

  execution(): AutoOpsExecution {
    const s = this.state();
    return (this.memo.execution ??= buildAutoOpsExecution(s));
  }

  recovery(): AutoOpsRecovery {
    const s = this.state();
    return (this.memo.recovery ??= buildAutoOpsRecovery(s));
  }

  optimization(): AutoOpsOptimization {
    const s = this.state();
    return (this.memo.optimization ??= buildAutoOpsOptimization(s));
  }

  incidents(): AutoOpsIncidents {
    const s = this.state();
    return (this.memo.incidents ??= buildAutoOpsIncidents(s));
  }

  approvals(): AutoOpsApprovals {
    const s = this.state();
    return (this.memo.approvals ??= buildAutoOpsApprovals(s));
  }

  monitoring(): AutoOpsMonitoring {
    const s = this.state();
    return (this.memo.monitoring ??= buildAutoOpsMonitoring(s));
  }

  analytics(): AutoOpsAnalytics {
    const s = this.state();
    return (this.memo.analytics ??= buildAutoOpsAnalytics(s));
  }

  governance(): AutoOpsGovernance {
    const s = this.state();
    return (this.memo.governance ??= buildAutoOpsGovernance(s));
  }
}
