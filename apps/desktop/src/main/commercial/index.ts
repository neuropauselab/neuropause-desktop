/**
 * P20 — NeuroPause Platform v2 (Commercial Productization) composition root.
 *
 * The commercial projection LAYER. It composes a READ-ONLY snapshot from the EXISTING commercial substrate —
 * ecosystem billing (subscription/plans/seats/licenses/purchases + the pure invoice math), the license
 * validator (entitled plan + lifecycle), the Cloud Control Plane overview (tenants/regions/deployments/
 * usage) and cloud identity (SSO/SCIM/MFA), the enterprise-OS org/RBAC/policies, usage + adoption analytics
 * (connector/workforce/marketplace/knowledge/AI), customer health (injected P7 report), releases + feature
 * flags + onboarding, and the P14 ROI signal — into commercial projections behind RBAC-gated IPC
 * (`commercial:read`).
 *
 * THE CARDINAL INVARIANT: it PROJECTS, never transacts. `buildState` reads only; it imports NO
 * setPlan/checkout/assignSeat/issueLicense/provision/deploy/override mutator, so the layer cannot change a
 * plan, charge a card, assign a seat, or provision a tenant — those flow through the existing billing engine
 * and cloud control plane under their own manage scopes. It projects no payment secret / card / token /
 * provider id. It creates no new store/runtime and reuses `ecosystem:event` for renderer liveness; every
 * read is defensively wrapped so one failing source degrades rather than crashes the projection.
 */
