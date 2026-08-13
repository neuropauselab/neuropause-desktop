/**
 * P20 — NeuroPause Platform v2 service tests: composition, snapshot + projection memoization,
 * invalidation, and the TTL freshness window.
 */
import { describe, expect, it } from 'vitest';
import { CommercialPlatformService } from './commercialService';
import type { CommercialState } from './commercialModel';

/**
 * P13C ROUND 3 — H-2. The memo is now keyed by tenant, so these tests must name
 * one. A fixed scope keeps every existing memoization assertion meaningful:
 * repeated reads under ONE tenant must still be O(1) cache hits, which is the
 * property this file was written to protect and the fix must not cost.
 */
const TEST_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof TEST_SCOPE => TEST_SCOPE;

function baseState(over: Partial<CommercialState> = {}): CommercialState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z', planTier: 'pro', subStatus: 'active', seats: 5, seatsUsed: 2,
    startedAt: '2026-06-01T00:00:00.000Z', renewsAt: '2026-08-15T00:00:00.000Z', trialEndsAt: null, entitledPlan: 'pro',
    licenseState: 'valid', graceDaysRemaining: 0,
    seatRows: [{ seatId: 's1', userId: 'u1', userName: 'A', assignedAt: '2026-06-01T00:00:00Z', bound: true }],
    licenseRows: [{ id: 'l1', listingName: 'Pack', kind: 'organization', seats: 0, status: 'active', issuedAt: '2026-06-01T00:00:00Z', expiresAt: null }],
    billing: { planName: 'Pro', priceMonthly: 49, currency: 'USD', periodRequests: 100, includedRequests: 100000, overageRequests: 0, estimatedCost: 49, activeLicenses: 1, marketplaceSpend: 0 },
    invoice: { period: '2026-07', subtotal: 49, total: 49, status: 'draft', lines: [{ kind: 'subscription', description: 'Pro', quantity: 1, unitPrice: 49, amount: 49 }] },
    revenue: { gross: 0, platformFees: 0, net: 0, currency: 'USD' },
    requests30d: 100, aiCostUsd: 1, monthlySpend: 49, currency: 'USD', quotas: [],
    tenantsTotal: 3, tenantsActive: 3, tenantsProvisioning: 0,
    regions: [{ id: 'us-east', name: 'US East', residency: 'us', available: true, tenants: 3, deployments: 3, replication: 'in_sync' }],
    multiRegion: false, ssoConnections: 1, ssoActive: 1, scimEnabled: false, mfaRequired: false,
    healthOverall: 80, healthDimensions: [{ key: 'security', label: 'Security', score: 80 }],
    onboarding: { firstRun: false, completed: true, nextStep: null, steps: [{ id: 'welcome', title: 'Welcome', done: true }] },
    analyticsDims: [{ key: 'platform', label: 'Platform', value: 100, display: '100', detail: 'ok', score: 80 }],
    monthlySavingUsd: 1000, cloudSpendUsd: 49,
    updatePhase: 'idle', updateChannel: 'stable', currentVersion: '1.0.0', updateAvailable: null,
    featureFlags: [{ key: 'cloud_sync', enabled: true, source: 'plan', description: 'x' }],
    organizations: 1, departments: [{ kind: 'team' }], users: [{ kind: 'human', status: 'active' }], roles: [{ name: 'Owner', permissionCount: 54, builtIn: true }],
    workspaces: 1, approvalChains: 3, complianceRules: 6, auditEntries: 4, auditSources: ['audit (4)'],
    kpis: [{ key: 'k', label: 'K', value: 80, display: '80/100', band: 'healthy' }],
    ...over,
  };
}

describe('CommercialPlatformService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new CommercialPlatformService({ scope, readState: () => baseState() });
    expect(svc.overview().summary.modules).toBe(9);
    expect(svc.subscription().tiers).toHaveLength(7);
    expect(svc.licensing().seatsTotal).toBe(5);
    expect(svc.billing().priceMonthly).toBe(49);
    expect(svc.metering().meters.length).toBeGreaterThanOrEqual(3);
    expect(svc.deployment().modes).toHaveLength(5);
    expect(svc.customers().healthOverall).toBe(80);
    expect(svc.analytics().monthlySavingUsd).toBe(1000);
    expect(svc.releases().totalFlags).toBe(1);
    expect(svc.administration().usersTotal).toBe(1);
    expect(svc.governance().commercialScope).toBe('commercial:read');
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new CommercialPlatformService({ scope, readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const b1 = svc.billing();
    expect(svc.billing()).toBe(b1); // same reference → O(1) cache hit
    expect(svc.overview()).toBe(svc.overview());
    expect(reads).toBe(1);

    box.value = baseState({ planTier: 'enterprise' });
    expect(svc.billing()).toBe(b1); // still cached
    svc.invalidate();
    expect(svc.subscription().tiers.find((t) => t.current)!.id).toBe('enterprise'); // recomposed
    expect(reads).toBe(2);
  });

  it('refreshes after the TTL even without invalidate() — fixes injected billing/cloud staleness', () => {
    let clock = 1_000;
    let reads = 0;
    const svc = new CommercialPlatformService({ scope, readState: () => {
        reads += 1;
        return baseState();
      },
      ttlMs: 3000,
      now: () => clock,
    });
    svc.overview();
    svc.overview();
    expect(reads).toBe(1); // within TTL → cached
    clock += 3000; // upstream billing/cloud/usage may have changed with no hooked event
    svc.overview();
    expect(reads).toBe(2); // recomposed on its own
  });
});
