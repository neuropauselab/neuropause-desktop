/**
 * A RETENTION CAP IS A WRITE. P13C ROUND 9 — F10, F11, F13.
 *
 * WHY THIS SUITE EXISTS SEPARATELY FROM THE ISOLATION SUITES
 *
 * Every store covered here already had a correct read filter, and every
 * isolation test over them was green. A filter HIDES a row; a cap DELETES one.
 * The three findings closed here are the same sentence in three subsystems:
 *
 *   F10  the knowledge graph's relationship history had no owner field AT ALL,
 *        and a flat 5000-row `slice()` over the whole log. A tenant's rebuild
 *        churn — which runs on a 750 ms debounce off any unified-store change —
 *        deleted another tenant's relationship history.
 *
 *   F11  the timeline's live window was one install-wide ring buffer. A busy
 *        tenant evicted a quiet one from memory while the durable file still
 *        held those rows, so `query()` and `export()` — two reads of the SAME
 *        log — returned different answers for the quiet tenant.
 *
 *   F13  the gateway audit cap was self-documented as "NOT a fix" and shipped
 *        anyway: `auditCap × (tenants with entries)`, front-first, so one
 *        tenant's traffic could still delete another tenant's audit records.
 *
 * THE SHAPE OF THE PROOF
 *
 * Real fixtures with named counts, and the assertions are the NUMBERS. Each
 * scenario gives three tenants different, specific volumes (3 / 7 / 11), drives
 * ONE of them far past the cap so eviction definitely runs, and then asserts the
 * other two still hold exactly 7 and exactly 11 — by count AND by row identity.
 * A test that only asserted `A !== B`, or that mocked a store as `() => []`,
 * would pass against every version of this bug.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  GatewayAuditEntry,
  GraphEdge,
  GraphNode,
  PlatformEvent,
  TenantScope,
} from '@neuropause/shared';
import { GraphStore } from '../graph/graphStore';
import { TimelineService } from '../platform/timelineService';
import { GatewayStore } from '../ecosystem/gateway/gatewayStore';

/** Three real organizations. Not "tenant A and not-tenant-A": three, with volumes. */
const A: TenantScope = { tenantId: 'org-ret-a', workspaceId: 'ws-ret-a' };
const B: TenantScope = { tenantId: 'org-ret-b', workspaceId: 'ws-ret-b' };
const C: TenantScope = { tenantId: 'org-ret-c', workspaceId: 'ws-ret-c' };

/** The counts every assertion in this file is written against. */
const A_ROWS = 3;
const B_ROWS = 7;
const C_ROWS = 11;