import {
  EmptyRequest,
  IpcChannel,
  type ControlPlaneOverview,
  type EnterpriseIntelligenceReport,
  type OptimizationEngine,
  type PlanTier,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { billingStore } from '../ecosystem/billing/billingInstance';
import { planFor, computeInvoice } from '../ecosystem/billing/billing';
import { marketplaceStore } from '../ecosystem/marketplace/marketplaceInstance';
import { orgStore } from '../enterprise/org/orgInstance';
import { governanceStore } from '../enterprise/governance/governanceInstance';
import { workspaceStore } from '../enterprise/workspace/workspaceInstance';
import { federationStore as cloudIdentityStore } from '../cloud/identity/federationInstance';
import { flagService } from '../featureFlags/flagInstance';
import { onboardingService } from '../onboarding/onboardingInstance';
import { licenseValidator } from '../license/licenseInstance';
import { connectorService } from '../connectors/connectorService';
import { graphStore } from '../graph/graphInstance';
import { memoryStore } from '../memory/memoryInstance';
import { jobStore } from '../workforce/runtime/jobInstance';
import { workforceIntelligence } from '../workforce/intelligence/workforceIntelligence';
import { aiEngine } from '../ai/engineInstance';
import { appUpdater } from '../services/appUpdater';
import { CommercialPlatformService } from './commercialService';
import type {
  AnalyticsDimInput,
  CommercialState,
  DeptInput,
  FlagInput,
  HealthDimInput,
  LicenseRowInput,
  OnboardingStepInput,
  QuotaInput,
  RegionInput,
  RoleInput,
  SeatRowInput,
  UserInput,
} from './commercialModel';
import { withCommercialAuthz } from './commercialAuthz';

const log = createLogger('commercial-platform');

export interface CommercialPlatformDeps {
  enterpriseReport: () => EnterpriseIntelligenceReport;
  controlPlaneOverview: () => ControlPlaneOverview;
  strategyOptimization: () => OptimizationEngine;
}

export interface CommercialPlatformSubsystem {
  handlers: SecureHandlerDef[];
  service: CommercialPlatformService;
  dispose: () => void;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Compose the commercial snapshot from the EXISTING platform signals (no new store/engine). */
function buildState(deps: CommercialPlatformDeps): CommercialState {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const period = nowIso.slice(0, 7);

  const report = safe(() => deps.enterpriseReport());
  const cloud = safe(() => deps.controlPlaneOverview());
  const optimization = safe(() => deps.strategyOptimization());
  const listings = safe(() => marketplaceStore.list()) ?? [];
  const mPackages = listings.length;
  const mInstalls = listings.reduce((n, l) => n + (l.installs ?? 0), 0);

  // ── Subscription + plan ──
  const sub = safe(() => billingStore.getSubscription());
  const planTier = (sub?.planTier ?? 'free') as PlanTier;
  const plan = safe(() => planFor(planTier));
  const orgId = sub?.orgId ?? safe(() => orgStore.defaultOrg().id) ?? 'org-default';

  // ── License validator (entitled plan + lifecycle) ──
  const licenseStatus = safe(() => licenseValidator.getStatus(orgId));
  const evaluation = licenseStatus?.evaluation ?? null;
  const entitledPlan = evaluation?.entitledPlan ?? planTier;
  const licenseState = evaluation?.state ?? (sub ? 'valid' : 'invalid');
  const graceDaysRemaining = evaluation?.graceDaysRemaining ?? 0;

  // ── Org members (for seat binding + administration) ──
  const orgUsers = safe(() => orgStore.usersFor(orgId)) ?? [];
  const memberIds = new Set(orgUsers.map((u) => u.id));

  // ── Seats + licenses ──
  const seatAssignments = safe(() => billingStore.seatAssignments()) ?? [];
  const seatRows: SeatRowInput[] = seatAssignments.map((a) => ({ seatId: a.id, userId: a.userId, userName: a.userName, assignedAt: a.assignedAt, bound: memberIds.has(a.userId) }));
  const rawLicenses = safe(() => billingStore.listLicenses()) ?? [];
  const licenseRows: LicenseRowInput[] = rawLicenses.map((l) => ({ id: l.id, listingName: l.listingName, kind: l.kind, seats: l.seats, status: l.status, issuedAt: l.issuedAt, expiresAt: l.expiresAt }));

  // ── Billing summary + invoice + revenue ──
  const usage = cloud?.usage ?? null;
  const requests30d = usage?.requests30d ?? 0;
  const includedRequests = plan?.includedRequests ?? 0;
  const overageRequests = Math.max(0, requests30d - includedRequests);
  const overageCost = plan ? Math.ceil(overageRequests / 1000) * plan.overagePer1k : 0;
  const marketplaceSpend = safe(() => billingStore.periodSpend(period)) ?? 0;
  const currency = plan?.currency ?? usage?.currency ?? 'USD';
  const estimatedCost = (plan?.priceMonthly ?? 0) + overageCost;
  const purchases = safe(() => billingStore.listPurchases()) ?? [];
  const invoice = plan ? safe(() => computeInvoice(orgId, plan, requests30d, purchases, period, nowIso)) : null;
  const revenueGross = purchases.reduce((n, p) => n + (p.amount ?? 0), 0);
  const revenuePlatformFees = purchases.reduce((n, p) => n + (p.feeAmount ?? 0), 0);
  const activeLicenses = licenseRows.filter((l) => l.status === 'active').length;

  // ── Metering quotas ──
  const quotas: QuotaInput[] = (usage?.quotas ?? []).map((q) => ({ resource: q.resource, used: q.used, limit: q.limit, utilizationPct: q.utilizationPct }));
  const aiCostUsd = safe(() => aiEngine.usageSummary().costUsd) ?? 0;
  const monthlySpend = usage?.monthlySpend ?? 0;

  // ── Deployment (tenants / regions / identity) ──
  const tenants = cloud?.tenants ?? [];
  const regions: RegionInput[] = (cloud?.regions ?? []).map((r) => ({ id: r.id, name: r.name, residency: r.residency, available: r.available, tenants: r.tenants, deployments: r.deployments, replication: r.replication }));
  const identity = safe(() => cloudIdentityStore.summary());

  // ── Customer health ──
  const healthOverall = report?.health.overall ?? 0;
  const healthDimensions: HealthDimInput[] = (report?.health.scores ?? []).map((sc) => ({ key: sc.key, label: sc.label, score: sc.score }));

  // ── Onboarding ──
  const onboardingStatus = safe(() => onboardingService.getStatus());
  const onboardingSteps: OnboardingStepInput[] = (onboardingStatus?.steps ?? []).map((st) => ({ id: st.id, title: st.title, done: st.completedAt != null }));

  // ── Product analytics dimensions ──
  const connectorStats = safe(() => connectorService.stats());
  const wfi = safe(() => workforceIntelligence(jobStore.page({ limit: 2000 }).jobs));
  const graphCounts = safe(() => graphStore.counts());
  const memoryCounts = safe(() => memoryStore.counts());
  const fleetScore = cloud?.fleet.score ?? 0;
  const connTotal = connectorStats?.total ?? 0;
  const connConnected = connectorStats?.connected ?? 0;
  const successRate = wfi?.overallSuccessRate ?? 0;
  const nodes = graphCounts?.nodes ?? 0;
  const edges = graphCounts?.edges ?? 0;
  const memoryTotal = memoryCounts?.total ?? 0;
  const analyticsDims: AnalyticsDimInput[] = [
    { key: 'platform', label: 'Platform usage', value: requests30d, display: `${requests30d.toLocaleString()} req/30d`, detail: `${usage?.activeWorkers ?? 0} active workers`, score: fleetScore },
    { key: 'connector', label: 'Connector adoption', value: connConnected, display: `${connConnected}/${connTotal}`, detail: `${connectorStats?.healthy ?? 0} healthy`, score: connTotal > 0 ? Math.round((connConnected / connTotal) * 100) : 0 },
    { key: 'worker', label: 'Worker utilization', value: wfi?.activeWorkers ?? 0, display: `${wfi?.activeWorkers ?? 0} active`, detail: `${Math.round(successRate * 100)}% success`, score: Math.round(successRate * 100) },
    { key: 'marketplace', label: 'Marketplace activity', value: mInstalls, display: `${mInstalls} installs`, detail: `${mPackages} packages`, score: mPackages > 0 ? Math.min(100, 50 + mInstalls * 5) : 30 },
    { key: 'knowledge', label: 'Knowledge growth', value: nodes, display: `${nodes} nodes`, detail: `${edges} edges · ${memoryTotal} memories`, score: Math.min(100, Math.round(nodes / 2 + memoryTotal)) },
  ];

  // ── ROI ──
  const monthlySavingUsd = optimization?.totalPotentialSavingUsd ?? 0;

  // ── Releases + feature flags ──
  const updateStatus = safe(() => appUpdater.status());
  const flags = safe(() => flagService.evaluate(entitledPlan as PlanTier)) ?? [];
  const featureFlags: FlagInput[] = flags.map((f) => ({ key: f.key, enabled: f.enabled, source: f.source, description: f.description }));

  // ── Administration ──
  const organizations = (safe(() => orgStore.listOrganizations()) ?? []).length;
  const departments: DeptInput[] = (safe(() => orgStore.unitsFor(orgId)) ?? []).map((u) => ({ kind: u.kind }));
  const users: UserInput[] = orgUsers.map((u) => ({ kind: u.kind, status: u.status }));
  const roles: RoleInput[] = (safe(() => orgStore.rolesFor(orgId)) ?? []).map((r) => ({ name: r.name, permissionCount: r.permissions.length, builtIn: r.builtIn }));
  const workspaces = (safe(() => workspaceStore.list()) ?? []).length;
  const approvalChains = (safe(() => governanceStore.chains()) ?? []).length;
  const complianceRules = (safe(() => governanceStore.rules()) ?? []).length;
  const auditEntries = safe(() => governanceStore.auditCount()) ?? 0;

  const auditSources = [
    `Enterprise governance audit (${auditEntries})`,
    `Billing subscription (${sub?.status ?? 'none'})`,
    `License validator (${licenseStatus?.source ?? 'none'})`,
    `Cloud Control Plane (${tenants.length} tenants)`,
  ];

  return {
    generatedAt: nowIso,
    planTier,
    subStatus: sub?.status ?? 'canceled',
    seats: sub?.seats ?? 0,
    seatsUsed: sub?.seatsUsed ?? 0,
    startedAt: sub?.startedAt ?? nowIso,
    renewsAt: sub?.renewsAt ?? nowIso,
    trialEndsAt: null,
    entitledPlan,
    licenseState,
    graceDaysRemaining,
    seatRows,
    licenseRows,
    billing: {
      planName: plan?.name ?? 'Free',
      priceMonthly: plan?.priceMonthly ?? 0,
      currency,
      periodRequests: requests30d,
      includedRequests,
      overageRequests,
      estimatedCost,
      activeLicenses,
      marketplaceSpend,
    },
    invoice: {
      period,
      subtotal: invoice?.subtotal ?? estimatedCost,
      total: invoice?.total ?? estimatedCost,
      status: invoice?.status ?? 'draft',
      lines: (invoice?.lines ?? []).map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount })),
    },
    revenue: { gross: revenueGross, platformFees: revenuePlatformFees, net: revenueGross - revenuePlatformFees, currency },
    requests30d,
    aiCostUsd,
    monthlySpend,
    currency,
    quotas,
    tenantsTotal: tenants.length,
    tenantsActive: tenants.filter((t) => t.status === 'active').length,
    tenantsProvisioning: tenants.filter((t) => t.status === 'provisioning').length,
    regions,
    multiRegion: regions.filter((r) => r.tenants > 0 || r.deployments > 0).length > 1,
    ssoConnections: identity?.connections ?? 0,
    ssoActive: identity?.active ?? 0,
    scimEnabled: identity?.scimEnabled ?? false,
    mfaRequired: identity?.mfaRequired ?? false,
    healthOverall,
    healthDimensions,
    onboarding: {
      firstRun: onboardingStatus?.firstRun ?? true,
      completed: onboardingStatus?.completedAt != null,
      nextStep: onboardingStatus?.nextStep ?? null,
      steps: onboardingSteps,
    },
    analyticsDims,
    monthlySavingUsd,
    cloudSpendUsd: monthlySpend,
    updatePhase: updateStatus?.phase ?? 'idle',
    updateChannel: updateStatus?.channel ?? 'stable',
    currentVersion: updateStatus?.currentVersion ?? '0.0.0',
    updateAvailable: updateStatus?.available?.version ?? null,
    featureFlags,
    organizations,
    departments,
    users,
    roles,
    workspaces,
    approvalChains,
    complianceRules,
    auditEntries,
    auditSources,
    kpis: report?.kpis ?? [],
  };
}

