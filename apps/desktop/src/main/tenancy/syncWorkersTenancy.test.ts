/**
 * P13C REMEDIATION — FINDING 1. The AI workforce, per tenant.
 *
 * `syncWorkers` took no tenant and resolved its organization with
 * `defaultOrg()`. That produced three distinct cross-tenant defects from one
 * line, and the third was not in the original report:
 *
 *   WRITE  — every tenant's workers became members of the first organization
 *   UPDATE — the "existing worker" index scanned every organization
 *   DELETE — so did the prune loop, so syncing tenant A's worker list REMOVED
 *            tenant B's AI members whose ids were absent from A's
 *
 * The delete is the one these tests are most careful about: it is silent, it is
 * destructive, and nothing else in the system would have reported it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OrgStore } from '../enterprise/org/orgStore';
import { ORG_ID, ROLE_TO_UNIT_ID } from '../enterprise/org/seed';

const dirs: string[] = [];
const stores: OrgStore[] = [];

async function store(): Promise<OrgStore> {
  const dir = join(tmpdir(), `np-workers-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  dirs.push(dir);
  const s = new OrgStore(join(dir, 'org.json'));
  await s.load();
  stores.push(s);
  return s;
}

afterEach(async () => {
  /**
   * FLUSH BEFORE REMOVING.
   *
   * `OrgStore` persists on a debounce through a temp-file rename, so removing
   * the directory while a write is in flight raises ENOTEMPTY from the rename
   * landing after the rmdir. That is a race in the TEST's cleanup, not in the
   * store — draining first makes the teardown deterministic instead of making
   * the suite flaky in a way someone would later "fix" by loosening it.
   */
  for (const s of stores.splice(0)) await s.flush().catch(() => {});
  for (const d of dirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

/** A second, independently created organization. */
function secondOrg(s: OrgStore): string {
  return s.createOrganization('Northwind Health', '').id;
}

const workerA = { id: 'w-alpha', name: 'Alpha Engineer AI', role: 'engineering' };
const workerB = { id: 'w-north', name: 'Northwind Ops AI', role: 'operations' };

const aiMembers = (s: OrgStore, orgId: string) =>
  s.usersFor(orgId).filter((u) => u.kind === 'ai_worker');

describe('a worker is folded into the organization it is synced for', () => {
  it('puts A’s worker in A and B’s worker in B', async () => {
    const s = await store();
    const B = secondOrg(s);

    s.syncWorkers(ORG_ID, [workerA], ROLE_TO_UNIT_ID);
    s.syncWorkers(B, [workerB], ROLE_TO_UNIT_ID);

    expect(aiMembers(s, ORG_ID).map((u) => u.workerId)).toEqual(['w-alpha']);
    expect(aiMembers(s, B).map((u) => u.workerId)).toEqual(['w-north']);
  });

  it('never writes a member into an organization it was not called for', async () => {
    const s = await store();
    const B = secondOrg(s);
    s.syncWorkers(B, [workerB], ROLE_TO_UNIT_ID);
    expect(aiMembers(s, ORG_ID)).toEqual([]);
  });

  /**
   * THE UNREPORTED DEFECT. Before the fix, this call would delete B's AI member
   * because `w-north` is absent from A's worker list.
   */
  it('syncing A does NOT delete B’s AI members', async () => {
    const s = await store();
    const B = secondOrg(s);
    s.syncWorkers(B, [workerB], ROLE_TO_UNIT_ID);
    expect(aiMembers(s, B)).toHaveLength(1);

    s.syncWorkers(ORG_ID, [workerA], ROLE_TO_UNIT_ID);

    expect(aiMembers(s, B).map((u) => u.workerId)).toEqual(['w-north']);
  });

  it('syncing A does NOT rename or re-file a worker recorded in B', async () => {
    const s = await store();
    const B = secondOrg(s);
    // The SAME catalogue worker present in both tenants — the update path.
    s.syncWorkers(B, [{ ...workerA, name: 'B-SIDE NAME' }], ROLE_TO_UNIT_ID);
    s.syncWorkers(ORG_ID, [{ ...workerA, name: 'A-SIDE NAME' }], ROLE_TO_UNIT_ID);

    expect(aiMembers(s, B).map((u) => u.name)).toEqual(['B-SIDE NAME']);
    expect(aiMembers(s, ORG_ID).map((u) => u.name)).toEqual(['A-SIDE NAME']);
  });

  it('prunes WITHIN a tenant when its own worker disappears', async () => {
    const s = await store();
    s.syncWorkers(ORG_ID, [workerA], ROLE_TO_UNIT_ID);
    expect(aiMembers(s, ORG_ID)).toHaveLength(1);
    s.syncWorkers(ORG_ID, [], ROLE_TO_UNIT_ID);
    expect(aiMembers(s, ORG_ID)).toEqual([]);
  });
});

describe('fail-closed', () => {
  it('an unknown organization writes NOTHING, rather than falling back', async () => {
    const s = await store();
    const before = s.usersFor(ORG_ID).length;

    expect(s.syncWorkers('org_does_not_exist', [workerA], ROLE_TO_UNIT_ID)).toBe(0);

    expect(s.usersFor(ORG_ID)).toHaveLength(before);
    expect(aiMembers(s, ORG_ID)).toEqual([]);
  });

  it('an empty organization id writes nothing', async () => {
    const s = await store();
    expect(s.syncWorkers('', [workerA], ROLE_TO_UNIT_ID)).toBe(0);
    expect(aiMembers(s, ORG_ID)).toEqual([]);
  });

  /**
   * `ROLE_TO_UNIT_ID` maps a worker role onto the SEEDED unit ids, so outside
   * the seeded organization that lookup finds a unit somebody else owns. The
   * member is left unfiled rather than filed under another tenant's department.
   */
  it('does not file a member into a unit owned by another organization', async () => {
    const s = await store();
    const B = secondOrg(s);
    s.syncWorkers(B, [workerA], ROLE_TO_UNIT_ID);

    const member = aiMembers(s, B)[0];
    expect(member).toBeDefined();
    if (member?.unitId != null) {
      expect(s.unit(member.unitId)?.orgId).toBe(B);
    }
  });
});
