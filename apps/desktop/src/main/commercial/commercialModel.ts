/**
 * NeuroPause Platform v2 (P20) — the pure commercial projection model.
 *
 * All non-trivial commercial logic lives here (the house pure-model pattern) so it is unit-tested under
 * Node with no I/O. It projects a composed snapshot of the EXISTING commercial substrate — ecosystem
 * billing (plans/seats/licenses/purchases/invoice), the license validator (entitled plan + lifecycle),
 * the Cloud Control Plane (tenants/regions/deployments/usage/identity), enterprise-OS org/RBAC/policies,
 * usage + adoption analytics, customer health, releases/flags/onboarding, and P14 ROI signals — into
 * commercial VIEW MODELS. It synthesizes the commercial packaging that does not yet exist (the 7-tier
 * catalog and the 5 deployment-mode catalog) as pure read-only projections. It introduces NO new billing
 * engine, marketplace, runtime, or store, and never projects a payment secret / card / token / provider id.
 */
import type {
  AnalyticsDimensionRow,
  CommercialAdministration,
  CommercialAnalytics,
  CommercialBand,
  CommercialBilling,
  CommercialCustomers,
  CommercialDeployment,
  CommercialGovernance,
  CommercialLicenseRow,
  CommercialLicensing,
  CommercialMetering,
  CommercialModuleStatus,
  CommercialOverview,
  CommercialReleases,
  CommercialRoleRow,
  CommercialSubscription,
  CommercialSummary,
  CommercialTier,
  CommercialTierId,
  DeploymentModeId,
  DeploymentModeRow,
  DeploymentRegionRow,
  ExecutiveKpi,
  FeatureFlagRow,
  HealthDimensionRow,
  InvoiceLineRow,
  MeterRow,
  OnboardingStepRow,
  SeatRow,
} from '@neuropause/shared';

/* ── The composed snapshot the projections read (assembled by the composition root) ── */

export interface SeatRowInput {
  seatId: string;
  userId: string;
  userName: string;
  assignedAt: string;
  bound: boolean;
}
export interface LicenseRowInput {
  id: string;
  listingName: string;
  kind: string;
  seats: number;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
}
export interface InvoiceLineInput {
  kind: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}
export interface QuotaInput {
  resource: string;
  used: number;
  limit: number;
  utilizationPct: number;
}
export interface RegionInput {
  id: string;
  name: string;
  residency: string;
  available: boolean;
  tenants: number;
  deployments: number;
  replication: string;
}
export interface HealthDimInput {
  key: string;
  label: string;
  score: number;
}
export interface OnboardingStepInput {
  id: string;
  title: string;
  done: boolean;
}
export interface AnalyticsDimInput {
  key: string;
  label: string;
  value: number;
  display: string;
  detail: string;
  /** 0..100 health-oriented score for banding. */
  score: number;
}
export interface FlagInput {
  key: string;
  enabled: boolean;
  source: string;
  description: string;
}
export interface DeptInput {
  kind: string;
}
export interface UserInput {
  kind: string;
  status: string;
}
export interface RoleInput {
  name: string;
  permissionCount: number;
  builtIn: boolean;
}

export interface CommercialState {
  generatedAt: string;
  planTier: string;
  subStatus: string;
  seats: number;
  seatsUsed: number;
  startedAt: string;
  renewsAt: string;
  trialEndsAt: string | null;
  entitledPlan: string;
  licenseState: string;
  graceDaysRemaining: number;
  seatRows: SeatRowInput[];
  licenseRows: LicenseRowInput[];
  billing: {
    planName: string;
    priceMonthly: number;
    currency: string;
    periodRequests: number;
    includedRequests: number;
    overageRequests: number;
    estimatedCost: number;
    activeLicenses: number;
    marketplaceSpend: number;
  };
  invoice: { period: string; subtotal: number; total: number; status: string; lines: InvoiceLineInput[] };
  revenue: { gross: number; platformFees: number; net: number; currency: string };
  requests30d: number;
  aiCostUsd: number;
  monthlySpend: number;
  currency: string;
  quotas: QuotaInput[];
  tenantsTotal: number;
  tenantsActive: number;
  tenantsProvisioning: number;
  regions: RegionInput[];
  multiRegion: boolean;
  ssoConnections: number;
  ssoActive: number;
  scimEnabled: boolean;
  mfaRequired: boolean;
  healthOverall: number;
  healthDimensions: HealthDimInput[];
  onboarding: { firstRun: boolean; completed: boolean; nextStep: string | null; steps: OnboardingStepInput[] };
  analyticsDims: AnalyticsDimInput[];
  monthlySavingUsd: number;
  cloudSpendUsd: number;
  updatePhase: string;
  updateChannel: string;
  currentVersion: string;
  updateAvailable: string | null;
  featureFlags: FlagInput[];
  organizations: number;
  departments: DeptInput[];
  users: UserInput[];
  roles: RoleInput[];
  workspaces: number;
  approvalChains: number;
  complianceRules: number;
  auditEntries: number;
  auditSources: string[];
  kpis: ExecutiveKpi[];
}

