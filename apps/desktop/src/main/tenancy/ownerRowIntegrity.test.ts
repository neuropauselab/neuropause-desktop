/**
 * P13C ROUND 31 — O-11. AN OMITTED FIELD ERASED THE ONE IT WAS NOT SENT FOR.
 *
 * `orgStore.updateUser` applied its patch with `{ ...user, ...patch }`. Object
 * spread copies own enumerable keys REGARDLESS of value, and the only caller —
 * the `enterprise:org.updateUser` IPC handler — builds its patch as an object
 * LITERAL naming all six fields:
 *
 *     const patch = guardOwnerUserPatch(r.id, OWNER_USER_ID, {
 *       name: r.name, email: r.email, title: r.title,
 *       unitId: r.unitId, roleIds: r.roleIds, status: r.status,
 *     });
 *
 * `EnterpriseOrgUpdateUserRequest` declares every one of those optional, so a
 * request that renames a member and says nothing about their address arrives
 * here as `{ name: 'X', email: undefined, … }` — and writes `email: undefined`.
 *
 * WHY THAT IS NOT A COSMETIC BUG
 *
 *   1. Membership is decided by matching the signed-in address against this
 *      field. Erasing it removes the person from their own organization.
 *   2. `JSON.stringify` omits undefined, so the erasure is written to disk and
 *      survives every restart. Nothing else in this program that breaks tenant
 *      resolution is persistent.
 *   3. `tenantContext.resolveFull()` tested it with `m.email !== null` — true
 *      for undefined — and then called `.trim()` on it. A TypeError out of the
 *      one function whose documented contract is that it never throws.
 *
 * On the seeded owner row all three compound: it is the root of first-claim-wins.
 *
 * The fix is deliberately in the STORE and not in the handler. Fixing the caller
 * fixes one caller; `updateUser` is public and `Partial<Pick<…>>` already means
 * "these fields", so honouring that is the store's job.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Organization, OrgUser, TenantScope, Workspace } from '@neuropause/shared';
import { OrgStore } from '../enterprise/org/orgStore';
import { OWNER_USER_ID } from '../enterprise/org/seed';
import { createTenantContextResolver } from './tenantContext';

const dirs: string[] = [];
let store: OrgStore;
let storePath = '';
let who: TenantScope | null = null;
let ORG_A = '';

const as = (tenantId: string): TenantScope => ({ tenantId, workspaceId: `ws-${tenantId}` });

beforeEach(async () => {
  const dir = join(tmpdir(), `np-owner-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  dirs.push(dir);
  storePath = join(dir, 'org.json');
  store = new OrgStore(storePath);
  store.bindScope(() => who);
  await store.load();
  ORG_A = store.defaultOrg().id;
  who = null;
});

afterEach(async () => {
  for (const d of dirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

/** The patch the IPC handler actually builds: every key present, most undefined. */
function handlerShapedPatch(over: Record<string, unknown>): Record<string, unknown> {
  return {
    name: undefined,
    email: undefined,
    title: undefined,
    unitId: undefined,
    roleIds: undefined,
    status: undefined,
    ...over,
  };
}

