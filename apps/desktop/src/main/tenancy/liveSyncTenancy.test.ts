/**
 * P13C ROUND 9 — F17 + F3. THE LIVE-SYNC ENGINE, PROVED ISOLATED WITH REAL DATA.
 *
 * WHAT WAS WRONG
 *
 * `cloud/livesync/store.ts` is ONE JSON file under userData holding the pending
 * record mutations of EVERY organization signed in on the machine, and it
 * declared nothing and enforced nothing. It was invisible to the structural scope
 * gate — that gate detects persistence and then demands a declaration, but its
 * retained-state probe looks for a `private` class field and this store's state is
 * a `let` inside a factory closure. The organization was an ARGUMENT on every
 * method, so naming another one read its queue, drained it, or rewound its pull
 * cursor. Its twin `mirror.ts` had the same shape, and the engine above them kept
 * ONE cursor, ONE backlog, ONE conflict log and ONE pause flag for the whole
 * install, all readable on `cloud:read` and the pause writable on `cloud:manage`
 * — a permission every organization's own administrator holds.
 *
 * WHY THIS SUITE IS SHAPED LIKE THIS
 *
 * A suite that mocks the store, or asserts `A !== B` over empty fixtures, proves
 * nothing: before the fix, `listPending('org-b')` returned org-b's rows and every
 * "different id" assertion still passed. So this one uses the REAL store, the REAL
 * mirror and the REAL service over REAL temp files, writes DIFFERENT NON-ZERO
 * COUNTS for three organizations (3, 7, 11 — chosen so a wrong answer is a wrong
 * NUMBER rather than a wrong boolean), and asserts the allowed read is non-empty
 * before asserting the denied one is empty. A boundary that denies everybody is
 * not isolation, it is an outage.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MergeOutcome, SyncChange, TenantScope } from '@neuropause/shared';
import { recordInScope } from '@neuropause/shared';
import { createPersistentSyncStore, type PersistentSyncStore } from '../cloud/livesync/store';
import { createLocalSyncMirror } from '../cloud/livesync/mirror';
import { createLiveSyncService, type LiveSyncService } from '../cloud/livesync/liveSyncService';
import type { SyncTransport } from '../cloud/livesync/types';

/** Three organizations on one machine. Distinct ids, distinct workspaces. */
const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-alpha' };
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-bravo' };
const C: TenantScope = { tenantId: 'org-charlie', workspaceId: 'ws-charlie' };

/** The named counts. A wrong boundary produces a wrong number, not a wrong flag. */
const A_COUNT = 3;
const B_COUNT = 7;
const C_COUNT = 11;

function changeFor(scope: TenantScope, entityId: string, seconds = 0): SyncChange {
  return {
    entityType: 'org_prefs',
    entityId,
    orgId: scope.tenantId,
    version: 1,
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(),
    deleted: false,
    data: { note: `${scope.tenantId}:${entityId}` },
  };
}

