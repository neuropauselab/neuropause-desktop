/**
 * P11 — Cloud Control Plane model tests. Pure projections over the composed cloud-subsystem
 * snapshot: fleet health rollup, region manager, tenant directory, deployment gates,
 * usage/quota, and the health-aggregation helpers.
 */
import { describe, expect, it } from 'vitest';
import type {
  ApiDeployment,
  ApiPlatformSummary,
  CloudRegion,
  CloudTenant,
  DrSummary,
  FederationSummary,
  IdentitySummary,
  ReplicaState,
  StorageIsolation,
  SyncSummary,
  TenantSummary,
} from '@neuropause/shared';
import {
  buildControlPlaneOverview,
  buildDeploymentView,
  buildFleetOverview,
  buildRegionManager,
  buildTenantDirectory,
  buildUsageOverview,
  ratioHealth,
  worstOf,
  type ControlPlaneState,
} from './controlPlaneModel';

const NOW = '2026-07-15T00:00:00.000Z';

const REGIONS: CloudRegion[] = [
  { id: 'us-east', name: 'US East (Virginia)', residency: 'us', available: true },
  { id: 'eu-west', name: 'EU West (Ireland)', residency: 'eu', available: true },
  { id: 'ap-south', name: 'Asia Pacific (Mumbai)', residency: 'apac', available: true },
];

function tenant(over: Partial<CloudTenant> = {}): CloudTenant {
  return {
    id: 'tnt-home',
    name: 'NeuroPause',
    slug: 'neuropause',
    organizationId: 'org-default',
    regionId: 'us-east',
    tier: 'enterprise',
    status: 'active',
    isHome: true,
    storageNamespace: 'ns-home',
    createdAt: NOW,
    ...over,
  };
}

function iso(over: Partial<StorageIsolation> = {}): StorageIsolation {
  return { tenantId: 'tnt-home', tenantName: 'NeuroPause', namespace: 'ns-home', encryptionKeyId: 'key-1', regionId: 'us-east', residency: 'us', objects: 1200, bytes: 40_000_000_000, ...over };
}

function deployment(over: Partial<ApiDeployment> = {}): ApiDeployment {
  return { id: 'dep-1', service: 'api-gateway', regionId: 'us-east', replicas: 3, healthyReplicas: 3, status: 'healthy', version: 'v1', uptimePct: 99.98, p95LatencyMs: 42, deployedAt: NOW, ...over };
}

function replica(over: Partial<ReplicaState> = {}): ReplicaState {
  return { regionId: 'us-east', status: 'in_sync', lagSeconds: 0, lastReplicatedAt: NOW, ...over };
}

const TENANT_SUMMARY: TenantSummary = { tenants: 4, active: 4, regions: 3, projects: 6, teams: 3, workers: 9 };
const API_SUMMARY: ApiPlatformSummary = { deployments: 3, healthy: 2, regions: 3, replicas: 7, uptimePct: 99.9, requests30d: 1_200_000, webhooks: 2, publicApis: 3 };
const SYNC_SUMMARY: SyncSummary = { domains: 8, synced: 8, pending: 0, conflicts: 0, online: true, lastFullSyncAt: NOW };
const IDENTITY_SUMMARY: IdentitySummary = { connections: 2, active: 1, enforced: true, scimEnabled: true, mfaRequired: true, provisionedUsers: 12 };
const FED_SUMMARY: FederationSummary = { orgs: 4, peers: 3, activePeers: 3, pendingInvites: 1, trustedPeers: 2, sharedOut: 2, sharedIn: 1 };
const DR_SUMMARY: DrSummary = { backups: 5, lastBackupAt: NOW, replicas: 3, inSync: 3, lastValidationAt: NOW, continuityScore: 92 };

function state(over: Partial<ControlPlaneState> = {}): ControlPlaneState {
  return {
    regions: REGIONS,
    tenants: [tenant(), tenant({ id: 'tnt-helios', name: 'Helios', slug: 'helios', organizationId: 'org-helios', regionId: 'eu-west', tier: 'business', isHome: false })],
    isolation: [iso(), iso({ tenantId: 'tnt-helios', tenantName: 'Helios', regionId: 'eu-west', residency: 'eu', objects: 400, bytes: 8_000_000_000 })],
    tenantSummary: TENANT_SUMMARY,
    deployments: [deployment(), deployment({ id: 'dep-2', regionId: 'eu-west', replicas: 2, healthyReplicas: 2 }), deployment({ id: 'dep-3', regionId: 'ap-south', replicas: 2, healthyReplicas: 1, status: 'degraded', uptimePct: 98.2 })],
    apiSummary: API_SUMMARY,
    syncSummary: SYNC_SUMMARY,
    identitySummary: IDENTITY_SUMMARY,
    federationSummary: FED_SUMMARY,
    drSummary: DR_SUMMARY,
    replicas: [replica(), replica({ regionId: 'eu-west', lagSeconds: 3 }), replica({ regionId: 'ap-south', status: 'lagging', lagSeconds: 47 })],
    organizations: 1,
    workers: 9,
    requests30d: 1_200_000,
    syncOps30d: 3400,
    monthlySpend: 499,
    currency: 'USD',
    ...over,
  };
}

