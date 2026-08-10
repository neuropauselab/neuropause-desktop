/**
 * The cross-tenant attack matrix.
 *
 * Two tenants, real stores, real temp files, real handlers. Every test in this
 * file is an ATTEMPT that must be REFUSED, and each one names the concrete
 * exposure it closes rather than restating the invariant.
 *
 * THE SETUP IS THE POINT. Tenant A and Tenant B share one `EnterpriseRecordStore`
 * instance backed by one file on disk — because that is exactly what the product
 * does: 106 stores, one JSON file per module, one install. If isolation only
 * worked when the tenants had separate files it would not be isolation, it would
 * be separate installs.
 *
 * `scope` is a mutable variable the store reads through its binding, so
 * "switching tenant" in these tests is the same operation the app performs, not
 * a re-construction that would quietly discard the other tenant's rows and make
 * every assertion pass for the wrong reason.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EnterpriseModuleDescriptor,
  Organization,
  OrgRole,
  OrgUser,
  TenantScope,
  Workspace,
} from '@neuropause/shared';
import { recordInScope, tenantKey } from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  setAmbientTenantScopeForTests,
} from '../enterprise/framework/enterpriseRecordStore';
import { TEST_TENANT_SCOPE } from './testScope';
import { EnterpriseModuleRegistry } from '../enterprise/framework/moduleRegistry';
import { defineEnterpriseModule } from '../enterprise/framework/enterpriseModule';
import { createTenantContextResolver } from './tenantContext';
import { buildMigrationInventory } from './migrationInventory';

const NOW = '2026-08-10T12:00:00.000Z';

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };

const CUSTOMERS: EnterpriseModuleDescriptor = {
  id: 'crm-customers',
  title: 'Customers',
  singular: 'Customer',
  plural: 'Customers',
  icon: 'user',
  description: 'test',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'secret', label: 'Secret', type: 'text' },
  ],
};

/* ── The data boundary ─────────────────────────────────────────────────── */

