/**
 * P20 — NeuroPause Platform v2 model tests. Pure projections over a composed commercial snapshot:
 * subscription (7-tier catalog), licensing (seat math + member binding), billing (invoice + revenue),
 * usage metering, deployment (5-mode catalog), customer success, product analytics + ROI, releases +
 * feature flags, org administration, and governance — PLUS the cardinal invariants (exactly 7 tiers with
 * one current; exactly 5 deployment modes; no payment secret / card / token / provider-id is ever
 * projected), deterministic and never-throws-on-empty.
 */
import { describe, expect, it } from 'vitest';
import {
  bandFor,
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
  buildCommercialSummary,
  buildCommercialModules,
  currentTierId,
  licenseBand,
  statusBand,
  COMMERCIAL_TIERS,
  DEPLOYMENT_MODES,
  type CommercialState,
} from './commercialModel';

function state(over: Partial<CommercialState> = {}): CommercialState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    planTier: 'pro',
    subStatus: 'active',
    seats: 5,
    seatsUsed: 3,
    startedAt: '2026-06-01T00:00:00.000Z',
    renewsAt: '2026-08-15T00:00:00.000Z',
    trialEndsAt: null,
    entitledPlan: 'pro',
    licenseState: 'valid',
    graceDaysRemaining: 0,
    seatRows: [
      { seatId: 'seat:1', userId: 'user-owner', userName: 'Owner', assignedAt: '2026-06-01T00:00:00Z', bound: true },
      { seatId: 'seat:2', userId: 'user-2', userName: 'Alex', assignedAt: '2026-06-02T00:00:00Z', bound: true },
      { seatId: 'seat:3', userId: 'ghost', userName: 'Ghost', assignedAt: '2026-06-03T00:00:00Z', bound: false },
    ],
    licenseRows: [
      { id: 'lic:1', listingName: 'SOC 2 Pack', kind: 'organization', seats: 0, status: 'active', issuedAt: '2026-06-01T00:00:00Z', expiresAt: null },
      { id: 'lic:2', listingName: 'Old Pack', kind: 'seat', seats: 3, status: 'expired', issuedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-05-01T00:00:00Z' },
    ],
    billing: { planName: 'Pro', priceMonthly: 49, currency: 'USD', periodRequests: 5000, includedRequests: 100000, overageRequests: 0, estimatedCost: 49, activeLicenses: 1, marketplaceSpend: 118 },
    invoice: { period: '2026-07', subtotal: 49, total: 49, status: 'draft', lines: [{ kind: 'subscription', description: 'Pro plan', quantity: 1, unitPrice: 49, amount: 49 }] },
    revenue: { gross: 118, platformFees: 24, net: 94, currency: 'USD' },
    requests30d: 5000,
    aiCostUsd: 12.5,
    monthlySpend: 49,
    currency: 'USD',
    quotas: [{ resource: 'workers', used: 3, limit: 25, utilizationPct: 12 }],
    tenantsTotal: 5,
    tenantsActive: 4,
    tenantsProvisioning: 1,
    regions: [
      { id: 'us-east', name: 'US East', residency: 'us', available: true, tenants: 3, deployments: 3, replication: 'in_sync' },
      { id: 'eu-west', name: 'EU West', residency: 'eu', available: true, tenants: 2, deployments: 2, replication: 'lagging' },
      { id: 'ap-south', name: 'AP South', residency: 'apac', available: true, tenants: 0, deployments: 0, replication: 'none' },
    ],
    multiRegion: true,
    ssoConnections: 2,
    ssoActive: 1,
    scimEnabled: false,
    mfaRequired: false,
    healthOverall: 78,
    healthDimensions: [
      { key: 'security', label: 'Security', score: 82 },
      { key: 'availability', label: 'Availability', score: 90 },
      { key: 'compliance', label: 'Compliance', score: 60 },
    ],
    onboarding: { firstRun: false, completed: false, nextStep: 'connectors', steps: [
      { id: 'welcome', title: 'Welcome', done: true },
      { id: 'organization', title: 'Organization', done: true },
      { id: 'connectors', title: 'Connectors', done: false },
      { id: 'ai_setup', title: 'AI setup', done: false },
    ] },
    analyticsDims: [
      { key: 'platform', label: 'Platform usage', value: 5000, display: '5,000 req/30d', detail: '4 active workers', score: 85 },
      { key: 'connector', label: 'Connector adoption', value: 3, display: '3/22', detail: '3 healthy', score: 14 },
      { key: 'worker', label: 'Worker utilization', value: 27, display: '27 active', detail: '92% success', score: 92 },
    ],
    monthlySavingUsd: 4200,
    cloudSpendUsd: 49,
    updatePhase: 'idle',
    updateChannel: 'stable',
    currentVersion: '1.0.0',
    updateAvailable: null,
    featureFlags: [
      { key: 'cloud_sync', enabled: true, source: 'plan', description: 'Cloud sync' },
      { key: 'automation_builder', enabled: true, source: 'default', description: 'Automation builder' },
      { key: 'advanced_analytics', enabled: false, source: 'plan', description: 'Advanced analytics' },
    ],
    organizations: 1,
    departments: [{ kind: 'business_unit' }, { kind: 'department' }, { kind: 'team' }],
    users: [
      { kind: 'human', status: 'active' },
      { kind: 'human', status: 'invited' },
      { kind: 'ai_worker', status: 'active' },
      { kind: 'ai_worker', status: 'active' },
    ],
    roles: [
      { name: 'Owner', permissionCount: 54, builtIn: true },
      { name: 'Viewer', permissionCount: 28, builtIn: true },
    ],
    workspaces: 1,
    approvalChains: 3,
    complianceRules: 6,
    auditEntries: 4,
    auditSources: ['Enterprise governance audit (4)', 'Billing subscription (active)'],
    kpis: [{ key: 'commercial.health', label: 'Health', value: 78, display: '78/100', band: 'healthy' }],
    ...over,
  };
}

