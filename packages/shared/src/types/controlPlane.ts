/**
 * Cloud Control Plane (P11) — the global management/orchestration LAYER over the existing
 * cloud subsystems (multi-tenant runtime, identity federation, cloud sync, the API platform,
 * cross-org federation, and disaster recovery). These are VIEW-MODEL projections: they are
 * derived from the data those subsystems' stores already own — no new runtime, tenant/identity
 * store, execution engine, or governance engine.
 *
 * The control plane MANAGES; it does not replace. Fleet + region + tenant + deployment + usage
 * are read rollups; lifecycle actions route to the existing store mutations behind RBAC.
 */
import type {
  CloudRegionId,
  DataResidency,
  DeploymentStatus,
  TenantStatus,
  TenantTier,
} from './cloud';

export type ControlPlaneHealth = 'healthy' | 'degraded' | 'down';

/* ════════════════════════════ Fleet overview ═════════════════════════════ */

export type ControlPlaneSubsystemId = 'tenancy' | 'api' | 'sync' | 'identity' | 'federation' | 'recovery';

export interface ControlPlaneSubsystem {
  id: ControlPlaneSubsystemId;
  label: string;
  status: ControlPlaneHealth;
  metric: number;
  unit: string;
  detail: string;
}

export interface FleetTotals {
  tenants: number;
  activeTenants: number;
  regions: number;
  deployments: number;
  healthyDeployments: number;
  workers: number;
  organizations: number;
  provisionedUsers: number;
  requests30d: number;
}

export interface FleetOverview {
  /** Worst-of the subsystem health signals. */
  status: ControlPlaneHealth;
  /** Aggregate health score 0..100. */
  score: number;
  subsystems: ControlPlaneSubsystem[];
  totals: FleetTotals;
}

/* ════════════════════════════ Region manager ═════════════════════════════ */

export type RegionReplication = 'in_sync' | 'lagging' | 'failed' | 'none';

export interface RegionStatus {
  id: CloudRegionId;
  name: string;
  residency: DataResidency;
  available: boolean;
  tenants: number;
  deployments: number;
  healthyDeployments: number;
  replication: RegionReplication;
  lagSeconds: number;
  health: ControlPlaneHealth;
}

/* ════════════════════════════ Tenant directory ═══════════════════════════ */

export interface TenantDirectoryEntry {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  regionId: CloudRegionId;
  residency: DataResidency;
  tier: TenantTier;
  status: TenantStatus;
  isHome: boolean;
  objects: number;
  bytes: number;
  health: ControlPlaneHealth;
}

/* ════════════════════════════ Deployment view ════════════════════════════ */

/** Health gate for a (modeled) rollout promotion — advisory; execution stays with the runtime. */
export type DeploymentGate = 'ok' | 'degraded' | 'blocked';

export interface DeploymentStatusEntry {
  id: string;
  service: string;
  regionId: CloudRegionId;
  replicas: number;
  healthyReplicas: number;
  status: DeploymentStatus;
  version: string;
  uptimePct: number;
  p95LatencyMs: number;
  gate: DeploymentGate;
}

/* ════════════════════════════ Usage + quota ══════════════════════════════ */

export interface QuotaRow {
  resource: string;
  used: number;
  limit: number;
  tier: TenantTier;
  utilizationPct: number;
}

export interface UsageOverview {
  requests30d: number;
  syncOps30d: number;
  activeWorkers: number;
  monthlySpend: number;
  currency: string;
  quotas: QuotaRow[];
}

/* ════════════════════════════ Overview bundle ════════════════════════════ */

export interface ControlPlaneOverview {
  fleet: FleetOverview;
  regions: RegionStatus[];
  tenants: TenantDirectoryEntry[];
  deployments: DeploymentStatusEntry[];
  usage: UsageOverview;
}
