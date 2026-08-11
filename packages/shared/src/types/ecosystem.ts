/**
 * Ecosystem Platform types (Phase 8). The domain for turning NeuroPause into a
 * platform: third-party developers, an API gateway, a publishing marketplace,
 * and billing/licensing. Types-only; the engines and stores live in the main
 * process under `main/ecosystem/`, and the public SDK mirrors the gateway shapes.
 */

/* ════════════════════════════ Developer Portal ════════════════════════════ */

export type PlanTier = 'free' | 'pro' | 'enterprise';
export const PLAN_TIERS: readonly PlanTier[] = ['free', 'pro', 'enterprise'] as const;

export type ApiScope =
  | 'marketplace:read'
  | 'marketplace:publish'
  | 'workers:read'
  | 'workers:manage'
  | 'connectors:read'
  | 'connectors:manage'
  | 'plugins:read'
  | 'plugins:manage'
  | 'usage:read'
  | 'billing:read'
  // P3.0 — Enterprise REST API scopes. Read/write the ERP records surface, and read the
  // cross-domain intelligence surfaces. Each maps a public route onto an existing handler;
  // the underlying Enterprise RBAC permission still applies on top of the scope check.
  | 'records:read'
  | 'records:write'
  | 'graph:read'
  | 'timeline:read'
  | 'context:read'
  | 'search:read'
  | 'automation:read'
  | 'industry:read'
  | 'observability:read';

export const ALL_API_SCOPES: readonly ApiScope[] = [
  'marketplace:read',
  'marketplace:publish',
  'workers:read',
  'workers:manage',
  'connectors:read',
  'connectors:manage',
  'plugins:read',
  'plugins:manage',
  'usage:read',
  'billing:read',
  'records:read',
  'records:write',
  'graph:read',
  'timeline:read',
  'context:read',
  'search:read',
  'automation:read',
  'industry:read',
  'observability:read',
];

export type DeveloperStatus = 'active' | 'suspended';

