/**
 * P13C Part 3 — two organizations actually existing at once (Phases 17-27).
 *
 * Everything before this program was written against an install with ONE
 * organization, where "list the workspaces" and "list MY workspaces" return the
 * same rows and no test can tell them apart. These tests build two real
 * tenants, sign in as each, and check both what is offered and what is refused.
 *
 * The refusals matter more than the successes. A switcher that shows a
 * destination every subsequent read denies is a broken product; a switcher that
 * shows another customer's name is a disclosure.
 */
import { describe, expect, it } from 'vitest';
import type {
  EnterprisePermission,
  Organization,
  OrgRole,
  OrgUser,
  Workspace,
} from '@neuropause/shared';
import { ALL_ENTERPRISE_PERMISSIONS } from '@neuropause/shared';
import {
  firstEnterableWorkspace,
  memberIn,
  visibleOrganizations,
  visibleWorkspaces,
  type TenantDirectoryDeps,
} from '../enterprise/org/tenantDirectory';
import {
  provisionOrganization,
  ownerNameFromEmail,
  DEFAULT_FIRST_WORKSPACE_NAME,
  type ProvisionDeps,
} from '../enterprise/org/provisionOrganization';
import { createTenantContextResolver } from './tenantContext';

const NOW = '2026-08-10T12:00:00.000Z';

/* ── A tiny in-memory org world ───────────────────────────────────────── */

class World {
  organizations: Organization[] = [];
  workspaces: Workspace[] = [];
  users: OrgUser[] = [];
  roles: OrgRole[] = [];
  private seq = 0;
  private id(p: string): string {
    this.seq += 1;
    return `${p}_${this.seq}`;
  }

  provisionDeps(): ProvisionDeps {
    return {
      createOrganization: (name, description) => {
        const org: Organization = {
          id: this.id('org'),
          name,
          slug: name.toLowerCase(),
          description,
          type: 'business',
          status: 'active',
          createdAt: NOW,
          updatedAt: NOW,
          metadata: {},
        };
        this.organizations.push(org);
        return org;
      },
      createRole: (input) => {
        const role: OrgRole = {
          id: this.id('role'),
          orgId: input.orgId,
          name: input.name,
          description: input.description,
          permissions: input.permissions,
          builtIn: false,
          createdAt: NOW,
          updatedAt: NOW,
        };
        this.roles.push(role);
        return role;
      },
      createUser: (input) => {
        const user: OrgUser = {
          id: this.id('user'),
          orgId: input.orgId,
          name: input.name,
          email: input.email,
          title: input.title,
          kind: 'human',
          workerId: null,
          unitId: null,
          roleIds: input.roleIds,
          status: 'active',
          createdAt: NOW,
          updatedAt: NOW,
        };
        this.users.push(user);
        return user;
      },
      createWorkspace: (name, organizationId) => {
        const ws: Workspace = {
          id: this.id('ws'),
          name,
          organizationId,
          isolation: 'isolated',
          createdAt: NOW,
          updatedAt: NOW,
        };
        this.workspaces.push(ws);
        return ws;
      },
    };
  }

  directory(session: string | null, activeWorkspaceId: string | null): TenantDirectoryDeps {
    const activeWs = this.workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
    return {
      sessionEmail: () => session,
      organizations: () => this.organizations,
      workspaces: () => this.workspaces,
      usersFor: (orgId) => this.users.filter((u) => u.orgId === orgId),
      rolesFor: (orgId) => this.roles.filter((r) => r.orgId === orgId),
      // No SEEDED owner in this world: these tests are about provisioned
      // tenants, and an unclaimed-owner fallback would mask a membership bug.
      ownerMember: () => null,
      activeOrganizationId: () => activeWs?.organizationId ?? null,
      activeWorkspaceId: () => activeWs?.id ?? null,
      unitCountFor: () => 0,
    };
  }

  resolver(session: string | null, activeWorkspaceId: string | null) {
    return createTenantContextResolver({
      sessionEmail: () => session,
      isLoaded: () => true,
      activeWorkspaceId: () => activeWorkspaceId,
      workspace: (id) => this.workspaces.find((w) => w.id === id) ?? null,
      organization: (id) => this.organizations.find((o) => o.id === id) ?? null,
      usersFor: (orgId) => this.users.filter((u) => u.orgId === orgId),
      rolesFor: (orgId) => this.roles.filter((r) => r.orgId === orgId),
      ownerMember: () => null,
    });
  }
}

const ALICE = 'alice@a.example';
const BOB = 'bob@b.example';

