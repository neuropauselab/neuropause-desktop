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

export interface ControlPlaneServiceDeps {
  /** Compose the control-plane snapshot from the existing subsystem stores (injected, so testable). */
  readState: () => ControlPlaneState;
}

interface ProjectionMemo {
  overview?: ControlPlaneOverview;
  fleet?: FleetOverview;
  regions?: RegionStatus[];
  tenants?: TenantDirectoryEntry[];
  deployments?: DeploymentStatusEntry[];
  usage?: UsageOverview;
}

export class ControlPlaneService {
  private snapshot: ControlPlaneState | null = null;
  private memo: ProjectionMemo = {};

  constructor(private readonly deps: ControlPlaneServiceDeps) {}

  /** Drop the memoized snapshot AND projections; the next read recomposes from the stores. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): ControlPlaneState {
    if (!this.snapshot) {
      this.snapshot = this.deps.readState();
      this.memo = {};
    }
    return this.snapshot;
  }

  overview(): ControlPlaneOverview {
    const s = this.state();
    return (this.memo.overview ??= buildControlPlaneOverview(s));
  }

  fleet(): FleetOverview {
    const s = this.state();
    return (this.memo.fleet ??= buildFleetOverview(s));
  }

  regions(): RegionStatus[] {
    const s = this.state();
    return (this.memo.regions ??= buildRegionManager(s));
  }

  tenants(): TenantDirectoryEntry[] {
    const s = this.state();
    return (this.memo.tenants ??= buildTenantDirectory(s));
  }

  deployments(): DeploymentStatusEntry[] {
    const s = this.state();
    return (this.memo.deployments ??= buildDeploymentView(s));
  }

  usage(): UsageOverview {
    const s = this.state();
    return (this.memo.usage ??= buildUsageOverview(s));
  }
}