export interface DeveloperAccount {
  id: string;
  name: string;
  email: string;
  organization: string;
  orgId: string;
  planTier: PlanTier;
  status: DeveloperStatus;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  developerId: string;
  /**
   * P13C ROUND 3 — H-3. The organization this record belongs to.
   *
   * Optional because rows written before this round have no owner, and an
   * unowned row is visible to NOBODY rather than being guessed into a tenant.
   */
  tenantId?: string | null;
  name: string;
  /** Public, non-secret identifying prefix, e.g. `npk_live_a1b2c3`. */
  prefix: string;
  last4: string;
  scopes: ApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** Returned only once, at creation — the full token is never persisted in clear. */
export interface ApiKeyWithSecret {
  key: ApiKey;
  secret: string;
}

export type OAuthGrantType = 'authorization_code' | 'client_credentials' | 'refresh_token';

export interface OAuthApplication {
  id: string;
  developerId: string;
  /**
   * P13C ROUND 3 — H-3. The organization this record belongs to.
   *
   * Optional because rows written before this round have no owner, and an
   * unowned row is visible to NOBODY rather than being guessed into a tenant.
   */
  tenantId?: string | null;
  name: string;
  clientId: string;
  secretLast4: string;
  redirectUris: string[];
  scopes: ApiScope[];
  grantTypes: OAuthGrantType[];
  createdAt: string;
}

export interface OAuthApplicationWithSecret {
  application: OAuthApplication;
  clientSecret: string;
}

export interface UsageRecord {
  id: string;
  developerId: string;
  /**
   * P13C ROUND 3 — H-3. The organization this record belongs to.
   *
   * Optional because rows written before this round have no owner, and an
   * unowned row is visible to NOBODY rather than being guessed into a tenant.
   */
  tenantId?: string | null;
  apiKeyId: string | null;
  at: string;
  method: string;
  path: string;
  version: string;
  status: number;
  latencyMs: number;
  computeUnits: number;
}

export interface DeveloperAnalytics {
  developerId: string;
  windowDays: number;
  totalRequests: number;
  errorRequests: number;
  errorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  computeUnits: number;
  byDay: { date: string; requests: number; errors: number }[];
  byRoute: { route: string; requests: number; errorRate: number }[];
  topStatuses: { status: number; count: number }[];
}

export type SdkLanguage = 'typescript' | 'python' | 'rest' | 'cli' | 'webhooks';

export interface SdkArtifact {
  language: SdkLanguage;
  name: string;
  packageName: string;
  version: string;
  install: string;
  docsPath: string;
  description: string;
  builds: string[];
}

/* ════════════════════════════ Marketplace ═════════════════════════════════ */

export type ListingKind =
  | 'ai_app'
  | 'ai_worker'
  | 'connector'
  | 'plugin'
  | 'automation_template'
  | 'enterprise_template';

export const LISTING_KINDS: readonly ListingKind[] = [
  'ai_app',
  'ai_worker',
  'connector',
  'plugin',
  'automation_template',
  'enterprise_template',
];

export type ListingStatus =
  | 'draft'
  | 'submitted'
  | 'scanning'
  | 'signing'
  | 'in_review'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'rolled_back';

export type ScanStatus = 'pass' | 'warn' | 'fail';
export type ScanSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface ScanFinding {
  id: string;
  rule: string;
  severity: ScanSeverity;
  message: string;
}

export interface ScanResult {
  status: ScanStatus;
  findings: ScanFinding[];
  scannedAt: string;
  scanner: string;
}

export interface PackageSignature {
  algorithm: string;
  keyId: string;
  digest: string;
  signature: string;
  signedAt: string;
}

export type ReviewDecision = 'approved' | 'rejected' | 'changes_requested';

export interface ReviewRecord {
  decision: ReviewDecision;
  reviewer: string;
  notes: string;
  decidedAt: string;
}

export interface ListingManifest {
  kind: ListingKind;
  name: string;
  version: string;
  entry: string;
  permissions: string[];
  capabilities: string[];
  dependencies: string[];
  network: string[];
  metadata: Record<string, string>;
}

export interface ListingVersion {
  id: string;
  listingId: string;
  version: string;
  status: ListingStatus;
  manifest: ListingManifest;
  changelog: string;
  scan: ScanResult | null;
  signature: PackageSignature | null;
  review: ReviewRecord | null;
  createdAt: string;
  publishedAt: string | null;
}

export type PricingModel = 'free' | 'one_time' | 'subscription';

export interface ListingPricing {
  model: PricingModel;
  amount: number;
  currency: string;
}

export interface MarketplaceListing {
  id: string;
  kind: ListingKind;
  slug: string;
  name: string;
  summary: string;
  developerId: string;
  category: string;
  pricing: ListingPricing;
  status: ListingStatus;
  currentVersionId: string | null;
  latestVersionId: string | null;
  installs: number;
  ratingAvg: number;
  ratingCount: number;
  certified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListingDetail {
  listing: MarketplaceListing;
  versions: ListingVersion[];
}

export interface SubmissionEvent {
  id: string;
  listingId: string;
  versionId: string;
  at: string;
  action: string;
  actor: string;
  detail: string;
}

export interface MarketplaceStats {
  totalListings: number;
  published: number;
  inReview: number;
  draft: number;
  byKind: Record<string, number>;
  totalInstalls: number;
  pendingReview: number;
}

/* ════════════════════════════ API Gateway ═════════════════════════════════ */

export type ApiVersion = 'v1' | 'v2';

export interface ApiVersionInfo {
  version: ApiVersion;
  status: 'current' | 'beta' | 'deprecated' | 'sunset';
  since: string;
  sunsetAt: string | null;
  notes: string;
}

export interface RateLimitPolicy {
  windowMs: number;
  max: number;
}

export interface QuotaPolicy {
  period: 'day' | 'month';
  limit: number;
}

export interface GatewayRequestInput {
  apiKey: string | null;
  method: string;
  path: string;
  version: ApiVersion;
  /** The scope the target route requires, if any. */
  scope: ApiScope | null;
}

export interface GatewayDecision {
  allowed: boolean;
  status: number;
  reason: string;
  developerId: string | null;
  keyId: string | null;
  rateRemaining: number;
  rateLimit: number;
  quotaRemaining: number;
  quotaLimit: number;
  retryAfterMs: number | null;
  version: ApiVersion;
}

export interface GatewayAuditEntry {
  id: string;
  at: string;
  /**
   * P13C ROUND 3 — H-3. The organization this record belongs to.
   *
   * Optional because rows written before this round have no owner, and an
   * unowned row is visible to NOBODY rather than being guessed into a tenant.
   */
  tenantId?: string | null;
  keyId: string | null;
  developerId: string | null;
  method: string;
  path: string;
  version: string;
  status: number;
  reason: string;
  latencyMs: number;
}

export interface GatewayMetrics {
  windowDays: number;
  requests: number;
  allowed: number;
  denied: number;
  rateLimited: number;
  unauthorized: number;
  byStatus: Record<string, number>;
  byVersion: Record<string, number>;
  p95LatencyMs: number;
}

/* ════════════════════════════ Billing & Licensing ═════════════════════════ */

export interface PlanFeature {
  label: string;
  included: boolean;
}

export interface Plan {
  tier: PlanTier;
  name: string;
  priceMonthly: number;
  currency: string;
  includedRequests: number;
  overagePer1k: number;
  rateLimit: RateLimitPolicy;
  quota: QuotaPolicy;
  /** Included seats; -1 means unlimited. */
  seats: number;
  marketplaceFeePct: number;
  features: PlanFeature[];
}

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface Subscription {
  id: string;
  orgId: string;
  planTier: PlanTier;
  seats: number;
  seatsUsed: number;
  status: SubscriptionStatus;
  startedAt: string;
  renewsAt: string;
}

export interface SeatAssignment {
  id: string;
  /**
   * P13C ROUND 3 — H-3. The organization this record belongs to.
   *
   * Optional because rows written before this round have no owner, and an
   * unowned row is visible to NOBODY rather than being guessed into a tenant.
   */
  tenantId?: string | null;
  userId: string;
  userName: string;
  assignedAt: string;
}

export type LicenseKind = 'organization' | 'seat';
export type LicenseStatus = 'active' | 'expired' | 'revoked';

export interface License {
  id: string;
  orgId: string;
  listingId: string;
  listingName: string;
  kind: LicenseKind;
  seats: number;
  status: LicenseStatus;
  issuedAt: string;
  expiresAt: string | null;
}

export interface MarketplacePurchase {
  id: string;
  orgId: string;
  listingId: string;
  listingName: string;
  versionId: string | null;
  model: PricingModel;
  amount: number;
  currency: string;
  feeAmount: number;
  purchasedAt: string;
}

export interface InvoiceLine {
  kind: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface Invoice {
  id: string;
  orgId: string;
  period: string;
  planTier: PlanTier;
  lines: InvoiceLine[];
  subtotal: number;
  total: number;
  currency: string;
  status: 'draft' | 'issued' | 'paid';
  issuedAt: string;
}

export interface BillingSummary {
  subscription: Subscription;
  plan: Plan;
  periodRequests: number;
  includedRequests: number;
  overageRequests: number;
  estimatedCost: number;
  currency: string;
  seatsUsed: number;
  seats: number;
  activeLicenses: number;
  marketplaceSpend: number;
}

/* ════════════════════════════ Portal rollup ═══════════════════════════════ */

export interface DeveloperDashboard {
  developer: DeveloperAccount;
  apiKeyCount: number;
  oauthAppCount: number;
  listingCount: number;
  publishedCount: number;
  pendingReviewCount: number;
  requests30d: number;
  errorRate30d: number;
  plan: Plan;
  marketplaceStats: MarketplaceStats;
}