describe('cross-tenant record access', () => {
  let dir: string;
  let store: EnterpriseRecordStore;
  /** The active scope. Mutating this IS the tenant switch. */
  let scope: TenantScope | null;
  let aRecordId: string;
  let bRecordId: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-xtenant-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    // ONE store, ONE file, TWO tenants. See the file header.
    store = new EnterpriseRecordStore(join(dir, 'customers.json'), CUSTOMERS.id, CUSTOMERS.id);
    store.bindScope(() => scope);
    await store.load();

    scope = A;
    aRecordId = store.create({
      title: 'Northwind (A)',
      fields: { name: 'Northwind (A)', secret: 'Tenant A confidential fact 8472.' },
      actor: 'a@example.com',
      now: NOW,
    }).id;

    scope = B;
    bRecordId = store.create({
      title: 'Borealis (B)',
      fields: { name: 'Borealis (B)', secret: 'Tenant B confidential fact 1193.' },
      actor: 'b@example.com',
      now: NOW,
    }).id;

    await store.flush();
  });

  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });

  it('READ: tenant A cannot list tenant B records', () => {
    scope = A;
    const rows = store.list({ limit: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(aRecordId);
    expect(JSON.stringify(rows)).not.toContain('1193');
  });

  it('IDOR: tenant A cannot read tenant B by direct record id', () => {
    scope = A;
    /**
     * The id is real, it exists in the same file, and A holds every permission.
     * The only thing standing between A and B's row is the scope predicate.
     */
    expect(store.get(bRecordId)).toBeNull();
    scope = B;
    expect(store.get(bRecordId)?.id).toBe(bRecordId);
  });

  it('IDOR: a miss and a foreign record are indistinguishable', () => {
    scope = A;
    // Same `null`, so an id-addressed read cannot be used as an existence oracle.
    expect(store.get(bRecordId)).toBeNull();
    expect(store.get('rec_does_not_exist')).toBeNull();
  });

  it('WRITE: tenant A cannot patch a tenant B record', () => {
    scope = A;
    expect(store.update(bRecordId, { fields: { name: 'Owned' }, now: NOW })).toBeNull();
    scope = B;
    // Untouched, and the revision did not move — so nothing was written and
    // silently rolled back either.
    const after = store.get(bRecordId)!;
    expect(after.fields.name).toBe('Borealis (B)');
    expect(after.rev).toBe(1);
  });

  it('DELETE: tenant A cannot delete a tenant B record', () => {
    scope = A;
    expect(store.softDelete(bRecordId, { actor: 'a@example.com', now: NOW })).toBeNull();
    scope = B;
    expect(store.get(bRecordId)?.status).toBe('active');
  });

  it('SEARCH: tenant A searching for tenant B content finds nothing', () => {
    scope = A;
    // `matchesRecordSearch` scans every field value, so without the scope filter
    // this is the shortest path to another tenant's data in the whole app.
    expect(store.search('Borealis', 50)).toHaveLength(0);
    expect(store.search('1193', 50)).toHaveLength(0);
    expect(store.search('Northwind', 50)).toHaveLength(1);
  });

  it('COUNT: a count does not reveal the other tenant', () => {
    /**
     * Counts leaked three ways before this: every tenant's export README printed
     * "N of M in the module", the module summary showed an install-wide total,
     * and one consumer used the count as a cache-invalidation signature — which
     * made it a live oracle for another tenant's writes.
     */
    scope = A;
    expect(store.count()).toBe(1);
    scope = B;
    expect(store.count()).toBe(1);
  });

  it('COLD START: no scope means no data, not all data', () => {
    /**
     * The failure this encodes is `if (scope) filter(...)` — which reads as
     * defensive and degrades to "unfiltered" precisely when the scope is
     * missing. Program 10's review found the same shape in a permission check.
     */
    scope = null;
    expect(store.list({ limit: 100 })).toEqual([]);
    expect(store.get(aRecordId)).toBeNull();
    expect(store.get(bRecordId)).toBeNull();
    expect(store.count()).toBe(0);
    expect(store.search('Northwind', 50)).toEqual([]);
  });

  it('COLD START: a write with no owner is refused out loud', () => {
    scope = null;
    // A read denies quietly; a write must not, because a record written with no
    // owner is exactly the unresolved row this program exists to eliminate.
    expect(() => store.create({ title: 'Orphan', fields: { name: 'Orphan' }, now: NOW })).toThrow(
      /no organization and workspace are active/i,
    );
  });

  it('an UNBOUND store denies rather than serving everything', async () => {
    /**
     * The ambient test fallback has to be cleared for this to mean anything.
     *
     * Left in place, an "unbound" store falls back to the suite-wide test scope
     * and returns nothing only because that scope matches neither tenant — the
     * assertion would pass while verifying the wrong mechanism. Which is the
     * class of defect this whole file exists to catch, so it gets caught here
     * too.
     */
    setAmbientTenantScopeForTests(null);
    try {
      const unbound = new EnterpriseRecordStore(
        join(dir, 'customers.json'),
        CUSTOMERS.id,
        CUSTOMERS.id,
      );
      await unbound.load();
      /**
       * `bindScope` is a method, not a constructor argument, so an unbound store
       * is constructible. This is the property that makes that acceptable: it
       * holds both records on disk and hands back none of them.
       */
      expect(unbound.list({ limit: 100 })).toEqual([]);
      expect(unbound.get(aRecordId)).toBeNull();
      expect(unbound.count()).toBe(0);
      expect(unbound.hasScope()).toBe(false);
    } finally {
      setAmbientTenantScopeForTests(() => TEST_TENANT_SCOPE);
    }
  });

  it('the ambient test seam refuses to be set outside a test runner', () => {
    /**
     * The ambient fallback is the one global in this design, so its guard is
     * load-bearing: without it, this is a boundary with a documented bypass that
     * some future production code path calls.
     */
    const saved = process.env.VITEST;
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => setAmbientTenantScopeForTests(() => A)).toThrow(/test-only seam/i);
    } finally {
      if (saved !== undefined) process.env.VITEST = saved;
      // `process.env.X = undefined` stores the STRING 'undefined', which every
      // later test in this worker would then read. Delete it instead.
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
    }
  });

  it('SWITCH: nothing from the previous tenant survives the switch', () => {
    scope = A;
    expect(store.list({ limit: 100 })).toHaveLength(1);
    scope = B;
    const rows = store.list({ limit: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(bRecordId);
    // The store reads the scope on every call rather than caching it, so a
    // switch cannot leave a stale view behind.
    expect(JSON.stringify(rows)).not.toContain('8472');
  });

  it('a record written in one workspace is not visible in another workspace of the SAME tenant', () => {
    scope = { tenantId: 'org-a', workspaceId: 'ws-a2' };
    expect(store.get(aRecordId)).toBeNull();
    expect(store.list({ limit: 100 })).toEqual([]);
  });

  it('LEGACY: a record with no owner is visible to nobody', async () => {
    /**
     * The pre-P11 shape, written directly to the file the way an existing
     * install has it: no `tenantId`, no `workspaceId`.
     *
     * The temptation is to treat it as the current tenant's. That guess would be
     * silent, permanent, and afterwards indistinguishable from a correct answer —
     * and on a two-tenant install it hands one tenant the other's history.
     */
    const path = join(dir, 'legacy.json');
    await fs.writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        moduleId: CUSTOMERS.id,
        records: [
          {
            id: 'rec_legacy',
            moduleId: CUSTOMERS.id,
            kind: CUSTOMERS.id,
            title: 'Pre-P11 Customer',
            status: 'active',
            fields: { name: 'Pre-P11 Customer' },
            tags: [],
            rev: 1,
            createdAt: NOW,
            updatedAt: NOW,
            createdBy: null,
            updatedBy: null,
            metadata: {},
          },
        ],
      }),
    );
    const legacy = new EnterpriseRecordStore(path, CUSTOMERS.id, CUSTOMERS.id);
    legacy.bindScope(() => scope);
    await legacy.load();

    scope = A;
    expect(legacy.list({ limit: 100 })).toEqual([]);
    expect(legacy.get('rec_legacy')).toBeNull();
    scope = B;
    expect(legacy.list({ limit: 100 })).toEqual([]);

    // …but it is COUNTED, so an operator can see it exists.
    const counts = legacy.ownershipCounts();
    expect(counts).toEqual({ total: 1, assigned: 0, unresolved: 1 });

    // And claiming is EXPLICIT, never a side effect of looking.
    scope = A;
    expect(legacy.claimUnresolved(A, { actor: 'a@example.com', now: NOW })).toBe(1);
    expect(legacy.get('rec_legacy')?.title).toBe('Pre-P11 Customer');
    scope = B;
    expect(legacy.get('rec_legacy')).toBeNull();
    // Claiming twice claims nothing — an already-owned record is never re-owned.
    expect(legacy.claimUnresolved(B, { now: NOW })).toBe(0);
    await legacy.flush();
  });
});

