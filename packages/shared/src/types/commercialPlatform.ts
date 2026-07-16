/**
 * P20 — NeuroPause Platform v2 (Commercial Productization): the view-model types for the commercial LAYER.
 *
 * A READ-ONLY commercial projection that unifies the EXISTING commercial substrate — billing/plans/seats/
 * licenses (ecosystem billing + license validator), cloud tenancy/regions/deployments/identity (Cloud
 * Control Plane), enterprise-OS org/departments/users/RBAC/policies, usage/adoption analytics
 * (control-plane/connector/workforce/marketplace/knowledge/AI), customer health (P7/org/CRM), releases +
 * feature flags + onboarding, and P14 ROI signals — into customer-facing commercial views. It introduces NO
 * new billing engine, marketplace, runtime, or store; it PROJECTS what exists, and synthesizes the
 * commercial packaging that does not yet exist (the 7-tier catalog, the deployment-mode catalog) as pure
 * read-only projections. No payment secret, card, token, or provider id is ever projected.
 */
import type { ExecutiveKpi } from './executiveCenter';

export type CommercialBand = 'healthy' | 'watch' | 'at-risk' | 'critical';

/* ── Commercial tier catalog (7 tiers — synthesized packaging over the 3 underlying plan tiers) ── */

export type CommercialTierId = 'free' | 'professional' | 'business' | 'enterprise' | 'government' | 'education' | 'oem';
export type CommercialSegment = 'self_serve' | 'sales_assisted' | 'special';
export type PriceModel = 'free' | 'per_seat' | 'annual_contract' | 'custom';

export interface CommercialTier {
  id: CommercialTierId;
  name: string;
  segment: CommercialSegment;
  /** The underlying production plan tier this commercial tier maps to (free | pro | enterprise). */
  basePlanTier: string;
  priceModel: PriceModel;
  priceHint: string;
  seatModel: string;
  entitlements: string[];
  targetSegment: string;
  /** True when this is the org's current commercial tier. */
  current: boolean;
  available: boolean;
}

/* ── Subscription management ── */

export interface CommercialSubscription {
  tier: CommercialTierId;
  tierName: string;
  planTier: string;
  status: string;
  seats: number;
  seatsUsed: number;
  startedAt: string;
  renewsAt: string;
  trialEndsAt: string | null;
  /** From the license validator — the entitled plan + license lifecycle state. */
  entitledPlan: string;
  licenseState: string;
  graceDaysRemaining: number;
  tiers: CommercialTier[];
  note: string;
}

/* ── License management ── */

export interface SeatRow {
  seatId: string;
  userId: string;
  userName: string;
  assignedAt: string;
  /** Whether the seat's userId resolves to a live org member. */
  bound: boolean;
}

export interface CommercialLicenseRow {
  id: string;
  listingName: string;
  kind: string;
  seats: number;
  status: string;
  band: CommercialBand;
  issuedAt: string;
  expiresAt: string | null;
}

export interface CommercialLicensing {
  seatsTotal: number;
  seatsUsed: number;
  seatsAvailable: number;
  seatUtilizationPct: number;
  seats: SeatRow[];
  licenses: CommercialLicenseRow[];
  activeLicenses: number;
  entitledPlan: string;
  licenseState: string;
  licenseBand: CommercialBand;
  graceDaysRemaining: number;
  note: string;
}

/* ── Billing center + revenue ── */

