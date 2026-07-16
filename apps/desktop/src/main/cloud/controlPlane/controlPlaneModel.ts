/**
 * Cloud Control Plane (P11) — the pure intelligence model.
 *
 * All non-trivial control-plane logic lives here (the house pure-model pattern) so it is
 * unit-tested under Node with no I/O. It projects a composed snapshot of the EXISTING cloud
 * subsystem state (multi-tenant runtime, API platform, cloud sync, identity federation,
 * cross-org federation, disaster recovery) into unified management VIEW MODELS: a fleet health
 * rollup, a region manager, a tenant directory, a deployment view, and a usage/quota overview.
 * No new runtime, store, or engine — every function is a projection over data the subsystem
 * stores already own.
 */
import type {
  ApiDeployment,
  ApiPlatformSummary,
  CloudRegion,
  CloudRegionId,
  CloudTenant,
  ControlPlaneHealth,
  ControlPlaneOverview,
  ControlPlaneSubsystem,
  DeploymentGate,
  DeploymentStatusEntry,
  DrSummary,
  FederationSummary,
  FleetOverview,
  FleetTotals,
  IdentitySummary,
  QuotaRow,
  RegionReplication,
  RegionStatus,
  ReplicaState,
  StorageIsolation,
  SyncSummary,
  TenantDirectoryEntry,
  TenantStatus,
  TenantSummary,
  TenantTier,
  UsageOverview,
} from '@neuropause/shared';

/* ── health helpers ───────────────────────────────────────────────────────── */

const HEALTH_RANK: Record<ControlPlaneHealth, number> = { healthy: 0, degraded: 1, down: 2 };

/** The worst (most severe) health across a set of signals. */
export function worstOf(healths: ControlPlaneHealth[]): ControlPlaneHealth {
  // Fail-safe: an out-of-union value (e.g. a corrupt persisted status) ranks as 'down', never healthy.
  const rank = (h: ControlPlaneHealth): number => HEALTH_RANK[h] ?? HEALTH_RANK.down;
  return healths.reduce<ControlPlaneHealth>((acc, h) => (rank(h) > rank(acc) ? h : acc), 'healthy');
}

/** Health from a healthy/total ratio: ≥99% healthy, ≥75% degraded, else down. */
export function ratioHealth(healthy: number, total: number): ControlPlaneHealth {
  if (total <= 0) return 'healthy';
  const r = healthy / total;
  return r >= 0.99 ? 'healthy' : r >= 0.75 ? 'degraded' : 'down';
}

/** The composed snapshot the projections read (assembled by the service from the subsystem stores). */
export interface ControlPlaneState {
  regions: CloudRegion[];
  tenants: CloudTenant[];
  isolation: StorageIsolation[];
  tenantSummary: TenantSummary;
  deployments: ApiDeployment[];
  apiSummary: ApiPlatformSummary;
  syncSummary: SyncSummary;
  identitySummary: IdentitySummary;
  federationSummary: FederationSummary;
  drSummary: DrSummary;
  replicas: ReplicaState[];
  organizations: number;
  workers: number;
  requests30d: number;
  syncOps30d: number;
  monthlySpend: number;
  currency: string;
}

/* ── Fleet overview (global health rollup) ────────────────────────────────── */