describe('O-11 — an omitted field is left alone, not erased', () => {
  it('renaming the owner does not erase the address membership is decided by', () => {
    who = as(ORG_A);
    store.claimOwnerIdentity({ name: 'Dishant', email: 'owner@neuropause033.test' });
    expect(store.user(OWNER_USER_ID)?.email).toBe('owner@neuropause033.test');

    // The exact shape `enterprise:org.updateUser` sends for a rename.
    const next = store.updateUser(OWNER_USER_ID, handlerShapedPatch({ name: 'Dishant D' }));

    expect(next?.name).toBe('Dishant D');
    expect(next?.email).toBe('owner@neuropause033.test');
    // Not merely non-null: the key must still be a string, or JSON drops it.
    expect(typeof next?.email).toBe('string');
  });

  it('the erasure would have survived a restart, so the round trip is asserted', async () => {
    who = as(ORG_A);
    store.claimOwnerIdentity({ name: 'Dishant', email: 'owner@neuropause033.test' });
    store.updateUser(OWNER_USER_ID, handlerShapedPatch({ title: 'Founder' }));
    await store.flush();

    const reloaded = new OrgStore(storePath);
    reloaded.bindScope(() => who);
    await reloaded.load();
    expect(reloaded.user(OWNER_USER_ID)?.email).toBe('owner@neuropause033.test');
  });

  it('an explicit null still clears the field — null is a meaningful value here', () => {
    // An UNCLAIMED owner is `email: null`, and first-claim-wins depends on being
    // able to express it. Dropping undefined must not also drop null.
    who = as(ORG_A);
    store.claimOwnerIdentity({ name: 'Dishant', email: 'owner@neuropause033.test' });
    const next = store.updateUser(OWNER_USER_ID, handlerShapedPatch({ email: null }));
    expect(next?.email).toBeNull();
  });

  it('every other optional field is protected the same way, not just email', () => {
    who = as(ORG_A);
    const created = store.createUser({
      orgId: ORG_A,
      name: 'Ada',
      email: 'ada@example.test',
      title: 'Ops',
    });
    const before = store.user(created.id) as OrgUser;

    const next = store.updateUser(created.id, handlerShapedPatch({ title: 'Lead' }));

    expect(next?.title).toBe('Lead');
    expect(next?.name).toBe(before.name);
    expect(next?.email).toBe(before.email);
    expect(next?.unitId).toBe(before.unitId);
    expect(next?.roleIds).toEqual(before.roleIds);
    expect(next?.status).toBe(before.status);
  });

  it('a real change is still applied — the guard is not a no-op', () => {
    who = as(ORG_A);
    const created = store.createUser({
      orgId: ORG_A,
      name: 'Ada',
      email: 'ada@example.test',
      title: 'Ops',
    });
    const next = store.updateUser(
      created.id,
      handlerShapedPatch({ name: 'Ada L', email: 'ada.l@example.test', status: 'suspended' }),
    );
    expect(next?.name).toBe('Ada L');
    expect(next?.email).toBe('ada.l@example.test');
    expect(next?.status).toBe('suspended');
  });
});

describe('O-11 — the resolver refuses a corrupt row instead of throwing on it', () => {
  const NOW = '2026-01-01T00:00:00.000Z';
  const ORG: Organization = {
    id: 'org-a',
    name: 'A',
    slug: 'a',
    description: '',
    type: 'business',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    metadata: {},
  };
  const WS: Workspace = {
    id: 'ws-a',
    name: 'A',
    organizationId: 'org-a',
    isolation: 'isolated',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const base: OrgUser = {
    id: 'user-a',
    orgId: 'org-a',
    name: 'Ada',
    email: 'ada@example.test',
    title: '',
    kind: 'human',
    workerId: null,
    unitId: null,
    roleIds: [],
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  };

  const resolverOver = (members: OrgUser[], owner: OrgUser | null) =>
    createTenantContextResolver({
      sessionEmail: () => 'ada@example.test',
      isLoaded: () => true,
      activeWorkspaceId: () => 'ws-a',
      workspace: (id) => (id === 'ws-a' ? WS : null),
      organization: (id) => (id === 'org-a' ? ORG : null),
      usersFor: () => members,
      rolesFor: () => [],
      ownerMember: () => owner,
    });

  it('a member row whose email is undefined does not throw resolveFull', () => {
    // The state O-11 produced on disk: the key is simply absent.
    const corrupt = { ...base } as Partial<OrgUser>;
    delete corrupt.email;

    const r = resolverOver([corrupt as OrgUser], null);
    expect(() => r.resolveFull()).not.toThrow();
    // `resolve()` documents that it never throws. That has to be true.
    expect(() => r.resolve()).not.toThrow();
    expect(() => r.scope()).not.toThrow();

    const res = r.resolveFull();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.refusal.reason).toBe('not_a_member');
  });

  it('a corrupt row does not become claimable by whoever signs in next', () => {
    // The tempting relaxation is to treat a non-string email as "unclaimed" and
    // let the owner fallback take it. That converts a data fault into a tenant
    // takeover, so the fallback is left strict on purpose.
    const corruptOwner = { ...base, id: OWNER_USER_ID } as Partial<OrgUser>;
    delete corruptOwner.email;

    const res = resolverOver([], corruptOwner as OrgUser).resolveFull();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.refusal.reason).toBe('not_a_member');
  });

  it('a genuinely unclaimed owner is still claimed — first-run is unchanged', () => {
    const unclaimed: OrgUser = { ...base, id: OWNER_USER_ID, email: null };
    const res = resolverOver([], unclaimed).resolveFull();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.member.id).toBe(OWNER_USER_ID);
  });

  it('a healthy member still resolves — the predicate change denies nothing real', () => {
    const res = resolverOver([base], null).resolveFull();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.member.id).toBe('user-a');
  });
});
