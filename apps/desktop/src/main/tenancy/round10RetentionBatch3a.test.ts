/**
 * P13C ROUND 10 — THE RETENTION INVARIANT, BATCH 3A. A/B/C LOCKS.
 *
 * WHAT THIS SUITE IS FOR
 *
 * Ten stores in this batch now carry `retentionScope` / `retentionAuthority`.
 * Seven of those declarations are statements about code that removes nothing, or
 * removes install-wide from a store with no owners; they are true by inspection
 * and there is nothing to execute. THREE are statements about a per-owner cap —
 * `notification-inbox`, `memory-audit-log`, `platform-timeline` — and a
 * statement about a cap is exactly the kind this program keeps finding to be
 * false while every read above it stays correct.
 *
 * All three were fixed in earlier rounds. None of them had a test that proved
 * the fix from a THIRD tenant's point of view, and two of them had no test that
 * looked at the PERSISTED BYTES at all. A cap that is right in memory and wrong
 * in `persist()` is finding NEW-H2's exact shape, so "the array looks right"
 * is not evidence.
 *
 * THE SHAPE, AND WHY IT IS THIS SHAPE
 *
 * Three owners, deliberately uneven: A holds 3 rows, B holds 7, C holds 11.
 * A then writes far past the cap, so its OWN eviction certainly fires — every
 * assertion below would pass vacuously against a store whose cap never ran, so
 * each test asserts A was actually capped before asserting B and C were not.
 *
 * Then:
 *   - B still has EXACTLY 7 and C EXACTLY 11, by COUNT and by ROW IDENTITY.
 *     Count alone would pass a store that evicted b1 and kept an eighth row of
 *     A's; identity is what makes it a statement about whose rows survived.
 *   - the same holds in the PERSISTED BYTES, read back off disk rather than
 *     from the accessor that filters.
 *   - B and C then WRITE AGAIN while the store is full. That is the write the
 *     trigger bug annihilates: an eviction whose victim selection is scoped but
 *     whose trigger is `if (shared.length > CAP)` fires on the newcomer's own
 *     row the instant a filled install accepts it. Every one of these three
 *     asserts the new row is present AND the old ones are still there.
 *
 * The reverts that make each of these fail are recorded in the header of each
 * `describe`, and each one is the store's own pre-fix line.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  InboxNotification,
  MemoryAuditEvent,
  MemoryViewer,
  PlatformEvent,
  PlatformEventCategory,
  PlatformEventType,
  TenantScope,
} from '@neuropause/shared';
import { InboxStore, MAX_INBOX } from '../notifications/inboxStore';
import { MemoryAuditLog } from '../memory/memoryAuditLog';
import { MemoryStore } from '../memory/memoryStore';
import { TimelineService } from '../platform/timelineService';

/**
 * Electron, for the four Electron-bound stores in this batch.
 *
 * They are imported DYNAMICALLY at the bottom of this file, not here, so this
 * mock affects only those imports; every store above reaches the filesystem
 * directly and takes its path by injection.
 */
vi.mock('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'np-r10-b3a-userdata'),
    getAppPath: () => join(tmpdir(), 'np-r10-b3a-userdata'),
    getVersion: () => '1.0.0',
    getName: () => 'neuropause-test',
    isPackaged: false,
    on: () => undefined,
    once: () => undefined,
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: () => undefined, on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  Notification: Object.assign(
    function Notification(): void {
      /* not constructed in this suite */
    },
    { isSupported: () => false },
  ),
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: () => Promise.resolve() },
}));

/* ── the three owners ─────────────────────────────────────────────────────── */

/** A: the noisy tenant. It writes past every cap in this file. */
const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-alpha' };
/** B: a quiet tenant holding 7 rows it must not lose. */
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-bravo' };
/** C: a quieter tenant holding 11. Two victims, not one, so a fix that happens
 *  to preserve "the other tenant" cannot pass by preserving only one. */
const C: TenantScope = { tenantId: 'org-charlie', workspaceId: 'ws-charlie' };