/* ── helpers ── */

const round = (n: number): number => Math.round(n);
const clamp100 = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 100 ? 100 : n);

/** Score (0..100) → band; the universal ≥75/≥50/≥25 cutoff shared across P13–P19. */
export function bandFor(score: number): CommercialBand {
  return score >= 75 ? 'healthy' : score >= 50 ? 'watch' : score >= 25 ? 'at-risk' : 'critical';
}
/** License lifecycle state → band. */
export function licenseBand(state: string): CommercialBand {
  return state === 'valid' ? 'healthy' : state === 'grace' ? 'watch' : 'critical';
}
/** License/subscription status → band. */
export function statusBand(status: string): CommercialBand {
  return status === 'active' ? 'healthy' : status === 'trialing' ? 'watch' : status === 'past_due' ? 'at-risk' : 'critical';
}

/* ── The 7-tier commercial catalog (synthesized packaging over the 3 production plan tiers) ── */

interface TierDef {
  id: CommercialTierId;
  name: string;
  segment: CommercialTier['segment'];
  basePlanTier: string;
  priceModel: CommercialTier['priceModel'];
  priceHint: string;
  seatModel: string;
  entitlements: string[];
  targetSegment: string;
}

export const COMMERCIAL_TIERS: TierDef[] = [
  { id: 'free', name: 'Free', segment: 'self_serve', basePlanTier: 'free', priceModel: 'free', priceHint: 'Free', seatModel: '1 seat', entitlements: ['Core platform', 'Community support'], targetSegment: 'Individuals & trials' },
  { id: 'professional', name: 'Professional', segment: 'self_serve', basePlanTier: 'pro', priceModel: 'per_seat', priceHint: '$49 / seat / mo', seatModel: 'Up to 10 seats', entitlements: ['Everything in Free', 'Automation builder', 'AI memory search', 'Email support'], targetSegment: 'Small teams' },
  { id: 'business', name: 'Business', segment: 'sales_assisted', basePlanTier: 'enterprise', priceModel: 'annual_contract', priceHint: 'From $499 / mo', seatModel: 'Up to 25 seats', entitlements: ['Everything in Professional', 'Advanced analytics', 'Multi-workspace', 'SSO', 'Priority support'], targetSegment: 'Growing companies' },
  { id: 'enterprise', name: 'Enterprise', segment: 'sales_assisted', basePlanTier: 'enterprise', priceModel: 'annual_contract', priceHint: 'Custom', seatModel: 'Unlimited seats', entitlements: ['Everything in Business', 'SCIM provisioning', 'Dedicated tenancy', 'Custom SLA', 'Governance & compliance'], targetSegment: 'Large enterprises' },
  { id: 'government', name: 'Government', segment: 'special', basePlanTier: 'enterprise', priceModel: 'custom', priceHint: 'Custom (public sector)', seatModel: 'Unlimited seats', entitlements: ['Everything in Enterprise', 'FedRAMP-aligned controls', 'Data residency', 'Air-gapped option'], targetSegment: 'Public sector' },
  { id: 'education', name: 'Education', segment: 'special', basePlanTier: 'enterprise', priceModel: 'custom', priceHint: 'Academic pricing', seatModel: 'Site license', entitlements: ['Everything in Enterprise', 'Discounted academic pricing', 'Classroom provisioning'], targetSegment: 'Schools & universities' },
  { id: 'oem', name: 'OEM', segment: 'special', basePlanTier: 'enterprise', priceModel: 'custom', priceHint: 'Revenue share', seatModel: 'Embedded licensing', entitlements: ['Everything in Enterprise', 'White-label', 'Embedded licensing', 'API-first'], targetSegment: 'Embedded & resellers' },
];