/** Two fully provisioned, independent tenants. */
function twoTenants() {
  const w = new World();
  const a = provisionOrganization(w.provisionDeps(), {
    name: 'Alpha Industries',
    ownerEmail: ALICE,
  });
  const b = provisionOrganization(w.provisionDeps(), {
    name: 'Northwind Health',
    ownerEmail: BOB,
    workspaceName: 'Clinical',
  });
  return { w, a, b };
}

/* ── Phase 18: provisioning ───────────────────────────────────────────── */

describe('Phase 18 — creating an organization provisions a USABLE tenant', () => {
  it('creates org + roles + owner + membership + default workspace together', () => {
    const w = new World();
    const r = provisionOrganization(w.provisionDeps(), { name: 'Alpha', ownerEmail: ALICE });

    expect(r.organization.status).toBe('active');
    expect(r.workspace.organizationId).toBe(r.organization.id);
    expect(r.workspace.name).toBe(DEFAULT_FIRST_WORKSPACE_NAME);
    expect(r.owner.orgId).toBe(r.organization.id);
    expect(r.owner.email).toBe(ALICE);
    expect(r.roles.length).toBeGreaterThan(0);
  });

  it('gives the owner a role that actually carries every permission', () => {
    const w = new World();
    const r = provisionOrganization(w.provisionDeps(), { name: 'Alpha', ownerEmail: ALICE });
    const ownerRole = r.roles.find((role) => r.owner.roleIds.includes(role.id));
    expect(ownerRole).toBeDefined();
    for (const p of ALL_ENTERPRISE_PERMISSIONS) {
      expect(ownerRole!.permissions).toContain(p as EnterprisePermission);
    }
  });

  /**
   * `workspaceIds` ABSENT means every workspace in the tenant. An explicit list
   * would pin the owner to the first workspace and lock them out of every
   * workspace they later create — an empty or stale list DENIES, by design.
   */
  it('leaves the owner unrestricted across their own tenant’s workspaces', () => {
    const w = new World();
    const r = provisionOrganization(w.provisionDeps(), { name: 'Alpha', ownerEmail: ALICE });
    expect(r.owner.workspaceIds).toBeUndefined();
  });

  it('REFUSES to create a tenant with no owner — it would be unenterable forever', () => {
    const w = new World();
    expect(() => provisionOrganization(w.provisionDeps(), { name: 'X', ownerEmail: '  ' })).toThrow(
      /signed-in account/,
    );
    expect(w.organizations).toHaveLength(0);
  });

  it('REFUSES a blank name', () => {
    const w = new World();
    expect(() =>
      provisionOrganization(w.provisionDeps(), { name: '   ', ownerEmail: ALICE }),
    ).toThrow(/needs a name/);
  });

  it('derives a readable owner name when the session has none', () => {
    expect(ownerNameFromEmail('alice@a.example')).toBe('alice');
  });
});

/* ── Phase 19: two organizations coexist ──────────────────────────────── */

describe('Phase 19 — two organizations exist independently', () => {
  it('has different ids, workspaces, members and roles, with nothing copied', () => {
    const { a, b } = twoTenants();
    expect(a.organization.id).not.toBe(b.organization.id);
    expect(a.workspace.id).not.toBe(b.workspace.id);
    expect(a.owner.id).not.toBe(b.owner.id);
    expect(a.workspace.name).toBe(DEFAULT_FIRST_WORKSPACE_NAME);
    expect(b.workspace.name).toBe('Clinical');

    // Role ROWS are per-tenant even though the definitions are shared.
    const shared = a.roles.filter((ra) => b.roles.some((rb) => rb.id === ra.id));
    expect(shared).toEqual([]);
    expect(a.roles.every((r) => r.orgId === a.organization.id)).toBe(true);
    expect(b.roles.every((r) => r.orgId === b.organization.id)).toBe(true);
  });

  it('gives each tenant the same CAPABILITIES from one definition, not a copy', () => {
    const { a, b } = twoTenants();
    const nameOf = (roles: OrgRole[]) => roles.map((r) => r.name).sort();
    expect(nameOf(a.roles)).toEqual(nameOf(b.roles));
  });
});

/* ── Phases 22 & 25: IDOR ─────────────────────────────────────────────── */

