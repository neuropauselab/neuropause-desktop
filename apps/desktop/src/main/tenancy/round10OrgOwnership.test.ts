/**
 * P13C ROUND 10 — NEW-H6. TENANT TAKEOVER.
 *
 * The most severe finding of Round 9, proven by an executed test then and
 * reproduced from the repository at the start of this round.
 *
 * `createUnit` / `createUser` / `createRole` stamped `orgId` from the
 * authoritative resolver. **Update and delete did not** — each was a bare
 * `this.<map>.get(id)` over one install-wide Map.
 *
 * WHY THIS STORE AND NOT ANOTHER. It decides who everyone is. Membership is
 * resolved by matching the signed-in email against an `OrgUser` row, so
 * rewriting a row's `email` does not edit a record — it transfers the row's
 * holder. `guardOwnerUserPatch` strips `roleIds` and `status`, and not `email`.
 * `user-owner` is a compile-time constant, so nothing had to be discovered.
 *
 * The permission check did not stop it because a permission answers "may this
 * person do this kind of thing", evaluated in the caller's own organization,
 * while the write landed in someone else's. Only ownership answers "to THIS row".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { OrgStore } from '../enterprise/org/orgStore';
import { OWNER_USER_ID } from '../enterprise/org/seed';

const dirs: string[] = [];
let store: OrgStore;
let who: TenantScope | null = null;

/** The three tenants. A is the SEEDED organization — the victim in the exploit. */
let A = '';
let B = '';
let C = '';

const as = (tenantId: string): TenantScope => ({ tenantId, workspaceId: `ws-${tenantId}` });