function emptyState(): CommercialState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z', planTier: 'free', subStatus: 'canceled', seats: 0, seatsUsed: 0,
    startedAt: '2026-07-16T00:00:00.000Z', renewsAt: '2026-07-16T00:00:00.000Z', trialEndsAt: null, entitledPlan: 'free',
    licenseState: 'invalid', graceDaysRemaining: 0, seatRows: [], licenseRows: [],
    billing: { planName: 'Free', priceMonthly: 0, currency: 'USD', periodRequests: 0, includedRequests: 0, overageRequests: 0, estimatedCost: 0, activeLicenses: 0, marketplaceSpend: 0 },
    invoice: { period: '2026-07', subtotal: 0, total: 0, status: 'draft', lines: [] },
    revenue: { gross: 0, platformFees: 0, net: 0, currency: 'USD' },
    requests30d: 0, aiCostUsd: 0, monthlySpend: 0, currency: 'USD', quotas: [],
    tenantsTotal: 0, tenantsActive: 0, tenantsProvisioning: 0, regions: [], multiRegion: false,
    ssoConnections: 0, ssoActive: 0, scimEnabled: false, mfaRequired: false,
    healthOverall: 0, healthDimensions: [], onboarding: { firstRun: true, completed: false, nextStep: null, steps: [] },
    analyticsDims: [], monthlySavingUsd: 0, cloudSpendUsd: 0,
    updatePhase: 'idle', updateChannel: 'stable', currentVersion: '0.0.0', updateAvailable: null, featureFlags: [],
    organizations: 0, departments: [], users: [], roles: [], workspaces: 0, approvalChains: 0, complianceRules: 0, auditEntries: 0,
    auditSources: [], kpis: [],
  };
}

describe('band / tier helpers', () => {
  it('maps scores + license + status to bands', () => {
    expect(bandFor(80)).toBe('healthy');
    expect(bandFor(30)).toBe('at-risk');
    expect(licenseBand('valid')).toBe('healthy');
    expect(licenseBand('grace')).toBe('watch');
    expect(licenseBand('invalid')).toBe('critical');
    expect(statusBand('active')).toBe('healthy');
    expect(statusBand('past_due')).toBe('at-risk');
    expect(currentTierId('free')).toBe('free');
    expect(currentTierId('pro')).toBe('professional');
    expect(currentTierId('enterprise')).toBe('enterprise');
  });
});