export function buildFleetOverview(s: ControlPlaneState): FleetOverview {
  const subsystems: ControlPlaneSubsystem[] = [
    {
      id: 'tenancy',
      // Runtime health, not a per-tenant status: a book of intentionally-suspended tenants is not a
      // fault (suspension shows per-tenant in the directory). Degraded only when there are no
      // tenants at all, or none active.
      label: 'Multi-tenant runtime',
      status: s.tenantSummary.tenants === 0 || s.tenantSummary.active === 0 ? 'degraded' : 'healthy',
      metric: s.tenantSummary.active,
      unit: 'active tenants',
      detail: `${s.tenantSummary.tenants} tenants across ${s.tenantSummary.regions} regions`,
    },
    {
      id: 'api',
      // Worst-of the actual deployment statuses (consistent with the Region view), so a single
      // down deployment surfaces here too; an empty platform is degraded, not falsely healthy.
      label: 'API platform',
      status: s.deployments.length === 0 ? 'degraded' : worstOf(s.deployments.map((d) => d.status)),
      metric: s.apiSummary.uptimePct,
      unit: '% uptime',
      detail: `${s.apiSummary.healthy}/${s.apiSummary.deployments} deployments healthy`,
    },
    {
      id: 'sync',
      label: 'Cloud sync',
      status: !s.syncSummary.online ? 'down' : s.syncSummary.conflicts > 0 || s.syncSummary.pending > 0 ? 'degraded' : 'healthy',
      metric: s.syncSummary.pending,
      unit: 'pending',
      detail: s.syncSummary.online ? `${s.syncSummary.synced}/${s.syncSummary.domains} domains synced` : 'offline',
    },
    {
      id: 'identity',
      label: 'Identity federation',
      // A disabled SSO connection is not a fault; identity is healthy while ≥1 connection is active.
      status: s.identitySummary.connections === 0 || s.identitySummary.active === 0 ? 'degraded' : 'healthy',
      metric: s.identitySummary.active,
      unit: 'active SSO',
      detail: `${s.identitySummary.provisionedUsers} provisioned · MFA ${s.identitySummary.mfaRequired ? 'required' : 'optional'}`,
    },
    {
      id: 'federation',
      label: 'Cross-org federation',
      status: s.federationSummary.peers === 0 ? 'healthy' : ratioHealth(s.federationSummary.activePeers, s.federationSummary.peers),
      metric: s.federationSummary.trustedPeers,
      unit: 'trusted peers',
      detail: `${s.federationSummary.activePeers}/${s.federationSummary.peers} active peers`,
    },
    {
      id: 'recovery',
      label: 'Disaster recovery',
      status: s.drSummary.replicas === 0 ? 'degraded' : ratioHealth(s.drSummary.inSync, s.drSummary.replicas),
      metric: s.drSummary.continuityScore,
      unit: 'continuity',
      detail: `${s.drSummary.inSync}/${s.drSummary.replicas} replicas in sync`,
    },
  ];

  const status = worstOf(subsystems.map((x) => x.status));
  const score = Math.round((subsystems.filter((x) => x.status === 'healthy').length / subsystems.length) * 100);
  const totals: FleetTotals = {
    tenants: s.tenantSummary.tenants,
    activeTenants: s.tenantSummary.active,
    regions: s.regions.length,
    deployments: s.apiSummary.deployments,
    healthyDeployments: s.apiSummary.healthy,
    workers: s.workers,
    organizations: s.organizations,
    provisionedUsers: s.identitySummary.provisionedUsers,
    requests30d: s.requests30d,
  };
  return { status, score, subsystems, totals };
}

/* ── Region manager ───────────────────────────────────────────────────────── */

/** Region health = worst of (its worst deployment status) and (its replication state). */
function regionHealth(available: boolean, worstDeployment: ControlPlaneHealth, replication: RegionReplication): ControlPlaneHealth {
  if (!available || replication === 'failed') return 'down';
  const replHealth: ControlPlaneHealth = replication === 'lagging' ? 'degraded' : 'healthy';
  return worstOf([worstDeployment, replHealth]);
}

export function buildRegionManager(s: ControlPlaneState): RegionStatus[] {
  const tenantsByRegion = new Map<CloudRegionId, number>();
  for (const t of s.tenants) tenantsByRegion.set(t.regionId, (tenantsByRegion.get(t.regionId) ?? 0) + 1);

  // DeploymentStatus and ControlPlaneHealth share the same 'healthy'|'degraded'|'down' vocabulary,
  // so a deployment's status is already a health signal we can aggregate worst-of.
  const depByRegion = new Map<CloudRegionId, { total: number; healthy: number; worst: ControlPlaneHealth }>();
  for (const d of s.deployments) {
    const cur = depByRegion.get(d.regionId) ?? { total: 0, healthy: 0, worst: 'healthy' as ControlPlaneHealth };
    cur.total += 1;
    if (d.status === 'healthy') cur.healthy += 1;
    cur.worst = worstOf([cur.worst, d.status]);
    depByRegion.set(d.regionId, cur);
  }

  const replicaByRegion = new Map<CloudRegionId, ReplicaState>();
  for (const r of s.replicas) replicaByRegion.set(r.regionId, r);

  return s.regions.map((region): RegionStatus => {
    const dep = depByRegion.get(region.id) ?? { total: 0, healthy: 0, worst: 'healthy' as ControlPlaneHealth };
    const replica = replicaByRegion.get(region.id) ?? null;
    const replication: RegionReplication = replica ? replica.status : 'none';
    return {
      id: region.id,
      name: region.name,
      residency: region.residency,
      available: region.available,
      tenants: tenantsByRegion.get(region.id) ?? 0,
      deployments: dep.total,
      healthyDeployments: dep.healthy,
      replication,
      lagSeconds: replica?.lagSeconds ?? 0,
      health: regionHealth(region.available, dep.worst, replication),
    };
  });
}

