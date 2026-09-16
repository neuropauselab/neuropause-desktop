/**
 * P13C ROUND 40 — GATE 27. PROVISIONED-ORG OWNER PROTECTION.
 *
 * The last un-dispositioned release blocker (matrix §B item 4; Gate 24's top
 * untested negative scenario): every root-of-trust guard was keyed on the
 * SEEDED literal `user-owner`, so a runtime-created organization had no
 * protected owner at all — any `people:manage` holder (Manager+) could
 * re-role, suspend, re-email, or delete the org's creator, and any
 * `governance:manage` holder could delete the Owner role outright
 * (provisioning created every spec role `builtIn:false`).
 *
 * Pinned here, over the REAL OrgStore and the REAL guards in the exact
 * composition the handlers now use (`protectedOwnerIdForTarget` → the pure
 * guards):
 *   1. Provisioning records `Organization.ownerUserId` and marks the spec
 *      roles built-in.
 *   2. The takeover chain, replayed one tenant over — every step now refused.
 *   3. Legacy stores (pre-round-40 provisioned orgs) heal on load when the
 *      owner is unambiguous, and admit it when it is not.
 *   4. The seeded organization's protections are byte-for-byte unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { OrgStore } from '../enterprise/org/orgStore';
import { ORG_ID as SEED_ORG_ID, OWNER_USER_ID } from '../enterprise/org/seed';
import { provisionOrganization, type ProvisionResult } from '../enterprise/org/provisionOrganization';
import {
  canDeleteMember,
  guardBuiltInRolePatch,
  guardOwnerUserPatch,
} from '../enterprise/authzGate';

const opened: OrgStore[] = [];
const paths: string[] = [];

function tempPath(): string {
  const p = join(tmpdir(), `nps-powner-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

/** A store whose caller scope can follow the tenant under test. */
async function newWorld(path = tempPath()): Promise<{ store: OrgStore; setScope: (s: TenantScope) => void }> {
  const store = new OrgStore(path);
  opened.push(store);
  let scope: TenantScope = { tenantId: SEED_ORG_ID, workspaceId: 'ws-test' };
  store.bindScope(() => scope);
  await store.load();
  return { store, setScope: (s) => (scope = s) };
}