describe('CARDINAL: commercial catalogs', () => {
  it('exposes exactly the 7 commercial tiers with exactly one current', () => {
    const sub = buildCommercialSubscription(state({ planTier: 'pro' }));
    expect(sub.tiers).toHaveLength(7);
    expect(sub.tiers.map((t) => t.id)).toEqual(['free', 'professional', 'business', 'enterprise', 'government', 'education', 'oem']);
    expect(sub.tiers.filter((t) => t.current)).toHaveLength(1);
    expect(sub.tiers.find((t) => t.current)!.id).toBe('professional');
    expect(sub.tiers.every((t) => t.available)).toBe(true);
    // catalog integrity: every tier maps to a real production plan tier.
    for (const t of COMMERCIAL_TIERS) expect(['free', 'pro', 'enterprise']).toContain(t.basePlanTier);
  });

  it('exposes exactly the 5 deployment modes with Cloud SaaS current', () => {
    const d = buildCommercialDeployment(state());
    expect(d.modes).toHaveLength(5);
    expect(d.modes.map((m) => m.id)).toEqual(['cloud_saas', 'private_cloud', 'hybrid', 'on_premises', 'air_gapped']);
    expect(d.modes.filter((m) => m.current)).toHaveLength(1);
    expect(d.currentMode).toBe('cloud_saas');
    expect(DEPLOYMENT_MODES).toHaveLength(5);
  });

  it('CARDINAL: no payment secret / card / token / provider-id VALUE is ever projected', () => {
    const sub = buildCommercialSubscription(state());
    const bill = buildCommercialBilling(state());
    const json = JSON.stringify({ sub, bill });
    // no card-number-length digit run, and no payment-provider secret/id value pattern.
    expect(json).not.toMatch(/\b\d{13,16}\b/);
    expect(json).not.toMatch(/sk_live|sk_test|rzp_|pk_live|tok_|cus_|whsec_/i);
    // billing + subscription surface no secret-named fields.
    for (const k of Object.keys(bill)) expect(k).not.toMatch(/token|secret|card|cvv|provider/i);
    for (const k of Object.keys(sub)) expect(k).not.toMatch(/token|secret|card|cvv|provider/i);
    // and the governance posture explicitly documents the protection.
    expect(buildCommercialGovernance(state()).dataProtection).toMatch(/no payment secret/i);
  });
});

describe('licensing — seat math + member binding', () => {
  it('computes seat availability + utilization and flags unbound seats', () => {
    const l = buildCommercialLicensing(state());
    expect(l.seatsTotal).toBe(5);
    expect(l.seatsUsed).toBe(3);
    expect(l.seatsAvailable).toBe(2);
    expect(l.seatUtilizationPct).toBe(60);
    expect(l.seats.filter((s) => !s.bound)).toHaveLength(1); // 'ghost' is unbound
    expect(l.activeLicenses).toBe(1); // one active, one expired
    expect(l.licenseBand).toBe('healthy'); // valid
  });

  it('handles unlimited seats (enterprise, seats = -1) without negative availability', () => {
    const l = buildCommercialLicensing(state({ seats: -1, seatsUsed: 40 }));
    expect(l.seatsAvailable).toBe(-1); // sentinel for unlimited
    expect(l.seatUtilizationPct).toBe(0); // not computed against a negative cap
  });
});

describe('billing / metering / deployment / customers / analytics / releases / admin', () => {
  it('projects billing with invoice + derived revenue, no secrets', () => {
    const b = buildCommercialBilling(state());
    expect(b.priceMonthly).toBe(49);
    expect(b.invoiceTotal).toBe(49);
    expect(b.revenueGross).toBe(118);
    expect(b.revenueNet).toBe(94);
    expect(b.invoiceLines).toHaveLength(1);
  });

  it('projects usage meters with headroom banding', () => {
    const m = buildCommercialMetering(state());
    expect(m.meters.length).toBeGreaterThanOrEqual(4); // requests + ai + spend + 1 quota
    expect(m.meters[0].key).toBe('requests');
    expect(m.aiCostUsd).toBe(13); // rounded 12.5
  });

  it('projects deployment tenants + regions + identity', () => {
    const d = buildCommercialDeployment(state());
    expect(d.tenantsTotal).toBe(5);
    expect(d.tenantsProvisioning).toBe(1);
    expect(d.activeRegions).toBe(2); // us-east + eu-west have tenants
    expect(d.multiRegion).toBe(true);
    expect(d.regions.find((r) => r.id === 'eu-west')!.band).toBe('at-risk'); // lagging
    expect(d.band).toBe('watch'); // one provisioning + a lagging region
  });

  it('deployment band never masks a region outage behind a provisioning tenant', () => {
    // a down region (available:false → critical) alongside a provisioning tenant must surface as at-risk.
    const d = buildCommercialDeployment(state({
      tenantsProvisioning: 1,
      regions: [{ id: 'us-east', name: 'US East', residency: 'us', available: false, tenants: 2, deployments: 2, replication: 'failed' }],
    }));
    expect(d.regions[0].band).toBe('critical');
    expect(d.band).toBe('at-risk'); // NOT 'watch' — the outage wins over provisioning
  });

  it('projects customer success (health + onboarding progress + renewal)', () => {
    const c = buildCommercialCustomers(state());
    expect(c.healthOverall).toBe(78);
    expect(c.healthBand).toBe('healthy');
    expect(c.onboardingProgressPct).toBe(50); // 2 of 4 steps
    expect(c.dimensions.find((d) => d.key === 'compliance')!.band).toBe('watch'); // 60
    expect(c.daysToRenewal).toBe(30); // Jul 16 → Aug 15
    expect(c.renewalRisk).toBe('watch'); // <=30 days, healthy
  });

  it('projects product analytics + ROI', () => {
    const a = buildCommercialAnalytics(state());
    expect(a.dimensions).toHaveLength(3);
    expect(a.monthlySavingUsd).toBe(4200);
    expect(a.netValueUsd).toBe(Math.round(4200 - 12.5 - 49)); // net rounded once: 4138.5 → 4139
    expect(a.roiRatio).toBeGreaterThan(1);
  });

  it('projects releases + feature flags', () => {
    const r = buildCommercialReleases(state());
    expect(r.totalFlags).toBe(3);
    expect(r.enabledFlags).toBe(2);
    expect(r.currentVersion).toBe('1.0.0');
  });

  it('projects organization administration', () => {
    const a = buildCommercialAdministration(state());
    expect(a.usersTotal).toBe(4);
    expect(a.usersHuman).toBe(2);
    expect(a.usersAiWorker).toBe(2);
    expect(a.usersInvited).toBe(1);
    expect(a.departments).toBe(3);
    expect(a.roles[0].name).toBe('Owner'); // sorted by permission count desc
  });
});

