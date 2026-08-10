/**
 * P13C REMEDIATION — FINDING 4. Organization intelligence, per tenant.
 *
 * `collectOrgHealthInputs` resolved its organization with `defaultOrg()` and
 * counted workspaces with an unfiltered `workspaceStore.list()`. That output is
 * not internal: it feeds `orgIntelligenceSource`, a source registered on the
 * scheduled delivery engine, so it becomes a DELIVERED finding. Every tenant
 * was therefore sent an assessment of the first tenant's licence state and
 * headcount, plus a workspace count that describes how many other customers
 * share the install.
 *
 * The module is bound to a scope rather than importing the enterprise root, so
 * these tests drive the boundary the same way production does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantScope } from '@neuropause/shared';

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };

/** Two organizations, with deliberately different licence and headcount. */
const ORGS = [
  { id: 'org-a', name: 'Alpha' },
  { id: 'org-b', name: 'Northwind' },
];
const USERS: Record<string, { id: string }[]> = {
  'org-a': [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }, { id: 'u4' }, { id: 'u5' }],
  'org-b': [{ id: 'v1' }],
};
const WORKSPACES = [
  { id: 'ws-a', organizationId: 'org-a' },
  { id: 'ws-a2', organizationId: 'org-a' },
  { id: 'ws-b', organizationId: 'org-b' },
];
/** Distinct expiry per tenant, so a leak is visible as a number. */
const LICENSE_DAYS: Record<string, number> = { 'org-a': 9812, 'org-b': 4721 };

vi.mock('../enterprise/org/orgInstance', () => ({
  orgStore: {
    organization: (id: string) => ORGS.find((o) => o.id === id) ?? null,
    usersFor: (id: string) => USERS[id] ?? [],
    defaultOrg: () => ORGS[0],
  },
}));
vi.mock('../enterprise/workspace/workspaceInstance', () => ({
  workspaceStore: { list: () => WORKSPACES },
}));
vi.mock('../connectors/connectorStore', () => ({ connectorStore: { all: () => [] } }));
vi.mock('../timeline', () => ({ getEnterpriseTimeline: () => null }));
vi.mock('../license/licenseInstance', () => ({
  licenseValidator: {
    getStatus: (orgId: string) => ({
      evaluation: {
        state: 'valid',
        expiresAt: new Date(
          Date.parse('2026-01-01T00:00:00.000Z') + (LICENSE_DAYS[orgId] ?? 0) * 86_400_000,
        ).toISOString(),
      },
    }),
  },
}));

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

let collectOrgHealthInputs: (nowMs: number) => {
  memberCount: number;
  workspaceCount: number;
  licenseDaysToExpiry: number | null;
  licenseValid?: boolean;
};
let bindOrgIntelligenceScope: (fn: () => TenantScope | null) => void;

let scope: TenantScope | null = A;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../enterprise/orgIntelligence');
  collectOrgHealthInputs = mod.collectOrgHealthInputs;
  bindOrgIntelligenceScope = mod.bindOrgIntelligenceScope;
  scope = A;
  bindOrgIntelligenceScope(() => scope);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('org intelligence reports on the tenant it is running for', () => {
  it('reports A’s headcount and licence under A', () => {
    scope = A;
    const inputs = collectOrgHealthInputs(NOW);
    expect(inputs.memberCount).toBe(5);
    expect(inputs.licenseDaysToExpiry).toBe(LICENSE_DAYS['org-a']);
  });

  it('reports B’s headcount and licence under B — not A’s', () => {
    scope = B;
    const inputs = collectOrgHealthInputs(NOW);
    expect(inputs.memberCount).toBe(1);
    expect(inputs.licenseDaysToExpiry).toBe(LICENSE_DAYS['org-b']);
    expect(inputs.licenseDaysToExpiry).not.toBe(LICENSE_DAYS['org-a']);
  });

  /**
   * The install-wide count is its own disclosure, separate from the licence and
   * headcount: it tells a tenant roughly how many other customers exist on the
   * machine, inside a notification they actually receive.
   */
  it('counts only the tenant’s OWN workspaces, never the install’s', () => {
    scope = A;
    expect(collectOrgHealthInputs(NOW).workspaceCount).toBe(2);
    scope = B;
    expect(collectOrgHealthInputs(NOW).workspaceCount).toBe(1);
    // The install has three; neither tenant is told so.
    expect(WORKSPACES).toHaveLength(3);
  });
});

describe('fail-closed', () => {
  it('an unresolved tenant yields a NEUTRAL assessment, not the first tenant’s', () => {
    scope = null;
    const inputs = collectOrgHealthInputs(NOW);
    expect(inputs.memberCount).toBe(0);
    expect(inputs.workspaceCount).toBe(0);
    expect(inputs.licenseDaysToExpiry).toBeNull();
    expect(inputs.licenseDaysToExpiry).not.toBe(LICENSE_DAYS['org-a']);
  });

  it('an UNBOUND scope denies, exactly as an unbound store does', async () => {
    vi.resetModules();
    const fresh = await import('../enterprise/orgIntelligence');
    // Deliberately not bound.
    const inputs = fresh.collectOrgHealthInputs(NOW);
    expect(inputs.memberCount).toBe(0);
    expect(inputs.workspaceCount).toBe(0);
    expect(inputs.licenseDaysToExpiry).toBeNull();
  });

  it('an unknown tenant id resolves to no organization', () => {
    scope = { tenantId: 'org-ghost', workspaceId: 'ws-ghost' };
    const inputs = collectOrgHealthInputs(NOW);
    expect(inputs.memberCount).toBe(0);
    expect(inputs.licenseDaysToExpiry).toBeNull();
  });
});
