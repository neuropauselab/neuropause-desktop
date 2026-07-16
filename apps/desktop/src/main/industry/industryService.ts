/**
 * P13 — Industry Solution Platform service.
 *
 * Orchestrates the pure model over a memoized snapshot composed from the EXISTING platform stores
 * (the worker registry, connector registry + connected accounts, enterprise governance rules, and
 * the marketplace) via a single injected `readState` reader. It caches BOTH the snapshot AND each
 * projection, so repeated reads are O(1) cache hits; the composition root invalidates on any
 * backing-store change. The service holds no state of record and adds no new store or runtime.
 */
import type {
  ExecutiveKpi,
  IndustryCollection,
  IndustryComplianceReport,
  IndustryPlatformOverview,
  IndustryReadinessReport,
  IndustrySuite,
} from '@neuropause/shared';
import {
  buildCollections,
  buildComplianceReport,
  buildIndustryKpis,
  buildIndustryOverview,
  buildReadinessReport,
  buildSuites,
  type IndustryPlatformState,
} from './industryModel';

export interface IndustryPlatformServiceDeps {
  /** Compose the industry snapshot from the existing platform stores (injected → testable). */
  readState: () => IndustryPlatformState;
}

interface ProjectionMemo {
  overview?: IndustryPlatformOverview;
  suites?: IndustrySuite[];
  kpis?: ExecutiveKpi[];
  compliance?: IndustryComplianceReport;
  collections?: IndustryCollection[];
  readiness?: IndustryReadinessReport;
}

export class IndustryPlatformService {
  private snapshot: IndustryPlatformState | null = null;
  private memo: ProjectionMemo = {};

  constructor(private readonly deps: IndustryPlatformServiceDeps) {}

  /** Drop the memoized snapshot AND projections; the next read recomposes from the stores. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): IndustryPlatformState {
    if (!this.snapshot) {
      this.snapshot = this.deps.readState();
      this.memo = {};
    }
    return this.snapshot;
  }

  // NOTE: `this.state()` MUST be resolved on its own line before the `??=` — `state()` may reset
  // `this.memo` on first read, and `a.b ??= f()` captures the base object `a` (this.memo) BEFORE
  // evaluating `f()`, so inlining state() inside the RHS would write the cache to a stale memo.
  overview(): IndustryPlatformOverview {
    const s = this.state();
    return (this.memo.overview ??= buildIndustryOverview(s));
  }

  suites(): IndustrySuite[] {
    const s = this.state();
    return (this.memo.suites ??= buildSuites(s));
  }

  kpis(): ExecutiveKpi[] {
    const s = this.state();
    return (this.memo.kpis ??= buildIndustryKpis(s));
  }

  compliance(): IndustryComplianceReport {
    const s = this.state();
    return (this.memo.compliance ??= buildComplianceReport(s));
  }

  collections(): IndustryCollection[] {
    const s = this.state();
    return (this.memo.collections ??= buildCollections(s));
  }

  readiness(): IndustryReadinessReport {
    const s = this.state();
    return (this.memo.readiness ??= buildReadinessReport(s));
  }
}