describe('modules + summary + overview + governance', () => {
  it('projects nine commercial modules + a summary + overview bundle', () => {
    const modules = buildCommercialModules(state());
    expect(modules).toHaveLength(9);
    for (const m of modules) expect(m.source.length).toBeGreaterThan(0);
    const o = buildCommercialOverview(state());
    expect(o.summary.tier).toBe('professional');
    expect(o.summary.modules).toBe(9);
    expect(o.summary.currentDeploymentMode).toBe('cloud_saas');
    expect(o.kpis).toHaveLength(1);
  });

  it('governance asserts data protection + reuses existing scopes', () => {
    const g = buildCommercialGovernance(state());
    expect(g.commercialScope).toBe('commercial:read');
    expect(g.dataProtection).toMatch(/no payment secret/i);
    expect(g.reusedSystems.length).toBe(6);
    expect(g.redactions.length).toBeGreaterThanOrEqual(3);
  });
});

describe('determinism + never-throws-on-empty', () => {
  it('is deterministic — same state yields deep-equal output', () => {
    expect(buildCommercialOverview(state())).toEqual(buildCommercialOverview(state()));
    expect(buildCommercialSubscription(state())).toEqual(buildCommercialSubscription(state()));
  });

  it('never throws on an empty commercial snapshot', () => {
    expect(() => buildCommercialOverview(emptyState())).not.toThrow();
    expect(() => buildCommercialBilling(emptyState())).not.toThrow();
    expect(() => buildCommercialMetering(emptyState())).not.toThrow();
    expect(() => buildCommercialDeployment(emptyState())).not.toThrow();
    expect(() => buildCommercialAnalytics(emptyState())).not.toThrow();
    expect(buildCommercialSubscription(emptyState()).tiers).toHaveLength(7);
    expect(buildCommercialSummary(emptyState()).liveModules).toBeGreaterThanOrEqual(0);
    expect(buildCommercialAnalytics(emptyState()).roiRatio).toBeNull(); // no cost → no ratio
  });
});

/* ── P13C ROUND 36 — GATE 5: a throwing validator is not a valid license ──── */

import { resolveLicenseState } from './commercialModel';

describe('resolveLicenseState (round 36)', () => {
  it('a THROWN validator (null status) answers unknown — never a false valid', () => {
    expect(resolveLicenseState(null, true)).toBe('unknown');
    expect(resolveLicenseState(null, false)).toBe('unknown');
  });
  it('an evaluation that ran passes its state through', () => {
    expect(resolveLicenseState({ evaluation: { state: 'grace' } }, true)).toBe('grace');
    expect(resolveLicenseState({ evaluation: { state: 'invalid' } }, true)).toBe('invalid');
  });
  it('no license record with a subscription keeps its documented valid meaning', () => {
    expect(resolveLicenseState({ evaluation: null }, true)).toBe('valid');
    expect(resolveLicenseState({ evaluation: null }, false)).toBe('invalid');
  });
  it('unknown bands as watch — attention, never healthy and never asserted breach', () => {
    expect(licenseBand('unknown')).toBe('watch');
    expect(licenseBand('valid')).toBe('healthy');
    expect(licenseBand('invalid')).toBe('critical');
  });
});
