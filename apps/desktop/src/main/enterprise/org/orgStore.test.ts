import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OrgStore } from './orgStore';
import { ORG_ID, OWNER_USER_ID, ROLE_TO_UNIT_ID, UNIT } from './seed';

const opened: OrgStore[] = [];
const paths: string[] = [];

function tempPath(): string {
  const p = join(tmpdir(), `nps-org-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

/**
 * P13C ROUND 10 — the harness now BINDS A SCOPE, because production does.
 *
 * Before NEW-H6 this store had no seam at all, so the suite constructed it bare
 * and every mutation succeeded. That is exactly why the suite could not see the
 * takeover: with no boundary there is no boundary to cross. The harness acts as
 * the seeded organization — the tenant that owns the rows these tests mutate —
 * and `crossTenantStore()` below supplies an attacker for the added cases.
 */
async function newStore(path: string): Promise<OrgStore> {
  const s = new OrgStore(path);
  opened.push(s);
  s.bindScope(() => ({ tenantId: ORG_ID, workspaceId: 'ws-test' }));
  await s.load();
  return s;
}

afterEach(async () => {
  for (const s of opened.splice(0)) await s.flush();
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

describe('OrgStore — seed', () => {
  it('seeds a default org with a unit hierarchy, built-in roles, and an owner', async () => {
    const s = await newStore(tempPath());
    const org = s.defaultOrg();
    expect(org.id).toBe(ORG_ID);
    expect(org.name).toBe('NeuroPause');
    expect(s.unitsFor(org.id).length).toBeGreaterThan(5);
    expect(s.rolesFor(org.id).length).toBe(6);
    const owner = s.user(OWNER_USER_ID);
    expect(owner?.kind).toBe('human');
    expect(owner?.roleIds.length).toBeGreaterThan(0);
  });
});

describe('OrgStore — removeProvisionedOrganization (GATE 23 rollback)', () => {
  it('removes ONLY the named org and its rows, leaving the seeded org intact', async () => {
    const s = await newStore(tempPath());
    const seededUsers = s.usersFor(ORG_ID).length;
    const seededRoles = s.rolesFor(ORG_ID).length;

    const org = s.createOrganization('Doomed Co');
    s.createRole({ orgId: org.id, name: 'Owner', description: '', permissions: [], builtIn: true });
    s.createUser({ orgId: org.id, name: 'Owner', title: 'Owner', email: 'o@doomed.test' });
    expect(s.organization(org.id)).not.toBeNull();
    expect(s.rolesFor(org.id)).toHaveLength(1);
    expect(s.usersFor(org.id)).toHaveLength(1);

    s.removeProvisionedOrganization(org.id);

    // The doomed org and everything it owned are gone…
    expect(s.organization(org.id)).toBeNull();
    expect(s.rolesFor(org.id)).toHaveLength(0);
    expect(s.usersFor(org.id)).toHaveLength(0);
    // …and the seeded org is byte-for-byte unaffected.
    expect(s.organization(ORG_ID)).not.toBeNull();
    expect(s.usersFor(ORG_ID)).toHaveLength(seededUsers);
    expect(s.rolesFor(ORG_ID)).toHaveLength(seededRoles);
  });

  it('REFUSES to remove the seeded organization', async () => {
    const s = await newStore(tempPath());
    expect(() => s.removeProvisionedOrganization(ORG_ID)).toThrow(/seeded organization cannot be removed/i);
    expect(s.organization(ORG_ID)).not.toBeNull();
  });

  it('is a no-op for an unknown org id', async () => {
    const s = await newStore(tempPath());
    expect(() => s.removeProvisionedOrganization('org_does_not_exist')).not.toThrow();
  });
});

// GATE 23 — organization names are unique case-insensitively GLOBALLY.
describe('OrgStore — name uniqueness (Gate 23)', () => {
  it('rejects a duplicate organization name globally — fail closed', async () => {
    const s = await newStore(tempPath());
    s.createOrganization('Northwind Health');
    expect(() => s.createOrganization('Northwind Health')).toThrow(
      /An organization named "Northwind Health" already exists\./,
    );
    // The second create did not land — exactly one 'Northwind Health' exists.
    expect(s.listOrganizations().filter((o) => o.name === 'Northwind Health')).toHaveLength(1);
  });

  it('rejects a case-insensitive / whitespace duplicate — including the seeded org name', async () => {
    const s = await newStore(tempPath());
    // Seeded org is 'NeuroPause'; a cased/padded variant must be refused.
    expect(() => s.createOrganization('  neuropause ')).toThrow(/already exists/);
    // And a second custom org collides case-insensitively with the first.
    s.createOrganization('Alpha Industries');
    expect(() => s.createOrganization('ALPHA INDUSTRIES')).toThrow(/already exists/);
  });

  it('allows a unique organization name (the gate is not "always no")', async () => {
    const s = await newStore(tempPath());
    const a = s.createOrganization('Globex');
    const b = s.createOrganization('Initech');
    expect(a.name).toBe('Globex');
    expect(b.name).toBe('Initech');
    expect(a.id).not.toBe(b.id);
  });
});

describe('OrgStore — CRUD', () => {
  it('creates, updates, and deletes units (re-parenting children)', async () => {
    const s = await newStore(tempPath());
    const child = s.createUnit({ orgId: ORG_ID, kind: 'team', name: 'New Team', parentId: UNIT.engineering });
    expect(s.unit(child.id)?.name).toBe('New Team');
    const updated = s.updateUnit(child.id, { name: 'Renamed Team' });
    expect(updated?.name).toBe('Renamed Team');
    expect(s.deleteUnit(child.id)).toBe(true);
    expect(s.unit(child.id)).toBeNull();
  });

  it('creates and deletes human members but refuses to delete AI workers', async () => {
    const s = await newStore(tempPath());
    const human = s.createUser({ orgId: ORG_ID, name: 'Alex', title: 'Engineer', unitId: UNIT.platform });
    expect(s.deleteUser(human.id)).toBe(true);

    s.syncWorkers(ORG_ID, [{ id: 'w1', name: 'Eng AI', role: 'engineering' }], ROLE_TO_UNIT_ID);
    const aiUser = s.usersFor(ORG_ID).find((u) => u.workerId === 'w1');
    expect(aiUser).toBeDefined();
    expect(s.deleteUser(aiUser!.id)).toBe(false);
  });

  it('refuses to delete built-in roles', async () => {
    const s = await newStore(tempPath());
    const builtIn = s.rolesFor(ORG_ID).find((r) => r.builtIn)!;
    expect(s.deleteRole(builtIn.id)).toBe(false);
    const custom = s.createRole({ orgId: ORG_ID, name: 'Auditor', description: '', permissions: ['org:read'] });
    expect(s.deleteRole(custom.id)).toBe(true);
  });
});

describe('OrgStore — syncWorkers', () => {
  it('folds workers onto matching teams, is idempotent, and prunes departed workers', async () => {
    const s = await newStore(tempPath());
    const workers = [
      { id: 'w-eng', name: 'Engineering AI', role: 'engineering' },
      { id: 'w-fin', name: 'Finance AI', role: 'finance' },
    ];
    const added = s.syncWorkers(ORG_ID, workers, ROLE_TO_UNIT_ID);
    expect(added).toBe(2);
    const eng = s.usersFor(ORG_ID).find((u) => u.workerId === 'w-eng');
    expect(eng?.unitId).toBe(ROLE_TO_UNIT_ID['engineering']);

    // Idempotent: same set adds nothing.
    expect(s.syncWorkers(ORG_ID, workers, ROLE_TO_UNIT_ID)).toBe(0);

    // Prune: drop one worker → one change, member removed.
    const changed = s.syncWorkers(ORG_ID, [workers[0]], ROLE_TO_UNIT_ID);
    expect(changed).toBe(1);
    expect(s.usersFor(ORG_ID).find((u) => u.workerId === 'w-fin')).toBeUndefined();
  });

  it('claims the owner via claimOwnerIdentity under the first-claim rule', async () => {
    const s = await newStore(tempPath());
    expect(s.claimOwnerIdentity({ name: 'Saurabh Patel', email: 'saurabh@example.com' })).toBe(true);
    const owner = s.user(OWNER_USER_ID);
    expect(owner?.name).toBe('Saurabh Patel');
    expect(owner?.email).toBe('saurabh@example.com');
    // Same account with a new display name refreshes the name only.
    expect(s.claimOwnerIdentity({ name: 'S. Patel', email: 'saurabh@example.com' })).toBe(true);
    expect(s.user(OWNER_USER_ID)?.name).toBe('S. Patel');
    // A different account never rebinds a claimed owner.
    expect(s.claimOwnerIdentity({ name: 'Eve', email: 'eve@evil.test' })).toBe(false);
    expect(s.user(OWNER_USER_ID)?.email).toBe('saurabh@example.com');
  });
});

describe('OrgStore — built-in role reconciliation', () => {
  it('backfills new baseline scopes onto an existing install (upgrade path)', async () => {
    const path = tempPath();
    const T = '2026-01-01T00:00:00.000Z';
    // A pre-P10 persisted install: seeded, but the built-in Owner role predates federation:*.
    const stale = {
      organizations: [{ id: ORG_ID, name: 'NeuroPause', slug: 'neuropause', description: '', createdAt: T, updatedAt: T, metadata: {} }],
      units: [],
      roles: [{ id: 'role-owner', orgId: ORG_ID, name: 'Owner', description: '', permissions: ['org:read'], builtIn: true, createdAt: T, updatedAt: T }],
      users: [],
      seeded: true,
    };
    await fs.writeFile(path, JSON.stringify(stale));
    const s = await newStore(path);
    const owner = s.rolesFor(ORG_ID).find((r) => r.id === 'role-owner')!;
    expect(owner.permissions).toContain('federation:read');
    expect(owner.permissions).toContain('federation:manage');
    expect(owner.permissions).toContain('federation:approve');
    // P11 — the cloud control-plane scopes must backfill on the same upgrade path.
    expect(owner.permissions).toContain('cloud:read');
    expect(owner.permissions).toContain('cloud:manage');
    // P12 — the developer-platform scopes must backfill on the same upgrade path (otherwise an
    // upgraded install would be locked out of the now-RBAC-gated ecosystem:devplatform.* channels).
    expect(owner.permissions).toContain('developer:read');
    expect(owner.permissions).toContain('developer:manage');
    // P13 — the industry-solution read scope must backfill on the same upgrade path.
    expect(owner.permissions).toContain('industry:read');
    // P14 — the autonomous-intelligence (strategy) read scope must backfill on the same upgrade path.
    expect(owner.permissions).toContain('strategy:read');
    // P15 — the digital-twin read scope must backfill on the same upgrade path.
    expect(owner.permissions).toContain('twin:read');
    // P16 — the knowledge-fabric read scope must backfill on the same upgrade path.
    expect(owner.permissions).toContain('knowledge:read');
    // P17 — the global-orchestration read scope must backfill on the same upgrade path.
    expect(owner.permissions).toContain('orchestration:read');
    // P18 — the intelligence-network read scope must backfill on the same upgrade path.
    expect(owner.permissions).toContain('network:read');
    // P19 — the autonomous-operations read scope must backfill on the same upgrade path.
    expect(owner.permissions).toContain('autonomousops:read');
    // P20 — the commercial productization read scope must backfill on the same upgrade path.
    expect(owner.permissions).toContain('commercial:read');
    // Experience Program v1.0 — the decision-first experience read scope must backfill too.
    expect(owner.permissions).toContain('experience:read');
    // Intent Experience Program v2.0 — the intent-native read scope must backfill too.
    expect(owner.permissions).toContain('intent:read');
  });

  it('leaves custom (non-built-in) roles untouched on load', async () => {
    const path = tempPath();
    const T = '2026-01-01T00:00:00.000Z';
    const seeded = {
      organizations: [{ id: ORG_ID, name: 'NeuroPause', slug: 'neuropause', description: '', createdAt: T, updatedAt: T, metadata: {} }],
      units: [],
      roles: [{ id: 'role-custom', orgId: ORG_ID, name: 'Auditor', description: '', permissions: ['org:read'], builtIn: false, createdAt: T, updatedAt: T }],
      users: [],
      seeded: true,
    };
    await fs.writeFile(path, JSON.stringify(seeded));
    const s = await newStore(path);
    const custom = s.rolesFor(ORG_ID).find((r) => r.id === 'role-custom')!;
    expect(custom.permissions).toEqual(['org:read']);
  });
});

describe('OrgStore — persistence', () => {
  it('persists across reloads', async () => {
    const path = tempPath();
    const s1 = await newStore(path);
    s1.createUnit({ orgId: ORG_ID, kind: 'team', name: 'Persisted Team', parentId: UNIT.engineering });
    s1.syncWorkers(ORG_ID, [{ id: 'w1', name: 'Ops AI', role: 'operations' }], ROLE_TO_UNIT_ID);
    await s1.flush();

    const s2 = await newStore(path);
    expect(s2.unitsFor(ORG_ID).some((u) => u.name === 'Persisted Team')).toBe(true);
    expect(s2.usersFor(ORG_ID).some((u) => u.workerId === 'w1')).toBe(true);
  });
});

/**
 * P13C ROUND 10 — NEW-H6, added to the store's OWN suite.
 *
 * The dedicated tenancy suite (`tenancy/round10OrgOwnership.test.ts`) carries
 * the full A/B/C matrix and the exploit chain. These live here because a
 * developer changing `orgStore.ts` runs this file, and the property they must
 * not break should fail in front of them rather than two directories away.
 */
describe('OrgStore — ownership (NEW-H6)', () => {
  /** A store seen through an ATTACKER's session: a different organization. */
  async function asAttacker(path: string): Promise<OrgStore> {
    const s = new OrgStore(path);
    opened.push(s);
    s.bindScope(() => ({ tenantId: 'org-attacker', workspaceId: 'ws-attacker' }));
    await s.load();
    return s;
  }

  it('a foreign tenant cannot rewrite the seeded owner’s email — the takeover', async () => {
    const path = tempPath();
    const victim = await newStore(path);
    const before = victim.user(OWNER_USER_ID)!;
    expect(before.orgId).toBe(ORG_ID);
    // The legitimate first sign-in claims the row — the rule is install-level.
    expect(victim.claimOwnerIdentity({ name: 'Real Owner', email: 'real@example.test' })).toBe(true);
    await victim.flush();

    const attacker = await asAttacker(path);
    expect(attacker.updateUser(OWNER_USER_ID, { email: 'attacker@evil.test' })).toBeNull();
    // Round 32: the second door is shut by the claim rule itself — a claimed
    // owner is never rebound, whatever scope the caller resolves to.
    expect(attacker.claimOwnerIdentity({ name: 'Attacker', email: 'attacker@evil.test' })).toBe(false);

    expect(attacker.user(OWNER_USER_ID)!.email).toBe('real@example.test');
  });

  it('a foreign tenant cannot delete seeded units or members', async () => {
    const path = tempPath();
    const victim = await newStore(path);
    const unitCount = victim.unitsFor(ORG_ID).length;
    const member = victim.createUser({ orgId: ORG_ID, name: 'Real', title: 'Member' });

    const attacker = await asAttacker(path);
    expect(attacker.deleteUnit(UNIT.engineering)).toBe(false);
    expect(attacker.deleteUser(member.id)).toBe(false);
    expect(attacker.setOrganizationStatus(ORG_ID, 'suspended')).toBeNull();

    expect(victim.unitsFor(ORG_ID)).toHaveLength(unitCount);
    expect(victim.usersFor(ORG_ID).some((u) => u.id === member.id)).toBe(true);
    expect(victim.organization(ORG_ID)!.status).not.toBe('suspended');
  });

  it('the owning tenant CAN still do all of it — the gate is not "always no"', async () => {
    const s = await newStore(tempPath());
    const member = s.createUser({ orgId: ORG_ID, name: 'Real', title: 'Member' });
    expect(s.updateUser(member.id, { title: 'Lead' })?.title).toBe('Lead');
    expect(s.deleteUser(member.id)).toBe(true);
    const unit = s.createUnit({ orgId: ORG_ID, kind: 'team', name: 'Mine' });
    expect(s.updateUnit(unit.id, { name: 'Renamed' })?.name).toBe('Renamed');
    expect(s.deleteUnit(unit.id)).toBe(true);
  });
});