describe('live-sync pending mutations belong to one organization', () => {
  let filePath: string;
  let acting: TenantScope | null;
  let store: PersistentSyncStore;
  const scope = (): TenantScope | null => acting;
  const applyLocal = async (): Promise<MergeOutcome> => 'applied';

  /** Act as `who` for the duration of `fn`. Mirrors an IPC call by that tenant. */
  async function as<T>(who: TenantScope | null, fn: () => Promise<T> | T): Promise<T> {
    const previous = acting;
    acting = who;
    try {
      return await fn();
    } finally {
      acting = previous;
    }
  }

  async function queue(who: TenantScope, count: number, offset = 0): Promise<void> {
    await as(who, async () => {
      for (let i = 1; i <= count; i += 1) {
        await store.enqueue(who.tenantId, changeFor(who, `${who.tenantId}-e${i}`, offset + i));
      }
    });
  }

  beforeEach(async () => {
    filePath = join(tmpdir(), `nps-livesync-tenancy-${randomUUID()}.json`);
    acting = null;
    store = createPersistentSyncStore({ filePath, applyLocal }).bindScope(scope);
    await store.load();
    await queue(A, A_COUNT);
    await queue(B, B_COUNT, 100);
    await queue(C, C_COUNT, 200);
  });
  afterEach(async () => {
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.tmp`, { force: true });
  });

  it('each organization sees exactly its own rows: A=3, B=7, C=11', async () => {
    expect(await as(A, () => store.listPending(A.tenantId))).toHaveLength(A_COUNT);
    expect(await as(B, () => store.listPending(B.tenantId))).toHaveLength(B_COUNT);
    expect(await as(C, () => store.listPending(C.tenantId))).toHaveLength(C_COUNT);

    expect(await as(A, () => store.pendingCount(A.tenantId))).toBe(A_COUNT);
    expect(await as(B, () => store.pendingCount(B.tenantId))).toBe(B_COUNT);
    expect(await as(C, () => store.pendingCount(C.tenantId))).toBe(C_COUNT);

    // All 21 rows really are in the one file — the isolation is enforced, not
    // an artefact of the data never having been written.
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      queues: Record<string, { tenantId?: string }[]>;
    };
    const total = Object.values(raw.queues).reduce((n, rows) => n + rows.length, 0);
    expect(total).toBe(A_COUNT + B_COUNT + C_COUNT);
  });

  it('a row read by its owner is the owner’s own content, not a count of nothing', async () => {
    const rows = await as(A, () => store.listPending(A.tenantId));
    expect(rows).toHaveLength(A_COUNT);
    for (const row of rows) {
      expect(row.change.orgId).toBe(A.tenantId);
      expect(row.change.data).toMatchObject({ note: expect.stringContaining(A.tenantId) });
    }
  });

  it('every persisted row carries an owner, and recordInScope agrees with the store', async () => {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      queues: Record<string, { tenantId?: string | null }[]>;
    };
    const rows = Object.values(raw.queues).flat();
    expect(rows).toHaveLength(A_COUNT + B_COUNT + C_COUNT);
    // The house predicate, applied to the rows as they sit on disk.
    expect(rows.filter((r) => recordInScope(r, A))).toHaveLength(A_COUNT);
    expect(rows.filter((r) => recordInScope(r, B))).toHaveLength(B_COUNT);
    expect(rows.filter((r) => recordInScope(r, C))).toHaveLength(C_COUNT);
    expect(rows.every((r) => typeof r.tenantId === 'string' && r.tenantId !== '')).toBe(true);
  });

  it('A reads A (ALLOWED, non-empty) and A reads B and C (DENIED, empty)', async () => {
    await as(A, async () => {
      expect(await store.listPending(A.tenantId)).toHaveLength(A_COUNT);
      expect(await store.listPending(B.tenantId)).toEqual([]);
      expect(await store.listPending(C.tenantId)).toEqual([]);
      expect(store.pendingCount(B.tenantId)).toBe(0);
      expect(store.pendingSnapshot(C.tenantId)).toEqual([]);
    });
  });

  it('B reads B (ALLOWED, non-empty) and B reads A and C (DENIED, empty)', async () => {
    await as(B, async () => {
      expect(await store.listPending(B.tenantId)).toHaveLength(B_COUNT);
      expect(await store.listPending(A.tenantId)).toEqual([]);
      expect(await store.listPending(C.tenantId)).toEqual([]);
    });
  });

  it('C reads C (ALLOWED, non-empty) and C reads A and B (DENIED, empty)', async () => {
    await as(C, async () => {
      expect(await store.listPending(C.tenantId)).toHaveLength(C_COUNT);
      expect(await store.listPending(A.tenantId)).toEqual([]);
      expect(await store.listPending(B.tenantId)).toEqual([]);
    });
  });

  it('A cannot MUTATE B: enqueue, drain and cursor are all refused, and B is intact', async () => {
    const bRows = await as(B, () => store.listPending(B.tenantId));
    const bIds = bRows.map((r) => r.queueId);

    await as(A, async () => {
      await expect(store.enqueue(B.tenantId, changeFor(B, 'planted'))).rejects.toThrow(
        /not the active organization/i,
      );
      await expect(store.enqueue(A.tenantId, changeFor(B, 'planted'))).rejects.toThrow(
        /not the active organization/i,
      );
      await expect(store.removePending(B.tenantId, bIds)).rejects.toThrow(/not the active/i);
      await expect(store.setCursor(B.tenantId, 999)).rejects.toThrow(/not the active/i);
      // Draining under A's OWN id, but naming B's queue ids, reaches nothing.
      await store.removePending(A.tenantId, bIds);
    });

    await as(B, async () => {
      expect(await store.listPending(B.tenantId)).toHaveLength(B_COUNT);
      expect(await store.getCursor(B.tenantId)).toBe(0);
    });
    // A's own rows are untouched by its failed attempts.
    expect(await as(A, () => store.listPending(A.tenantId))).toHaveLength(A_COUNT);
  });

  it('B cannot MUTATE A: symmetric, with A intact afterwards', async () => {
    const aIds = (await as(A, () => store.listPending(A.tenantId))).map((r) => r.queueId);
    await as(A, () => store.setCursor(A.tenantId, 42));

    await as(B, async () => {
      await expect(store.enqueue(A.tenantId, changeFor(A, 'planted'))).rejects.toThrow(
        /not the active organization/i,
      );
      await expect(store.removePending(A.tenantId, aIds)).rejects.toThrow(/not the active/i);
      await expect(store.setCursor(A.tenantId, 0)).rejects.toThrow(/not the active/i);
      await store.removePending(B.tenantId, aIds);
    });

    await as(A, async () => {
      expect(await store.listPending(A.tenantId)).toHaveLength(A_COUNT);
      expect(await store.getCursor(A.tenantId)).toBe(42);
    });
    expect(await as(B, () => store.listPending(B.tenantId))).toHaveLength(B_COUNT);
  });

  it('an unresolved caller reads nothing and writes nothing, while the rows survive', async () => {
    await as(null, async () => {
      expect(await store.listPending(A.tenantId)).toEqual([]);
      expect(await store.getCursor(A.tenantId)).toBe(0);
      await expect(store.enqueue(A.tenantId, changeFor(A, 'x'))).rejects.toThrow(/no owner/i);
      await expect(store.removePending(A.tenantId, ['anything'])).rejects.toThrow(/not the active/i);
    });
    expect(await as(A, () => store.listPending(A.tenantId))).toHaveLength(A_COUNT);
  });

  /* ── RESTART. The store is a file, so the boundary has to survive one. ──── */

  it('after a reload from disk the counts are still 3 / 7 / 11 and still separate', async () => {
    const reopened = createPersistentSyncStore({ filePath, applyLocal }).bindScope(scope);
    await reopened.load();

    expect(await as(A, () => reopened.listPending(A.tenantId))).toHaveLength(A_COUNT);
    expect(await as(B, () => reopened.listPending(B.tenantId))).toHaveLength(B_COUNT);
    expect(await as(C, () => reopened.listPending(C.tenantId))).toHaveLength(C_COUNT);

    await as(A, async () => {
      expect(await reopened.listPending(B.tenantId)).toEqual([]);
      expect(await reopened.listPending(C.tenantId)).toEqual([]);
    });
    await as(C, async () => {
      expect(await reopened.listPending(A.tenantId)).toEqual([]);
      expect(await reopened.listPending(B.tenantId)).toEqual([]);
    });
  });

  it('cursors survive a restart per organization and stay unreadable across one', async () => {
    await as(A, () => store.setCursor(A.tenantId, 11));
    await as(B, () => store.setCursor(B.tenantId, 22));

    const reopened = createPersistentSyncStore({ filePath, applyLocal }).bindScope(scope);
    await reopened.load();
    expect(await as(A, () => reopened.getCursor(A.tenantId))).toBe(11);
    expect(await as(B, () => reopened.getCursor(B.tenantId))).toBe(22);
    expect(await as(A, () => reopened.getCursor(B.tenantId))).toBe(0);
    expect(await as(C, () => reopened.getCursor(A.tenantId))).toBe(0);
  });

  /* ── RETENTION. A cap is a WRITE, so whose rows it reaches is the question. ─ */

  it('A’s retention cap evicts A’s oldest rows and NONE of B’s or C’s', async () => {
    // A cap of 2 with A holding 3 rows: one of A's must go. B's and C's rows are
    // OLDER in file order for B (queued first at offset 100 vs 200) and B's are
    // the oldest by timestamp among the survivors — an install-wide oldest-first
    // cap would take one of theirs.
    const capped = createPersistentSyncStore({
      filePath,
      applyLocal,
      maxPendingPerOrg: 2,
    }).bindScope(scope);
    await capped.load();

    await as(A, () => capped.enqueue(A.tenantId, changeFor(A, 'a-newest', 50)));

    const aRows = await as(A, () => capped.listPending(A.tenantId));
    expect(aRows).toHaveLength(2);
    expect(aRows.map((r) => r.change.entityId)).toEqual([`${A.tenantId}-e3`, 'a-newest']);

    expect(await as(B, () => capped.listPending(B.tenantId))).toHaveLength(B_COUNT);
    expect(await as(C, () => capped.listPending(C.tenantId))).toHaveLength(C_COUNT);

    // And the eviction is durable in the same file, without touching the others.
    const reopened = createPersistentSyncStore({ filePath, applyLocal }).bindScope(scope);
    await reopened.load();
    expect(await as(A, () => reopened.listPending(A.tenantId))).toHaveLength(2);
    expect(await as(B, () => reopened.listPending(B.tenantId))).toHaveLength(B_COUNT);
    expect(await as(C, () => reopened.listPending(C.tenantId))).toHaveLength(C_COUNT);
  });

  it('a flood by one organization cannot push another organization’s rows out', async () => {
    const capped = createPersistentSyncStore({
      filePath,
      applyLocal,
      maxPendingPerOrg: 4,
    }).bindScope(scope);
    await capped.load();

    await as(C, async () => {
      for (let i = 0; i < 200; i += 1) {
        await capped.enqueue(C.tenantId, changeFor(C, `flood-${i}`, 1000 + i));
      }
    });

    expect(await as(C, () => capped.listPending(C.tenantId))).toHaveLength(4);
    expect(await as(A, () => capped.listPending(A.tenantId))).toHaveLength(A_COUNT);
    expect(await as(B, () => capped.listPending(B.tenantId))).toHaveLength(B_COUNT);
  });
});

/* ── The whole engine: queue + mirror + cursor + egress toggle. ──────────── */

describe('the live-sync service isolates status, mirror and the egress toggle', () => {
  let storePath: string;
  let mirrorPath: string;
  let acting: TenantScope | null;
  let svc: LiveSyncService;
  let pushedByOrg: Record<string, number>;
  const scope = (): TenantScope | null => acting;

  const transport: SyncTransport = {
    async push(orgId, _deviceId, changes) {
      pushedByOrg[orgId] = (pushedByOrg[orgId] ?? 0) + changes.length;
      return {
        results: changes.map((c) => ({
          entityType: c.entityType,
          entityId: c.entityId,
          status: 'applied' as const,
          serverVersion: c.version,
          serverUpdatedAt: c.updatedAt,
        })),
        cursor: 0,
      };
    },
    async pull(orgId) {
      // The backend answers with that organization's own record, plus — because
      // a backend is not trusted to name organizations — one belonging to
      // somebody else.
      return {
        changes: [
          { ...changeFor({ tenantId: orgId, workspaceId: '' }, 'landed', 5), version: 4 },
          { ...changeFor(C, 'cross-tenant-plant', 6), version: 9 },
        ],
        cursor: orgId === A.tenantId ? 31 : 62,
        hasMore: false,
      };
    },
  };

  async function as<T>(who: TenantScope | null, fn: () => Promise<T> | T): Promise<T> {
    const previous = acting;
    acting = who;
    try {
      return await fn();
    } finally {
      acting = previous;
    }
  }

  beforeEach(async () => {
    storePath = join(tmpdir(), `nps-livesync-svc-${randomUUID()}.json`);
    mirrorPath = join(tmpdir(), `nps-livesync-mirror-${randomUUID()}.json`);
    pushedByOrg = {};
    acting = null;
    svc = createLiveSyncService({
      deviceId: 'device-1',
      storeFilePath: storePath,
      mirrorFilePath: mirrorPath,
      transport,
      // The DEVICE pointer says A, permanently and wrongly for B and C. That is
      // the stale-pointer case F3 is about: it must not decide anybody's read.
      getActiveOrgId: () => A.tenantId,
      scope,
      intervalMs: 999_999,
    });
    await svc.init();
  });
  afterEach(async () => {
    svc.stop();
    for (const p of [storePath, mirrorPath]) {
      await fs.rm(p, { force: true });
      await fs.rm(`${p}.tmp`, { force: true });
    }
  });

  it('status and detail report the CALLER’s counts: A=3, B=7, C=11', async () => {
    for (const [who, count] of [
      [A, A_COUNT],
      [B, B_COUNT],
      [C, C_COUNT],
    ] as const) {
      await as(who, async () => {
        for (let i = 1; i <= count; i += 1) {
          await svc.enqueue(who.tenantId, changeFor(who, `${who.tenantId}-e${i}`, i));
        }
      });
    }

    expect(await as(A, () => svc.getStatus().pendingCount)).toBe(A_COUNT);
    expect(await as(B, () => svc.getStatus().pendingCount)).toBe(B_COUNT);
    expect(await as(C, () => svc.getStatus().pendingCount)).toBe(C_COUNT);

    const aDetail = await as(A, () => svc.getDetail());
    expect(aDetail.orgId).toBe(A.tenantId);
    expect(aDetail.entities.reduce((n, e) => n + e.pending, 0)).toBe(A_COUNT);
    const cDetail = await as(C, () => svc.getDetail());
    expect(cDetail.entities.reduce((n, e) => n + e.pending, 0)).toBe(C_COUNT);
  });

  it('a synced organization’s cursor and mirrored records are invisible to the others', async () => {
    await as(A, async () => {
      await svc.enqueue(A.tenantId, changeFor(A, 'a-1', 1));
      await svc.syncNow();
    });

    await as(A, () => {
      expect(svc.getStatus().cursor).toBe(31);
      expect(svc.list(A.tenantId)).toHaveLength(1);
      expect(svc.read(A.tenantId, 'org_prefs', 'landed')).not.toBeNull();
      // The backend's cross-tenant plant landed nowhere.
      expect(svc.read(A.tenantId, 'org_prefs', 'cross-tenant-plant')).toBeNull();
    });

    await as(B, () => {
      expect(svc.getStatus().cursor).toBe(0);
      expect(svc.getStatus().lastSyncedAt).toBeNull();
      expect(svc.list(A.tenantId)).toEqual([]);
      expect(svc.read(A.tenantId, 'org_prefs', 'landed')).toBeNull();
      expect(svc.getDetail().entities.every((e) => e.synced === 0)).toBe(true);
    });

    // Not even the organization the plant NAMED can see it: it was never filed.
    await as(C, () => {
      expect(svc.read(C.tenantId, 'org_prefs', 'cross-tenant-plant')).toBeNull();
      expect(svc.list(C.tenantId)).toEqual([]);
    });
  });

  it('THE EGRESS TOGGLE: A pausing does not stop B, and A cannot resume B', async () => {
    await as(A, async () => {
      await svc.enqueue(A.tenantId, changeFor(A, 'a-1', 1));
      svc.setOnline(false);
    });
    await as(B, async () => {
      await svc.enqueue(B.tenantId, changeFor(B, 'b-1', 2));
      svc.setOnline(false);
    });

    // A resumes ITSELF and syncs. B stays paused, and nothing of B's leaves.
    await as(A, async () => {
      svc.setOnline(true);
      await svc.syncNow();
    });
    expect(pushedByOrg[A.tenantId]).toBe(1);
    expect(pushedByOrg[B.tenantId]).toBeUndefined();

    await as(B, async () => {
      expect(svc.getStatus().state).toBe('offline');
      expect(svc.getStatus().pendingCount).toBe(1); // still queued on the device
      await svc.syncNow();
    });
    expect(pushedByOrg[B.tenantId]).toBeUndefined();

    // …and B resuming itself works, which proves the pause was real rather than
    // a store that denies everyone.
    await as(B, async () => {
      svc.setOnline(true);
      await svc.syncNow();
      expect(svc.getStatus().state).toBe('idle');
    });
    expect(pushedByOrg[B.tenantId]).toBe(1);
  });

  it('A pausing does not stop C, whose sync is untouched throughout', async () => {
    await as(A, () => svc.setOnline(false));
    await as(C, async () => {
      await svc.enqueue(C.tenantId, changeFor(C, 'c-1', 3));
      expect(svc.getStatus().state).toBe('idle');
      await svc.syncNow();
      expect(svc.getStatus().cursor).toBe(62);
    });
    expect(pushedByOrg[C.tenantId]).toBe(1);
    expect(pushedByOrg[A.tenantId]).toBeUndefined();
  });

  it('the mirror survives a restart with each organization still reading only its own', async () => {
    await as(A, () => svc.syncNow());
    await as(B, () => svc.syncNow());

    const reopened = createLiveSyncService({
      deviceId: 'device-1',
      storeFilePath: storePath,
      mirrorFilePath: mirrorPath,
      transport,
      getActiveOrgId: () => A.tenantId,
      scope,
      intervalMs: 999_999,
    });
    await reopened.init();

    await as(A, () => {
      expect(reopened.list(A.tenantId)).toHaveLength(1);
      expect(reopened.read(A.tenantId, 'org_prefs', 'landed')?.orgId).toBe(A.tenantId);
      expect(reopened.list(B.tenantId)).toEqual([]);
    });
    await as(B, () => {
      expect(reopened.list(B.tenantId)).toHaveLength(1);
      expect(reopened.read(B.tenantId, 'org_prefs', 'landed')?.orgId).toBe(B.tenantId);
      expect(reopened.list(A.tenantId)).toEqual([]);
      expect(reopened.read(A.tenantId, 'org_prefs', 'landed')).toBeNull();
    });
    reopened.stop();
  });
});

/* ── The declarations themselves. F17 asks for classification, not just a fix. ─ */

describe('the live-sync stores declare an honest scope', () => {
  it('both are declared TENANT with CUSTOMER_DERIVED data and per-owner retention', async () => {
    const { storeScopeDeclarations } = await import('./storeScope');
    // Importing the modules is what registers them.
    await import('../cloud/livesync/store');
    await import('../cloud/livesync/mirror');

    const byName = new Map(storeScopeDeclarations().map((d) => [d.name, d]));
    for (const name of ['cloud-livesync-queue', 'cloud-livesync-mirror']) {
      const decl = byName.get(name);
      expect(decl, `${name} must declare a scope`).toBeDefined();
      expect(decl?.scope).toBe('TENANT');
      expect(decl?.classification).toBe('CUSTOMER_DERIVED');
      expect(decl?.persistence).toBe('file');
      expect(decl?.retention.trim()).not.toBe('');
      expect(decl?.reason.trim()).not.toBe('');
    }
    // Per-owner retention is the property that matters, so it is asserted rather
    // than merely present.
    expect(byName.get('cloud-livesync-queue')?.retention).toMatch(/per owner/i);
  });

  it('a global scope for this data is refused by the gate, not by convention', async () => {
    const { declareStoreScope } = await import('./storeScope');
    expect(() =>
      declareStoreScope({
        name: 'cloud-livesync-queue-as-install-global',
        scope: 'INSTALL_GLOBAL',
        persistence: 'file',
        authority: 'SYSTEM',
        classification: 'CUSTOMER_DERIVED',
        retention: 'irrelevant',
        reason: 'it is only a queue',
      }),
    ).toThrow(/cannot be INSTALL_GLOBAL/);
  });

  it('the mirror’s bound seam is what the startup gate observes', async () => {
    const { storeScopeDeclarations } = await import('./storeScope');
    const unboundPath = join(tmpdir(), `nps-unbound-${randomUUID()}.json`);
    const decl = storeScopeDeclarations().find((d) => d.name === 'cloud-livesync-mirror');
    createLocalSyncMirror({ filePath: unboundPath }); // deliberately never bound
    expect(decl?.isBound?.()).toBe(false);
  });
});