describe('Phase 22/25 — direct object references are refused', () => {
  it('Alice cannot resolve a tenant from BOB’s workspace id', () => {
    const { w, b } = twoTenants();
    const resolver = w.resolver(ALICE, b.workspace.id); // forged active workspace
    const res = resolver.resolve();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.refusal.reason).toBe('not_a_member');
  });

  it('Alice cannot SWITCH INTO Bob’s workspace', () => {
    const { w, a, b } = twoTenants();
    const resolver = w.resolver(ALICE, a.workspace.id);
    const decision = resolver.canSwitchTo(b.workspace);
    expect(decision.ok).toBe(false);
  });

  it('Bob cannot switch into Alice’s workspace either — it is symmetric', () => {
    const { w, a, b } = twoTenants();
    const resolver = w.resolver(BOB, b.workspace.id);
    expect(resolver.canSwitchTo(a.workspace).ok).toBe(false);
  });

  it('an organization switch to a tenant you do not belong to finds NO entry', () => {
    const { w, a, b } = twoTenants();
    const dir = w.directory(ALICE, a.workspace.id);
    expect(firstEnterableWorkspace(dir, b.organization.id)).toBeNull();
  });

  it('an organization switch to an INVENTED id finds no entry', () => {
    const { w, a } = twoTenants();
    const dir = w.directory(ALICE, a.workspace.id);
    expect(firstEnterableWorkspace(dir, 'org_does_not_exist')).toBeNull();
  });

  it('each owner CAN enter their own organization — the gate is not just "no"', () => {
    const { w, a, b } = twoTenants();
    expect(firstEnterableWorkspace(w.directory(ALICE, a.workspace.id), a.organization.id)?.id).toBe(
      a.workspace.id,
    );
    expect(firstEnterableWorkspace(w.directory(BOB, b.workspace.id), b.organization.id)?.id).toBe(
      b.workspace.id,
    );
  });
});

/* ── Phase 23/24: what the switcher may show ──────────────────────────── */

describe('Phase 23/24 — the directory discloses only your own tenant', () => {
  it('the workspace list shows ONLY the caller’s organization’s workspaces', () => {
    const { w, a } = twoTenants();
    const rows = visibleWorkspaces(w.directory(ALICE, a.workspace.id));
    expect(rows.map((r) => r.id)).toEqual([a.workspace.id]);
    expect(rows[0]!.orgName).toBe('Alpha Industries');
  });

  it('never leaks the OTHER tenant’s name, id or headcount', () => {
    const { w, a, b } = twoTenants();
    const rows = visibleWorkspaces(w.directory(ALICE, a.workspace.id));
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain('Northwind');
    expect(blob).not.toContain(b.organization.id);
    expect(blob).not.toContain(b.workspace.id);
  });

  it('the organization list shows only organizations you are a member of', () => {
    const { w, a } = twoTenants();
    const orgs = visibleOrganizations(w.directory(ALICE, a.workspace.id));
    expect(orgs.map((o) => o.name)).toEqual(['Alpha Industries']);
    expect(orgs[0]!.active).toBe(true);
    expect(orgs[0]!.roles).toContain('Owner');
    expect(orgs[0]!.workspaceCount).toBe(1);
  });

  it('a SUSPENDED tenant disappears from the list rather than showing as blocked', () => {
    const { w, a, b } = twoTenants();
    // Alice joins Bob's tenant, which is then suspended.
    w.users.push({ ...b.owner, id: 'u-alice-in-b', email: ALICE });
    expect(visibleOrganizations(w.directory(ALICE, a.workspace.id))).toHaveLength(2);

    const idx = w.organizations.findIndex((o) => o.id === b.organization.id);
    w.organizations[idx] = { ...w.organizations[idx]!, status: 'suspended' };

    const after = visibleOrganizations(w.directory(ALICE, a.workspace.id));
    expect(after.map((o) => o.id)).toEqual([a.organization.id]);
    // …and it cannot be entered by id either.
    expect(firstEnterableWorkspace(w.directory(ALICE, a.workspace.id), b.organization.id)).toBeNull();
  });

  it('a SUSPENDED member sees nothing, even in their own tenant', () => {
    const { w, a } = twoTenants();
    const idx = w.users.findIndex((u) => u.id === a.owner.id);
    w.users[idx] = { ...w.users[idx]!, status: 'suspended' };
    expect(visibleOrganizations(w.directory(ALICE, a.workspace.id))).toEqual([]);
    expect(visibleWorkspaces(w.directory(ALICE, a.workspace.id))).toEqual([]);
  });

  it('a signed-OUT caller is shown nothing at all', () => {
    const { w, a } = twoTenants();
    expect(visibleOrganizations(w.directory(null, a.workspace.id))).toEqual([]);
    expect(visibleWorkspaces(w.directory(null, a.workspace.id))).toEqual([]);
  });

  it('an unknown account is shown nothing, not the default organization', () => {
    const { w, a } = twoTenants();
    const dir = w.directory('nobody@example.com', a.workspace.id);
    expect(visibleOrganizations(dir)).toEqual([]);
    expect(visibleWorkspaces(dir)).toEqual([]);
    expect(memberIn(dir, a.organization.id)).toBeNull();
  });
});