beforeEach(async () => {
  const dir = join(tmpdir(), `np-org-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  dirs.push(dir);
  store = new OrgStore(join(dir, 'org.json'));
  store.bindScope(() => who);
  await store.load();
  A = store.defaultOrg().id;

  // B and C are REAL organizations with REAL members — the fixture is positive.
  B = store.createOrganization('Org B').id;
  C = store.createOrganization('Org C').id;
  who = null;
});

afterEach(async () => {
  for (const d of dirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

/** Create `n` members in `orgId`, acting as that tenant. Returns their ids. */
function membersFor(orgId: string, n: number, tag: string): string[] {
  who = as(orgId);
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    ids.push(
      store.createUser({
        orgId,
        name: `${tag}-${i}`,
        email: `${tag}-${i}@example.test`,
        title: 'Member',
      }).id,
    );
  }
  who = null;
  return ids;
}

describe('A/B/C each hold real members and mutate only their own', () => {
  it('A owns 3, B owns 7, C owns 11 — the counts, not an inequality', () => {
    const a = membersFor(A, 3, 'A');
    const b = membersFor(B, 7, 'B');
    const c = membersFor(C, 11, 'C');

    // `usersFor` is the resolver-facing read and takes an explicit org id.
    // Seeded rows exist in A, so assert the created members are present rather
    // than a bare total — the number that matters is each tenant's own.
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(7);
    expect(c).toHaveLength(11);
    expect(store.usersFor(B)).toHaveLength(7);
    expect(store.usersFor(C)).toHaveLength(11);
    expect(store.usersFor(B).every((u) => u.orgId === B)).toBe(true);
    expect(store.usersFor(C).every((u) => u.orgId === C)).toBe(true);
  });

  it('each tenant CAN update its own member — the gate is not "always no"', () => {
    const [a0] = membersFor(A, 3, 'A');
    const [b0] = membersFor(B, 7, 'B');
    const [c0] = membersFor(C, 11, 'C');

    who = as(A);
    expect(store.updateUser(a0!, { title: 'Lead' })?.title).toBe('Lead');
    who = as(B);
    expect(store.updateUser(b0!, { title: 'Lead' })?.title).toBe('Lead');
    who = as(C);
    expect(store.updateUser(c0!, { title: 'Lead' })?.title).toBe('Lead');
  });
});

describe('no tenant may mutate another tenant’s directory', () => {
  it('A cannot update or delete B’s member; B cannot touch A’s', () => {
    const [a0] = membersFor(A, 3, 'A');
    const [b0] = membersFor(B, 7, 'B');

    who = as(A);
    expect(store.updateUser(b0!, { title: 'Owned' })).toBeNull();
    expect(store.deleteUser(b0!)).toBe(false);

    who = as(B);
    expect(store.updateUser(a0!, { title: 'Owned' })).toBeNull();
    expect(store.deleteUser(a0!)).toBe(false);

    // Both survive, unmodified.
    expect(store.usersFor(B)).toHaveLength(7);
    expect(store.usersFor(B).find((u) => u.id === b0)!.title).toBe('Member');
    expect(store.usersFor(A).find((u) => u.id === a0)!.title).toBe('Member');
  });

  it('C cannot delete A’s member', () => {
    const [a0] = membersFor(A, 3, 'A');
    membersFor(C, 11, 'C');
    who = as(C);
    expect(store.deleteUser(a0!)).toBe(false);
    expect(store.usersFor(A).some((u) => u.id === a0)).toBe(true);
  });

  it('units, roles and organization status are all refused across tenants', () => {
    who = as(A);
    const aUnit = store.createUnit({ orgId: A, kind: 'team', name: 'A-Team' });
    const aRole = store.createRole({ orgId: A, name: 'A-Role', description: '', permissions: [] });

    who = as(B);
    expect(store.updateUnit(aUnit.id, { name: 'PWNED' })).toBeNull();
    expect(store.deleteUnit(aUnit.id)).toBe(false);
    expect(store.updateRole(aRole.id, { name: 'PWNED' })).toBeNull();
    expect(store.deleteRole(aRole.id)).toBe(false);
    expect(store.setOrganizationStatus(A, 'suspended')).toBeNull();

    who = as(A);
    expect(store.unitsFor(A).find((u) => u.id === aUnit.id)!.name).toBe('A-Team');
    expect(store.rolesFor(A).find((r) => r.id === aRole.id)!.name).toBe('A-Role');
    expect(store.organization(A)!.status).not.toBe('suspended');
  });

  it('an unresolved caller mutates nothing', () => {
    const [a0] = membersFor(A, 3, 'A');
    who = null;
    expect(store.updateUser(a0!, { title: 'Owned' })).toBeNull();
    expect(store.deleteUser(a0!)).toBe(false);
    expect(store.setOrganizationStatus(A, 'suspended')).toBeNull();
  });
});

describe('THE EXPLOIT — the Round 9 takeover chain, step by step', () => {
  /**
   * Reproduced exactly: an attacker who created their own organization uses a
   * COMPILE-TIME CONSTANT id to rewrite the victim tenant's owner row's email,
   * and thereby becomes that tenant's Owner.
   */
  it('an attacker in their own org cannot claim the seeded owner row', () => {
    // The victim's owner row: seeded, in organization A, holding role-owner.
    const ownerBefore = store.usersFor(A).find((u) => u.id === OWNER_USER_ID);
    expect(ownerBefore, 'the seeded owner must exist for this test to mean anything').toBeDefined();
    expect(ownerBefore!.orgId).toBe(A);

    // Step 1-2: the attacker is Owner of their OWN organization B, and calls
    // updateUser with the constant id and their own email.
    who = as(B);
    expect(store.updateUser(OWNER_USER_ID, { email: 'attacker@evil.test' })).toBeNull();

    // Step 3-4 never happen: the row is unchanged, so membership still resolves
    // to the legitimate holder.
    const ownerAfter = store.usersFor(A).find((u) => u.id === OWNER_USER_ID)!;
    expect(ownerAfter.email).toBe(ownerBefore!.email);
    expect(ownerAfter.orgId).toBe(A);
    expect(ownerAfter.roleIds).toEqual(ownerBefore!.roleIds);
  });

  it('claimOwnerIdentity never rebinds a claimed owner — the second door stays shut', () => {
    // Round 32 (O-12): the protection moved from caller scope into the claim
    // rule itself. A claimed owner is never rebound, whatever scope is active.
    expect(store.claimOwnerIdentity({ name: 'Real Owner', email: 'real@example.test' })).toBe(true);
    who = as(B);
    expect(store.claimOwnerIdentity({ name: 'Attacker', email: 'attacker@evil.test' })).toBe(false);
    const after = store.usersFor(A).find((u) => u.id === OWNER_USER_ID)!;
    expect(after.email).toBe('real@example.test');
    expect(after.name).toBe('Real Owner');
  });

  it('the first sign-in claims the owner with NO resolved tenant — the O-12 self-heal path', () => {
    // The install-level rule must not depend on which workspace happens to be
    // active, and must keep working while tenant resolution is refusing.
    who = null;
    expect(store.claimOwnerIdentity({ name: 'Real Owner', email: 'real@example.test' })).toBe(true);
    expect(store.usersFor(A).find((u) => u.id === OWNER_USER_ID)!.email).toBe('real@example.test');
  });

  it('a corrupt owner row (email undefined — the O-11 shape) is never claimable', () => {
    who = as(A);
    store.claimOwnerIdentity({ name: 'Real Owner', email: 'real@example.test' });
    // Simulate the persisted O-11 corruption: the email key erased on disk.
    const owner = store.usersFor(A).find((u) => u.id === OWNER_USER_ID)!;
    const corrupt = { ...owner } as Partial<typeof owner>;
    delete corrupt.email;
    // Reach the map the way a corrupted load would have populated it.
    (store as unknown as { users: Map<string, unknown> }).users.set(OWNER_USER_ID, corrupt);
    expect(store.claimOwnerIdentity({ name: 'Next', email: 'next@example.test' })).toBe(false);
  });

  it('the attacker cannot delete the victim’s seeded units by constant id', () => {
    const victimUnits = store.unitsFor(A);
    expect(victimUnits.length).toBeGreaterThan(0);
    who = as(B);
    for (const u of victimUnits) expect(store.deleteUnit(u.id)).toBe(false);
    expect(store.unitsFor(A)).toHaveLength(victimUnits.length);
  });
});

describe('ownership survives a reload from disk', () => {
  it('a reopened store still refuses B on A’s member and still allows A', async () => {
    const [a0] = membersFor(A, 3, 'A');
    await store.flush?.();

    const path = (store as unknown as { filePath: string }).filePath;
    const reopened = new OrgStore(path);
    reopened.bindScope(() => who);
    await reopened.load();

    who = as(B);
    expect(reopened.updateUser(a0!, { title: 'Owned' })).toBeNull();

    who = as(A);
    expect(reopened.updateUser(a0!, { title: 'Lead' })?.title).toBe('Lead');
  });
});
