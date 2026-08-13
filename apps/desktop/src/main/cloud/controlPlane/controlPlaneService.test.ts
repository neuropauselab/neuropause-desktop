/**
 * P11 — Cloud Control Plane service tests: composition, snapshot + projection memoization,
 * and invalidation.
 */
import { describe, expect, it } from 'vitest';
import type {
  ApiPlatformSummary,
  CloudRegion,
  CloudTenant,
  DrSummary,
  FederationSummary,
  IdentitySummary,
  LiveSyncStatus,
  TenantSummary,
} from '@neuropause/shared';
import { ControlPlaneService } from './controlPlaneService';
import type { ControlPlaneState } from './controlPlaneModel';

/**
 * P13C ROUND 3 — H-2. The memo is now keyed by tenant, so these tests must name
 * one. A fixed scope keeps every existing memoization assertion meaningful:
 * repeated reads under ONE tenant must still be O(1) cache hits, which is the
 * property this file was written to protect and the fix must not cost.
 */
const TEST_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof TEST_SCOPE => TEST_SCOPE;

const NOW = '2026-07-15T00:00:00.000Z';
const REGIONS: CloudRegion[] = [
  { id: 'us-east', name: 'US East', residency: 'us', available: true },
  { id: 'eu-west', name: 'EU West', residency: 'eu', available: true },
];
const HOME: CloudTenant = { id: 'tnt-home', name: 'NeuroPause', slug: 'neuropause', organizationId: 'org-default', regionId: 'us-east', tier: 'enterprise', status: 'active', isHome: true, storageNamespace: 'ns', createdAt: NOW };
const TENANT_SUMMARY: TenantSummary = { tenants: 2, active: 2, regions: 2, projects: 3, teams: 2, workers: 5 };
const API_SUMMARY: ApiPlatformSummary = { deployments: 2, healthy: 2, regions: 2, replicas: 5, uptimePct: 99.9, requests30d: 900_000, webhooks: 1, publicApis: 3 };
const LIVE_SYNC: LiveSyncStatus = { state: 'idle', online: true, pendingCount: 0, failures: 0, lastError: null, lastSyncedAt: NOW, cursor: 1200 };
const IDENTITY: IdentitySummary = { connections: 1, active: 1, enforced: true, scimEnabled: true, mfaRequired: true, provisionedUsers: 7 };
const FED: FederationSummary = { orgs: 2, peers: 1, activePeers: 1, pendingInvites: 0, trustedPeers: 1, sharedOut: 1, sharedIn: 0 };
const DR: DrSummary = { backups: 3, lastBackupAt: NOW, replicas: 2, inSync: 2, lastValidationAt: NOW, continuityScore: 90 };

function baseState(over: Partial<ControlPlaneState> = {}): ControlPlaneState {
  return {
    regions: REGIONS,
    tenants: [HOME],
    isolation: [{ tenantId: 'tnt-home', tenantName: 'NeuroPause', namespace: 'ns', encryptionKeyId: 'k', regionId: 'us-east', residency: 'us', objects: 100, bytes: 10_000_000_000 }],
    tenantSummary: TENANT_SUMMARY,
    deployments: [{ id: 'd1', service: 'api-gateway', regionId: 'us-east', replicas: 3, healthyReplicas: 3, status: 'healthy', version: 'v1', uptimePct: 99.9, p95LatencyMs: 40, deployedAt: NOW }],
    apiSummary: API_SUMMARY,
    liveSync: LIVE_SYNC,
    identitySummary: IDENTITY,
    federationSummary: FED,
    drSummary: DR,
    replicas: [{ regionId: 'us-east', status: 'in_sync', lagSeconds: 0, lastReplicatedAt: NOW }],
    organizations: 1,
    workers: 5,
    requests30d: 900_000,
    syncOps30d: 1200,
    monthlySpend: 499,
    currency: 'USD',
    ...over,
  };
}

describe('ControlPlaneService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new ControlPlaneService({ scope, readState: () => baseState() });
    expect(svc.overview().fleet.subsystems).toHaveLength(6);
    expect(svc.fleet().status).toBe('healthy');
    expect(svc.regions()).toHaveLength(2);
    expect(svc.tenants()[0].isHome).toBe(true);
    expect(svc.deployments()).toHaveLength(1);
    expect(svc.usage().quotas.length).toBeGreaterThan(0);
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new ControlPlaneService({ scope, readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const f1 = svc.fleet();
    expect(svc.fleet()).toBe(f1); // same reference → O(1) cache hit
    expect(svc.regions()).toBe(svc.regions());
    expect(reads).toBe(1); // one composition across all reads

    box.value = baseState({ workers: 99 });
    expect(svc.fleet()).toBe(f1); // still cached
    svc.invalidate();
    expect(svc.fleet()).not.toBe(f1); // recomposed
    expect(svc.fleet().totals.workers).toBe(99);
    expect(reads).toBe(2);
  });
});
