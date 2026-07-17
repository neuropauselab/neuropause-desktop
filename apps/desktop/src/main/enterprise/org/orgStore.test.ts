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

async function newStore(path: string): Promise<OrgStore> {
  const s = new OrgStore(path);
  opened.push(s);
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

    s.syncWorkers([{ id: 'w1', name: 'Eng AI', role: 'engineering' }], ROLE_TO_UNIT_ID);
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
    const added = s.syncWorkers(workers, ROLE_TO_UNIT_ID);
    expect(added).toBe(2);
    const eng = s.usersFor(ORG_ID).find((u) => u.workerId === 'w-eng');
    expect(eng?.unitId).toBe(ROLE_TO_UNIT_ID['engineering']);

    // Idempotent: same set adds nothing.
    expect(s.syncWorkers(workers, ROLE_TO_UNIT_ID)).toBe(0);

    // Prune: drop one worker → one change, member removed.
    const changed = s.syncWorkers([workers[0]], ROLE_TO_UNIT_ID);
    expect(changed).toBe(1);
    expect(s.usersFor(ORG_ID).find((u) => u.workerId === 'w-fin')).toBeUndefined();
  });

  it('renames the owner via setOwnerIdentity', async () => {
    const s = await newStore(tempPath());
    s.setOwnerIdentity('Saurabh Patel', 'saurabh@example.com');
    const owner = s.user(OWNER_USER_ID);
    expect(owner?.name).toBe('Saurabh Patel');
    expect(owner?.email).toBe('saurabh@example.com');
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
    s1.syncWorkers([{ id: 'w1', name: 'Ops AI', role: 'operations' }], ROLE_TO_UNIT_ID);
    await s1.flush();

    const s2 = await newStore(path);
    expect(s2.unitsFor(ORG_ID).some((u) => u.name === 'Persisted Team')).toBe(true);
    expect(s2.usersFor(ORG_ID).some((u) => u.workerId === 'w1')).toBe(true);
  });
});