/** Map the production plan tier to its current commercial tier (self-serve tiers are the observable ones). */
export function currentTierId(planTier: string): CommercialTierId {
  return planTier === 'free' ? 'free' : planTier === 'pro' ? 'professional' : 'enterprise';
}

export function buildCommercialTiers(planTier: string): CommercialTier[] {
  const current = currentTierId(planTier);
  return COMMERCIAL_TIERS.map((t) => ({ ...t, current: t.id === current, available: true }));
}

/* ── The 5 deployment-mode catalog (synthesized over the existing cloud posture) ── */

interface ModeDef {
  id: DeploymentModeId;
  name: string;
  description: string;
  isolation: string;
  residencySupport: string;
  connectivity: string;
}

export const DEPLOYMENT_MODES: ModeDef[] = [
  { id: 'cloud_saas', name: 'Cloud SaaS', description: 'Multi-tenant SaaS in NeuroPause-managed regions.', isolation: 'Namespace + KMS key per tenant', residencySupport: 'US / EU / APAC', connectivity: 'Public internet (TLS)' },
  { id: 'private_cloud', name: 'Private Cloud', description: 'Single-tenant dedicated cloud deployment.', isolation: 'Dedicated tenant + VPC', residencySupport: 'Customer-selected region', connectivity: 'Private link' },
  { id: 'hybrid', name: 'Hybrid', description: 'Control plane in cloud, data plane on customer infrastructure.', isolation: 'Split control / data plane', residencySupport: 'Data stays on-prem', connectivity: 'Outbound-only bridge' },
  { id: 'on_premises', name: 'On-Premises', description: 'Fully self-hosted in the customer datacenter.', isolation: 'Customer-owned', residencySupport: 'Customer datacenter', connectivity: 'Customer network' },
  { id: 'air_gapped', name: 'Air-Gapped', description: 'Isolated deployment with no external connectivity.', isolation: 'Fully isolated', residencySupport: 'Customer datacenter', connectivity: 'None (offline)' },
];

/** The current deployment mode observed from the substrate (multi-tenant multi-region cloud). */
export const CURRENT_DEPLOYMENT_MODE: DeploymentModeId = 'cloud_saas';

/* ── Subscription management ── */

export function buildCommercialSubscription(s: CommercialState): CommercialSubscription {
  const tier = currentTierId(s.planTier);
  const tierDef = COMMERCIAL_TIERS.find((t) => t.id === tier)!;
  return {
    tier,
    tierName: tierDef.name,
    planTier: s.planTier,
    status: s.subStatus,
    seats: s.seats,
    seatsUsed: s.seatsUsed,
    startedAt: s.startedAt,
    renewsAt: s.renewsAt,
    trialEndsAt: s.trialEndsAt,
    entitledPlan: s.entitledPlan,
    licenseState: s.licenseState,
    graceDaysRemaining: s.graceDaysRemaining,
    tiers: buildCommercialTiers(s.planTier),
    note: 'Subscription projects the EXISTING ecosystem subscription + license validator; the 7-tier catalog (Free / Professional / Business / Enterprise / Government / Education / OEM) is synthesized commercial packaging over the underlying free/pro/enterprise plan tiers. No plan change is performed here — checkout flows through the existing billing engine.',
  };
}

/* ── License management ── */

export function buildCommercialLicensing(s: CommercialState): CommercialLicensing {
  const seats: SeatRow[] = s.seatRows.map((r) => ({ seatId: r.seatId, userId: r.userId, userName: r.userName, assignedAt: r.assignedAt, bound: r.bound }));
  const licenses: CommercialLicenseRow[] = s.licenseRows
    .map((l) => ({ id: l.id, listingName: l.listingName, kind: l.kind, seats: l.seats, status: l.status, band: (l.status === 'active' ? 'healthy' : l.status === 'expired' ? 'at-risk' : 'critical') as CommercialBand, issuedAt: l.issuedAt, expiresAt: l.expiresAt }))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const seatsAvailable = s.seats < 0 ? -1 : Math.max(0, s.seats - s.seatsUsed);
  const seatUtilizationPct = s.seats > 0 ? round((s.seatsUsed / s.seats) * 100) : 0;
  return {
    seatsTotal: s.seats,
    seatsUsed: s.seatsUsed,
    seatsAvailable,
    seatUtilizationPct,
    seats,
    licenses,
    activeLicenses: licenses.filter((l) => l.status === 'active').length,
    entitledPlan: s.entitledPlan,
    licenseState: s.licenseState,
    licenseBand: licenseBand(s.licenseState),
    graceDaysRemaining: s.graceDaysRemaining,
    note: 'License management projects the EXISTING ecosystem seat assignments + marketplace licenses + the product-license validator (entitled plan / grace). Seats join to org members by userId; unbound seats are flagged. No seat or license is assigned or revoked here.',
  };
}