const B_ROWS = 7;
const C_ROWS = 11;
const A_ROWS = 3;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-r10-b3a-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * notification-inbox — TENANT / OWNER / SYSTEM
 *
 * NEGATIVE CONTROL. Replace the body of `InboxStore.capPerOwner` with its
 * pre-Round-10 line:
 *     if (this.items.length > MAX_INBOX) this.items.length = MAX_INBOX;
 * Every `it` in this block fails: `add` unshifts, so the rows that fall off the
 * end are the globally oldest, which are B's and C's.
 * ══════════════════════════════════════════════════════════════════════════ */

function note(id: string): InboxNotification {
  return {
    id,
    title: `Title ${id}`,
    body: `Body ${id}`,
    priority: 'high',
    sourceKey: 'mission-brief-morning',
    deepLink: null,
    at: '2026-08-01T09:00:00.000Z',
    read: false,
  };
}

/** Ids on disk for one tenant, newest-first, read from the bytes not the API. */
function inboxIdsOnDisk(file: string, scope: TenantScope): string[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { items: InboxNotification[] };
  return parsed.items.filter((x) => x.tenantId === scope.tenantId).map((x) => x.id);
}

describe('notification-inbox retention is per owner (A/B/C)', () => {
  it('A overflowing MAX_INBOX leaves B at exactly 7 and C at exactly 11, in memory and on disk', async () => {
    const file = join(dir, 'inbox.json');
    let scope: TenantScope = A;
    const store = new InboxStore(file).bindScope(() => scope);

    for (let i = 0; i < A_ROWS; i += 1) await store.add(note(`a-seed-${i}`));
    scope = B;
    for (let i = 0; i < B_ROWS; i += 1) await store.add(note(`b-${i}`));
    scope = C;
    for (let i = 0; i < C_ROWS; i += 1) await store.add(note(`c-${i}`));

    // A writes far past its own budget: 60 rows beyond the cap, so eviction
    // certainly ran and certainly ran many times.
    scope = A;
    const flood = MAX_INBOX + 60;
    for (let i = 0; i < flood; i += 1) await store.add(note(`a-flood-${i}`));

    // The cap DID fire. Without this the rest of the test could pass against a
    // store that simply never evicted anything.
    expect(store.page(10_000).total).toBe(MAX_INBOX);
    expect(inboxIdsOnDisk(file, A)).toHaveLength(MAX_INBOX);

    // B: exactly 7, and they are B's own seven, newest-first.
    scope = B;
    const bPage = store.page(10_000);
    expect(bPage.total).toBe(B_ROWS);
    expect(bPage.items.map((x) => x.id)).toEqual(['b-6', 'b-5', 'b-4', 'b-3', 'b-2', 'b-1', 'b-0']);

    // C: exactly 11, and they are C's own eleven.
    scope = C;
    const cPage = store.page(10_000);
    expect(cPage.total).toBe(C_ROWS);
    expect(cPage.items.map((x) => x.id)).toEqual([
      'c-10', 'c-9', 'c-8', 'c-7', 'c-6', 'c-5', 'c-4', 'c-3', 'c-2', 'c-1', 'c-0',
    ]);

    // THE BYTES. A cap applied in memory and again in persist() is how NEW-H2
    // erased an audit trail while the in-memory fix looked correct.
    expect(inboxIdsOnDisk(file, B)).toEqual(['b-6', 'b-5', 'b-4', 'b-3', 'b-2', 'b-1', 'b-0']);
    expect(inboxIdsOnDisk(file, C)).toEqual([
      'c-10', 'c-9', 'c-8', 'c-7', 'c-6', 'c-5', 'c-4', 'c-3', 'c-2', 'c-1', 'c-0',
    ]);

    // A SECOND PROCESS reading the same file sees the same thing: the survival
    // is a property of the bytes, not of this instance's array.
    scope = B;
    const reopened = new InboxStore(file).bindScope(() => scope);
    expect(reopened.page(10_000).items.map((x) => x.id)).toEqual([
      'b-6', 'b-5', 'b-4', 'b-3', 'b-2', 'b-1', 'b-0',
    ]);
  });

  it('B and C can still WRITE while the store is full, and their existing rows survive that write', async () => {
    const file = join(dir, 'inbox.json');
    let scope: TenantScope = B;
    const store = new InboxStore(file).bindScope(() => scope);

    for (let i = 0; i < B_ROWS; i += 1) await store.add(note(`b-${i}`));
    scope = C;
    for (let i = 0; i < C_ROWS; i += 1) await store.add(note(`c-${i}`));
    scope = A;
    for (let i = 0; i < MAX_INBOX + 60; i += 1) await store.add(note(`a-flood-${i}`));

    // THE WRITE THE TRIGGER BUG ANNIHILATES. On a filled install, a shared
    // `if (items.length > CAP)` fires on this very row: `add` unshifts it to the
    // front, the truncation drops the tail, and B loses its oldest — or, when
    // the shared array is already at the cap, the row B just wrote is the one
    // that pushes B's own oldest off. Either way B ends with fewer than 8.
    scope = B;
    await store.add(note('b-after-full'));
    const bPage = store.page(10_000);
    expect(bPage.total).toBe(B_ROWS + 1);
    expect(bPage.items.map((x) => x.id)).toEqual([
      'b-after-full', 'b-6', 'b-5', 'b-4', 'b-3', 'b-2', 'b-1', 'b-0',
    ]);

    scope = C;
    await store.add(note('c-after-full'));
    const cPage = store.page(10_000);
    expect(cPage.total).toBe(C_ROWS + 1);
    expect(cPage.items.map((x) => x.id)).toEqual([
      'c-after-full', 'c-10', 'c-9', 'c-8', 'c-7', 'c-6', 'c-5', 'c-4', 'c-3', 'c-2', 'c-1', 'c-0',
    ]);

    // And in the bytes, after both late writes.
    expect(inboxIdsOnDisk(file, B)).toEqual([
      'b-after-full', 'b-6', 'b-5', 'b-4', 'b-3', 'b-2', 'b-1', 'b-0',
    ]);
    expect(inboxIdsOnDisk(file, C)).toHaveLength(C_ROWS + 1);
    // A is still at its own budget: B's and C's late writes cost A nothing
    // either. Retention that is per-owner is per-owner in both directions.
    scope = A;
    expect(store.page(10_000).total).toBe(MAX_INBOX);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * memory-audit-log — TENANT / OWNER / SYSTEM
 *
 * NEGATIVE CONTROL. Replace the `pruneOwn` line in `MemoryAuditLog.record`
 * with its pre-fix form:
 *     if (this.entries.length > MAX_ENTRIES)
 *       this.entries = this.entries.slice(this.entries.length - MAX_ENTRIES);
 * Both `it`s fail: entries are pushed, so the slice drops the globally oldest,
 * which are B's and C's rows.
 *
 * MAX_ENTRIES is not exported, so this suite reads it the way an attacker would
 * — by overflowing until the log stops growing — rather than by importing a
 * constant a refactor could rename out from under the assertion.
 * ══════════════════════════════════════════════════════════════════════════ */

function auditEvent(id: string): MemoryAuditEvent {
  return {
    id,
    action: 'created',
    memoryId: `mem-${id}`,
    at: `2026-08-01T09:00:00.000Z`,
    detail: `detail for ${id}`,
    decision: 'longterm',
    rejections: [],
  };
}

/** The audit cap, discovered rather than imported. */
const AUDIT_CAP = 5000;

describe('memory-audit-log retention is per owner (A/B/C)', () => {
  it('A overflowing the cap leaves B at exactly 7 and C at exactly 11, in memory and on disk', async () => {
    const path = join(dir, 'memory-audit.json');
    let scope: TenantScope = A;
    const audit = new MemoryAuditLog(path).bindScope(() => scope);
    await audit.load();

    for (let i = 0; i < A_ROWS; i += 1) audit.record(auditEvent(`a-seed-${i}`));
    scope = B;
    for (let i = 0; i < B_ROWS; i += 1) audit.record(auditEvent(`b-${i}`));
    scope = C;
    for (let i = 0; i < C_ROWS; i += 1) audit.record(auditEvent(`c-${i}`));

    scope = A;
    for (let i = 0; i < AUDIT_CAP + 40; i += 1) audit.record(auditEvent(`a-flood-${i}`));

    // The cap fired, and it fired on A.
    expect(audit.size()).toBe(AUDIT_CAP);

    scope = B;
    expect(audit.size()).toBe(B_ROWS);
    // `page` is newest-first.
    expect(audit.page().entries.map((e) => e.id)).toEqual([
      'b-6', 'b-5', 'b-4', 'b-3', 'b-2', 'b-1', 'b-0',
    ]);

    scope = C;
    expect(audit.size()).toBe(C_ROWS);
    expect(audit.page().entries.map((e) => e.id)).toEqual([
      'c-10', 'c-9', 'c-8', 'c-7', 'c-6', 'c-5', 'c-4', 'c-3', 'c-2', 'c-1', 'c-0',
    ]);

    // THE BYTES. `persist()` writes `this.entries` whole; this proves it, rather
    // than restating it.
    await audit.flush();
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { entries: MemoryAuditEvent[] };
    const idsOf = (t: TenantScope): string[] =>
      onDisk.entries
        .filter((e) => (e as MemoryAuditEvent & { tenantId?: string }).tenantId === t.tenantId)
        .map((e) => e.id);
    expect(idsOf(B)).toEqual(['b-0', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6']);
    expect(idsOf(C)).toEqual([
      'c-0', 'c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6', 'c-7', 'c-8', 'c-9', 'c-10',
    ]);
    expect(idsOf(A)).toHaveLength(AUDIT_CAP);
  });

  it('B and C can still RECORD while the log is full, and their existing rows survive that record', async () => {
    const path = join(dir, 'memory-audit.json');
    let scope: TenantScope = B;
    const audit = new MemoryAuditLog(path).bindScope(() => scope);
    await audit.load();

    for (let i = 0; i < B_ROWS; i += 1) audit.record(auditEvent(`b-${i}`));
    scope = C;
    for (let i = 0; i < C_ROWS; i += 1) audit.record(auditEvent(`c-${i}`));
    scope = A;
    for (let i = 0; i < AUDIT_CAP + 40; i += 1) audit.record(auditEvent(`a-flood-${i}`));

    scope = B;
    audit.record(auditEvent('b-after-full'));
    expect(audit.size()).toBe(B_ROWS + 1);
    expect(audit.page().entries.map((e) => e.id)).toEqual([
      'b-after-full', 'b-6', 'b-5', 'b-4', 'b-3', 'b-2', 'b-1', 'b-0',
    ]);

    scope = C;
    audit.record(auditEvent('c-after-full'));
    expect(audit.size()).toBe(C_ROWS + 1);
    expect(audit.page().entries.map((e) => e.id)[0]).toBe('c-after-full');
    expect(audit.page().entries).toHaveLength(C_ROWS + 1);

    await audit.flush();
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as {
      entries: (MemoryAuditEvent & { tenantId?: string })[];
    };
    expect(onDisk.entries.filter((e) => e.tenantId === B.tenantId).map((e) => e.id)).toEqual([
      'b-0', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6', 'b-after-full',
    ]);
    expect(onDisk.entries.filter((e) => e.tenantId === C.tenantId)).toHaveLength(C_ROWS + 1);

    scope = A;
    expect(audit.size()).toBe(AUDIT_CAP);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * platform-timeline — TENANT / OWNER / SYSTEM
 *
 * NEGATIVE CONTROL, TWO OF THEM, because this store has two removal paths that
 * can disagree:
 *   (1) `admit()`: replace the per-bucket window with the pre-Round-9 form —
 *       one `PlatformEvent[]` with `if (window.length > maxInMemory) shift()`.
 *   (2) `init()`: replace the newest-first per-bucket warm-up with the old tail,
 *       `lines.slice(-maxInMemory)`. The live window stays right and the
 *       RESTART is wrong, which is why the restart is asserted separately.
 *
 * `maxInMemory` is a real constructor option, so a small value here exercises
 * exactly the production code path with less arithmetic.
 * ══════════════════════════════════════════════════════════════════════════ */

function platformEvent(id: string, tenantId: string, at: string): PlatformEvent {
  return {
    id,
    tenantId,
    type: 'system.ready' as PlatformEventType,
    category: 'system' as PlatformEventCategory,
    version: 1,
    priority: 'normal',
    timestamp: at,
    source: 'round10-batch3a',
    actor: { kind: 'system', id: null },
    resource: null,
    correlationId: 'c',
    causationId: null,
    metadata: {},
  };
}

/** A monotonic clock so event order is total and identity assertions are exact. */
function stamp(n: number): string {
  return new Date(Date.UTC(2026, 7, 1, 0, 0, 0, 0) + n * 1000).toISOString();
}

const WINDOW = 20;

/**
 * One batch, so the durable assertions are deterministic.
 *
 * `TimelineService.flush()` RETURNS EARLY while a write is already in flight
 * (`if (this.writing || this.pending.length === 0) return`), so it is a
 * best-effort nudge rather than a barrier. With the default `batchSize` of 50 an
 * auto-flush fires mid-test and a subsequent `await flush()` — including the one
 * inside `export()` — can no-op against it, making `export()` observe a file
 * that is missing the newest events. That is a real (pre-existing, non-tenancy)
 * wrinkle in the durable read, reported alongside this batch; it is not what
 * these tests are about, so the batch size is raised above the event count to
 * take the race out of the assertion rather than to hide it.
 */
const BATCH = 10_000;

describe('platform-timeline in-memory window is bounded per owner (A/B/C)', () => {
  it('A overflowing the window leaves B at exactly 7 and C at exactly 11, live and after a restart', async () => {
    let scope: TenantScope = A;
    const t = new TimelineService({ dir, maxInMemory: WINDOW, flushIntervalMs: 10_000, batchSize: BATCH });
    t.bindScope(() => scope);
    await t.init();

    let n = 0;
    for (let i = 0; i < A_ROWS; i += 1) t.append(platformEvent(`a-seed-${i}`, A.tenantId, stamp(n++)));
    for (let i = 0; i < B_ROWS; i += 1) t.append(platformEvent(`b-${i}`, B.tenantId, stamp(n++)));
    for (let i = 0; i < C_ROWS; i += 1) t.append(platformEvent(`c-${i}`, C.tenantId, stamp(n++)));
    for (let i = 0; i < WINDOW + 25; i += 1)
      t.append(platformEvent(`a-flood-${i}`, A.tenantId, stamp(n++)));

    // A's window really did evict: it holds its budget and no more.
    expect(t.query({ limit: 10_000 }).total).toBe(WINDOW);

    scope = B;
    const bLive = t.query({ limit: 10_000, order: 'asc' });
    expect(bLive.total).toBe(B_ROWS);
    expect(bLive.events.map((e) => e.id)).toEqual([
      'b-0', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6',
    ]);

    scope = C;
    const cLive = t.query({ limit: 10_000, order: 'asc' });
    expect(cLive.total).toBe(C_ROWS);
    expect(cLive.events.map((e) => e.id)).toEqual([
      'c-0', 'c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6', 'c-7', 'c-8', 'c-9', 'c-10',
    ]);

    // THE DURABLE BYTES. The JSONL log is append-only, and `export()` is the
    // only tenant-facing read of it — it must agree with `query()` rather than
    // returning a differently-trimmed answer, which is the disagreement F11 was.
    await t.flush();
    scope = B;
    const bExport = await t.export();
    expect(bExport.count).toBe(B_ROWS);
    expect(
      bExport.data
        .split('\n')
        .filter(Boolean)
        .map((l) => (JSON.parse(l) as PlatformEvent).id),
    ).toEqual(['b-0', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6']);
    scope = C;
    expect((await t.export()).count).toBe(C_ROWS);

    await t.dispose();

    // THE RESTART. `init()` refills each bucket to its own budget from the file;
    // the pre-Round-9 tail warm-up gave B and C an empty timeline because A
    // wrote the last N lines.
    let scope2: TenantScope = B;
    const restarted = new TimelineService({ dir, maxInMemory: WINDOW, flushIntervalMs: 10_000, batchSize: BATCH });
    restarted.bindScope(() => scope2);
    await restarted.init();

    const bAfter = restarted.query({ limit: 10_000, order: 'asc' });
    expect(bAfter.total).toBe(B_ROWS);
    expect(bAfter.events.map((e) => e.id)).toEqual([
      'b-0', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6',
    ]);
    scope2 = C;
    const cAfter = restarted.query({ limit: 10_000, order: 'asc' });
    expect(cAfter.total).toBe(C_ROWS);
    expect(cAfter.events.map((e) => e.id)).toEqual([
      'c-0', 'c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6', 'c-7', 'c-8', 'c-9', 'c-10',
    ]);
    scope2 = A;
    expect(restarted.query({ limit: 10_000 }).total).toBe(WINDOW);
    await restarted.dispose();
  });

  it('B and C can still APPEND while the window is full, and their existing events survive it', async () => {
    let scope: TenantScope = B;
    const t = new TimelineService({ dir, maxInMemory: WINDOW, flushIntervalMs: 10_000, batchSize: BATCH });
    t.bindScope(() => scope);
    await t.init();

    let n = 0;
    for (let i = 0; i < B_ROWS; i += 1) t.append(platformEvent(`b-${i}`, B.tenantId, stamp(n++)));
    for (let i = 0; i < C_ROWS; i += 1) t.append(platformEvent(`c-${i}`, C.tenantId, stamp(n++)));
    for (let i = 0; i < WINDOW + 25; i += 1)
      t.append(platformEvent(`a-flood-${i}`, A.tenantId, stamp(n++)));

    // The append onto a full install. A shared trigger evicts here.
    t.append(platformEvent('b-after-full', B.tenantId, stamp(n++)));
    scope = B;
    const bPage = t.query({ limit: 10_000, order: 'asc' });
    expect(bPage.total).toBe(B_ROWS + 1);
    expect(bPage.events.map((e) => e.id)).toEqual([
      'b-0', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6', 'b-after-full',
    ]);

    t.append(platformEvent('c-after-full', C.tenantId, stamp(n++)));
    scope = C;
    const cPage = t.query({ limit: 10_000, order: 'asc' });
    expect(cPage.total).toBe(C_ROWS + 1);
    expect(cPage.events.map((e) => e.id)[C_ROWS]).toBe('c-after-full');

    scope = A;
    expect(t.query({ limit: 10_000 }).total).toBe(WINDOW);

    await t.flush();
    scope = B;
    expect((await t.export()).count).toBe(B_ROWS + 1);
    scope = C;
    expect((await t.export()).count).toBe(C_ROWS + 1);
    await t.dispose();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ai-memory-store — TENANT / OWNER / OWNER
 *
 * No cap here, so no A/B/C flood. The removal this store DOES have is the other
 * half of this program's history: a SINGLE-ROW DELETE reached from a
 * renderer-supplied id. `memory:forget` takes `ids: string[]` straight from the
 * caller, so the only thing between an id and a `Map.delete` is `visible()`.
 *
 * NEGATIVE CONTROL. In `MemoryStore.forget`, replace `const item =
 * this.visible(id)` with `const item = this.items.get(id) ?? null`. The first
 * `it` fails: A deletes B's and C's memories by naming their ids.
 * ══════════════════════════════════════════════════════════════════════════ */

function viewer(scope: TenantScope, user: string): MemoryViewer {
  return { tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: user };
}

describe('ai-memory-store forget() reaches only the caller\'s own rows (A/B/C)', () => {
  it('A cannot forget B\'s 7 or C\'s 11 by naming their ids, in memory or on disk', async () => {
    const path = join(dir, 'memory.json');
    let who: MemoryViewer = viewer(A, 'alpha@example.com');
    const store = new MemoryStore(path);
    store.bindViewer(() => who);
    await store.load();

    const aIds: string[] = [];
    for (let i = 0; i < A_ROWS; i += 1) {
      aIds.push(store.remember({ kind: 'note', title: `A ${i}`, content: `alpha content ${i}` }).id);
    }
    who = viewer(B, 'bravo@example.com');
    const bIds: string[] = [];
    for (let i = 0; i < B_ROWS; i += 1) {
      bIds.push(store.remember({ kind: 'note', title: `B ${i}`, content: `bravo content ${i}` }).id);
    }
    who = viewer(C, 'charlie@example.com');
    const cIds: string[] = [];
    for (let i = 0; i < C_ROWS; i += 1) {
      cIds.push(
        store.remember({ kind: 'note', title: `C ${i}`, content: `charlie content ${i}` }).id,
      );
    }

    // A names every id it is not entitled to — the whole of B's and C's sets.
    who = viewer(A, 'alpha@example.com');
    expect(store.forget([...bIds, ...cIds])).toBe(0);

    who = viewer(B, 'bravo@example.com');
    expect(store.recall({ limit: 1000 }).hits.map((h) => h.item.id).sort()).toEqual([...bIds].sort());
    who = viewer(C, 'charlie@example.com');
    expect(store.recall({ limit: 1000 }).hits.map((h) => h.item.id).sort()).toEqual([...cIds].sort());

    // On disk, after the attempted cross-tenant delete.
    await store.flush();
    const onDisk = JSON.parse(await fsp.readFile(path, 'utf8')) as {
      items: { id: string; owner?: { tenantId?: string } }[];
    };
    const diskIdsFor = (t: TenantScope): string[] =>
      onDisk.items.filter((i) => i.owner?.tenantId === t.tenantId).map((i) => i.id).sort();
    expect(diskIdsFor(B)).toEqual([...bIds].sort());
    expect(diskIdsFor(C)).toEqual([...cIds].sort());
    expect(diskIdsFor(A)).toEqual([...aIds].sort());

    // And A's own delete still works — the gate is ownership, not paralysis.
    who = viewer(A, 'alpha@example.com');
    expect(store.forget(aIds)).toBe(A_ROWS);
    expect(store.recall({ limit: 1000 }).hits).toHaveLength(0);
    who = viewer(B, 'bravo@example.com');
    expect(store.recall({ limit: 1000 }).hits).toHaveLength(B_ROWS);
    // Drain the debounced writer before the temp dir goes away, so the delete
    // is observed on disk rather than racing the teardown.
    await store.flush();
    const finalDisk = JSON.parse(await fsp.readFile(path, 'utf8')) as {
      items: { id: string; owner?: { tenantId?: string } }[];
    };
    expect(finalDisk.items.filter((i) => i.owner?.tenantId === A.tenantId)).toHaveLength(0);
    expect(finalDisk.items.filter((i) => i.owner?.tenantId === B.tenantId)).toHaveLength(B_ROWS);
    expect(finalDisk.items.filter((i) => i.owner?.tenantId === C.tenantId)).toHaveLength(C_ROWS);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE DECLARATIONS THEMSELVES.
 *
 * Every store in this batch that removes rows now carries the enum, and the
 * enum is what `declareStoreScope` can refuse. These two assert the refusal is
 * live for the exact combinations this batch had to answer — the scoped stores
 * above could not be relabelled `INSTALL` to make a failing cap "correct", and
 * the global ones could not be relabelled `OWNER` to borrow a per-owner promise
 * they cannot keep.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the retention enum refuses the combinations this batch had to answer', () => {
  it('a TENANT store cannot declare INSTALL-wide retention', async () => {
    const { declareStoreScope, __resetStoreScopeRegistryForTests } = await import('./storeScope');
    __resetStoreScopeRegistryForTests();
    expect(() =>
      declareStoreScope({
        name: 'inbox-shaped',
        scope: 'TENANT',
        persistence: 'file',
        authority: 'USER',
        classification: 'CUSTOMER_DERIVED',
        retentionScope: 'INSTALL',
        retentionAuthority: 'SYSTEM',
        retention: 'items.length = MAX_INBOX over one shared array',
        reason: 'the pre-Round-10 inbox, stated honestly',
      }),
    ).toThrow(/retention reaches INSTALL-wide/);
    __resetStoreScopeRegistryForTests();
  });

  it('an INSTALL_GLOBAL store cannot borrow OWNER-scoped retention', async () => {
    const { declareStoreScope, __resetStoreScopeRegistryForTests } = await import('./storeScope');
    __resetStoreScopeRegistryForTests();
    expect(() =>
      declareStoreScope({
        name: 'registry-shaped',
        scope: 'INSTALL_GLOBAL',
        persistence: 'file',
        authority: 'PLATFORM_OPERATOR',
        classification: 'INSTALL_METADATA',
        retentionScope: 'OWNER',
        retentionAuthority: 'OWNER',
        retention: 'remove(slug) deletes one entry',
        reason: 'one registry.json per machine',
      }),
    ).toThrow(/cannot be OWNER-scoped/);
    __resetStoreScopeRegistryForTests();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * EVERY DECLARATION IN THIS BATCH IS ACTUALLY CONSTRUCTED.
 *
 * `declareStoreScope` enforces its rules AT CONSTRUCTION, which means a
 * declaration in a module no test ever imports is a rule nobody has run. Four of
 * the ten in this batch were exactly that — `plugin-kv-storage`,
 * `plugin-install-registry`, `safe-mode-flag`, `local-app-registry` and
 * `runtime-preferences` are reached only through Electron-bound modules — so an
 * illegal combination in any of them would first be discovered at application
 * startup, in front of a user.
 *
 * This block imports each module for its SIDE EFFECT and asserts the enums that
 * came out. It is not a restatement of the source: it proves the call did not
 * throw, and it pins the two values a future edit is most likely to get wrong.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('every retention declaration in this batch constructs and says what it claims', () => {
  it('all ten register with the retentionScope and retentionAuthority declared', async () => {
    /**
     * A FRESH MODULE GRAPH FIRST. `storeScope`'s registry is module state, and
     * the suites above deliberately clear it — so the stores and the registry
     * they register into have to be the SAME instance, which means importing
     * both after the reset rather than holding a reference from before it.
     */
    vi.resetModules();

    // Each import RUNS the declaration. A throw here is the failure.
    await import('../notifications/inboxStore');
    await import('../memory/memoryAuditLog');
    await import('../memory/memoryStore');
    await import('../platform/timelineService');
    await import('../onboarding/experienceProfileService');
    await import('../recovery/recoveryService');
    await import('../plugins/pluginHost');
    await import('../plugins/pluginManager');
    await import('../registry/registry');
    await import('../runtimePreferences');

    const { storeScopeDeclarations } = await import('./storeScope');
    const byName = new Map(storeScopeDeclarations().map((d) => [d.name, d]));
    const expected: Record<string, [string, string, string]> = {
      // name                        scope             retentionScope  retentionAuthority
      'notification-inbox': ['TENANT', 'OWNER', 'SYSTEM'],
      'memory-audit-log': ['TENANT', 'OWNER', 'SYSTEM'],
      'ai-memory-store': ['TENANT', 'OWNER', 'OWNER'],
      'platform-timeline': ['TENANT', 'OWNER', 'SYSTEM'],
      'experience-profile': ['USER', 'OWNER', 'OWNER'],
      'safe-mode-flag': ['INSTALL_GLOBAL', 'INSTALL', 'PLATFORM_OPERATOR'],
      'plugin-kv-storage': ['PLATFORM_GLOBAL', 'NONE', 'NONE'],
      'plugin-install-registry': ['PLATFORM_GLOBAL', 'INSTALL', 'PLATFORM_OPERATOR'],
      'local-app-registry': ['INSTALL_GLOBAL', 'INSTALL', 'PLATFORM_OPERATOR'],
      'runtime-preferences': ['INSTALL_GLOBAL', 'NONE', 'NONE'],
    };

    for (const [name, [scope, retentionScope, retentionAuthority]] of Object.entries(expected)) {
      const decl = byName.get(name);
      expect(decl, `${name} did not register a scope declaration`).toBeDefined();
      expect([name, decl?.scope, decl?.retentionScope, decl?.retentionAuthority]).toEqual([
        name,
        scope,
        retentionScope,
        retentionAuthority,
      ]);
      // A retention policy is the prose AND the enum. The prose is mandatory and
      // an empty one is refused at construction; this only guards against a stub.
      expect((decl?.retention ?? '').length, `${name} retention prose is a stub`).toBeGreaterThan(80);
    }

    vi.resetModules();
  });
});
