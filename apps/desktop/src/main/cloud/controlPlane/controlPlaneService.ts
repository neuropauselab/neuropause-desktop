/**
 * P11 — Cloud Control Plane service.
 *
 * Orchestrates the pure model over a memoized snapshot composed from the EXISTING cloud
 * subsystem stores via a single injected `readState` reader (the composition root assembles it
 * from tenancy / API platform / sync / identity / federation / DR / gateway / org / workforce /
 * billing). It caches BOTH the snapshot AND each projection, so repeated reads are O(1) cache
 * hits; the composition root invalidates on any backing-store change. The service holds no state
 * of record — it is a management projection over data the subsystems already own.
 */
import type {
  ControlPlaneOverview,
  DeploymentStatusEntry,
  FleetOverview,
  RegionStatus,
  TenantDirectoryEntry,
  UsageOverview,
} from '@neuropause/shared';
import {
  buildControlPlaneOverview,
  buildDeploymentView,
  buildFleetOverview,
  buildRegionManager,
  buildTenantDirectory,
  buildUsageOverview,
  type ControlPlaneState,
} from './controlPlaneModel';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../../tenancy/tenantMemo';

export interface ControlPlaneServiceDeps {
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
  /** Compose the control-plane snapshot from the existing subsystem stores (injected, so testable). */
  readState: () => ControlPlaneState;
}


export class ControlPlaneService {
  /**
   * One tenant-keyed cell holding the snapshot AND its projections.
   *
   * The projections are inside the cell rather than beside it because they
   * are derived from that snapshot: keeping the snapshot keyed while leaving
   * the derived values in a separate object would leak exactly the composed,
   * human-readable half — which is the half worth stealing.
   */
  private readonly cache: TenantMemo<ControlPlaneState>;

  constructor(private readonly deps: ControlPlaneServiceDeps) {
    this.cache = new TenantMemo<ControlPlaneState>('cloud-control-plane-projections').bindScope(deps.scope);
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the stores. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private state(): ControlPlaneState {
    return this.cache.state(() => this.deps.readState());
  }

  overview(): ControlPlaneOverview {
    const s = this.state();
    return this.cache.projection('overview', () => buildControlPlaneOverview(s));
  }

  fleet(): FleetOverview {
    const s = this.state();
    return this.cache.projection('fleet', () => buildFleetOverview(s));
  }

  regions(): RegionStatus[] {
    const s = this.state();
    return this.cache.projection('regions', () => buildRegionManager(s));
  }

  tenants(): TenantDirectoryEntry[] {
    const s = this.state();
    return this.cache.projection('tenants', () => buildTenantDirectory(s));
  }

  deployments(): DeploymentStatusEntry[] {
    const s = this.state();
    return this.cache.projection('deployments', () => buildDeploymentView(s));
  }

  usage(): UsageOverview {
    const s = this.state();
    return this.cache.projection('usage', () => buildUsageOverview(s));
  }
}