/* ── Billing center + revenue ── */

export function buildCommercialBilling(s: CommercialState): CommercialBilling {
  const invoiceLines: InvoiceLineRow[] = s.invoice.lines.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: round(l.amount) }));
  return {
    planTier: s.planTier,
    planName: s.billing.planName,
    priceMonthly: round(s.billing.priceMonthly),
    currency: s.billing.currency,
    periodRequests: s.billing.periodRequests,
    includedRequests: s.billing.includedRequests,
    overageRequests: s.billing.overageRequests,
    estimatedCost: round(s.billing.estimatedCost),
    seatsUsed: s.seatsUsed,
    seats: s.seats,
    activeLicenses: s.billing.activeLicenses,
    marketplaceSpend: round(s.billing.marketplaceSpend),
    invoicePeriod: s.invoice.period,
    invoiceSubtotal: round(s.invoice.subtotal),
    invoiceTotal: round(s.invoice.total),
    invoiceStatus: s.invoice.status,
    invoiceLines,
    revenueGross: round(s.revenue.gross),
    revenuePlatformFees: round(s.revenue.platformFees),
    revenueNet: round(s.revenue.net),
    note: 'Billing projects the EXISTING billing summary + on-demand draft invoice. The marketplace figures are the org\'s own LIFETIME marketplace transaction volume (gross), platform fees, and publisher net — the org\'s purchase spend, distinct from the period-scoped estimated cost. `estimatedCost` is the recurring subscription + overage (excludes one-off marketplace purchases). Everything is computed from plan price, metered requests, and marketplace purchases — no card, token, or payment-provider id is projected, and no charge is made here.',
  };
}

/* ── Usage metering ── */

export function buildCommercialMetering(s: CommercialState): CommercialMetering {
  const meters: MeterRow[] = [];
  const reqLimit = s.billing.includedRequests > 0 ? s.billing.includedRequests : null;
  const reqUtil = reqLimit ? Math.min(100, round((s.requests30d / reqLimit) * 100)) : null;
  meters.push({ key: 'requests', label: 'API requests (30d)', used: s.requests30d, limit: reqLimit, unit: 'requests', display: `${s.requests30d.toLocaleString()}${reqLimit ? ` / ${reqLimit.toLocaleString()}` : ''}`, utilizationPct: reqUtil, band: reqUtil == null ? 'healthy' : bandFor(100 - reqUtil), source: 'Developer gateway meter' });
  meters.push({ key: 'ai_cost', label: 'AI usage cost (MTD)', used: round(s.aiCostUsd), limit: null, unit: s.currency, display: `${s.currency}${s.aiCostUsd.toFixed(2)}`, utilizationPct: null, band: 'healthy', source: 'AI usage tracker (FinOps)' });
  meters.push({ key: 'spend', label: 'Cloud monthly spend', used: round(s.monthlySpend), limit: null, unit: s.currency, display: `${s.currency}${round(s.monthlySpend)}`, utilizationPct: null, band: 'healthy', source: 'Cloud Control Plane' });
  for (const q of s.quotas) {
    const util = round(clamp100(q.utilizationPct));
    meters.push({ key: `quota:${q.resource}`, label: `Quota — ${q.resource}`, used: q.used, limit: q.limit, unit: q.resource, display: `${q.used.toLocaleString()} / ${q.limit.toLocaleString()}`, utilizationPct: util, band: bandFor(100 - util), source: 'Cloud Control Plane quota' });
  }
  return {
    meters,
    requests30d: s.requests30d,
    aiCostUsd: round(s.aiCostUsd),
    monthlySpend: round(s.monthlySpend),
    currency: s.currency,
    note: 'Usage metering projects the EXISTING meters — the developer gateway request meter, the AI FinOps cost tracker, and the Cloud Control Plane spend/quota. Utilization bands reflect remaining headroom; no meter is incremented here.',
  };
}

/* ── Tenant provisioning + deployment ── */

