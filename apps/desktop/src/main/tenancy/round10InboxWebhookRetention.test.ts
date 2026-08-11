/**
 * A RETENTION CAP IS A WRITE — ROUND 10. NEW-H1 (inbox) and NEW-H2 (webhooks).
 *
 * WHY THESE TWO SURVIVED NINE ROUNDS OF AUDITING
 *
 * Both stores had already been through the tenancy programme and both came out
 * with genuinely correct READS. The inbox's `visible()`, `markRead()`, `page()`
 * and its `(scope, id)` de-dupe key were all hardened in P12. The webhook
 * store's `deliveriesFor()`, `deadLetters()`, `replay()` and `stats()` were all
 * hardened in P13C part 2. Every isolation test over them passed.
 *
 * Neither of those is the write.
 *
 *   NEW-H1  `inboxStore.add()` ended with `this.items.length = MAX_INBOX` over
 *           the ONE shared array, then persisted. `add` unshifts, so the rows
 *           that fell off the end were the globally oldest — somebody else's.
 *           Tenant B held 3 notifications; tenant A delivered 200; B's `page()`
 *           returned total 0 and ZERO of B's rows were left in `inbox.json`.
 *
 *   NEW-H2  `webhookStore.prune()` ran `selectEvictions` over every tenant's
 *           deliveries at once, sorted TERMINAL-FIRST then oldest-first, and
 *           deleted `rows.length - cap` of them. Terminal-first put another
 *           tenant's DEAD-LETTERED rows at the very front of the eviction
 *           order — and the dead-letter queue is the replay and forensics
 *           surface, so what was destroyed was evidence, not history. B had 5
 *           deliveries (2 dead); A enqueued 5,100; B's `deliveriesFor` → 0,
 *           `deadLetters` → 0, `stats` → all zeros.
 *
 * THE SHAPE OF THE PROOF
 *
 * Real stores on real files, three real organizations with DIFFERENT, NAMED
 * volumes, and the assertions are the NUMBERS and the ROW IDENTITIES. One
 * tenant is driven far past the cap so eviction definitely runs; the other two
 * are then asserted to still hold exactly what they held, both in memory and in
 * the bytes on disk, and again after a reload from those bytes. A suite that
 * only asserted `A !== B`, or that mocked a store as `() => []`, would pass
 * against every broken version of this code.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  InboxNotification,
  PlatformEvent,
  TenantScope,
  WebhookDelivery,
} from '@neuropause/shared';
import { InboxStore, MAX_INBOX } from '../notifications/inboxStore';
import { DELIVERY_CAP_PER_OWNER, WebhookStore } from '../webhooks/webhookStore';
import { applyAttemptResult } from '../webhooks/delivery';
import { WEBHOOK_MAX_ATTEMPTS } from '../webhooks/retry';

/**
 * Three organizations. Deliberately NOT `TEST_TENANT_SCOPE`: the node setup file
 * installs that as an AMBIENT fallback for the webhook store, and a fixture that
 * reused it could pass because the fallback answered rather than because the
 * boundary held. Every store below is also explicitly bound, so the fallback is
 * never consulted at all.
 */
const A: TenantScope = { tenantId: 'org-r10-a', workspaceId: 'ws-r10-a' };
const B: TenantScope = { tenantId: 'org-r10-b', workspaceId: 'ws-r10-b' };
const C: TenantScope = { tenantId: 'org-r10-c', workspaceId: 'ws-r10-c' };

/** The counts every assertion in this file is written against. */
const B_ROWS = 3;
const C_ROWS = 11;
const B_DELIVERIES = 5;
const B_DEAD = 2;
const C_DELIVERIES = 11;

/* ════════════════════════════════════════════════════════════════════════════
   NEW-H1 — the notification inbox
   ════════════════════════════════════════════════════════════════════════════ */

function note(id: string, over: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id,
    title: `Title ${id}`,
    body: 'Body',
    priority: 'high',
    sourceKey: 'work-failed',
    deepLink: null,
    at: '2026-08-01T09:00:00.000Z',
    read: false,
    ...over,
  };
}