export interface InvoiceLineRow {
  kind: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface CommercialBilling {
  planTier: string;
  planName: string;
  priceMonthly: number;
  currency: string;
  periodRequests: number;
  includedRequests: number;
  overageRequests: number;
  estimatedCost: number;
  seatsUsed: number;
  seats: number;
  activeLicenses: number;
  marketplaceSpend: number;
  invoicePeriod: string;
  invoiceSubtotal: number;
  invoiceTotal: number;
  invoiceStatus: string;
  invoiceLines: InvoiceLineRow[];
  /** Marketplace revenue (gross / platform fees / net) — derived, never a persisted ledger. */
  revenueGross: number;
  revenuePlatformFees: number;
  revenueNet: number;
  note: string;
}

/* ── Usage metering ── */

export interface MeterRow {
  key: string;
  label: string;
  used: number;
  limit: number | null;
  unit: string;
  display: string;
  utilizationPct: number | null;
  band: CommercialBand;
  source: string;
}

export interface CommercialMetering {
  meters: MeterRow[];
  requests30d: number;
  aiCostUsd: number;
  monthlySpend: number;
  currency: string;
  note: string;
}

/* ── Tenant provisioning + deployment ── */

export type DeploymentModeId = 'cloud_saas' | 'private_cloud' | 'hybrid' | 'on_premises' | 'air_gapped';

export interface DeploymentModeRow {
  id: DeploymentModeId;
  name: string;
  description: string;
  isolation: string;
  residencySupport: string;
  connectivity: string;
  available: boolean;
  current: boolean;
}

export interface DeploymentRegionRow {
  id: string;
  name: string;
  residency: string;
  available: boolean;
  tenants: number;
  deployments: number;
  replication: string;
  band: CommercialBand;
}

export interface CommercialDeployment {
  modes: DeploymentModeRow[];
  currentMode: DeploymentModeId;
  tenantsTotal: number;
  tenantsActive: number;
  tenantsProvisioning: number;
  regions: DeploymentRegionRow[];
  activeRegions: number;
  multiRegion: boolean;
  ssoConnections: number;
  ssoActive: number;
  scimEnabled: boolean;
  mfaRequired: boolean;
  band: CommercialBand;
  note: string;
}

/* ── Customer health + success + onboarding ── */

export interface HealthDimensionRow {
  key: string;
  label: string;
  score: number;
  band: CommercialBand;
}

export interface OnboardingStepRow {
  id: string;
  title: string;
  done: boolean;
}

export interface CommercialCustomers {
  healthOverall: number;
  healthBand: CommercialBand;
  dimensions: HealthDimensionRow[];
  onboardingFirstRun: boolean;
  onboardingCompleted: boolean;
  onboardingProgressPct: number;
  onboardingNextStep: string | null;
  onboardingSteps: OnboardingStepRow[];
  adoptionScore: number;
  renewsAt: string;
  daysToRenewal: number;
  renewalRisk: CommercialBand;
  note: string;
}

/* ── Product analytics + ROI ── */

export interface AnalyticsDimensionRow {
  key: string;
  label: string;
  value: number;
  display: string;
  detail: string;
  band: CommercialBand;
}

export interface CommercialAnalytics {
  dimensions: AnalyticsDimensionRow[];
  monthlySavingUsd: number;
  aiCostUsd: number;
  cloudSpendUsd: number;
  netValueUsd: number;
  roiRatio: number | null;
  note: string;
}

/* ── Release center + feature flags ── */

export interface FeatureFlagRow {
  key: string;
  enabled: boolean;
  source: string;
  description: string;
}

export interface CommercialReleases {
  updatePhase: string;
  updateChannel: string;
  currentVersion: string;
  updateAvailable: string | null;
  entitledPlan: string;
  featureFlags: FeatureFlagRow[];
  enabledFlags: number;
  totalFlags: number;
  note: string;
}

/* ── Organization administration ── */

export interface CommercialRoleRow {
  name: string;
  permissionCount: number;
  builtIn: boolean;
}

export interface CommercialAdministration {
  organizations: number;
  departments: number;
  departmentsByKind: { kind: string; count: number }[];
  usersTotal: number;
  usersHuman: number;
  usersAiWorker: number;
  usersActive: number;
  usersInvited: number;
  usersSuspended: number;
  roles: CommercialRoleRow[];
  workspaces: number;
  approvalChains: number;
  complianceRules: number;
  auditEntries: number;
  note: string;
}

/* ── Commercial security / governance posture ── */

export interface CommercialScopeRow {
  system: string;
  permission: string;
}

export interface CommercialGovernance {
  commercialScope: string;
  dataProtection: string;
  reusedSystems: CommercialScopeRow[];
  auditSources: string[];
  redactions: string[];
  note: string;
}

/* ── Modules + summary + overview ── */

export interface CommercialModuleStatus {
  id: string;
  name: string;
  coordinates: string;
  entityCount: number;
  band: CommercialBand;
  live: boolean;
  source: string;
  note: string;
}

export interface CommercialSummary {
  generatedAt: string;
  tier: CommercialTierId;
  tierName: string;
  subscriptionStatus: string;
  seatsUsed: number;
  seats: number;
  activeLicenses: number;
  estimatedMonthlyCost: number;
  currency: string;
  currentDeploymentMode: DeploymentModeId;
  tenants: number;
  activeRegions: number;
  healthOverall: number;
  healthBand: CommercialBand;
  adoptionScore: number;
  monthlySavingUsd: number;
  modules: number;
  liveModules: number;
}

export interface CommercialOverview {
  summary: CommercialSummary;
  modules: CommercialModuleStatus[];
  kpis: ExecutiveKpi[];
}