export function buildCommercialDeployment(s: CommercialState): CommercialDeployment {
  const modes: DeploymentModeRow[] = DEPLOYMENT_MODES.map((m) => ({ ...m, available: true, current: m.id === CURRENT_DEPLOYMENT_MODE }));
  const regions: DeploymentRegionRow[] = s.regions
    .map((r) => ({ id: r.id, name: r.name, residency: r.residency, available: r.available, tenants: r.tenants, deployments: r.deployments, replication: r.replication, band: (!r.available || r.replication === 'failed' ? 'critical' : r.replication === 'lagging' ? 'at-risk' : 'healthy') as CommercialBand }))
    .sort((a, b) => b.tenants - a.tenants || a.id.localeCompare(b.id));
  const activeRegions = regions.filter((r) => r.tenants > 0 || r.deployments > 0).length;
  // A region outage (critical) must never be masked by a provisioning tenant — critical wins over 'watch'.
  const band: CommercialBand = regions.some((r) => r.band === 'critical')
    ? 'at-risk'
    : s.tenantsProvisioning > 0 || regions.some((r) => r.band === 'at-risk')
      ? 'watch'
      : 'healthy';
  return {
    modes,
    currentMode: CURRENT_DEPLOYMENT_MODE,
    tenantsTotal: s.tenantsTotal,
    tenantsActive: s.tenantsActive,
    tenantsProvisioning: s.tenantsProvisioning,
    regions,
    activeRegions,
    multiRegion: s.multiRegion,
    ssoConnections: s.ssoConnections,
    ssoActive: s.ssoActive,
    scimEnabled: s.scimEnabled,
    mfaRequired: s.mfaRequired,
    band,
    note: 'Deployment projects the EXISTING Cloud Control Plane tenancy / regions / deployments / identity. The 5 deployment modes (Cloud SaaS / Private Cloud / Hybrid / On-Premises / Air-Gapped) are synthesized commercial offerings over the current multi-tenant, multi-region cloud posture; no tenant is provisioned or deprovisioned here.',
  };
}

/* ── Customer health + success + onboarding ── */