/* ── Phase 24: workspace restriction semantics, preserved ─────────────── */

describe('Phase 24 — workspaceIds semantics are preserved, not redefined', () => {
  it('ABSENT still means every workspace in the tenant', () => {
    const { w, a } = twoTenants();
    a.owner.workspaceIds = undefined;
    w.workspaces.push({ ...a.workspace, id: 'ws-second', name: 'Second' });
    expect(visibleWorkspaces(w.directory(ALICE, a.workspace.id)).map((r) => r.id).sort()).toEqual(
      [a.workspace.id, 'ws-second'].sort(),
    );
  });

  it('PRESENT restricts to exactly that list — an intra-tenant boundary', () => {
    const { w, a } = twoTenants();
    w.workspaces.push({ ...a.workspace, id: 'ws-second', name: 'Second' });
    const idx = w.users.findIndex((u) => u.id === a.owner.id);
    w.users[idx] = { ...w.users[idx]!, workspaceIds: [a.workspace.id] };

    const rows = visibleWorkspaces(w.directory(ALICE, a.workspace.id));
    expect(rows.map((r) => r.id)).toEqual([a.workspace.id]);
    // And the restricted workspace is not reachable by id.
    const resolver = w.resolver(ALICE, a.workspace.id);
    const target = w.workspaces.find((x) => x.id === 'ws-second')!;
    expect(resolver.canSwitchTo(target).ok).toBe(false);
  });

  it('an EMPTY list is not "all" — it denies', () => {
    const { w, a } = twoTenants();
    const idx = w.users.findIndex((u) => u.id === a.owner.id);
    w.users[idx] = { ...w.users[idx]!, workspaceIds: [] };
    expect(visibleWorkspaces(w.directory(ALICE, a.workspace.id))).toEqual([]);
    expect(visibleOrganizations(w.directory(ALICE, a.workspace.id))[0]?.workspaceCount).toBe(0);
  });
});

/* ── Phase 21: switching re-resolves ──────────────────────────────────── */

describe('Phase 21 — switching organization re-resolves the whole chain', () => {
  it('the resolved tenant, member, roles and permissions all change with it', () => {
    const { w, a, b } = twoTenants();
    // One person who belongs to BOTH tenants — the multi-org user of Phase 20.
    w.users.push({
      ...b.owner,
      id: 'u-alice-in-b',
      email: ALICE,
      roleIds: [b.roles.find((r) => r.name === 'Viewer')!.id],
    });

    const inA = w.resolver(ALICE, a.workspace.id).resolveFull();
    const inB = w.resolver(ALICE, b.workspace.id).resolveFull();
    expect(inA.ok && inB.ok).toBe(true);
    if (!inA.ok || !inB.ok) return;

    expect(inA.value.context.tenantId).toBe(a.organization.id);
    expect(inB.value.context.tenantId).toBe(b.organization.id);
    expect(inA.value.member.id).not.toBe(inB.value.member.id);
    expect(inA.value.context.roles).toEqual(['Owner']);
    expect(inB.value.context.roles).toEqual(['Viewer']);
    // Owner holds everything; Viewer must hold strictly less.
    expect(inB.value.context.permissions.length).toBeLessThan(
      inA.value.context.permissions.length,
    );
  });

  it('lists BOTH organizations for that person, marking the active one', () => {
    const { w, a, b } = twoTenants();
    w.users.push({ ...b.owner, id: 'u-alice-in-b', email: ALICE });

    const fromA = visibleOrganizations(w.directory(ALICE, a.workspace.id));
    expect(fromA.map((o) => o.id).sort()).toEqual([a.organization.id, b.organization.id].sort());
    expect(fromA.find((o) => o.id === a.organization.id)?.active).toBe(true);
    expect(fromA.find((o) => o.id === b.organization.id)?.active).toBe(false);

    const fromB = visibleOrganizations(w.directory(ALICE, b.workspace.id));
    expect(fromB.find((o) => o.id === b.organization.id)?.active).toBe(true);
  });
});