/* ── Tenant directory ─────────────────────────────────────────────────────── */

function tenantHealth(status: TenantStatus): ControlPlaneHealth {
  return status === 'active' ? 'healthy' : status === 'provisioning' ? 'degraded' : 'down';
}

/** Bound on the tenant directory payload (home-first, then sorted) so the IPC stays finite at scale. */
const MAX_DIRECTORY_TENANTS = 250;

export function buildTenantDirectory(s: ControlPlaneState): TenantDirectoryEntry[] {
  const isoByTenant = new Map<string, StorageIsolation>();
  for (const iso of s.isolation) isoByTenant.set(iso.tenantId, iso);
  const residencyByRegion = new Map(s.regions.map((r) => [r.id, r.residency] as const));

  return s.tenants
    .map((t): TenantDirectoryEntry => {
      const iso = isoByTenant.get(t.id) ?? null;
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        organizationId: t.organizationId,
        regionId: t.regionId,
        residency: residencyByRegion.get(t.regionId) ?? iso?.residency ?? 'us',
        tier: t.tier,
        status: t.status,
        isHome: t.isHome,
        objects: iso?.objects ?? 0,
        bytes: iso?.bytes ?? 0,
        health: tenantHealth(t.status),
      };
    })
    .sort((a, b) => (a.isHome !== b.isHome ? (a.isHome ? -1 : 1) : a.name.localeCompare(b.name)))
    .slice(0, MAX_DIRECTORY_TENANTS);
}

/* ── Deployment view (health-gated; advisory) ─────────────────────────────── */

function deploymentGate(d: ApiDeployment): DeploymentGate {
  if (d.status === 'down' || d.healthyReplicas === 0) return 'blocked';
  if (d.status === 'degraded' || d.healthyReplicas < d.replicas || d.uptimePct < 99) return 'degraded';
  return 'ok';
}

export function buildDeploymentView(s: ControlPlaneState): DeploymentStatusEntry[] {
  return s.deployments.map((d): DeploymentStatusEntry => ({
    id: d.id,
    service: d.service,
    regionId: d.regionId,
    replicas: d.replicas,
    healthyReplicas: d.healthyReplicas,
    status: d.status,
    version: d.version,
    uptimePct: d.uptimePct,
    p95LatencyMs: d.p95LatencyMs,
    gate: deploymentGate(d),
  }));
}

/* ── Usage + quota (advisory; enforcement stays with the runtime) ─────────── */

const TIER_QUOTAS: Record<TenantTier, { workers: number; requests: number; storageGb: number }> = {
  free: { workers: 3, requests: 100_000, storageGb: 5 },
  business: { workers: 25, requests: 5_000_000, storageGb: 100 },
  enterprise: { workers: 500, requests: 100_000_000, storageGb: 5_000 },
};

function quota(resource: string, used: number, limit: number, tier: TenantTier): QuotaRow {
  return { resource, used, limit, tier, utilizationPct: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0 };
}

export function buildUsageOverview(s: ControlPlaneState): UsageOverview {
  const home = s.tenants.find((t) => t.isHome) ?? null;
  // No home tenant → assume the most restrictive tier so utilization is surfaced, never masked.
  const tier = home?.tier ?? 'free';
  const q = TIER_QUOTAS[tier];
  const homeIso = home ? s.isolation.find((i) => i.tenantId === home.id) ?? null : null;
  const storageGb = homeIso ? Math.round(homeIso.bytes / 1e9) : 0;
  const quotas: QuotaRow[] = [
    quota('Workers', s.workers, q.workers, tier),
    quota('API requests (30d)', s.requests30d, q.requests, tier),
    quota('Storage (GB)', storageGb, q.storageGb, tier),
  ];
  return {
    requests30d: s.requests30d,
    syncOps30d: s.syncOps30d,
    activeWorkers: s.workers,
    monthlySpend: s.monthlySpend,
    currency: s.currency,
    quotas,
  };
}

/* ── Overview bundle ──────────────────────────────────────────────────────── */

export function buildControlPlaneOverview(s: ControlPlaneState): ControlPlaneOverview {
  return {
    fleet: buildFleetOverview(s),
    regions: buildRegionManager(s),
    tenants: buildTenantDirectory(s),
    deployments: buildDeploymentView(s),
    usage: buildUsageOverview(s),
  };
}
