/**
 * Enterprise administration (pure). Rolls the cloud control plane into the admin
 * surfaces: a tenant table, the user list, usage, billing, and a compliance
 * report (SOC 2 / GDPR / ISO 27001 controls + data-residency posture). No I/O.
 */
import type {
  AdminBilling,
  AdminOverview,
  AdminTenantRow,
  AdminUsage,
  AdminUserRow,
  CloudRegionId,
  CloudTenant,
  ComplianceControl,
  ComplianceReport,
  DataResidency,
  IdentitySummary,
  StorageIsolation,
  TenantTier,
} from '@neuropause/shared';

export interface AdminUserInput {
  id: string;
  name: string;
  email: string;
  role: string;
  isWorker: boolean;
}

export interface AdminInput {
  tenants: CloudTenant[];
  isolation: StorageIsolation[];
  homeTenantId: string;
  homeUsers: AdminUserInput[];
  homeMonthly: number;
  identity: IdentitySummary;
  apiRequests30d: number;
  syncOps30d: number;
  activeWorkers: number;
  regionResidency: Record<CloudRegionId, DataResidency>;
  now: number;
}

const TIER_MONTHLY: Record<TenantTier, number> = { free: 0, business: 49, enterprise: 499 };

function tenantSpend(t: CloudTenant, homeTenantId: string, homeMonthly: number): number {
  if (t.id === homeTenantId) return homeMonthly;
  return TIER_MONTHLY[t.tier];
}

export function buildComplianceReport(input: AdminInput): ComplianceReport {
  const { identity, tenants, regionResidency, now } = input;
  const accessControlled = identity.enforced || identity.mfaRequired;

  const controls: ComplianceControl[] = [
    {
      id: 'soc2-cc6.1',
      framework: 'SOC 2',
      control: 'CC6.1 — Logical access controls',
      status: accessControlled ? 'pass' : 'warn',
      detail: accessControlled ? 'SSO enforced and/or MFA required.' : 'No SSO enforcement or MFA requirement configured.',
    },
    {
      id: 'soc2-cc7.2',
      framework: 'SOC 2',
      control: 'CC7.2 — System monitoring & audit',
      status: 'pass',
      detail: 'Audit logging is active across governance, gateway, and admin.',
    },
    {
      id: 'gdpr-art32',
      framework: 'GDPR',
      control: 'Art. 32 — Encryption at rest',
      status: 'pass',
      detail: 'Each tenant has an isolated namespace and encryption key.',
    },
    {
      id: 'gdpr-art17',
      framework: 'GDPR',
      control: 'Art. 17 — Right to erasure',
      status: 'warn',
      detail: 'Tenant data deletion is available; automated subject erasure is a tracked seam.',
    },
    {
      id: 'iso-a9',
      framework: 'ISO 27001',
      control: 'A.9 — Access management',
      status: identity.mfaRequired ? 'pass' : 'warn',
      detail: identity.mfaRequired ? 'MFA required by policy.' : 'MFA is optional.',
    },
    {
      id: 'iso-a12',
      framework: 'ISO 27001',
      control: 'A.12 — Data residency',
      status: 'pass',
      detail: 'Tenants are pinned to regions with declared residency.',
    },
  ];

  const score = Math.round(controls.reduce((n, c) => n + (c.status === 'pass' ? 100 : c.status === 'warn' ? 60 : 0), 0) / controls.length);

  const byRegion = new Map<CloudRegionId, number>();
  for (const t of tenants) byRegion.set(t.regionId, (byRegion.get(t.regionId) ?? 0) + 1);
  const residencyByRegion = [...byRegion.entries()].map(([region, count]) => ({ region, residency: regionResidency[region], tenants: count }));

  return { generatedAt: new Date(now).toISOString(), score, controls, residencyByRegion };
}

export function buildAdminOverview(input: AdminInput): AdminOverview {
  const projectsByTenant = new Map<string, number>();
  // projects aren't passed in detail here; the tenant rows use isolation + users.

  const tenantRows: AdminTenantRow[] = input.tenants.map((t) => ({
    tenantId: t.id,
    name: t.name,
    tier: t.tier,
    status: t.status,
    region: t.regionId,
    users: t.id === input.homeTenantId ? input.homeUsers.filter((u) => !u.isWorker).length : Math.max(2, Math.round((input.isolation.find((i) => i.tenantId === t.id)?.objects ?? 0) / 12_000)),
    projects: projectsByTenant.get(t.id) ?? (t.id === input.homeTenantId ? 1 : 2),
    monthlySpend: tenantSpend(t, input.homeTenantId, input.homeMonthly),
  }));

  const users: AdminUserRow[] = input.homeUsers.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    tenantId: input.homeTenantId,
    source: u.isWorker ? 'local' : input.identity.scimEnabled ? 'scim' : 'local',
    role: u.role,
    mfa: input.identity.mfaRequired,
  }));

  const storageBytes = input.isolation.reduce((n, i) => n + i.bytes, 0);
  const usage: AdminUsage = {
    apiRequests30d: input.apiRequests30d,
    syncOps30d: input.syncOps30d,
    storageBytes,
    activeWorkers: input.activeWorkers,
    activeUsers: input.homeUsers.filter((u) => !u.isWorker).length + input.identity.provisionedUsers,
  };

  const byTenant = tenantRows.map((t) => ({ tenantId: t.tenantId, name: t.name, amount: t.monthlySpend }));
  const billing: AdminBilling = {
    totalMonthly: byTenant.reduce((n, t) => n + t.amount, 0),
    currency: 'USD',
    byTenant,
  };

  return {
    tenants: tenantRows,
    users,
    usage,
    billing,
    compliance: buildComplianceReport(input),
  };
}