export function buildCommercialCustomers(s: CommercialState): CommercialCustomers {
  const dimensions: HealthDimensionRow[] = s.healthDimensions.map((d) => ({ key: d.key, label: d.label, score: round(clamp100(d.score)), band: bandFor(d.score) }));
  const steps: OnboardingStepRow[] = s.onboarding.steps.map((st) => ({ id: st.id, title: st.title, done: st.done }));
  const onboardingProgressPct = steps.length ? round((steps.filter((st) => st.done).length / steps.length) * 100) : 0;
  const adoptionScore = round(clamp100(s.analyticsDims.length ? s.analyticsDims.reduce((n, d) => n + d.score, 0) / s.analyticsDims.length : 0));
  const daysToRenewal = daysBetween(s.generatedAt, s.renewsAt);
  const renewalRisk: CommercialBand = s.licenseState === 'invalid' ? 'critical' : s.licenseState === 'grace' ? 'at-risk' : daysToRenewal <= 30 && s.healthOverall < 50 ? 'at-risk' : daysToRenewal <= 30 ? 'watch' : 'healthy';
  return {
    healthOverall: round(clamp100(s.healthOverall)),
    healthBand: bandFor(s.healthOverall),
    dimensions,
    onboardingFirstRun: s.onboarding.firstRun,
    onboardingCompleted: s.onboarding.completed,
    onboardingProgressPct,
    onboardingNextStep: s.onboarding.nextStep,
    onboardingSteps: steps,
    adoptionScore,
    renewsAt: s.renewsAt,
    daysToRenewal,
    renewalRisk,
    note: 'Customer success projects the EXISTING P7/org customer-health scores, the onboarding checklist, adoption analytics, and renewal timing. Renewal risk blends the license state, days-to-renewal, and health — an advisory signal only.',
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/* ── Product analytics + ROI ── */

export function buildCommercialAnalytics(s: CommercialState): CommercialAnalytics {
  const dimensions: AnalyticsDimensionRow[] = s.analyticsDims.map((d) => ({ key: d.key, label: d.label, value: d.value, display: d.display, detail: d.detail, band: bandFor(d.score) }));
  const netValueUsd = round(s.monthlySavingUsd - s.aiCostUsd - s.cloudSpendUsd);
  const cost = s.aiCostUsd + s.cloudSpendUsd;
  const roiRatio = cost > 0 ? Number((s.monthlySavingUsd / cost).toFixed(2)) : null;
  return {
    dimensions,
    monthlySavingUsd: round(s.monthlySavingUsd),
    aiCostUsd: round(s.aiCostUsd),
    cloudSpendUsd: round(s.cloudSpendUsd),
    netValueUsd,
    roiRatio,
    note: 'Product analytics projects the EXISTING adoption signals — platform usage, connector adoption, worker utilization, marketplace activity, and knowledge growth. ROI is the P14 monthly potential saving net of AI + cloud spend; every figure is an existing aggregate.',
  };
}

/* ── Release center + feature flags ── */

export function buildCommercialReleases(s: CommercialState): CommercialReleases {
  const featureFlags: FeatureFlagRow[] = s.featureFlags
    .map((f) => ({ key: f.key, enabled: f.enabled, source: f.source, description: f.description }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return {
    updatePhase: s.updatePhase,
    updateChannel: s.updateChannel,
    currentVersion: s.currentVersion,
    updateAvailable: s.updateAvailable,
    entitledPlan: s.entitledPlan,
    featureFlags,
    enabledFlags: featureFlags.filter((f) => f.enabled).length,
    totalFlags: featureFlags.length,
    note: 'Release center projects the EXISTING self-updater status and the plan-tier feature-flag entitlements (evaluated for the entitled plan). No update is downloaded or installed, and no flag override is set here.',
  };
}

/* ── Organization administration ── */

export function buildCommercialAdministration(s: CommercialState): CommercialAdministration {
  const byKind = new Map<string, number>();
  for (const d of s.departments) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);
  const roles: CommercialRoleRow[] = s.roles.map((r) => ({ name: r.name, permissionCount: r.permissionCount, builtIn: r.builtIn })).sort((a, b) => b.permissionCount - a.permissionCount || a.name.localeCompare(b.name));
  return {
    organizations: s.organizations,
    departments: s.departments.length,
    departmentsByKind: [...byKind.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    usersTotal: s.users.length,
    usersHuman: s.users.filter((u) => u.kind === 'human').length,
    usersAiWorker: s.users.filter((u) => u.kind === 'ai_worker').length,
    usersActive: s.users.filter((u) => u.status === 'active').length,
    usersInvited: s.users.filter((u) => u.status === 'invited').length,
    usersSuspended: s.users.filter((u) => u.status === 'suspended').length,
    roles,
    workspaces: s.workspaces,
    approvalChains: s.approvalChains,
    complianceRules: s.complianceRules,
    auditEntries: s.auditEntries,
    note: 'Organization administration projects the EXISTING enterprise-OS org / departments / users / RBAC roles / approval chains / compliance rules — read-only. No org, user, role, or policy is created or modified here; that flows through the existing enterprise admin under its own manage scopes.',
  };
}

/* ── Commercial security / governance posture ── */

export function buildCommercialGovernance(s: CommercialState): CommercialGovernance {
  return {
    commercialScope: 'commercial:read',
    dataProtection: 'No payment secret, card number, API token, or billing-provider id is ever projected. Billing figures are derived aggregates (plan price, metered requests, marketplace purchases); identity secrets are surfaced only as last-4 hints by the underlying stores.',
    reusedSystems: [
      { system: 'Billing / plans / seats / licenses', permission: 'developer:read' },
      { system: 'Product license (entitled plan)', permission: 'commercial:read' },
      { system: 'Tenancy / regions / deployment / identity', permission: 'cloud:read' },
      { system: 'Organization / departments / users / RBAC', permission: 'org:read' },
      { system: 'Policies / compliance / audit', permission: 'governance:read' },
      { system: 'Usage / adoption / customer health', permission: 'intelligence:read' },
    ].sort((a, b) => a.system.localeCompare(b.system)),
    auditSources: [...s.auditSources].sort(),
    redactions: [
      'No payment secret / card / token / billing-provider id is projected.',
      'Identity secrets are surfaced only as last-4 hints by the underlying stores.',
      'No mutator is imported — no plan change, seat assignment, provisioning, or checkout occurs.',
    ],
    note: 'Commercial governance reuses the existing RBAC, governance, audit, and Cloud Control Plane. All channels require commercial:read; each underlying source keeps its own production scope. The layer adds no new billing engine or governance and performs no commercial mutation.',
  };
}

/* ── Modules + summary + overview ── */

export function buildCommercialModules(s: CommercialState): CommercialModuleStatus[] {
  const sub = buildCommercialSubscription(s);
  const lic = buildCommercialLicensing(s);
  const dep = buildCommercialDeployment(s);
  const cust = buildCommercialCustomers(s);
  const an = buildCommercialAnalytics(s);
  const rel = buildCommercialReleases(s);
  const admin = buildCommercialAdministration(s);
  return [
    { id: 'subscription-management', name: 'Subscription Management', coordinates: '7-tier catalog + current plan', entityCount: sub.tiers.length, band: statusBand(s.subStatus), live: true, source: 'Ecosystem billing + license validator', note: 'Read-only; checkout stays in billing.' },
    { id: 'license-management', name: 'License Management', coordinates: 'Seats + licenses', entityCount: lic.seatsUsed + lic.licenses.length, band: lic.licenseBand, live: lic.seats.length > 0 || lic.licenses.length > 0, source: 'Ecosystem billing + org members', note: 'Seat↔member join.' },
    { id: 'billing-center', name: 'Billing Center', coordinates: 'Invoice + revenue', entityCount: s.invoice.lines.length, band: statusBand(s.subStatus), live: true, source: 'Billing summary + marketplace revenue', note: 'No card/token projected.' },
    { id: 'usage-metering', name: 'Usage Metering', coordinates: 'Requests / AI / quota / spend', entityCount: 3 + s.quotas.length, band: 'healthy', live: true, source: 'Gateway + AI FinOps + Cloud', note: 'Read-only meters.' },
    { id: 'deployment', name: 'Tenant Provisioning & Deployment', coordinates: 'Tenants / regions / modes', entityCount: dep.tenantsTotal, band: dep.band, live: dep.tenantsTotal > 0, source: 'Cloud Control Plane', note: '5 deployment modes.' },
    { id: 'customer-success', name: 'Customer Success', coordinates: 'Health / onboarding / renewal', entityCount: cust.dimensions.length, band: cust.healthBand, live: true, source: 'P7 / org health + onboarding', note: 'Renewal intelligence.' },
    { id: 'product-analytics', name: 'Product Analytics', coordinates: 'Adoption + ROI', entityCount: an.dimensions.length, band: bandFor(cust.adoptionScore), live: an.dimensions.length > 0, source: 'Platform / connector / worker / marketplace / knowledge', note: 'Existing aggregates.' },
    { id: 'release-center', name: 'Release Center & Flags', coordinates: 'Updates + feature flags', entityCount: rel.totalFlags, band: 'healthy', live: true, source: 'Self-updater + feature flags', note: 'Entitlement-gated.' },
    { id: 'organization-admin', name: 'Organization Administration', coordinates: 'Org / users / RBAC / policies', entityCount: admin.usersTotal, band: 'healthy', live: admin.usersTotal > 0, source: 'Enterprise OS', note: 'Read-only.' },
  ];
}

export function buildCommercialSummary(s: CommercialState): CommercialSummary {
  const modules = buildCommercialModules(s);
  const tier = currentTierId(s.planTier);
  const tierDef = COMMERCIAL_TIERS.find((t) => t.id === tier)!;
  const cust = buildCommercialCustomers(s);
  return {
    generatedAt: s.generatedAt,
    tier,
    tierName: tierDef.name,
    subscriptionStatus: s.subStatus,
    seatsUsed: s.seatsUsed,
    seats: s.seats,
    activeLicenses: s.billing.activeLicenses,
    estimatedMonthlyCost: round(s.billing.estimatedCost),
    currency: s.currency,
    currentDeploymentMode: CURRENT_DEPLOYMENT_MODE,
    tenants: s.tenantsTotal,
    activeRegions: s.regions.filter((r) => r.tenants > 0 || r.deployments > 0).length,
    healthOverall: round(clamp100(s.healthOverall)),
    healthBand: bandFor(s.healthOverall),
    adoptionScore: cust.adoptionScore,
    monthlySavingUsd: round(s.monthlySavingUsd),
    modules: modules.length,
    liveModules: modules.filter((m) => m.live).length,
  };
}

export function buildCommercialOverview(s: CommercialState): CommercialOverview {
  return {
    summary: buildCommercialSummary(s),
    modules: buildCommercialModules(s),
    kpis: s.kpis,
  };
}
