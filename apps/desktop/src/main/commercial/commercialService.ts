/**
 * P20 — NeuroPause Platform v2 commercial service.
 *
 * Orchestrates the pure commercial model over a memoized snapshot composed from the EXISTING commercial
 * substrate via a single injected `readState` reader. It caches BOTH the snapshot AND each projection, so
 * repeated reads are O(1) cache hits; a short TTL (matching the upstream pull-TTLs) plus backing-store
 * events keep it fresh. The service holds no state of record, charges nothing, provisions nothing, adds no
 * store.
 */
import type {
  CommercialAdministration,
  CommercialAnalytics,
  CommercialBilling,
  CommercialCustomers,
  CommercialDeployment,
  CommercialGovernance,
  CommercialLicensing,
  CommercialMetering,
  CommercialOverview,
  CommercialReleases,
  CommercialSubscription,
} from '@neuropause/shared';
import {
  buildCommercialAdministration,
  buildCommercialAnalytics,
  buildCommercialBilling,
  buildCommercialCustomers,
  buildCommercialDeployment,
  buildCommercialGovernance,
  buildCommercialLicensing,
  buildCommercialMetering,
  buildCommercialOverview,
  buildCommercialReleases,
  buildCommercialSubscription,
  type CommercialState,
} from './commercialModel';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';

export interface CommercialPlatformServiceDeps {
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
  /** Compose the commercial snapshot from the existing platform signals (injected → testable). */
  readState: () => CommercialState;
  /** Snapshot freshness window (ms) — injected billing/cloud/usage accessors change with no hooked event. */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}


export class CommercialPlatformService {
  /**
   * One tenant-keyed cell holding the snapshot AND its projections.
   *
   * The projections are inside the cell rather than beside it because they
   * are derived from that snapshot: keeping the snapshot keyed while leaving
   * the derived values in a separate object would leak exactly the composed,
   * human-readable half — which is the half worth stealing.
   */
  private readonly cache: TenantMemo<CommercialState>;

  constructor(private readonly deps: CommercialPlatformServiceDeps) {
    this.cache = new TenantMemo<CommercialState>('commercial-projections', {
      ttlMs: deps.ttlMs ?? 3000,
      ...(deps.now ? { now: deps.now } : {}),
    }).bindScope(deps.scope);
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private state(): CommercialState {
    return this.cache.state(() => this.deps.readState());
  }

  // The projection name is the memo key, and it lives INSIDE the tenant-keyed cell
  // established by `state()`. Resolving `state()` on its own line first is what puts
  // the right cell in place; it also removes the `??=` base-object footgun this
  // comment used to warn about, because there is no longer an object to capture.
  overview(): CommercialOverview {
    const s = this.state();
    return this.cache.projection('overview', () => buildCommercialOverview(s));
  }

  subscription(): CommercialSubscription {
    const s = this.state();
    return this.cache.projection('subscription', () => buildCommercialSubscription(s));
  }

  licensing(): CommercialLicensing {
    const s = this.state();
    return this.cache.projection('licensing', () => buildCommercialLicensing(s));
  }

  billing(): CommercialBilling {
    const s = this.state();
    return this.cache.projection('billing', () => buildCommercialBilling(s));
  }

  metering(): CommercialMetering {
    const s = this.state();
    return this.cache.projection('metering', () => buildCommercialMetering(s));
  }

  deployment(): CommercialDeployment {
    const s = this.state();
    return this.cache.projection('deployment', () => buildCommercialDeployment(s));
  }

  customers(): CommercialCustomers {
    const s = this.state();
    return this.cache.projection('customers', () => buildCommercialCustomers(s));
  }

  analytics(): CommercialAnalytics {
    const s = this.state();
    return this.cache.projection('analytics', () => buildCommercialAnalytics(s));
  }

  releases(): CommercialReleases {
    const s = this.state();
    return this.cache.projection('releases', () => buildCommercialReleases(s));
  }

  administration(): CommercialAdministration {
    const s = this.state();
    return this.cache.projection('administration', () => buildCommercialAdministration(s));
  }

  governance(): CommercialGovernance {
    const s = this.state();
    return this.cache.projection('governance', () => buildCommercialGovernance(s));
  }
}