/* ── The registry binds every module ──────────────────────────────────── */

describe('module registry scope binding', () => {
  const moduleFor = (path: string): ReturnType<typeof defineEnterpriseModule> =>
    defineEnterpriseModule({
      descriptor: CUSTOMERS,
      store: new EnterpriseRecordStore(path, CUSTOMERS.id, CUSTOMERS.id),
    });

  it('binds a module registered AFTER the scope is bound', async () => {
    const dir = join(tmpdir(), `np-reg-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const registry = new EnterpriseModuleRegistry();
    registry.bindScope(() => A);
    registry.register(moduleFor(join(dir, 'a.json')));
    expect(registry.unscopedModules()).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('binds a module registered BEFORE the scope is bound', async () => {
    /**
     * Ordering has to be forgiving in the SAFE direction. Registering first and
     * binding second must still close the boundary — otherwise a composition-order
     * change leaves a store permanently global, which is the failure mode that is
     * hardest to notice.
     */
    const dir = join(tmpdir(), `np-reg2-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const registry = new EnterpriseModuleRegistry();
    const mod = moduleFor(join(dir, 'b.json'));
    registry.register(mod);
    expect(registry.unscopedModules()).toEqual([CUSTOMERS.id]);
    registry.bindScope(() => A);
    expect(registry.unscopedModules()).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });
});

/* ── The resolver ─────────────────────────────────────────────────────── */

describe('tenant context resolution', () => {
  const ORG_A: Organization = {
    id: 'org-a',
    name: 'Tenant A',
    slug: 'a',
    description: '',
    type: 'business',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    metadata: {},
  };
  const ORG_B: Organization = { ...ORG_A, id: 'org-b', name: 'Tenant B', slug: 'b' };
  const WS_A: Workspace = {
    id: 'ws-a',
    name: 'A',
    organizationId: 'org-a',
    isolation: 'isolated',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const WS_B: Workspace = { ...WS_A, id: 'ws-b', name: 'B', organizationId: 'org-b' };

  const ROLE_A: OrgRole = {
    id: 'role-a',
    orgId: 'org-a',
    name: 'Manager',
    description: '',
    permissions: ['crm:read', 'crm:manage'],
    builtIn: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const MEMBER_A: OrgUser = {
    id: 'user-a',
    orgId: 'org-a',
    name: 'Ada',
    email: 'a@example.com',
    title: 'Ops',
    kind: 'human',
    workerId: null,
    unitId: null,
    roleIds: ['role-a'],
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  };

  let email: string | null;
  let loaded: boolean;
  let activeWs: string | null;
  // Rebuilt per test. Shared `const` maps leaked a suspended org from one case
  // into the next and made five later assertions fail for the wrong reason —
  // which is the shape of an unfalsifiable test, caught by being falsified.
  let orgs: Map<string, Organization>;
  let workspaces: Map<string, Workspace>;
  let members: OrgUser[];

  const make = (): ReturnType<typeof createTenantContextResolver> =>
    createTenantContextResolver({
      sessionEmail: () => email,
      isLoaded: () => loaded,
      activeWorkspaceId: () => activeWs,
      workspace: (id) => workspaces.get(id) ?? null,
      organization: (id) => orgs.get(id) ?? null,
      usersFor: (orgId) => members.filter((m) => m.orgId === orgId),
      rolesFor: (orgId) => (orgId === 'org-a' ? [ROLE_A] : []),
      // Claimed owner in a third org: never a fallback for A or B.
      ownerMember: () => ({ ...MEMBER_A, id: 'owner', orgId: 'org-z', email: 'owner@example.com' }),
    });

  beforeEach(() => {
    email = 'a@example.com';
    loaded = true;
    activeWs = 'ws-a';
    members = [MEMBER_A];
    orgs = new Map([
      [ORG_A.id, ORG_A],
      [ORG_B.id, ORG_B],
    ]);
    workspaces = new Map([
      [WS_A.id, WS_A],
      [WS_B.id, WS_B],
    ]);
  });

  it('resolves the tenant from the workspace, and the role from the member', () => {
    const res = make().resolve();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.context.tenantId).toBe('org-a');
    expect(res.context.workspaceId).toBe('ws-a');
    expect(res.context.permissions).toEqual(expect.arrayContaining(['crm:manage']));
    expect(res.context.actorType).toBe('human');
    // A request id, so an audit line can be joined to the request that made it.
    expect(res.context.requestId).toMatch(/^req_/);
  });

  it('refuses before the stores are read — the cold-start case', () => {
    loaded = false;
    const res = make().resolve();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.reason).toBe('not_loaded');
  });

  it('refuses when the account is not a member of the workspace’s tenant', () => {
    /**
     * The core cross-tenant denial. A's account, B's workspace active. Before
     * P11 this resolved: `activeOrg()` ended in `?? orgStore.defaultOrg()`, so
     * any organization id at all produced a real org.
     */
    activeWs = 'ws-b';
    const res = make().resolve();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.reason).toBe('not_a_member');
    // The message does not name the other organization — a denial that named it
    // would be a disclosure.
    expect(res.refusal.message).not.toContain('Tenant B');
    expect(res.refusal.message).not.toContain('org-b');
  });

  it('refuses a workspace pointing at an organization that does not exist', () => {
    workspaces.set('ws-orphan', { ...WS_A, id: 'ws-orphan', organizationId: 'org-vanished' });
    activeWs = 'ws-orphan';
    const res = make().resolve();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // NOT silently the default organization. That fallback is the reason
    // `Workspace.organizationId` could never deny anything.
    expect(res.refusal.reason).toBe('workspace_orphaned');
  });

  it('refuses a suspended tenant', () => {
    orgs.set('org-a', { ...ORG_A, status: 'suspended' });
    const res = make().resolve();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.reason).toBe('tenant_not_operable');
  });

  it('refuses a member restricted to another workspace of the same tenant', () => {
    workspaces.set('ws-a2', { ...WS_A, id: 'ws-a2', name: 'A2' });
    members = [{ ...MEMBER_A, workspaceIds: ['ws-a2'] }];
    activeWs = 'ws-a';
    const res = make().resolve();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.reason).toBe('not_in_workspace');
  });

  it('an ABSENT workspace list still means every workspace — the upgrade is not a lockout', () => {
    // Every existing member row has no `workspaceIds`. If absent meant "none",
    // upgrading would lock every current user out of their own data.
    workspaces.set('ws-a2', { ...WS_A, id: 'ws-a2' });
    activeWs = 'ws-a2';
    expect(make().resolve().ok).toBe(true);
  });

  it('refuses a suspended member', () => {
    members = [{ ...MEMBER_A, status: 'suspended' }];
    const res = make().resolve();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.reason).toBe('member_inactive');
  });

  it('SWITCH: refuses a switch into a tenant the account is not a member of', () => {
    const decision = make().canSwitchTo(WS_B);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.refusal.reason).toBe('not_a_member');
  });

  it('SWITCH: allows a switch inside the account’s own tenant', () => {
    workspaces.set('ws-a2', { ...WS_A, id: 'ws-a2' });
    expect(make().canSwitchTo(workspaces.get('ws-a2')!).ok).toBe(true);
  });

  it('a CLAIMED owner is never a fallback, even in the right org', () => {
    /**
     * Split from the test below so each guard is exercised ALONE. Together they
     * were two independent reasons for one assertion — delete either and it
     * still passed, which is the shape of a test that cannot fail.
     *
     * Here the owner is in the correct org and HAS an email: first-claim-wins
     * must not apply, because a claimed owner that did not match the session
     * means a different account is signing in.
     */
    email = 'stranger@example.com';
    const resolver = createTenantContextResolver({
      sessionEmail: () => email,
      isLoaded: () => loaded,
      activeWorkspaceId: () => activeWs,
      workspace: (id) => workspaces.get(id) ?? null,
      organization: (id) => orgs.get(id) ?? null,
      usersFor: (orgId) => members.filter((m) => m.orgId === orgId),
      rolesFor: () => [ROLE_A],
      ownerMember: () => ({ ...MEMBER_A, id: 'owner', email: 'owner@example.com' }),
    });
    const res = resolver.resolve();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.reason).toBe('not_a_member');
  });

  it('an UNCLAIMED owner of another org is never a fallback for this one', () => {
    /**
     * The other half. The owner is unclaimed — so first-claim-wins WOULD apply —
     * but it belongs to a different tenant. Without the org check this grants
     * Owner authority, which is every permission there is, in a tenant the
     * account has no relationship to.
     */
    email = 'stranger@example.com';
    const resolver = createTenantContextResolver({
      sessionEmail: () => email,
      isLoaded: () => loaded,
      activeWorkspaceId: () => activeWs,
      workspace: (id) => workspaces.get(id) ?? null,
      organization: (id) => orgs.get(id) ?? null,
      usersFor: (orgId) => members.filter((m) => m.orgId === orgId),
      rolesFor: () => [ROLE_A],
      ownerMember: () => ({ ...MEMBER_A, id: 'owner', orgId: 'org-z', email: null }),
    });
    const res = resolver.resolve();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.reason).toBe('not_a_member');
  });

  it('an unclaimed owner OF THIS ORG still claims it — the first-run path', () => {
    // The behaviour Program 4 shipped, preserved. Narrowing it would lock every
    // existing install out of its own data on upgrade.
    email = 'first@example.com';
    members = [];
    const resolver = createTenantContextResolver({
      sessionEmail: () => email,
      isLoaded: () => loaded,
      activeWorkspaceId: () => activeWs,
      workspace: (id) => workspaces.get(id) ?? null,
      organization: (id) => orgs.get(id) ?? null,
      usersFor: () => [],
      rolesFor: () => [ROLE_A],
      ownerMember: () => ({ ...MEMBER_A, id: 'owner', orgId: 'org-a', email: null }),
    });
    expect(resolver.resolve().ok).toBe(true);
  });

  it('a member restricted to NO workspace is denied — an empty list is not "all"', () => {
    // The docstring says an empty array denies. Nothing checked it.
    members = [{ ...MEMBER_A, workspaceIds: [] }];
    const res = make().resolve();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.reason).toBe('not_in_workspace');
  });

  it('email matching ignores case and surrounding whitespace', () => {
    members = [{ ...MEMBER_A, email: '  A@Example.COM ' }];
    email = 'a@example.com';
    expect(make().resolve().ok).toBe(true);
  });

  it('SERVICE: a service acts only in the tenant it was declared for', () => {
    const resolver = make();
    const ok = resolver.forService({
      serviceId: 'svc',
      purpose: 'Connector sync',
      tenantId: 'org-a',
      workspaceId: 'ws-a',
      permissions: ['crm:manage'],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.context.actorType).toBe('service');
      // Named as a service in the audit trail, never as a person.
      expect(ok.context.label).toBe('Connector sync (service)');
      expect(ok.context.userId).toBeNull();
    }

    // A's service cannot be pointed at B's workspace.
    const crossed = resolver.forService({
      serviceId: 'svc',
      purpose: 'Connector sync',
      tenantId: 'org-a',
      workspaceId: 'ws-b',
      permissions: ['crm:manage'],
    });
    expect(crossed.ok).toBe(false);
  });

  it('SERVICE: suspending a tenant stops its background work too', () => {
    orgs.set('org-a', { ...ORG_A, status: 'suspended' });
    const res = make().forService({
      serviceId: 'svc',
      purpose: 'Connector sync',
      tenantId: 'org-a',
      workspaceId: 'ws-a',
      permissions: ['crm:manage'],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.reason).toBe('tenant_not_operable');
  });
});

