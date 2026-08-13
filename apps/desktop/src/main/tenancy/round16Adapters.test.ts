/**
 * F22 ADAPTERS — WORKFORCE JOBS AND COMPANION DEVICES. P13C ROUND 16.
 *
 * Two adapters that each break the mechanical pattern in a different way, and
 * each break it SILENTLY — which is why they get their own suite rather than a
 * row in a table.
 *
 *   `workforce-jobs`  persists from a parallel `order[]` index, not from the
 *                     Map. A merge that updates `jobs` and forgets `order`
 *                     writes a file MISSING every restored row, with no error,
 *                     and the loss only surfaces on the next reload.
 *
 *   `companion-devices` owns rows by `boundTenantId`. The store holds a
 *                     `TenantOwnership`, but `onlyFor`/`onlyMine` read
 *                     `.tenantId` — a field these rows do not have — so an
 *                     adapter copied from the mechanical shape returns an EMPTY
 *                     archive on every install and never fails.
 *
 * Both failure modes produce a backup that looks fine and contains nothing. That
 * is the class this whole program exists to refuse, so both are asserted by
 * COUNT and by identity, and both have a negative control.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { JobStore } from '../workforce/runtime/jobStore';
import { CompanionDeviceStore } from '../companion/deviceRegistryStore';
import { authorizeTenantRead } from '../tenancy/tenantOwnedStore';
import {
  createTenantArchive,
  restoreTenantArchive,
  registerTenantDomainSource,
  __resetTenantDomainSourcesForTests,
} from '../backup/tenantArchive';
import { workforceJobsSource, companionDevicesSource } from '../backup/tenantDomainSources';

const A = 'org-a';
const B = 'org-b';

const OP = { tenantId: 'org-platform', platformOperator: true };
const as = (t: string): TenantScope => ({ tenantId: t, workspaceId: `ws-${t}` });

let dir: string;
let jobs: JobStore;
let devices: CompanionDeviceStore;
let who: TenantScope | null = null;

beforeEach(async () => {
  dir = join(tmpdir(), `np-r16-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  jobs = new JobStore(join(dir, 'jobs.json')).bindScope(() => who);
  await jobs.load();
  devices = new CompanionDeviceStore(join(dir, 'devices.json')).bindScope(() => who);
  await devices.load();
  __resetTenantDomainSourcesForTests();
  registerTenantDomainSource(workforceJobsSource(jobs as never));
  registerTenantDomainSource(companionDevicesSource(devices as never));
  who = null;
});
afterEach(async () => {
  __resetTenantDomainSourcesForTests();
  await jobs.flush().catch(() => undefined);
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
});

function addJobs(tenant: string, n: number): string[] {
  who = as(tenant);
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = `${tenant}-job-${i}`;
    jobs.put({
      id,
      kind: 'test',
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
    ids.push(id);
  }
  who = null;
  return ids;
}

async function pair(tenant: string, n: number): Promise<void> {
  who = as(tenant);
  for (let i = 0; i < n; i += 1) {
    await devices.register({
      name: `${tenant}-phone-${i}`,
      platform: 'ios',
      model: 'iPhone17,1',
      publicKeyB64: `PK-${tenant}-${i}`,
      boundMember: `${tenant}@example.test`,
      boundTenantId: null,
      now: '2026-08-12T00:00:00.000Z',
    });
  }
  who = null;
}

describe('workforce jobs — the order[] index survives a round trip', () => {
  it('A’s archive holds A’s jobs only', async () => {
    addJobs(A, 3);
    addJobs(B, 2);
    const archive = await createTenantArchive(authorizeTenantRead(OP, A), 'now', 'bk');
    expect(archive.data['workforce-jobs']).toHaveLength(3);
    expect(JSON.stringify(archive)).not.toContain('org-b-job');
  });

  it('restore rebuilds order[] so the merge actually reaches DISK', async () => {
    addJobs(A, 3);
    addJobs(B, 2);
    const grantA = authorizeTenantRead(OP, A);
    const archive = await createTenantArchive(grantA, 'now', 'bk');

    addJobs(A, 2); // A drifts to 5
    expect((await restoreTenantArchive(grantA, archive)).ok).toBe(true);

    // THE order[] ASSERTION: a fresh store over the same file must see them.
    const reopened = new JobStore(join(dir, 'jobs.json')).bindScope(() => who);
    await reopened.load();
    who = as(A);
    expect(reopened.page({ limit: 100 }).jobs).toHaveLength(3);
    who = as(B);
    expect(reopened.page({ limit: 100 }).jobs).toHaveLength(2);
    who = null;
  });

  /**
   * THE order[] HAZARD, EXERCISED PROPERLY.
   *
   * My first version of this suite did NOT catch it: the restored ids were the
   * same ids already sitting in `order`, so a merge that forgot to rebuild the
   * index still produced a correct file, and the negative control passed. That
   * is a test proving nothing, which is worse than no test.
   *
   * The hazard needs a restored id that is ABSENT from `order` — exactly what
   * happens when a job is pruned between backup and restore. `persist()`
   * serializes `order.map(id => jobs.get(id))`, so such a row lives in the Map,
   * is invisible to the writer, and disappears at the next write with no error.
   */
  it('a job pruned after backup is restored INTO order[], not just into the Map', async () => {
    const aIds = addJobs(A, 3);
    addJobs(B, 2);
    const grantA = authorizeTenantRead(OP, A);
    const archive = await createTenantArchive(grantA, 'now', 'bk');

    // Simulate retention removing one of A's jobs from both structures.
    const store = jobs as unknown as { jobs: Map<string, unknown>; order: string[] };
    store.jobs.delete(aIds[0]!);
    store.order = store.order.filter((id) => id !== aIds[0]!);

    expect((await restoreTenantArchive(grantA, archive)).ok).toBe(true);

    const reopened = new JobStore(join(dir, 'jobs.json')).bindScope(() => who);
    await reopened.load();
    who = as(A);
    // All three must come back THROUGH THE FILE, which means through order[].
    expect(reopened.page({ limit: 100 }).jobs.map((j) => j.id).sort()).toEqual([...aIds].sort());
    who = null;
  });

  it('B’s jobs keep their positions, not just their existence', async () => {
    const bIds = addJobs(B, 3);
    addJobs(A, 2);
    const grantA = authorizeTenantRead(OP, A);
    const archive = await createTenantArchive(grantA, 'now', 'bk');
    await restoreTenantArchive(grantA, archive);

    const reopened = new JobStore(join(dir, 'jobs.json')).bindScope(() => who);
    await reopened.load();
    who = as(B);
    // `page()` returns newest-first, so the expected order is the reverse of
    // insertion — asserting the ORDER, not merely the set, is the point: a merge
    // that rebuilt `order[]` wrongly would still return the right three ids.
    expect(reopened.page({ limit: 100 }).jobs.map((j) => j.id)).toEqual([...bIds].reverse());
    who = null;
  });
});