export function initCommercialPlatform(deps: CommercialPlatformDeps): CommercialPlatformSubsystem {
  const service = new CommercialPlatformService({ readState: () => buildState(deps) });

  // Invalidate the memoized snapshot when a backing store changes; the injected report/cloud/strategy/
  // marketplace accessors refresh via the service TTL. Renderer liveness reuses `ecosystem:event`.
  const invalidate = (): void => service.invalidate();
  billingStore.on('changed', invalidate);
  orgStore.on('changed', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.CommercialOverview, schema: EmptyRequest, handler: () => service.overview() },
    { channel: IpcChannel.CommercialSubscription, schema: EmptyRequest, handler: () => service.subscription() },
    { channel: IpcChannel.CommercialLicensing, schema: EmptyRequest, handler: () => service.licensing() },
    { channel: IpcChannel.CommercialBilling, schema: EmptyRequest, handler: () => service.billing() },
    { channel: IpcChannel.CommercialMetering, schema: EmptyRequest, handler: () => service.metering() },
    { channel: IpcChannel.CommercialDeployment, schema: EmptyRequest, handler: () => service.deployment() },
    { channel: IpcChannel.CommercialCustomers, schema: EmptyRequest, handler: () => service.customers() },
    { channel: IpcChannel.CommercialAnalytics, schema: EmptyRequest, handler: () => service.analytics() },
    { channel: IpcChannel.CommercialReleases, schema: EmptyRequest, handler: () => service.releases() },
    { channel: IpcChannel.CommercialAdministration, schema: EmptyRequest, handler: () => service.administration() },
    { channel: IpcChannel.CommercialGovernance, schema: EmptyRequest, handler: () => service.governance() },
  ];
  const handlers = withCommercialAuthz(rawHandlers);

  const dispose = (): void => {
    billingStore.off('changed', invalidate);
    orgStore.off('changed', invalidate);
  };

  log.info('NeuroPause Platform v2 (commercial) ready', { modules: safe(() => service.overview().modules.length) ?? 0 });
  return { handlers, service, dispose };
}