/* ── The primitives ──────────────────────────────────────────────────── */

describe('scope primitives', () => {
  it('an unresolved record is in NO scope', () => {
    expect(recordInScope({ tenantId: null }, A)).toBe(false);
    expect(recordInScope({ tenantId: undefined }, A)).toBe(false);
    expect(recordInScope({ tenantId: '' }, A)).toBe(false);
  });

  it('a tenant-level record is readable across that tenant’s workspaces', () => {
    expect(recordInScope({ tenantId: 'org-a' }, A)).toBe(true);
    expect(recordInScope({ tenantId: 'org-a' }, { tenantId: 'org-a', workspaceId: 'ws-a2' })).toBe(
      true,
    );
    expect(recordInScope({ tenantId: 'org-a' }, B)).toBe(false);
  });

  it('a workspace-scoped record is not readable from a sibling workspace', () => {
    const rec = { tenantId: 'org-a', workspaceId: 'ws-a' };
    expect(recordInScope(rec, A)).toBe(true);
    expect(recordInScope(rec, { tenantId: 'org-a', workspaceId: 'ws-a2' })).toBe(false);
  });

  it('a cache key cannot be collapsed by an id containing the separator', () => {
    /**
     * A joined key (`${tenant}:${ws}:${id}`) lets a crafted id impersonate a
     * different tuple. JSON-encoding the parts makes that unrepresentable.
     */
    expect(tenantKey(A, 'x:y')).not.toBe(tenantKey(A, 'x', 'y'));
    expect(tenantKey(A, 'r1')).not.toBe(tenantKey(B, 'r1'));
  });
});

