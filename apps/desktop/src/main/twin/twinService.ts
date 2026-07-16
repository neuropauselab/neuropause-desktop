/**
 * P15 — Enterprise Digital Twin service.
 *
 * Orchestrates the pure twin model over a memoized snapshot composed from the EXISTING platform via a
 * single injected `readState` reader. It caches BOTH the snapshot AND each projection, so repeated
 * reads are O(1) cache hits; a short TTL (matching the upstream Enterprise Intelligence 3s TTL) plus
 * backing-store events keep it fresh. The service holds no state of record, executes nothing, and adds
 * no store, graph, timeline, or simulation engine.
 */
import type {
  EnterpriseTwinOverview,
  TwinCommandCenter,
  TwinDomains,
  TwinHealthMap,
  TwinImpact,
  TwinReplay,
  TwinScenarioCenter,
  TwinTopology,
} from '@neuropause/shared';
import {
  buildEnterpriseTwinOverview,
  buildTwinCommandCenter,
  buildTwinDomains,
  buildTwinHealthMap,
  buildTwinImpact,
  buildTwinReplay,
  buildTwinScenarioCenter,
  buildTwinTopology,
  type TwinState,
} from './twinModel';

export interface TwinServiceDeps {
  /** Compose the twin snapshot from the existing platform signals (injected → testable). */
  readState: () => TwinState;
  /**
   * Snapshot freshness window (ms). The injected Enterprise Intelligence report (3s pull-TTL), Cloud
   * Control Plane, Strategy service, and timeline change WITHOUT emitting a hooked event, so a TTL
   * guarantees the snapshot recomposes and the Refresh control reflects fresh upstream data.
   */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

interface ProjectionMemo {
  overview?: EnterpriseTwinOverview;
  domains?: TwinDomains;
  topology?: TwinTopology;
  health?: TwinHealthMap;
  replay?: TwinReplay;
  scenario?: TwinScenarioCenter;
  impact?: TwinImpact;
  executive?: TwinCommandCenter;
}

export class TwinService {
  private snapshot: TwinState | null = null;
  private snapshotAt = 0;
  private memo: ProjectionMemo = {};
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: TwinServiceDeps) {
    this.ttlMs = deps.ttlMs ?? 3000;
    this.now = deps.now ?? Date.now;
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): TwinState {
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
  overview(): EnterpriseTwinOverview {
    const s = this.state();
    return (this.memo.overview ??= buildEnterpriseTwinOverview(s));
  }

  domains(): TwinDomains {
    const s = this.state();
    return (this.memo.domains ??= buildTwinDomains(s));
  }

  topology(): TwinTopology {
    const s = this.state();
    return (this.memo.topology ??= buildTwinTopology(s));
  }

  health(): TwinHealthMap {
    const s = this.state();
    return (this.memo.health ??= buildTwinHealthMap(s));
  }

  replay(): TwinReplay {
    const s = this.state();
    return (this.memo.replay ??= buildTwinReplay(s));
  }

  scenario(): TwinScenarioCenter {
    const s = this.state();
    return (this.memo.scenario ??= buildTwinScenarioCenter(s));
  }

  impact(): TwinImpact {
    const s = this.state();
    return (this.memo.impact ??= buildTwinImpact(s));
  }

  executive(): TwinCommandCenter {
    const s = this.state();
    return (this.memo.executive ??= buildTwinCommandCenter(s));
  }
}