/** A fixture where every subsystem is healthy (no degraded deployment). */
function healthyState(): ControlPlaneState {
  return state({
    deployments: [deployment(), deployment({ id: 'dep-2', regionId: 'eu-west', replicas: 2, healthyReplicas: 2 })],
  });
}

describe('health helpers', () => {
  it('ranks worst-of and derives ratio health', () => {
    expect(worstOf(['healthy', 'degraded', 'healthy'])).toBe('degraded');
    expect(worstOf(['healthy', 'down', 'degraded'])).toBe('down');
    expect(worstOf(['healthy'])).toBe('healthy');
    expect(ratioHealth(3, 3)).toBe('healthy');
    expect(ratioHealth(3, 4)).toBe('degraded');
    expect(ratioHealth(1, 4)).toBe('down');
    expect(ratioHealth(0, 0)).toBe('healthy');
  });
});

describe('buildFleetOverview', () => {
  it('rolls up the six subsystems + totals with worst-of; a degraded deployment degrades the fleet', () => {
    const f = buildFleetOverview(state()); // default has one degraded ap-south deployment
    expect(f.subsystems.map((x) => x.id)).toEqual(['tenancy', 'api', 'sync', 'identity', 'federation', 'recovery']);
    expect(f.totals.tenants).toBe(4);
    expect(f.totals.regions).toBe(3);
    expect(f.totals.provisionedUsers).toBe(12);
    expect(f.subsystems.find((x) => x.id === 'identity')!.status).toBe('healthy'); // 1 active SSO is fine
    expect(f.subsystems.find((x) => x.id === 'api')!.status).toBe('degraded'); // worst-of a degraded deployment
    expect(f.status).toBe('degraded'); // worst-of, NOT down
    expect(f.score).toBeLessThan(100);
  });

  it('scores 100 when every subsystem is healthy', () => {
    const f = buildFleetOverview(healthyState());
    expect(f.subsystems.every((x) => x.status === 'healthy')).toBe(true);
    expect(f.status).toBe('healthy');
    expect(f.score).toBe(100);
  });

  it('goes down (worst-of) when a subsystem is down', () => {
    const f = buildFleetOverview(state({ syncSummary: { ...SYNC_SUMMARY, online: false } }));
    expect(f.subsystems.find((x) => x.id === 'sync')!.status).toBe('down');
    expect(f.status).toBe('down');
  });

  it('marks an empty platform degraded, never falsely healthy', () => {
    const f = buildFleetOverview(state({ tenants: [], tenantSummary: { ...TENANT_SUMMARY, tenants: 0, active: 0 }, deployments: [] }));
    expect(f.subsystems.find((x) => x.id === 'tenancy')!.status).toBe('degraded');
    expect(f.subsystems.find((x) => x.id === 'api')!.status).toBe('degraded');
  });
});

describe('buildRegionManager', () => {
  it('joins tenants, deployments, and replicas per region with derived health', () => {
    const regions = buildRegionManager(state());
    const apSouth = regions.find((r) => r.id === 'ap-south')!;
    expect(apSouth.deployments).toBe(1);
    expect(apSouth.healthyDeployments).toBe(0); // the one ap-south deployment is degraded
    expect(apSouth.replication).toBe('lagging');
    expect(apSouth.health).toBe('degraded');
    const usEast = regions.find((r) => r.id === 'us-east')!;
    expect(usEast.health).toBe('healthy');
    expect(usEast.tenants).toBe(1);
  });

  it('honors the worst DEPLOYMENT status independent of replication', () => {
    const regions = buildRegionManager(
      state({
        regions: [{ id: 'us-east', name: 'US East', residency: 'us', available: true }],
        deployments: [deployment({ regionId: 'us-east', status: 'down', healthyReplicas: 0 })],
        replicas: [replica({ regionId: 'us-east', status: 'in_sync' })],
      }),
    );
    expect(regions[0].health).toBe('down'); // a down deployment beats in_sync replication
  });

  it('honors REPLICATION lag independent of deployment health', () => {
    const regions = buildRegionManager(
      state({
        regions: [{ id: 'us-east', name: 'US East', residency: 'us', available: true }],
        deployments: [deployment({ regionId: 'us-east', status: 'healthy' })],
        replicas: [replica({ regionId: 'us-east', status: 'lagging', lagSeconds: 30 })],
      }),
    );
    expect(regions[0].health).toBe('degraded'); // lagging replication degrades a healthy region
  });

  it('marks an unavailable region down', () => {
    const regions = buildRegionManager(state({ regions: [{ id: 'us-east', name: 'US East', residency: 'us', available: false }] }));
    expect(regions[0].health).toBe('down');
  });
});

