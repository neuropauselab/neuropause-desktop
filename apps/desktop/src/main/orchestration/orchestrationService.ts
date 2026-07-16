/**
 * P17 — Global AI Orchestration Platform service.
 *
 * Orchestrates the pure orchestration model over a memoized snapshot composed from the EXISTING platform
 * via a single injected `readState` reader. It caches BOTH the snapshot AND each projection, so repeated
 * reads are O(1) cache hits; a short TTL (matching the upstream 3s pull-TTLs) plus backing-store events
 * keep it fresh. The service holds no state of record, executes nothing, and adds no store, runtime,
 * engine, or scheduler.
 */
import type {
  OrchestrationCloud,
  OrchestrationCoordination,
  OrchestrationFlowReport,
  OrchestrationGoalRouting,
  OrchestrationGovernance,
  OrchestrationKnowledge,
  OrchestrationOverview,
  OrchestrationWorkforce,
} from '@neuropause/shared';
import {
  buildOrchestrationCloud,
  buildOrchestrationCoordination,
  buildOrchestrationFlowReport,
  buildOrchestrationGoals,
  buildOrchestrationGovernance,
  buildOrchestrationKnowledge,
  buildOrchestrationOverview,
  buildOrchestrationWorkforce,
  type OrchestrationState,
} from './orchestrationModel';

export interface GlobalOrchestrationServiceDeps {
  /** Compose the orchestration snapshot from the existing platform signals (injected → testable). */
  readState: () => OrchestrationState;
  /**
   * Snapshot freshness window (ms). The injected report/strategy/twin/knowledge/cloud accessors change
   * WITHOUT emitting a hooked event, so a TTL guarantees the snapshot recomposes and Refresh reflects
   * fresh upstream data.
   */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

interface ProjectionMemo {
  overview?: OrchestrationOverview;
  goals?: OrchestrationGoalRouting;
  workforce?: OrchestrationWorkforce;
  cloud?: OrchestrationCloud;
  knowledge?: OrchestrationKnowledge;
  flows?: OrchestrationFlowReport;
  coordination?: OrchestrationCoordination;
  governance?: OrchestrationGovernance;
}

export class GlobalOrchestrationService {
  private snapshot: OrchestrationState | null = null;
  private snapshotAt = 0;
  private memo: ProjectionMemo = {};
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: GlobalOrchestrationServiceDeps) {
    this.ttlMs = deps.ttlMs ?? 3000;
    this.now = deps.now ?? Date.now;
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): OrchestrationState {
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
  overview(): OrchestrationOverview {
    const s = this.state();
    return (this.memo.overview ??= buildOrchestrationOverview(s));
  }

  goals(): OrchestrationGoalRouting {
    const s = this.state();
    return (this.memo.goals ??= buildOrchestrationGoals(s));
  }

  workforce(): OrchestrationWorkforce {
    const s = this.state();
    return (this.memo.workforce ??= buildOrchestrationWorkforce(s));
  }

  cloud(): OrchestrationCloud {
    const s = this.state();
    return (this.memo.cloud ??= buildOrchestrationCloud(s));
  }

  knowledge(): OrchestrationKnowledge {
    const s = this.state();
    return (this.memo.knowledge ??= buildOrchestrationKnowledge(s));
  }

  flows(): OrchestrationFlowReport {
    const s = this.state();
    return (this.memo.flows ??= buildOrchestrationFlowReport(s));
  }

  coordination(): OrchestrationCoordination {
    const s = this.state();
    return (this.memo.coordination ??= buildOrchestrationCoordination(s));
  }

  governance(): OrchestrationGovernance {
    const s = this.state();
    return (this.memo.governance ??= buildOrchestrationGovernance(s));
  }
}
