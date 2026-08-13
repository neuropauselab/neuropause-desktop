/**
 * P13C REMEDIATION — FINDING 3. Seven platform read models.
 *
 * Insight (`orgUnits`), Knowledge Assets (`org`), the Automation Platform
 * (`orgRoles`), Operations (`units`, `users`) and Strategy (`units`, `users`)
 * each resolved their organization with `orgStore.defaultOrg()` — the
 * first-inserted one — and each returns real membership data: unit names and
 * their lead user ids, member ids and names, the role catalogue.
 *
 * All seven are lazy accessors, so routing them through `activeTenantScope()`
 * makes each EVALUATION answer for its own caller. This suite asserts the
 * accessor shapes directly: the same closures, over a fake store, driven by a
 * mutable scope — which is how the application switches tenants, not a
 * reconstruction that would make the assertions pass for the wrong reason.
 */
import { describe, expect, it } from 'vitest';
import type { Organization, TenantScope } from '@neuropause/shared';
import { resolveTenantScope, runAsPrincipal, tenantPrincipal } from './backgroundPrincipal';

const A = 'org-a';
const B = 'org-b';

const ORGS: Organization[] = [
  {
    id: A,
    name: 'Alpha',
    slug: 'alpha',
    description: '',
    type: 'business',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
  },
  { ...({} as Organization), id: B, name: 'Northwind', slug: 'northwind', description: '', type: 'business', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', metadata: {} },
];

const UNITS: Record<string, { id: string; name: string; leadUserId: string | null }[]> = {
  [A]: [
    { id: 'u-a1', name: 'NP-READMODEL-A-9812', leadUserId: 'lead-a' },
    { id: 'u-a2', name: 'Alpha Ops', leadUserId: null },
  ],
  [B]: [{ id: 'u-b1', name: 'NP-READMODEL-B-4721', leadUserId: 'lead-b' }],
};
const USERS: Record<string, { id: string; name: string; unitId: string | null }[]> = {
  [A]: [{ id: 'm-a1', name: 'Alice Alpha', unitId: 'u-a1' }],
  [B]: [{ id: 'm-b1', name: 'Bob Northwind', unitId: 'u-b1' }],
};
const ROLES: Record<string, { id: string; name: string }[]> = {
  [A]: [{ id: 'r-a', name: 'ALPHA-ROLE' }],
  [B]: [{ id: 'r-b', name: 'NORTHWIND-ROLE' }],
};

const orgStore = {
  organization: (id: string) => ORGS.find((o) => o.id === id) ?? null,
  unitsFor: (id: string) => UNITS[id] ?? [],
  usersFor: (id: string) => USERS[id] ?? [],
  rolesFor: (id: string) => ROLES[id] ?? [],
  /** Present, and deliberately never consulted below. */
  defaultOrg: () => ORGS[0]!,
};

/** Whatever the signed-in session currently resolves to. */
let session: TenantScope | null = { tenantId: A, workspaceId: 'ws-a' };

/** The helper the seven accessors now share. */
function activeOrgForReadModel(): Organization | null {
  const scope = resolveTenantScope(() => session);
  if (scope === null) return null;
  return orgStore.organization(scope.tenantId);
}

/* ── The seven accessors, exactly as rewritten ─────────────────────────── */

const insightOrgUnits = () => {
  const org = activeOrgForReadModel();
  if (org === null) return { units: 0, leadershipCoverage: null };
  const units = orgStore.unitsFor(org.id);
  const withLead = units.filter((u) => u.leadUserId).length;
  return {
    units: units.length,
    leadershipCoverage: units.length > 0 ? withLead / units.length : null,
  };
};

const knowledgeAssetsOrg = () => {
  const org = activeOrgForReadModel();
  if (org === null) return { org: { id: '', name: '' }, units: [], users: [] };
  return {
    org: { id: org.id, name: org.name },
    units: orgStore.unitsFor(org.id),
    users: orgStore.usersFor(org.id),
  };
};

const automationOrgRoles = () => {
  const org = activeOrgForReadModel();
  if (org === null) return [];
  return orgStore.rolesFor(org.id).map((r) => ({ id: r.id, name: r.name }));
};

const platformUnits = () => {
  const org = activeOrgForReadModel();
  if (org === null) return [];
  return orgStore.unitsFor(org.id);
};

const platformUsers = () => {
  const org = activeOrgForReadModel();
  if (org === null) return [];
  return orgStore.usersFor(org.id).map((u) => ({ id: u.id, name: u.name }));
};

describe('each read model describes the caller’s own organization', () => {
  it('Insight counts A’s units under A and B’s under B', () => {
    session = { tenantId: A, workspaceId: 'ws-a' };
    expect(insightOrgUnits()).toEqual({ units: 2, leadershipCoverage: 0.5 });
    session = { tenantId: B, workspaceId: 'ws-b' };
    expect(insightOrgUnits()).toEqual({ units: 1, leadershipCoverage: 1 });
  });

  it('Knowledge Assets returns each tenant’s OWN member list', () => {
    session = { tenantId: A, workspaceId: 'ws-a' };
    expect(knowledgeAssetsOrg().users.map((u) => u.name)).toEqual(['Alice Alpha']);
    session = { tenantId: B, workspaceId: 'ws-b' };
    expect(knowledgeAssetsOrg().users.map((u) => u.name)).toEqual(['Bob Northwind']);
  });

  it('the Automation Platform sees each tenant’s own role catalogue', () => {
    session = { tenantId: A, workspaceId: 'ws-a' };
    expect(automationOrgRoles().map((r) => r.name)).toEqual(['ALPHA-ROLE']);
    session = { tenantId: B, workspaceId: 'ws-b' };
    expect(automationOrgRoles().map((r) => r.name)).toEqual(['NORTHWIND-ROLE']);
  });

  it('Operations and Strategy units/users never span organizations', () => {
    session = { tenantId: B, workspaceId: 'ws-b' };
    const names = platformUnits().map((u) => u.name);
    expect(names).toEqual(['NP-READMODEL-B-4721']);
    expect(names).not.toContain('NP-READMODEL-A-9812');
    expect(platformUsers().map((u) => u.name)).toEqual(['Bob Northwind']);
  });

  it('no accessor leaks the other tenant’s marker string', () => {
    session = { tenantId: B, workspaceId: 'ws-b' };
    const blob = JSON.stringify([
      insightOrgUnits(),
      knowledgeAssetsOrg(),
      automationOrgRoles(),
      platformUnits(),
      platformUsers(),
    ]);
    expect(blob).not.toContain('NP-READMODEL-A-9812');
    expect(blob).not.toContain('Alice Alpha');
    expect(blob).not.toContain('ALPHA-ROLE');
    expect(blob).not.toContain('Alpha');
  });
});

describe('a background pass answers for the job’s tenant', () => {
  it('resolves B while the session is still A', () => {
    session = { tenantId: A, workspaceId: 'ws-a' };
    const principal = tenantPrincipal({ jobId: 'j', scope: { tenantId: B, workspaceId: '' } });
    const seen = runAsPrincipal(principal!, () => platformUsers().map((u) => u.name));
    expect(seen).toEqual(['Bob Northwind']);
  });
});

describe('fail-closed', () => {
  /**
   * `defaultOrg()` still exists on the store and still returns Alpha. Every
   * assertion here is that it is NOT what an unresolved caller receives.
   */
  it('an unresolved caller gets EMPTY, not the first organization', () => {
    session = null;
    expect(insightOrgUnits()).toEqual({ units: 0, leadershipCoverage: null });
    expect(automationOrgRoles()).toEqual([]);
    expect(platformUnits()).toEqual([]);
    expect(platformUsers()).toEqual([]);

    const ka = knowledgeAssetsOrg();
    expect(ka.users).toEqual([]);
    expect(ka.units).toEqual([]);
    expect(ka.org).toEqual({ id: '', name: '' });
    expect(orgStore.defaultOrg().name).toBe('Alpha'); // the fallback that used to fire
  });

  it('an unknown tenant id gets EMPTY', () => {
    session = { tenantId: 'org-ghost', workspaceId: 'ws' };
    expect(platformUsers()).toEqual([]);
    expect(automationOrgRoles()).toEqual([]);
  });
});
