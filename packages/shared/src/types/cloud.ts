/**
 * Cloud & Federation — Cloud Platform types (Phase 9 · Stage 1). The control
 * plane that turns NeuroPause from a local-first app into a multi-tenant cloud
 * platform: tenancy + regions + storage isolation, identity federation
 * (SAML / OIDC / SCIM / MFA), cloud synchronization of the local-first stores,
 * the API gateway as a cloud service, and enterprise administration.
 */

/* ════════════════════════════ Multi-tenant platform ═══════════════════════ */

export type CloudRegionId = 'us-east' | 'us-west' | 'eu-west' | 'eu-central' | 'ap-south' | 'ap-southeast';
export type DataResidency = 'us' | 'eu' | 'apac';

export interface CloudRegion {
  id: CloudRegionId;
  name: string;
  residency: DataResidency;
  available: boolean;
}

export type TenantTier = 'free' | 'business' | 'enterprise';
export type TenantStatus = 'active' | 'suspended' | 'provisioning';

export interface CloudTenant {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  regionId: CloudRegionId;
  tier: TenantTier;
  status: TenantStatus;
  /** The local organization's own tenant. */
  isHome: boolean;
  storageNamespace: string;
  createdAt: string;
}

export interface CloudProject {
  id: string;
  tenantId: string;
  name: string;
  key: string;
  description: string;
  createdAt: string;
}

export interface CloudTeam {
  id: string;
  tenantId: string;
  name: string;
  memberCount: number;
  createdAt: string;
}

export interface TenantWorker {
  id: string;
  tenantId: string;
  workerId: string;
  name: string;
  role: string;
}

export interface StorageIsolation {
  tenantId: string;
  tenantName: string;
  namespace: string;
  encryptionKeyId: string;
  regionId: CloudRegionId;
  residency: DataResidency;
  objects: number;
  bytes: number;
}

export interface TenantSummary {
  tenants: number;
  active: number;
  regions: number;
  projects: number;
  teams: number;
  workers: number;
}

/* ════════════════════════════ Identity federation ═════════════════════════ */

export type SsoProtocol = 'saml' | 'oidc';
export type SsoStatus = 'active' | 'disabled' | 'error';

export interface SsoConnection {
  id: string;
  tenantId: string;
  name: string;
  protocol: SsoProtocol;
  status: SsoStatus;
  issuer: string;
  entityId: string;
  ssoUrl: string;
  clientId: string;
  domains: string[];
  attributeMapping: Record<string, string>;
  enforced: boolean;
  createdAt: string;
}

export type ScimStatus = 'enabled' | 'disabled';

export interface ScimConfig {
  tenantId: string;
  status: ScimStatus;
  tokenLast4: string;
  endpoint: string;
  provisioned: number;
  lastSyncAt: string | null;
}

export type MfaMethod = 'totp' | 'webauthn' | 'sms';

export interface MfaPolicy {
  tenantId: string;
  required: boolean;
  methods: MfaMethod[];
  graceDays: number;
}

export interface FederatedIdentity {
  subject: string;
  email: string;
  displayName: string;
  connectionId: string;
  protocol: SsoProtocol;
  groups: string[];
  mfaSatisfied: boolean;
  mappedRole: string;
}

export interface FederationResult {
  ok: boolean;
  identity: FederatedIdentity | null;
  reason: string;
  mfaRequired: boolean;
}

export interface IdentitySummary {
  connections: number;
  active: number;
  enforced: boolean;
  scimEnabled: boolean;
  mfaRequired: boolean;
  provisionedUsers: number;
}

/* ═══════════════ Cloud synchronization ═══════════════
   The pre-livesync domain-simulator types (SyncDomain, SyncDomainState,
   SyncSummary, SyncConflict, SyncResult) were retired with the simulator
   (audit findings A4-2/A5-3). The real engine's status contract is
   `LiveSyncStatus` in ipc/contracts.ts. */

/* ════════════════════════════ Enterprise API platform ═════════════════════ */

export type DeploymentStatus = 'healthy' | 'degraded' | 'down';

export interface ApiDeployment {
  id: string;
  service: string;
  regionId: CloudRegionId;
  replicas: number;
  healthyReplicas: number;
  status: DeploymentStatus;
  version: string;
  uptimePct: number;
  p95LatencyMs: number;
  deployedAt: string;
}

export type RateLimitScope = 'global' | 'tenant' | 'key';

export interface CloudRateLimitPolicy {
  id: string;
  name: string;
  scope: RateLimitScope;
  windowSec: number;
  limit: number;
  burst: number;
  enabled: boolean;
}

export type WebhookStatus = 'active' | 'paused' | 'failing';

export interface WebhookEndpoint {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  status: WebhookStatus;
  secretLast4: string;
  deliveries: number;
  failures: number;
  lastDeliveryAt: string | null;
  createdAt: string;
}

export type ApiVisibility = 'public' | 'partner' | 'private';

export interface PublicApi {
  id: string;
  name: string;
  basePath: string;
  version: string;
  visibility: ApiVisibility;
  scopes: string[];
  rps: number;
}

export interface ApiPlatformSummary {
  deployments: number;
  healthy: number;
  regions: number;
  replicas: number;
  uptimePct: number;
  requests30d: number;
  webhooks: number;
  publicApis: number;
}

/* ════════════════════════════ Enterprise administration ═══════════════════ */

export interface AdminTenantRow {
  tenantId: string;
  name: string;
  tier: TenantTier;
  status: TenantStatus;
  region: CloudRegionId;
  users: number;
  projects: number;
  monthlySpend: number;
}

export type UserSource = 'local' | 'scim' | 'sso';

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  tenantId: string;
  source: UserSource;
  role: string;
  mfa: boolean;
}

export type CloudComplianceStatus = 'pass' | 'warn' | 'fail';

export interface ComplianceControl {
  id: string;
  framework: string;
  control: string;
  status: CloudComplianceStatus;
  detail: string;
}

export interface AdminUsage {
  apiRequests30d: number;
  syncOps30d: number;
  storageBytes: number;
  activeWorkers: number;
  activeUsers: number;
}

export interface AdminBilling {
  totalMonthly: number;
  currency: string;
  byTenant: { tenantId: string; name: string; amount: number }[];
}

export interface ComplianceReport {
  generatedAt: string;
  score: number;
  controls: ComplianceControl[];
  residencyByRegion: { region: CloudRegionId; residency: DataResidency; tenants: number }[];
}

export interface AdminOverview {
  tenants: AdminTenantRow[];
  users: AdminUserRow[];
  usage: AdminUsage;
  billing: AdminBilling;
  compliance: ComplianceReport;
}