function tally(keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/* ════════════════════════════════════════════════════════════════════════════
   F10 — the knowledge graph's relationship history
   ════════════════════════════════════════════════════════════════════════════ */

const AT = '2026-01-01T00:00:00.000Z';

function gNode(id: string): GraphNode {
  return {
    id,
    type: 'task',
    label: id,
    sourceKind: 'test',
    sourceId: id,
    connectorId: null,
    createdAt: AT,
    updatedAt: AT,
    metadata: {},
  };
}

function gEdge(from: string, to: string): GraphEdge {
  return {
    id: `${from}|belongs_to|${to}`,
    type: 'belongs_to',
    from,
    to,
    label: null,
    createdAt: AT,
    updatedAt: AT,
    evidence: null,
    metadata: {},
  };
}

const hubOf = (t: TenantScope): string => `${t.tenantId}:hub`;
const leafOf = (t: TenantScope, n: number): string => `${t.tenantId}:leaf-${n}`;

describe('F10 — relationship history is owned, and its cap is per tenant', () => {
  let dir: string;
  let path: string;
  let scope: TenantScope | null;
  const opened: GraphStore[] = [];

  async function open(p: string, historyCapPerTenant?: number): Promise<GraphStore> {
    const store = new GraphStore(p, historyCapPerTenant === undefined ? {} : { historyCapPerTenant });
    store.bindScope(() => scope);
    await store.load();
    opened.push(store);
    return store;
  }

  /** One rebuild that leaves `t` holding exactly `n` new 'added' history rows. */
  function seed(store: GraphStore, t: TenantScope, n: number, at: string): string[] {
    const leaves = Array.from({ length: n }, (_, i) => leafOf(t, i + 1));
    store.apply(
      [gNode(hubOf(t)), ...leaves.map(gNode)],
      leaves.map((l) => gEdge(hubOf(t), l)),
      at,
    );
    return leaves.map((l) => gEdge(hubOf(t), l).id);
  }

  /** Rebuild `t` `rounds` times, each swapping its single edge. 2 history rows a round. */
  function churn(store: GraphStore, t: TenantScope, rounds: number): void {
    for (let r = 1; r <= rounds; r += 1) {
      const leaf = `${t.tenantId}:flood-${r}`;
      store.apply(
        [gNode(hubOf(t)), gNode(leaf)],
        [gEdge(hubOf(t), leaf)],
        `2026-02-01T00:00:${String(r % 60).padStart(2, '0')}.000Z`,
      );
    }
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'np-retention-graph-'));
    path = join(dir, 'graph.json');
    scope = null;
  });
  afterEach(async () => {
    await Promise.all(opened.map((s) => s.flush()));
    opened.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('a tenant driven far past the cap does not cost the other two a single row', async () => {
    const store = await open(path, 20);

    scope = A;
    seed(store, A, A_ROWS, AT);
    scope = B;
    const bEdges = seed(store, B, B_ROWS, AT);
    scope = C;
    const cEdges = seed(store, C, C_ROWS, AT);

    // Everyone starts with exactly what they wrote.
    scope = A;
    expect(store.historyFor({ id: hubOf(A), limit: 1000 })).toHaveLength(A_ROWS);
    scope = B;
    expect(store.historyFor({ id: hubOf(B), limit: 1000 })).toHaveLength(B_ROWS);
    scope = C;
    expect(store.historyFor({ id: hubOf(C), limit: 1000 })).toHaveLength(C_ROWS);

    /**
     * A rebuilds 40 times. That is 3 seed rows + 3 removals + 40 additions + 39
     * removals = 85 history rows against a cap of 20, so eviction has run many
     * times over — under the install-wide slice this alone was 4x the whole log.
     */
    scope = A;
    churn(store, A, 40);
    const aHistory = store.historyFor({ id: hubOf(A), limit: 1000 });
    expect(aHistory).toHaveLength(20);

    // A KEPT ITS NEWEST. The last rebuild's edge is present, the first seed is gone.
    const aEdgeIds = aHistory.map((h) => h.edgeId);
    expect(aEdgeIds).toContain(gEdge(hubOf(A), `${A.tenantId}:flood-40`).id);
    expect(aEdgeIds).not.toContain(gEdge(hubOf(A), leafOf(A, 1)).id);

    // THE NUMBERS THAT MATTER: B and C are untouched, by count and by identity.
    scope = B;
    const bHistory = store.historyFor({ id: hubOf(B), limit: 1000 });
    expect(bHistory).toHaveLength(B_ROWS);
    expect(bHistory.map((h) => h.edgeId).sort()).toEqual([...bEdges].sort());

    scope = C;
    const cHistory = store.historyFor({ id: hubOf(C), limit: 1000 });
    expect(cHistory).toHaveLength(C_ROWS);
    expect(cHistory.map((h) => h.edgeId).sort()).toEqual([...cEdges].sort());
  });

  it('every persisted history row carries the rebuilding tenant, stamped at write time', async () => {
    const store = await open(path, 20);
    scope = A;
    seed(store, A, A_ROWS, AT);
    churn(store, A, 40);
    scope = B;
    seed(store, B, B_ROWS, AT);
    scope = C;
    seed(store, C, C_ROWS, AT);
    await store.flush();

    const file = JSON.parse(await fs.readFile(path, 'utf8')) as {
      history: Array<{ tenantId?: string | null; workspaceId?: string | null }>;
    };

    // NOT ONE UNOWNED ROW ON DISK. The owner is on the row, not on a filter.
    expect(file.history.every((h) => typeof h.tenantId === 'string' && h.tenantId !== '')).toBe(true);
    // Tenant-level, like the nodes and edges beside them.
    expect(file.history.every((h) => h.workspaceId === null)).toBe(true);

    const byTenant = tally(file.history.map((h) => h.tenantId as string));
    expect(byTenant[A.tenantId]).toBe(20); // A's own cap, and only A's rows
    expect(byTenant[B.tenantId]).toBe(B_ROWS);
    expect(byTenant[C.tenantId]).toBe(C_ROWS);
    expect(file.history).toHaveLength(20 + B_ROWS + C_ROWS);
  });

  it('the history read is scoped on the ROW, not only on the endpoint nodes', async () => {
    const store = await open(path, 20);
    scope = B;
    seed(store, B, B_ROWS, AT);

    // A cannot reach B's history by naming B's anchor.
    scope = A;
    expect(store.historyFor({ id: hubOf(B), limit: 1000 })).toEqual([]);
    // Nor with no organization active at all.
    scope = null;
    expect(store.historyFor({ id: hubOf(B), limit: 1000 })).toEqual([]);
  });

  it('a pre-Round-9 row has no owner: nobody reads it, and nobody can evict it', async () => {
    const legacyPath = join(dir, 'legacy-graph.json');
    const legacyEdge = gEdge(hubOf(B), leafOf(B, 1));
    await fs.writeFile(
      legacyPath,
      JSON.stringify({
        nodes: [
          { ...gNode(hubOf(B)), tenantId: B.tenantId, workspaceId: null },
          { ...gNode(leafOf(B, 1)), tenantId: B.tenantId, workspaceId: null },
        ],
        edges: [{ ...legacyEdge, tenantId: B.tenantId, workspaceId: null }],
        // The shape Round 9 inherited: a history row with NO owner field at all.
        history: [
          {
            at: AT,
            edgeId: legacyEdge.id,
            type: 'belongs_to',
            from: hubOf(B),
            to: leafOf(B, 1),
            change: 'added',
          },
        ],
        lastBuiltAt: AT,
      }),
    );

    const store = await open(legacyPath, 2);

    // Invisible to the tenant whose nodes it names, and to everyone else.
    scope = B;
    expect(store.historyFor({ id: hubOf(B), limit: 1000 })).toEqual([]);
    scope = A;
    expect(store.historyFor({ id: hubOf(A), limit: 1000 })).toEqual([]);

    // A now writes 20+ rows against a cap of 2. Under the install-wide slice the
    // unowned row is the OLDEST and goes first; it must survive here.
    scope = A;
    seed(store, A, A_ROWS, AT);
    churn(store, A, 12);
    await store.flush();

    const file = JSON.parse(await fs.readFile(legacyPath, 'utf8')) as {
      history: Array<{ tenantId?: string | null; edgeId: string }>;
    };
    const unowned = file.history.filter((h) => h.tenantId === undefined || h.tenantId === null);
    expect(unowned).toHaveLength(1);
    expect(unowned[0]?.edgeId).toBe(legacyEdge.id);
    // And A is held to its own budget rather than to the whole file's.
    expect(file.history.filter((h) => h.tenantId === A.tenantId)).toHaveLength(2);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   F11 — the timeline's live window
   ════════════════════════════════════════════════════════════════════════════ */

describe('F11 — query() and export() are two reads of the same log and must agree', () => {
  let dir: string;
  let scope: TenantScope | null;
  let timeline: TimelineService;
  let clock = 0;

  /** The window size used throughout. Small enough that the counts below overrun it. */
  const WINDOW = 20;

  function ts(): string {
    clock += 1;
    return new Date(Date.UTC(2026, 2, 1, 0, 0, 0) + clock * 1000).toISOString();
  }

  function event(tenantId: string | null, marker: string): PlatformEvent {
    return {
      id: `ev_${randomUUID()}`,
      tenantId,
      type: 'system.ready',
      category: 'system',
      version: 1,
      priority: 'normal',
      timestamp: ts(),
      source: 'retention-test',
      actor: { kind: 'system', id: null },
      resource: null,
      correlationId: 'c',
      causationId: null,
      metadata: { marker },
    };
  }

  function write(t: TenantScope, n: number, marker: string): void {
    for (let i = 0; i < n; i += 1) timeline.append(event(t.tenantId, `${marker}-${i + 1}`));
  }

  beforeEach(async () => {
    clock = 0;
    dir = await fs.mkdtemp(join(tmpdir(), 'np-retention-timeline-'));
    scope = null;
    timeline = new TimelineService({ dir, maxInMemory: WINDOW, flushIntervalMs: 10_000 });
    timeline.bindScope(() => scope);
    await timeline.init();
  });
  afterEach(async () => {
    await timeline.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('agrees for all three tenants when the INSTALL overruns the window but nobody else does', async () => {
    // 15 + 7 + 11 = 33 events against a 20-event window. Under one shared ring
    // buffer the first 13 events written were gone from memory — A's, mostly,
    // but B's and C's too depending only on who wrote when.
    write(A, 15, 'A');
    write(B, B_ROWS, 'B');
    write(C, C_ROWS, 'C');

    for (const [tenant, expected] of [
      [A, 15],
      [B, B_ROWS],
      [C, C_ROWS],
    ] as const) {
      scope = tenant;
      const page = timeline.query({ limit: 1000 });
      const dump = await timeline.export();
      expect(page.total, `${tenant.tenantId} query`).toBe(expected);
      expect(dump.count, `${tenant.tenantId} export`).toBe(expected);
      expect(page.total, `${tenant.tenantId} query vs export`).toBe(dump.count);
      expect(timeline.stats().total).toBe(expected);
    }
  });

  it('a tenant flooding the window costs the other two nothing', async () => {
    write(B, B_ROWS, 'B');
    write(C, C_ROWS, 'C');

    // A writes 200 events into a 20-event window: eviction runs 180 times.
    write(A, 200, 'A');

    scope = B;
    const bPage = timeline.query({ limit: 1000 });
    const bDump = await timeline.export();
    expect(bPage.total).toBe(B_ROWS);
    expect(bDump.count).toBe(B_ROWS);
    expect(bPage.events.map((e) => e.metadata.marker).sort()).toEqual(
      Array.from({ length: B_ROWS }, (_, i) => `B-${i + 1}`).sort(),
    );

    scope = C;
    const cPage = timeline.query({ limit: 1000 });
    const cDump = await timeline.export();
    expect(cPage.total).toBe(C_ROWS);
    expect(cDump.count).toBe(C_ROWS);
    expect(cPage.events.map((e) => e.metadata.marker).sort()).toEqual(
      Array.from({ length: C_ROWS }, (_, i) => `C-${i + 1}`).sort(),
    );

    /**
     * A's OWN window is bounded by A's OWN cap, and holds A's newest. That is not
     * cross-tenant behaviour: it is the same bound every tenant gets, and the
     * durable log still holds all 200 for A's export.
     */
    scope = A;
    const aPage = timeline.query({ limit: 1000 });
    expect(aPage.total).toBe(WINDOW);
    expect(aPage.events.map((e) => e.metadata.marker)).toContain('A-200');
    expect(aPage.events.map((e) => e.metadata.marker)).not.toContain('A-1');
    expect(aPage.events.every((e) => e.tenantId === A.tenantId)).toBe(true);
    expect((await timeline.export()).count).toBe(200);
  });

  it('a restart warms each tenant its own window, not whoever wrote last', async () => {
    write(B, B_ROWS, 'B');
    write(C, C_ROWS, 'C');
    write(A, 200, 'A');
    await timeline.flush();

    // A fresh service over the same durable log — the boot path, which used to
    // take the last 20 LINES of the file and hand every one of them to A.
    const restarted = new TimelineService({ dir, maxInMemory: WINDOW, flushIntervalMs: 10_000 });
    restarted.bindScope(() => scope);
    await restarted.init();
    try {
      scope = B;
      expect(restarted.query({ limit: 1000 }).total).toBe(B_ROWS);
      expect((await restarted.export()).count).toBe(B_ROWS);
      scope = C;
      expect(restarted.query({ limit: 1000 }).total).toBe(C_ROWS);
      expect((await restarted.export()).count).toBe(C_ROWS);
      scope = A;
      expect(restarted.query({ limit: 1000 }).total).toBe(WINDOW);
    } finally {
      await restarted.dispose();
    }
  });

  it('SYSTEM events keep a budget of their own, so no tenant can evict the alerts', async () => {
    const alert: PlatformEvent = {
      ...event(null, 'SYSTEM-ALERT'),
      scopeKind: 'system',
      type: 'runtime.supervisor.critical',
      category: 'runtime',
      priority: 'critical',
    };
    timeline.append(alert);
    write(A, 200, 'A');

    for (const tenant of [A, B, C]) {
      scope = tenant;
      const markers = timeline.query({ limit: 1000 }).events.map((e) => e.metadata.marker);
      expect(markers, `${tenant.tenantId} sees the alert`).toContain('SYSTEM-ALERT');
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   F13 — the gateway audit trail
   ════════════════════════════════════════════════════════════════════════════ */

describe('F13 — one tenant’s traffic cannot delete another tenant’s audit records', () => {
  const paths: string[] = [];
  let scope: TenantScope | null = null;
  let seq = 0;

  /** The per-tenant cap. Above C's 11 rows, so B and C are never at their own limit. */
  const CAP = 50;

  function tempPath(): string {
    const p = join(tmpdir(), `np-retention-gw-${process.pid}-${randomUUID()}.json`);
    paths.push(p);
    return p;
  }

  function entry(tenantId: string | null, marker: string): Omit<GatewayAuditEntry, 'id'> {
    seq += 1;
    return {
      at: new Date(Date.UTC(2026, 3, 1, 0, 0, 0) + seq * 1000).toISOString(),
      tenantId,
      keyId: `key-${marker}`,
      developerId: 'dev-1',
      method: 'GET',
      path: `/v1/resource/${marker}`,
      version: 'v1',
      status: 200,
      reason: 'ok',
      latencyMs: 12,
    };
  }

  function traffic(store: GatewayStore, t: TenantScope, n: number, marker: string): string[] {
    return Array.from({ length: n }, (_, i) => store.record(entry(t.tenantId, `${marker}-${i + 1}`)).id);
  }

  afterEach(async () => {
    for (const p of paths.splice(0)) {
      await fs.rm(p, { force: true }).catch(() => undefined);
      await fs.rm(`${p}.tmp`, { force: true }).catch(() => undefined);
    }
  });

  it('B keeps exactly 7 and C exactly 11 while A writes 500 into a 50-row cap', async () => {
    const store = new GatewayStore(tempPath(), { auditCap: CAP }).bindScope(() => scope);
    await store.load();

    traffic(store, A, A_ROWS, 'A-seed');
    const bIds = traffic(store, B, B_ROWS, 'B');
    const cIds = traffic(store, C, C_ROWS, 'C');

    // 500 requests from A: 453 evictions, all of them A's own.
    traffic(store, A, 500, 'A-flood');

    scope = B;
    const bRows = store.auditEntries(1000);
    expect(bRows).toHaveLength(B_ROWS);
    expect(bRows.map((r) => r.id).sort()).toEqual([...bIds].sort());

    scope = C;
    const cRows = store.auditEntries(1000);
    expect(cRows).toHaveLength(C_ROWS);
    expect(cRows.map((r) => r.id).sort()).toEqual([...cIds].sort());

    // A is held to its OWN cap and keeps its newest.
    scope = A;
    const aRows = store.auditEntries(1000);
    expect(aRows).toHaveLength(CAP);
    expect(aRows[0]?.path).toBe('/v1/resource/A-flood-500');
    expect(aRows.every((r) => r.tenantId === A.tenantId)).toBe(true);

    // Tamper evidence survives per-tenant rotation, and the install-wide totals
    // still add up: nothing was lost that was not the writer's own oldest.
    const report = store.verifyAuditIntegrity();
    expect(report.ok).toBe(true);
    expect(report.retained).toBe(CAP + B_ROWS + C_ROWS);
    expect(store.totalAudit()).toBe(A_ROWS + B_ROWS + C_ROWS + 500);
    await store.flush();
  });

  it('survives a restart with each tenant’s rows and chain intact', async () => {
    const path = tempPath();
    const store = new GatewayStore(path, { auditCap: CAP }).bindScope(() => scope);
    await store.load();
    const bIds = traffic(store, B, B_ROWS, 'B');
    traffic(store, C, C_ROWS, 'C');
    traffic(store, A, 500, 'A-flood');
    await store.flush();

    const reopened = new GatewayStore(path, { auditCap: CAP }).bindScope(() => scope);
    let violated = false;
    reopened.on('integrity-violation', () => (violated = true));
    await reopened.load();

    scope = B;
    expect(reopened.auditEntries(1000)).toHaveLength(B_ROWS);
    expect(reopened.auditEntries(1000).map((r) => r.id).sort()).toEqual([...bIds].sort());
    scope = C;
    expect(reopened.auditEntries(1000)).toHaveLength(C_ROWS);
    expect(reopened.verifyAuditIntegrity().ok).toBe(true);
    expect(violated).toBe(false);
  });

  /**
   * Round 8 kept ONE install-wide chain partly because a per-tenant chain
   * "could not detect an entry deleted from another tenant's section of the same
   * file". Splitting the chain must therefore be shown not to have given that up:
   * a whole tenant's rows are removed from the file here, and the report still
   * says `ok:false`. (The one case the split does give up — removing a tenant's
   * rows AND its chain snapshot together — is named in `verifyAuditIntegrity`.)
   */
  it('DETECTS one tenant’s rows being deleted out of the file', async () => {
    const path = tempPath();
    const store = new GatewayStore(path, { auditCap: CAP }).bindScope(() => scope);
    await store.load();
    traffic(store, A, A_ROWS, 'A');
    traffic(store, B, B_ROWS, 'B');
    traffic(store, C, C_ROWS, 'C');
    await store.flush();

    const raw = JSON.parse(await fs.readFile(path, 'utf8')) as { audit: GatewayAuditEntry[] };
    raw.audit = raw.audit.filter((e) => e.tenantId !== B.tenantId);
    expect(raw.audit).toHaveLength(A_ROWS + C_ROWS);
    await fs.writeFile(path, JSON.stringify(raw));

    const reopened = new GatewayStore(path, { auditCap: CAP }).bindScope(() => scope);
    let violated = false;
    reopened.on('integrity-violation', () => (violated = true));
    await reopened.load();
    expect(reopened.verifyAuditIntegrity().ok).toBe(false);
    expect(violated).toBe(true);
  });

  it('an unowned row is in nobody’s budget: A’s flood does not remove it', async () => {
    const store = new GatewayStore(tempPath(), { auditCap: 5 }).bindScope(() => scope);
    await store.load();
    store.record(entry(null, 'no-credential'));
    traffic(store, A, 200, 'A-flood');

    // Read by nobody (an unowned row is not the reader's) …
    scope = A;
    expect(store.auditEntries(1000).some((r) => r.path.includes('no-credential'))).toBe(false);
    // … and deleted by nobody: 5 of A's + the 1 unowned.
    const counts = store.ownershipCounts();
    expect(counts.total).toBe(6);
    expect(counts.assigned).toBe(5);
    expect(counts.unresolved).toBe(1);
    await store.flush();
  });

  /**
   * A pre-Round-9 file has ONE install-wide chain. Splitting it must verify the
   * legacy form FIRST, so an upgrade cannot launder a tampered log into a clean
   * one — and must keep the accounting, so `totalAudit()` does not reset.
   */
  it('migrates a legacy install-wide chain without losing its verdict or its count', async () => {
    const path = tempPath();
    const seedStore = new GatewayStore(path, { auditCap: CAP }).bindScope(() => scope);
    await seedStore.load();
    traffic(seedStore, A, A_ROWS, 'A');
    traffic(seedStore, B, B_ROWS, 'B');
    await seedStore.flush();

    // Rewrite the file in the pre-Round-9 shape: one chain over the whole array.
    const { AuditChain } = await import('../security/auditChain');
    const rows = (JSON.parse(await fs.readFile(path, 'utf8')) as { audit: GatewayAuditEntry[] }).audit;
    const canonical = (e: GatewayAuditEntry): string =>
      JSON.stringify({
        at: e.at,
        developerId: e.developerId,
        id: e.id,
        keyId: e.keyId,
        latencyMs: e.latencyMs,
        method: e.method,
        path: e.path,
        reason: e.reason,
        status: e.status,
        ...(e.tenantId ? { tenantId: e.tenantId } : {}),
        version: e.version,
      });
    const legacy = new AuditChain<GatewayAuditEntry>(canonical, 'api-gateway');
    legacy.rebuild(rows);
    await fs.writeFile(path, JSON.stringify({ audit: rows, integrity: legacy.snapshot() }));

    const migrated = new GatewayStore(path, { auditCap: CAP }).bindScope(() => scope);
    let violated = false;
    migrated.on('integrity-violation', () => (violated = true));
    await migrated.load();
    expect(violated).toBe(false);
    expect(migrated.verifyAuditIntegrity().ok).toBe(true);
    expect(migrated.totalAudit()).toBe(A_ROWS + B_ROWS);

    // And retention is per tenant from here on: A floods, B keeps its 7.
    traffic(migrated, A, 500, 'A-flood');
    scope = B;
    expect(migrated.auditEntries(1000)).toHaveLength(B_ROWS);
    scope = A;
    expect(migrated.auditEntries(1000)).toHaveLength(CAP);
    await migrated.flush();
  });

  it('a legacy chain that was ALREADY broken stays broken across the split and a restart', async () => {
    const path = tempPath();
    const seedStore = new GatewayStore(path, { auditCap: CAP }).bindScope(() => scope);
    await seedStore.load();
    traffic(seedStore, A, A_ROWS, 'A');
    traffic(seedStore, B, B_ROWS, 'B');
    await seedStore.flush();

    const { AuditChain } = await import('../security/auditChain');
    const rows = (JSON.parse(await fs.readFile(path, 'utf8')) as { audit: GatewayAuditEntry[] }).audit;
    const canonical = (e: GatewayAuditEntry): string => JSON.stringify({ id: e.id, at: e.at, status: e.status });
    const legacy = new AuditChain<GatewayAuditEntry>(canonical, 'api-gateway');
    legacy.rebuild(rows);
    const forged = rows.map((r, i) => (i === 1 ? { ...r, status: 999 } : r));
    await fs.writeFile(path, JSON.stringify({ audit: forged, integrity: legacy.snapshot() }));

    const migrated = new GatewayStore(path, { auditCap: CAP }).bindScope(() => scope);
    let violated = false;
    migrated.on('integrity-violation', () => (violated = true));
    await migrated.load();
    expect(violated).toBe(true);
    expect(migrated.verifyAuditIntegrity().ok).toBe(false);

    // The split wrote the breach to the file, so a later load still reports it.
    traffic(migrated, A, 1, 'A-after');
    await migrated.flush();
    const again = new GatewayStore(path, { auditCap: CAP }).bindScope(() => scope);
    let violatedAgain = false;
    again.on('integrity-violation', () => (violatedAgain = true));
    await again.load();
    expect(again.verifyAuditIntegrity().ok).toBe(false);
    expect(violatedAgain).toBe(true);
  });
});