/** Provision 'Globex' through the real function over the real store. */
function provisionGlobex(store: OrgStore): ProvisionResult {
  return provisionOrganization(
    {
      createOrganization: (name, description) => store.createOrganization(name, description),
      createRole: (input) => store.createRole(input),
      createUser: (input) => store.createUser(input),
      createWorkspace: (name, organizationId) => ({
        id: `ws_${randomUUID()}`,
        name,
        organizationId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      recordOwner: (orgId, userId) => store.assignProvisionedOwner(orgId, userId),
    },
    { name: 'Globex', ownerEmail: 'eve.owner@globex.example', ownerName: 'Eve' },
  );
}

afterEach(async () => {
  for (const s of opened.splice(0)) await s.flush();
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

describe('provisioning records the root of trust', () => {
  it('anchors the creator as ownerUserId and marks every spec role built-in', async () => {
    const { store, setScope } = await newWorld();
    const r = provisionGlobex(store);
    setScope({ tenantId: r.organization.id, workspaceId: 'ws-g' });

    expect(store.organization(r.organization.id)?.ownerUserId).toBe(r.owner.id);
    expect(store.ownerUserIdFor(r.organization.id)).toBe(r.owner.id);
    for (const role of store.rolesFor(r.organization.id)) {
      expect(role.builtIn).toBe(true);
    }
  });

  it('the anchor is first-set-wins and refuses the seeded org and foreign users', async () => {
    const { store, setScope } = await newWorld();
    const r = provisionGlobex(store);
    setScope({ tenantId: r.organization.id, workspaceId: 'ws-g' });
    const mallory = store.createUser({
      orgId: r.organization.id,
      name: 'Mallory',
      title: 'Manager',
      unitId: null,
    });

    expect(store.assignProvisionedOwner(r.organization.id, mallory.id)).toBe(false); // already anchored
    expect(store.ownerUserIdFor(r.organization.id)).toBe(r.owner.id);
    expect(store.assignProvisionedOwner(SEED_ORG_ID, mallory.id)).toBe(false); // seeded anchor is compile-time
    expect(store.assignProvisionedOwner(r.organization.id, OWNER_USER_ID)).toBe(false); // foreign user
  });
});

describe('THE EXPLOIT, one tenant over — every step now refused', () => {
  it('a Manager patching the provisioned owner cannot touch roles, status, or email', async () => {
    const { store, setScope } = await newWorld();
    const r = provisionGlobex(store);
    setScope({ tenantId: r.organization.id, workspaceId: 'ws-g' });

    // The handler's exact composition: per-target-org owner id → pure guard.
    const patch = guardOwnerUserPatch(r.owner.id, store.protectedOwnerIdForTarget(r.owner.id), {
      name: 'Still Eve',
      email: 'mallory@attacker.example',
      roleIds: [],
      status: 'suspended',
    });
    expect(patch).toEqual({ name: 'Still Eve' }); // profile edits pass; the takeover fields do not
    const updated = store.updateUser(r.owner.id, patch);
    expect(updated?.email).toBe('eve.owner@globex.example');
    expect(updated?.roleIds).toEqual(r.owner.roleIds);
    expect(updated?.status).toBe('active');
  });

  it('the provisioned owner cannot be deleted; an ordinary member still can be', async () => {
    const { store, setScope } = await newWorld();
    const r = provisionGlobex(store);
    setScope({ tenantId: r.organization.id, workspaceId: 'ws-g' });
    const member = store.createUser({
      orgId: r.organization.id,
      name: 'Bob',
      title: 'Analyst',
      unitId: null,
    });

    expect(canDeleteMember(r.owner.id, store.protectedOwnerIdForTarget(r.owner.id))).toBe(false);
    expect(canDeleteMember(member.id, store.protectedOwnerIdForTarget(member.id))).toBe(true);
    expect(store.deleteUser(member.id)).toBe(true);
  });

  it('the provisioned Owner role can be neither deleted nor de-permissioned', async () => {
    const { store, setScope } = await newWorld();
    const r = provisionGlobex(store);
    setScope({ tenantId: r.organization.id, workspaceId: 'ws-g' });
    const ownerRole = store.rolesFor(r.organization.id).find((role) => role.name === 'Owner');
    expect(ownerRole).toBeDefined();

    expect(store.deleteRole(ownerRole!.id)).toBe(false); // builtIn now — the deletable root of trust is closed
    const patch = guardBuiltInRolePatch(store.role(ownerRole!.id), {
      name: 'Renamed',
      permissions: [],
    });
    expect(patch).toEqual({ name: 'Renamed' }); // rename fine; stripping permissions is not
  });
});

describe('legacy stores heal on load', () => {
  it('an unambiguous pre-round-40 provisioned org gains its anchor and built-in roles', async () => {
    const path = tempPath();
    // Build the pre-round-40 shape with the REAL machinery, then strip the
    // round-40 markers from the persisted file — a genuine legacy artifact.
    {
      const { store } = await newWorld(path);
      provisionGlobex(store);
      await store.flush();
    }
    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    const file = raw.data ?? raw;
    for (const org of file.organizations) delete org.ownerUserId;
    for (const role of file.roles) if (role.orgId !== SEED_ORG_ID) role.builtIn = false;
    await fs.writeFile(path, JSON.stringify(raw));

    const { store } = await newWorld(path);
    const globex = store.listOrganizations().find((o) => o.name === 'Globex');
    expect(globex?.ownerUserId).toBeDefined();
    const healedOwner = store.user(globex!.ownerUserId!);
    expect(healedOwner?.email).toBe('eve.owner@globex.example');
    const ownerRole = store.rolesFor(globex!.id).find((role) => role.name === 'Owner');
    expect(ownerRole?.builtIn).toBe(true);
  });

  it('an AMBIGUOUS legacy org is left unanchored — no invented root of trust', async () => {
    const path = tempPath();
    {
      const { store, setScope } = await newWorld(path);
      const r = provisionGlobex(store);
      setScope({ tenantId: r.organization.id, workspaceId: 'ws-g' });
      // A second member shaped exactly like the owner: same title, same role.
      store.createUser({
        orgId: r.organization.id,
        name: 'Second Owner-Shaped',
        title: 'Owner',
        unitId: null,
        roleIds: [...r.owner.roleIds],
      });
      await store.flush();
    }
    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    const file = raw.data ?? raw;
    for (const org of file.organizations) delete org.ownerUserId;
    await fs.writeFile(path, JSON.stringify(raw));

    const { store } = await newWorld(path);
    const globex = store.listOrganizations().find((o) => o.name === 'Globex');
    expect(globex?.ownerUserId).toBeUndefined();
    // Guards fall back to the seeded literal — never LESS protection than before.
    const anyUser = store.usersFor(globex!.id)[0];
    expect(store.protectedOwnerIdForTarget(anyUser!.id)).toBe(OWNER_USER_ID);
  });
});

describe('the seeded organization is untouched', () => {
  it('the seeded owner remains keyed on the compile-time literal', async () => {
    const { store } = await newWorld();
    expect(store.ownerUserIdFor(SEED_ORG_ID)).toBe(OWNER_USER_ID);
    expect(store.protectedOwnerIdForTarget(OWNER_USER_ID)).toBe(OWNER_USER_ID);
    expect(canDeleteMember(OWNER_USER_ID, store.protectedOwnerIdForTarget(OWNER_USER_ID))).toBe(false);
    const patch = guardOwnerUserPatch(OWNER_USER_ID, store.protectedOwnerIdForTarget(OWNER_USER_ID), {
      email: 'attacker@evil.example',
      roleIds: [],
      status: 'suspended',
      name: 'ok',
    });
    expect(patch).toEqual({ name: 'ok' });
  });
});
