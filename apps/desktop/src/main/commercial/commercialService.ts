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

export interface CommercialPlatformServiceDeps {
  /** Compose the commercial snapshot from the existing platform signals (injected → testable). */
  readState: () => CommercialState;
  /** Snapshot freshness window (ms) — injected billing/cloud/usage accessors change with no hooked event. */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

interface ProjectionMemo {
  overview?: CommercialOverview;
  subscription?: CommercialSubscription;
  licensing?: CommercialLicensing;
  billing?: CommercialBilling;
  metering?: CommercialMetering;
  deployment?: CommercialDeployment;
  customers?: CommercialCustomers;
  analytics?: CommercialAnalytics;
  releases?: CommercialReleases;
  administration?: CommercialAdministration;
  governance?: CommercialGovernance;
}

export class CommercialPlatformService {
  private snapshot: CommercialState | null = null;
  private snapshotAt = 0;
  private memo: ProjectionMemo = {};
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: CommercialPlatformServiceDeps) {
    this.ttlMs = deps.ttlMs ?? 3000;
    this.now = deps.now ?? Date.now;
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the sources. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): CommercialState {
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
  overview(): CommercialOverview {
    const s = this.state();
    return (this.memo.overview ??= buildCommercialOverview(s));
  }

  subscription(): CommercialSubscription {
    const s = this.state();
    return (this.memo.subscription ??= buildCommercialSubscription(s));
  }

  licensing(): CommercialLicensing {
    const s = this.state();
    return (this.memo.licensing ??= buildCommercialLicensing(s));
  }

  billing(): CommercialBilling {
    const s = this.state();
    return (this.memo.billing ??= buildCommercialBilling(s));
  }

  metering(): CommercialMetering {
    const s = this.state();
    return (this.memo.metering ??= buildCommercialMetering(s));
  }

  deployment(): CommercialDeployment {
    const s = this.state();
    return (this.memo.deployment ??= buildCommercialDeployment(s));
  }

  customers(): CommercialCustomers {
    const s = this.state();
    return (this.memo.customers ??= buildCommercialCustomers(s));
  }

  analytics(): CommercialAnalytics {
    const s = this.state();
    return (this.memo.analytics ??= buildCommercialAnalytics(s));
  }

  releases(): CommercialReleases {
    const s = this.state();
    return (this.memo.releases ??= buildCommercialReleases(s));
  }

  administration(): CommercialAdministration {
    const s = this.state();
    return (this.memo.administration ??= buildCommercialAdministration(s));
  }

  governance(): CommercialGovernance {
    const s = this.state();
    return (this.memo.governance ??= buildCommercialGovernance(s));
  }
}