/* ── The inventory tells the truth ────────────────────────────────────── */

describe('migration inventory', () => {
  it('reports PARTIAL while an unowned record remains, and COMPLETE only after', async () => {
    /**
     * The inventory is the artefact the program is judged on, so it gets a test
     * that can fail. `COMPLETE` must require BOTH a bound scope and zero
     * unresolved records — a store with one unowned row is not "done with a
     * caveat", it is a store where somebody's data is invisible.
     */
    const dir = join(tmpdir(), `np-inv-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const path = join(dir, 'inv.json');
    await fs.writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        moduleId: CUSTOMERS.id,
        records: [
          {
            id: 'rec_unowned',
            moduleId: CUSTOMERS.id,
            kind: CUSTOMERS.id,
            title: 'Unowned',
            status: 'active',
            fields: { name: 'Unowned' },
            tags: [],
            rev: 1,
            createdAt: NOW,
            updatedAt: NOW,
            createdBy: null,
            updatedBy: null,
            metadata: {},
          },
        ],
      }),
    );

    const registry = new EnterpriseModuleRegistry();
    registry.bindScope(() => A);
    const store = new EnterpriseRecordStore(path, CUSTOMERS.id, CUSTOMERS.id);
    registry.register(defineEnterpriseModule({ descriptor: CUSTOMERS, store }));

    const before = await buildMigrationInventory({ registry, now: () => NOW });
    const mine = before.entries.find((e) => e.store.includes(CUSTOMERS.id))!;
    expect(mine.status).toBe('PARTIAL');
    expect(mine.unresolved).toBe(1);
    expect(mine.assigned).toBe(0);

    // The unenforced stores are named, so the report cannot read as complete.
    expect(before.entries.some((e) => e.store.includes('documents'))).toBe(true);
    expect(before.entries.some((e) => e.status === 'REQUIRES_MIGRATION')).toBe(true);
    // Totals are summed from the rows, so the headline cannot disagree.
    expect(before.totals.unresolved).toBe(1);

    store.claimUnresolved(A, { now: NOW });
    const after = await buildMigrationInventory({ registry, now: () => NOW });
    const claimed = after.entries.find((e) => e.store.includes(CUSTOMERS.id))!;
    expect(claimed.status).toBe('COMPLETE');
    expect(claimed.assigned).toBe(1);

    await store.flush();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });

  it('an unscoped store is reported as REQUIRES_MIGRATION, not silently omitted', async () => {
    const dir = join(tmpdir(), `np-inv2-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const registry = new EnterpriseModuleRegistry();
    // Registered with NO bindScope call on the registry.
    const store = new EnterpriseRecordStore(join(dir, 'x.json'), CUSTOMERS.id, CUSTOMERS.id);
    registry.register(defineEnterpriseModule({ descriptor: CUSTOMERS, store }));
    const inv = await buildMigrationInventory({ registry, now: () => NOW });
    expect(inv.entries.find((e) => e.store.includes(CUSTOMERS.id))!.status).toBe(
      'REQUIRES_MIGRATION',
    );
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });
});

/* ── Eviction is confined to the writing tenant ──────────────────────── */

describe('record eviction', () => {
  it('one tenant filling the cap does not destroy another tenant’s records', async () => {
    /**
     * REPRODUCED BEFORE THE FIX. `evictOldest` sorted every record in the file
     * and deleted `all[0]` — the globally oldest — so tenant A's writes hard-
     * deleted tenant B's rows, oldest first. No soft delete, no `deleted` status,
     * no audit line, no lifecycle event, no recovery. On a real install the
     * victim is whoever has been there longest.
     *
     * Reachable: the Data Plane importer writes through `create` and accepts
     * 200,000 rows per table against a 50,000 record cap.
     */
    const dir = join(tmpdir(), `np-evict-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    let scope: TenantScope | null = null;
    const store = new EnterpriseRecordStore(join(dir, 'cap.json'), CUSTOMERS.id, CUSTOMERS.id, 3);
    store.bindScope(() => scope);
    await store.load();

    scope = B;
    for (let i = 0; i < 3; i += 1) {
      store.create({ title: `B${i}`, fields: { name: `B${i}` }, now: `2020-01-0${i + 1}T00:00:00.000Z` });
    }
    expect(store.list({ limit: 50 })).toHaveLength(3);

    // A now writes past the cap. B must be untouched.
    scope = A;
    store.create({ title: 'A1', fields: { name: 'A1' }, now: NOW });
    store.create({ title: 'A2', fields: { name: 'A2' }, now: NOW });

    scope = B;
    expect(store.list({ limit: 50 })).toHaveLength(3);
    scope = A;
    // A's own cap still applies to A: the cap is per tenant now, which is the
    // correct semantics — a shared cap is a cross-tenant denial of service.
    expect(store.list({ limit: 50 }).length).toBeLessThanOrEqual(3);

    await store.flush();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });
});