describe('buildTenantDirectory', () => {
  it('lists tenants home-first with storage + health', () => {
    const dir = buildTenantDirectory(state());
    expect(dir[0].isHome).toBe(true);
    expect(dir[0].bytes).toBe(40_000_000_000);
    const helios = dir.find((t) => t.id === 'tnt-helios')!;
    expect(helios.residency).toBe('eu');
    expect(helios.health).toBe('healthy');
  });

  it('derives degraded/down health from tenant status', () => {
    const dir = buildTenantDirectory(state({ tenants: [tenant({ status: 'provisioning' }), tenant({ id: 't2', name: 'Susp', isHome: false, status: 'suspended' })] }));
    expect(dir.find((t) => t.id === 'tnt-home')!.health).toBe('degraded');
    expect(dir.find((t) => t.id === 't2')!.health).toBe('down');
  });

  it('caps the tenant directory payload at scale', () => {
    const many = Array.from({ length: 400 }, (_, i) => tenant({ id: `t${i}`, name: `Tenant ${i.toString().padStart(3, '0')}`, isHome: false }));
    const dir = buildTenantDirectory(state({ tenants: many, isolation: [] }));
    expect(dir.length).toBe(250);
  });
});

describe('buildDeploymentView', () => {
  it('gates deployments by health', () => {
    const v = buildDeploymentView(state());
    expect(v.find((d) => d.id === 'dep-1')!.gate).toBe('ok');
    expect(v.find((d) => d.id === 'dep-3')!.gate).toBe('degraded'); // degraded + partial replicas
  });

  it('blocks a down deployment', () => {
    const v = buildDeploymentView(state({ deployments: [deployment({ status: 'down', healthyReplicas: 0 })] }));
    expect(v[0].gate).toBe('blocked');
  });

  it('degrades on partial replicas alone (status healthy)', () => {
    const v = buildDeploymentView(state({ deployments: [deployment({ status: 'healthy', replicas: 3, healthyReplicas: 2, uptimePct: 99.99 })] }));
    expect(v[0].gate).toBe('degraded');
  });

  it('degrades on low uptime alone (status healthy, full replicas)', () => {
    const v = buildDeploymentView(state({ deployments: [deployment({ status: 'healthy', replicas: 3, healthyReplicas: 3, uptimePct: 98.5 })] }));
    expect(v[0].gate).toBe('degraded');
  });
});

describe('buildUsageOverview', () => {
  it('builds tier-based quota rows and utilization', () => {
    const u = buildUsageOverview(state());
    expect(u.monthlySpend).toBe(499);
    const workers = u.quotas.find((q) => q.resource === 'Workers')!;
    expect(workers.tier).toBe('enterprise');
    expect(workers.limit).toBe(500);
    expect(workers.utilizationPct).toBe(2); // 9/500
  });

  it('assumes the most restrictive tier when there is no home tenant', () => {
    const u = buildUsageOverview(state({ tenants: [tenant({ isHome: false })] }));
    const workers = u.quotas.find((q) => q.resource === 'Workers')!;
    expect(workers.tier).toBe('free');
    expect(workers.limit).toBe(3);
    expect(workers.utilizationPct).toBe(100); // 9 workers over a free limit of 3 → surfaced, not masked
  });
});

describe('buildControlPlaneOverview', () => {
  it('bundles fleet, regions, tenants, deployments, and usage', () => {
    const o = buildControlPlaneOverview(state());
    expect(o.fleet.subsystems).toHaveLength(6);
    expect(o.regions).toHaveLength(3);
    expect(o.tenants).toHaveLength(2);
    expect(o.deployments).toHaveLength(3);
    expect(o.usage.quotas.length).toBeGreaterThan(0);
  });
});
