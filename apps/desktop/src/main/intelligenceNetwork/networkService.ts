/**
 * P18 — Enterprise Intelligence Network service.
 *
 * Orchestrates the pure network model over a memoized snapshot composed from the EXISTING platform via a
 * single injected `readState` reader. It caches BOTH the snapshot AND each projection, so repeated reads
 * are O(1) cache hits; a short TTL (matching the upstream 3s pull-TTLs) plus backing-store events keep it
 * fresh. The service holds no state of record, exchanges nothing, executes nothing, and adds no store.
 */
import type {
  IntelNetworkBenchmarks,
  IntelNetworkCollective,
  IntelNetworkExchange,
  IntelNetworkGovernance,
  IntelNetworkInsights,
  IntelNetworkOrganizations,
  IntelNetworkOverview,
  IntelNetworkTrust,
} from '@neuropause/shared';
import {
  buildIntelNetworkBenchmarks,
  buildIntelNetworkCollective,
  buildIntelNetworkExchange,
  buildIntelNetworkGovernance,
  buildIntelNetworkInsights,
  buildIntelNetworkOrganizations,
  buildIntelNetworkOverview,
  buildIntelNetworkTrust,
  type IntelNetworkState,
} from './networkModel';

export interface EnterpriseIntelligenceNetworkServiceDeps {
  /** Compose the sanitized network snapshot from the existing platform signals (injected → testable). */
  readState: () => IntelNetworkState;
  /**
   * Snapshot freshness window (ms). The injected knowledge/industry/strategy/twin/orchestration accessors
   * change WITHOUT emitting a hooked event, so a TTL guarantees the snapshot recomposes and Refresh
   * reflects fresh upstream data.
   */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

interface ProjectionMemo {
  overview?: IntelNetworkOverview;
  exchange?: IntelNetworkExchange;
  benchmarks?: IntelNetworkBenchmarks;
  insights?: IntelNetworkInsights;
  trust?: IntelNetworkTrust;
  organizations?: IntelNetworkOrganizations;
  collective?: IntelNetworkCollective;
  governance?: IntelNetworkGovernance;
}

export class EnterpriseIntelligenceNetworkService {
  private snapshot: IntelNetworkState | null = null;
  private snapshotAt = 0;
  private memo: ProjectionMemo = {};
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: EnterpriseIntelligenceNetworkServiceDeps) {
    this.ttlMs = deps.ttlMs ?? 3000;
    this.now = deps.now ?? Date.now;
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): IntelNetworkState {
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
  overview(): IntelNetworkOverview {
    const s = this.state();
    return (this.memo.overview ??= buildIntelNetworkOverview(s));
  }

  exchange(): IntelNetworkExchange {
    const s = this.state();
    return (this.memo.exchange ??= buildIntelNetworkExchange(s));
  }

  benchmarks(): IntelNetworkBenchmarks {
    const s = this.state();
    return (this.memo.benchmarks ??= buildIntelNetworkBenchmarks(s));
  }

  insights(): IntelNetworkInsights {
    const s = this.state();
    return (this.memo.insights ??= buildIntelNetworkInsights(s));
  }

  trust(): IntelNetworkTrust {
    const s = this.state();
    return (this.memo.trust ??= buildIntelNetworkTrust(s));
  }

  organizations(): IntelNetworkOrganizations {
    const s = this.state();
    return (this.memo.organizations ??= buildIntelNetworkOrganizations(s));
  }

  collective(): IntelNetworkCollective {
    const s = this.state();
    return (this.memo.collective ??= buildIntelNetworkCollective(s));
  }

  governance(): IntelNetworkGovernance {
    const s = this.state();
    return (this.memo.governance ??= buildIntelNetworkGovernance(s));
  }
}