describe('companion devices — owned by boundTenantId, not tenantId', () => {
  it('A’s archive is NOT empty — the trap this adapter avoids', async () => {
    await pair(A, 2);
    await pair(B, 3);
    const archive = await createTenantArchive(authorizeTenantRead(OP, A), 'now', 'bk');
    // An adapter reading `.tenantId` would produce 0 here and never fail.
    expect(archive.data['companion-device-registry']).toHaveLength(2);
    expect(JSON.stringify(archive)).not.toContain('org-b@example.test');
  });

  it('restore preserves B’s devices', async () => {
    await pair(A, 2);
    await pair(B, 3);
    const grantA = authorizeTenantRead(OP, A);
    const archive = await createTenantArchive(grantA, 'now', 'bk');
    await pair(A, 1); // A drifts to 3
    expect((await restoreTenantArchive(grantA, archive)).ok).toBe(true);

    who = as(A);
    expect(devices.list()).toHaveLength(2);
    who = as(B);
    expect(devices.list()).toHaveLength(3);
    who = null;
  });

  it('the merge does not disturb the gateway settings persisted beside the rows', async () => {
    await devices.setEnabled(true);
    await pair(A, 1);
    const grantA = authorizeTenantRead(OP, A);
    const archive = await createTenantArchive(grantA, 'now', 'bk');
    await restoreTenantArchive(grantA, archive);
    // `persist()` writes `enabled`/`port` alongside the devices; a restore must
    // not switch another organization's companion gateway off.
    expect(devices.isEnabled()).toBe(true);
  });

  it('an unowned device belongs to nobody and is never archived', async () => {
    who = null;
    await devices.register({
      name: 'orphan',
      platform: 'ios',
      model: 'x',
      publicKeyB64: 'PK-orphan',
      boundMember: null,
      boundTenantId: null,
      mintedTenantId: null,
      now: '2026-08-12T00:00:00.000Z',
    });
    await pair(A, 1);
    const archive = await createTenantArchive(authorizeTenantRead(OP, A), 'now', 'bk');
    expect(archive.data['companion-device-registry']).toHaveLength(1);
    expect(JSON.stringify(archive)).not.toContain('orphan');
  });
});

describe('cross-tenant restore is refused on both new domains', () => {
  it('a grant for A cannot restore B’s archive', async () => {
    addJobs(A, 1);
    addJobs(B, 2);
    await pair(B, 1);
    const bArchive = await createTenantArchive(authorizeTenantRead(OP, B), 'now', 'bk-b');
    const res = await restoreTenantArchive(authorizeTenantRead(OP, A), bArchive);
    expect(res.refusal).toBe('TENANT_MISMATCH');
  });

  it('a relabelled B archive is caught by the row owner on both domains', async () => {
    addJobs(B, 2);
    await pair(B, 2);
    const bArchive = await createTenantArchive(authorizeTenantRead(OP, B), 'now', 'bk-b');
    bArchive.manifest.tenantId = A;
    expect((await restoreTenantArchive(authorizeTenantRead(OP, A), bArchive)).refusal).toBe(
      'ROW_OWNER_MISMATCH',
    );
    who = as(B);
    expect(devices.list()).toHaveLength(2);
    who = null;
  });
});