const inboxIds = (t: TenantScope, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${t.tenantId}-note-${i + 1}`);

describe('NEW-H1 — the notification inbox is capped PER OWNER', () => {
  let dir: string;
  let file: string;
  /** Who is acting. Every store below binds to this, so a switch is a real switch. */
  let scope: TenantScope | null;

  function open(): InboxStore {
    return new InboxStore(file).bindScope(() => scope);
  }

  /** Deliver `ids` as `t`, in order, so the newest ends up at the front. */
  async function deliver(store: InboxStore, t: TenantScope, ids: readonly string[]): Promise<void> {
    scope = t;
    for (const id of ids) await store.add(note(id));
  }

  /** The tenant ids actually present in the persisted file, tallied. */
  function onDiskByTenant(): Record<string, number> {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { items: InboxNotification[] };
    const out: Record<string, number> = {};
    for (const row of raw.items) {
      const key = row.tenantId ?? '__unowned__';
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'np-r10-inbox-'));
    file = join(dir, 'inbox.json');
    scope = null;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /**
   * The exploit, run forwards. B and C are seeded first so they are the OLDEST
   * rows in the shared array — which is exactly the position the old truncation
   * deleted from.
   */
  it("A's flood past MAX_INBOX leaves B exactly 3 and C exactly 11, by identity and on disk", async () => {
    const store = open();
    await deliver(store, B, inboxIds(B, B_ROWS));
    await deliver(store, C, inboxIds(C, C_ROWS));

    // Precondition: they really are there before the flood. A test that skipped
    // this could be asserting an empty fixture against an empty result.
    scope = B;
    expect(store.page().total).toBe(B_ROWS);
    scope = C;
    expect(store.page().total).toBe(C_ROWS);

    // A delivers MAX_INBOX + 40 — far enough past the cap that eviction runs
    // forty times over.
    const aIds = inboxIds(A, MAX_INBOX + 40);
    await deliver(store, A, aIds);

    // B: unchanged. By COUNT and by ROW IDENTITY, newest-first.
    scope = B;
    const bPage = store.page();
    expect(bPage.total).toBe(B_ROWS);
    expect(bPage.items.map((x) => x.id)).toEqual([...inboxIds(B, B_ROWS)].reverse());
    expect(bPage.items.map((x) => x.title)).toEqual(
      [...inboxIds(B, B_ROWS)].reverse().map((id) => `Title ${id}`),
    );

    // C: unchanged, and a different number from B — so a fix that kept "some"
    // rows, or the same number for everyone, still fails.
    scope = C;
    const cPage = store.page();
    expect(cPage.total).toBe(C_ROWS);
    expect(cPage.items.map((x) => x.id)).toEqual([...inboxIds(C, C_ROWS)].reverse());

    // A: capped at exactly MAX_INBOX, and it is A's OWN oldest 40 that went.
    scope = A;
    const aPage = store.page(MAX_INBOX);
    expect(aPage.total).toBe(MAX_INBOX);
    expect(aPage.items[0]!.id).toBe(aIds[aIds.length - 1]);
    expect(aPage.items.map((x) => x.id)).not.toContain(aIds[0]);

    // THE BYTES. `page()` is a filter and a filter can hide a deletion; the file
    // cannot. The proven exploit left ZERO of B's rows here.
    expect(onDiskByTenant()).toEqual({
      [A.tenantId]: MAX_INBOX,
      [B.tenantId]: B_ROWS,
      [C.tenantId]: C_ROWS,
    });
  });

  it('every read still holds the boundary after the flood: page, visible/unreadCount, markRead, de-dupe', async () => {
    const store = open();
    await deliver(store, B, inboxIds(B, B_ROWS));
    await deliver(store, C, inboxIds(C, C_ROWS));
    await deliver(store, A, inboxIds(A, MAX_INBOX + 40));

    // `unreadCount()` and `page().unread` both funnel through the private
    // `visible()`, so this is that filter under test.
    scope = B;
    expect(store.unreadCount()).toBe(B_ROWS);
    expect(store.page().unread).toBe(B_ROWS);
    scope = C;
    expect(store.unreadCount()).toBe(C_ROWS);

    // `markRead('all')` means all of MINE.
    scope = A;
    expect(await store.markRead('all')).toBe(MAX_INBOX);
    scope = B;
    expect(store.unreadCount()).toBe(B_ROWS);
    scope = C;
    expect(store.unreadCount()).toBe(C_ROWS);

    // Naming B's id from A neither reads nor clears B's row.
    scope = A;
    expect(await store.markRead([inboxIds(B, 1)[0]!])).toBe(0);
    scope = B;
    expect(store.unreadCount()).toBe(B_ROWS);

    // De-dupe is keyed on (scope, id): A delivering B's id gets A its own row and
    // leaves B's alone — and the flood's cap did not disturb that.
    const sharedId = inboxIds(B, 1)[0]!;
    scope = A;
    await store.add(note(sharedId, { title: 'A version' }));
    expect(store.page(MAX_INBOX).items.filter((x) => x.id === sharedId)).toHaveLength(1);
    expect(store.page(MAX_INBOX).items.find((x) => x.id === sharedId)!.title).toBe('A version');
    scope = B;
    expect(store.page().total).toBe(B_ROWS);
    expect(store.page().items.find((x) => x.id === sharedId)!.title).toBe(`Title ${sharedId}`);
    expect(store.unreadCount()).toBe(B_ROWS);
  });

  it('the boundary survives a reload from disk', async () => {
    const first = open();
    await deliver(first, B, inboxIds(B, B_ROWS));
    await deliver(first, C, inboxIds(C, C_ROWS));
    await deliver(first, A, inboxIds(A, MAX_INBOX + 40));

    // A brand-new instance over the same bytes. Nothing carries over in memory.
    const reloaded = open();
    expect(reloaded.loadAllSync()).toHaveLength(MAX_INBOX + B_ROWS + C_ROWS);
    scope = B;
    expect(reloaded.page().total).toBe(B_ROWS);
    expect(reloaded.page().items.map((x) => x.id)).toEqual([...inboxIds(B, B_ROWS)].reverse());
    scope = C;
    expect(reloaded.page().total).toBe(C_ROWS);
    scope = A;
    expect(reloaded.page(MAX_INBOX).total).toBe(MAX_INBOX);

    // And a further flood through the RELOADED instance still cannot reach them.
    await deliver(reloaded, A, inboxIds(A, MAX_INBOX).map((id) => `${id}-second-wave`));
    scope = B;
    expect(reloaded.page().total).toBe(B_ROWS);
    scope = C;
    expect(reloaded.page().total).toBe(C_ROWS);
    expect(onDiskByTenant()[B.tenantId]).toBe(B_ROWS);
    expect(onDiskByTenant()[C.tenantId]).toBe(C_ROWS);
  });

  /**
   * The production shape the bus path actually writes.
   *
   * A bus-driven delivery runs under a TENANT-LEVEL principal, which resolves to
   * `workspaceId: ''` — `recordInScope` reads that as tenant-wide, so the row is
   * visible from any of that tenant's workspaces. The retention key must bucket
   * it the same way, or the most common row in the store is the one the cap can
   * still reach across the boundary.
   */
  it("a tenant-wide row (the background-principal shape) is not evicted by another tenant's flood", async () => {
    const store = open();
    const tenantWide: TenantScope = { tenantId: B.tenantId, workspaceId: '' };
    await deliver(store, tenantWide, inboxIds(B, B_ROWS));
    await deliver(store, A, inboxIds(A, MAX_INBOX + 40));

    // Visible from B's real workspace, because the row is tenant-wide.
    scope = B;
    expect(store.page().total).toBe(B_ROWS);
    expect(store.page().items.map((x) => x.id)).toEqual([...inboxIds(B, B_ROWS)].reverse());
    // Still visible from a DIFFERENT workspace of the same tenant.
    scope = { tenantId: B.tenantId, workspaceId: 'ws-r10-b-second' };
    expect(store.page().total).toBe(B_ROWS);
    // And never visible to A.
    scope = A;
    expect(store.page(MAX_INBOX).items.map((x) => x.id)).not.toContain(inboxIds(B, 1)[0]);
    expect(onDiskByTenant()[B.tenantId]).toBe(B_ROWS);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   NEW-H2 — the webhook delivery outbox
   ════════════════════════════════════════════════════════════════════════════ */

const T0 = Date.parse('2026-08-01T00:00:00.000Z');

function event(id: string): PlatformEvent {
  return {
    id,
    type: 'enterprise.record.created',
    category: 'enterprise',
    version: 1,
    priority: 'normal',
    timestamp: '2026-08-01T00:00:00.000Z',
    source: 'test',
    actor: { kind: 'system', id: 'test', displayName: 'test' },
    resource: null,
    correlationId: `corr-${id}`,
    causationId: null,
    metadata: {},
  } as PlatformEvent;
}

describe('NEW-H2 — the webhook delivery outbox is capped PER OWNER', () => {
  let dir: string;
  let file: string;
  let scope: TenantScope | null;
  let store: WebhookStore;
  let endpoint: Record<string, string>;
  let bDeliveries: WebhookDelivery[];
  let bDead: WebhookDelivery[];
  let cDeliveries: WebhookDelivery[];

  async function open(): Promise<WebhookStore> {
    const s = new WebhookStore(file);
    s.bindScope(() => scope);
    await s.load();
    return s;
  }

  /** Register one endpoint per tenant, owned by that tenant. */
  function register(t: TenantScope): string {
    scope = t;
    return store.create(t.tenantId, `https://hooks.example.com/${t.tenantId}`, {
      categories: [],
      types: [],
    }).webhook.id;
  }

  /** Enqueue `n` deliveries for `t`, each with a distinct, increasing createdAt. */
  function enqueue(t: TenantScope, n: number, from: number): WebhookDelivery[] {
    const out: WebhookDelivery[] = [];
    for (let i = 0; i < n; i += 1) {
      out.push(store.enqueue(endpoint[t.tenantId]!, event(`${t.tenantId}-evt-${i + 1}`), from + i));
    }
    return out;
  }

  /** Drive one delivery through the real retry schedule until it dead-letters. */
  function deadLetter(d: WebhookDelivery): WebhookDelivery {
    let cur = d;
    for (let i = 0; i < WEBHOOK_MAX_ATTEMPTS; i += 1) {
      cur = applyAttemptResult(cur, { ok: false, statusCode: 500, error: 'boom' }, T0 + i);
      store.update(cur);
    }
    expect(cur.status).toBe('dead');
    return cur;
  }

  /** The tenant ids actually present in the persisted file, tallied. */
  function onDiskByTenant(): Record<string, number> {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      deliveries: Array<{ tenantId?: string | null; status: string }>;
    };
    const out: Record<string, number> = {};
    for (const row of raw.deliveries) {
      const key = row.tenantId ?? '__unowned__';
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }

  function onDiskDeadFor(tenantId: string): number {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      deliveries: Array<{ tenantId?: string | null; status: string }>;
    };
    return raw.deliveries.filter((d) => d.tenantId === tenantId && d.status === 'dead').length;
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'np-r10-webhook-'));
    file = join(dir, 'webhooks.json');
    scope = null;
    store = await open();
    endpoint = {
      [A.tenantId]: register(A),
      [B.tenantId]: register(B),
      [C.tenantId]: register(C),
    };

    // B: five deliveries, two of them dead-lettered. C: eleven, all pending.
    bDeliveries = enqueue(B, B_DELIVERIES, T0);
    bDead = bDeliveries.slice(0, B_DEAD).map(deadLetter);
    cDeliveries = enqueue(C, C_DELIVERIES, T0 + 1_000);

    // Precondition, asserted rather than assumed.
    scope = B;
    expect(store.deliveriesFor()).toHaveLength(B_DELIVERIES);
    expect(store.deadLetters()).toHaveLength(B_DEAD);
    scope = C;
    expect(store.deliveriesFor()).toHaveLength(C_DELIVERIES);

    // A floods past the cap. `prune()` runs on every one of these.
    enqueue(A, DELIVERY_CAP_PER_OWNER + 100, T0 + 10_000);
    await store.flush();
  });
  // Drain before the directory goes, so a still-pending write cannot land on a
  // deleted path and spray an unrelated ENOENT through the next test's output.
  afterEach(async () => {
    await store.flush();
    rmSync(dir, { recursive: true, force: true });
  });

  it("A's flood leaves B exactly 5 with 2 dead letters, and C exactly 11 — by identity and on disk", () => {
    scope = B;
    const mine = store.deliveriesFor();
    expect(mine).toHaveLength(B_DELIVERIES);
    expect(mine.map((d) => d.id).sort()).toEqual(bDeliveries.map((d) => d.id).sort());

    // The dead-letter queue specifically. Terminal-first sorting put exactly
    // these rows at the front of the old install-wide eviction order.
    const dead = store.deadLetters();
    expect(dead).toHaveLength(B_DEAD);
    expect(dead.map((d) => d.id).sort()).toEqual(bDead.map((d) => d.id).sort());

    scope = C;
    expect(store.deliveriesFor()).toHaveLength(C_DELIVERIES);
    expect(store.deliveriesFor().map((d) => d.id).sort()).toEqual(
      cDeliveries.map((d) => d.id).sort(),
    );
    expect(store.deadLetters()).toHaveLength(0);

    // A: capped at exactly the per-owner cap, so retention still bounds the file.
    scope = A;
    expect(store.stats().total).toBe(DELIVERY_CAP_PER_OWNER);

    // THE BYTES.
    expect(onDiskByTenant()).toEqual({
      [A.tenantId]: DELIVERY_CAP_PER_OWNER,
      [B.tenantId]: B_DELIVERIES,
      [C.tenantId]: C_DELIVERIES,
    });
    expect(onDiskDeadFor(B.tenantId)).toBe(B_DEAD);
  });

  it("B's stats are unchanged, and B's replay still works, after A's flood", () => {
    scope = B;
    expect(store.stats()).toEqual({
      total: B_DELIVERIES,
      delivered: 0,
      failed: 0,
      pending: B_DELIVERIES - B_DEAD,
      dead: B_DEAD,
    });

    // REPLAY IS THE POINT OF THE DLQ. A dead-lettered row that has been evicted
    // cannot be re-sent, and the customer is never told it went missing.
    const replayed = store.replay(bDead[0]!.id, T0 + 900_000);
    expect(replayed).not.toBeNull();
    expect(replayed!.status).toBe('pending');
    expect(replayed!.eventId).toBe(bDead[0]!.eventId);
    expect(replayed!.tenantId).toBe(B.tenantId);

    // The replay added a row and evicted none of B's: the DLQ is intact.
    expect(store.deliveriesFor()).toHaveLength(B_DELIVERIES + 1);
    expect(store.deadLetters()).toHaveLength(B_DEAD);

    // C is untouched by B's replay too.
    scope = C;
    expect(store.deliveriesFor()).toHaveLength(C_DELIVERIES);
  });

  it("A cannot replay, read or count B's deliveries even while flooding them", () => {
    scope = A;
    expect(store.replay(bDead[0]!.id, T0 + 900_000)).toBeNull();
    expect(store.deliveriesFor({ webhookId: endpoint[B.tenantId]! })).toEqual([]);
    expect(store.deadLetters()).toEqual([]);
    expect(store.stats().dead).toBe(0);

    scope = B;
    expect(store.deliveriesFor()).toHaveLength(B_DELIVERIES);
    expect(store.deadLetters()).toHaveLength(B_DEAD);
  });

  it('the boundary survives a reload from disk', async () => {
    const reloaded = await open();

    scope = B;
    expect(reloaded.deliveriesFor()).toHaveLength(B_DELIVERIES);
    expect(reloaded.deliveriesFor().map((d) => d.id).sort()).toEqual(
      bDeliveries.map((d) => d.id).sort(),
    );
    expect(reloaded.deadLetters()).toHaveLength(B_DEAD);
    expect(reloaded.stats()).toEqual({
      total: B_DELIVERIES,
      delivered: 0,
      failed: 0,
      pending: B_DELIVERIES - B_DEAD,
      dead: B_DEAD,
    });
    expect(reloaded.replay(bDead[0]!.id, T0 + 900_000)).not.toBeNull();

    scope = C;
    expect(reloaded.deliveriesFor()).toHaveLength(C_DELIVERIES);
    scope = A;
    expect(reloaded.stats().total).toBe(DELIVERY_CAP_PER_OWNER);

    // A second flood, through the reloaded instance, still cannot reach them.
    scope = A;
    for (let i = 0; i < 200; i += 1) {
      reloaded.enqueue(endpoint[A.tenantId]!, event(`${A.tenantId}-second-${i}`), T0 + 2_000_000 + i);
    }
    await reloaded.flush();
    scope = B;
    expect(reloaded.deliveriesFor()).toHaveLength(B_DELIVERIES + 1); // +1 replayed above
    expect(reloaded.deadLetters()).toHaveLength(B_DEAD);
    scope = C;
    expect(reloaded.deliveriesFor()).toHaveLength(C_DELIVERIES);
    expect(onDiskByTenant()[B.tenantId]).toBe(B_DELIVERIES + 1);
    expect(onDiskByTenant()[C.tenantId]).toBe(C_DELIVERIES);
    expect(onDiskDeadFor(B.tenantId)).toBe(B_DEAD);
  });
});
