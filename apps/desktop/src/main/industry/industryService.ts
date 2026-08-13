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
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';

export interface IndustryPlatformServiceDeps {
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
  /** Compose the industry snapshot from the existing platform stores (injected → testable). */
  readState: () => IndustryPlatformState;
}


export class IndustryPlatformService {
  /**
   * One tenant-keyed cell holding the snapshot AND its projections.
   *
   * The projections are inside the cell rather than beside it because they
   * are derived from that snapshot: keeping the snapshot keyed while leaving
   * the derived values in a separate object would leak exactly the composed,
   * human-readable half — which is the half worth stealing.
   */
  private readonly cache: TenantMemo<IndustryPlatformState>;

  constructor(private readonly deps: IndustryPlatformServiceDeps) {
    this.cache = new TenantMemo<IndustryPlatformState>('industry-projections').bindScope(deps.scope);
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the stores. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private state(): IndustryPlatformState {
    return this.cache.state(() => this.deps.readState());
  }

  // The projection name is the memo key, and it lives INSIDE the tenant-keyed cell
  // established by `state()`. Resolving `state()` on its own line first is what puts
  // the right cell in place; it also removes the `??=` base-object footgun this
  // comment used to warn about, because there is no longer an object to capture.
  // evaluating `f()`, so inlining state() inside the RHS would write the cache to a stale memo.
  overview(): IndustryPlatformOverview {
    const s = this.state();
    return this.cache.projection('overview', () => buildIndustryOverview(s));
  }

  suites(): IndustrySuite[] {
    const s = this.state();
    return this.cache.projection('suites', () => buildSuites(s));
  }

  kpis(): ExecutiveKpi[] {
    const s = this.state();
    return this.cache.projection('kpis', () => buildIndustryKpis(s));
  }

  compliance(): IndustryComplianceReport {
    const s = this.state();
    return this.cache.projection('compliance', () => buildComplianceReport(s));
  }

  collections(): IndustryCollection[] {
    const s = this.state();
    return this.cache.projection('collections', () => buildCollections(s));
  }

  readiness(): IndustryReadinessReport {
    const s = this.state();
    return this.cache.projection('readiness', () => buildReadinessReport(s));
  }
}
