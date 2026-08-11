/**
 * ROUND 10 — two proven cross-tenant defects, with three tenants in the fixture.
 *
 * Both findings below were demonstrated by an executed exploit before the fix,
 * and each test here is written as that exploit rather than as a restatement of
 * the patch. A third tenant (C) is present throughout because a two-tenant
 * fixture cannot distinguish "isolated" from "the write went to the wrong
 * place": with A, B and C, a leak has somewhere to land that is not the victim.
 *
 * ── NEW-H3 · sandbox/validation/runStore.ts ──────────────────────────────────
 *
 * The validation run store kept the newest 200 runs on ONE shared array, in two
 * places: `add()` sliced the array after every push, and `snapshot()` sliced it
 * again on every debounced save — so the truncation was WRITTEN TO DISK and
 * survived a restart. Reads were already scoped (`all`, `recent`, `get`,
 * `history`, `count` all go through `onlyMine`/`mine`) and `update` had been
 * hardened against a write-side IDOR. The cap sat between them, unpartitioned.
 *
 * PROVEN: tenant B held 4 certification runs; tenant A submitted 200 of its
 * own; B's `all()` returned 0 and `history()` returned 0. A certification
 * history is the evidence of what was validated and at what level, and the
 * runIds in it unlock the full reports — destroyed by another tenant's ordinary
 * use of the product, with no privileged call and nothing displayed to A.
 *
 * ── NEW-H4 · memory/memoryRetriever.ts ───────────────────────────────────────
 *
 * `LexicalMemoryRetriever` was indexed over EVERY tenant's memories, because
 * `memoryStore.reindex()` hands it `[...this.items.values()]` from a file that
 * holds them all. Two separate defects lived in the gap between that global
 * index and the per-viewer filter the store applied afterwards:
 *
 *   (a) CANDIDATE STARVATION AND A DIVERGENCE. `search()` took the GLOBAL
 *       top-N and only then did the caller filter to the viewer. PROVEN: A
 *       recalled its own memory (1 hit); B wrote 200 notes containing the same
 *       term; A's recall for its OWN memory dropped to 0 hits while `counts()`
 *       and `allItems()` — which never touch the index — still saw it. One
 *       tenant could make another unable to find their own data, and two reads
 *       of the same data disagreed about whether it existed.
 *
 *   (b) A NUMERIC ORACLE. `N` was the global document count, the idf used the
 *       global posting list, and the normaliser was a top score that could
 *       belong to another tenant's document. The value reaches the renderer as
 *       `MemoryHit.ranking.lexicalScore`. PROVEN: A's score FOR ITS OWN MEMORY
 *       moved 1 → 0.453 → 0.229 as B's private corpus grew — a binary search
 *       over another tenant's vocabulary and document counts that never returns
 *       a record.
 *
 * Filtering after a global ranking cannot fix either: (a) happens before the
 * filter runs and (b) was computed before the filter runs. The INDEX is
 * partitioned now, per audience, the way `unified/searchBackend.ts` already
 * partitions `byTenant` for the same attack.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MemoryViewer, TenantScope, ValidationRun } from '@neuropause/shared';
import { ValidationRunStore } from '../sandbox/validation/runStore';
import { MemoryStore } from '../memory/memoryStore';
import { OTHER_TENANT_SCOPE, TEST_TENANT_SCOPE } from './testScope';

/* ══════════════════════════════════════════════════════════════════════════
 * NEW-H3 — the validation run retention cap
 * ══════════════════════════════════════════════════════════════════════════ */

const RUN_A = TEST_TENANT_SCOPE;
const RUN_B = OTHER_TENANT_SCOPE;
/** A THIRD tenant. Neither the attacker nor the primary victim. */
const RUN_C: TenantScope = { tenantId: 'org-third', workspaceId: 'workspace-third' };

/** The per-owner budget in `runStore.ts`. A must exceed it to trigger retention. */
const CAP = 200;
const A_RUNS = 205;
const B_RUNS = 7;
const C_RUNS = 11;

/**
 * Marker strings, so a surviving row is identified by its CONTENT and not only
 * by its id. A test that checked ids alone would pass against a store that kept
 * the right number of rows with the wrong bodies.
 */
const MARK_A = 'NP-R10-RUN-A-51720';
const MARK_B = 'NP-R10-RUN-B-88431';
const MARK_C = 'NP-R10-RUN-C-20964';

function makeRun(id: string, marker: string, at: string): ValidationRun {
  return {
    id,
    pipeline: 'release-candidate',
    trigger: 'manual',
    status: 'passed',
    startedAt: at,
    finishedAt: at,
    durationMs: 60_000,
    stages: [{ id: 's1', name: marker, status: 'pass' } as never],
    metrics: { marker: marker.length },
    certificationLevel: 'certified',
    regressionCount: 0,
  } as ValidationRun;
}

describe('NEW-H3 — validation run retention is per tenant, in memory and on disk', () => {
  let dir: string;
  let path: string;
  let runs: ValidationRunStore;
  let scope: TenantScope | null;
  const opened: ValidationRunStore[] = [];

  /** Open a store on the SAME file, bound to the same switchable scope. */
  async function openRuns(): Promise<ValidationRunStore> {
    const store = new ValidationRunStore(path).bindScope(() => scope);
    await store.load();
    opened.push(store);
    return store;
  }

  /** The ids `who` submitted, in submission order. */
  function submit(who: TenantScope, marker: string, n: number, prefix: string): string[] {
    scope = who;
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = `${prefix}-${i}`;
      // Distinct timestamps, so "newest" is a fact about the data and not about
      // the order the assertions happen to read it in.
      runs.add(makeRun(id, marker, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()));
      ids.push(id);
    }
    return ids;
  }

  let bIds: string[];
  let cIds: string[];
  let aIds: string[];

  beforeEach(async () => {
    dir = join(tmpdir(), `np-r10-runs-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    path = join(dir, 'runs.json');
    scope = RUN_A;
    runs = await openRuns();

    // The victims write FIRST, so the attacker's overflow is what evicts them.
    bIds = submit(RUN_B, MARK_B, B_RUNS, 'run-b');
    cIds = submit(RUN_C, MARK_C, C_RUNS, 'run-c');
    aIds = submit(RUN_A, MARK_A, A_RUNS, 'run-a');
    scope = RUN_A;
  });

  afterEach(async () => {
    for (const s of opened) await s.flush().catch(() => undefined);
    opened.length = 0;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  /** Every assertion about the post-retention state, run against any store. */
  function assertSurvivors(store: ValidationRunStore, where: string): void {
    scope = RUN_B;
    expect(store.count(), `${where}: B's run count`).toBe(B_RUNS);
    expect(store.all().map((r) => r.id).sort(), `${where}: B's run ids`).toEqual([...bIds].sort());
    // Row identity, not just arity: every surviving row is really B's.
    for (const r of store.all()) {
      expect(r.stages[0]?.name, `${where}: B's run body`).toBe(MARK_B);
      expect(r.tenantId).toBe(RUN_B.tenantId);
    }
    expect(store.history(50).map((h) => h.runId).sort(), `${where}: B's history`).toEqual(
      [...bIds].sort(),
    );
    expect(store.history(50).every((h) => h.level === 'certified')).toBe(true);

    scope = RUN_C;
    expect(store.count(), `${where}: C's run count`).toBe(C_RUNS);
    expect(store.all().map((r) => r.id).sort(), `${where}: C's run ids`).toEqual([...cIds].sort());
    for (const r of store.all()) expect(r.stages[0]?.name, `${where}: C's run body`).toBe(MARK_C);
    expect(store.history(50)).toHaveLength(C_RUNS);

    // A is capped at its OWN budget, and it evicted its OWN oldest runs.
    scope = RUN_A;
    expect(store.count(), `${where}: A's run count`).toBe(CAP);
    const kept = new Set(store.all().map((r) => r.id));
    for (const id of aIds.slice(0, A_RUNS - CAP)) {
      expect(kept.has(id), `${where}: A's oldest run ${id} was evicted`).toBe(false);
    }
    for (const id of aIds.slice(A_RUNS - CAP)) {
      expect(kept.has(id), `${where}: A's newest run ${id} survived`).toBe(true);
    }

    // Nobody sees anybody else's markers.
    for (const [who, mine, theirs] of [
      [RUN_A, MARK_A, [MARK_B, MARK_C]],
      [RUN_B, MARK_B, [MARK_A, MARK_C]],
      [RUN_C, MARK_C, [MARK_A, MARK_B]],
    ] as const) {
      scope = who;
      const bodies = store.all().map((r) => r.stages[0]?.name);
      expect(new Set(bodies), `${where}: ${who.tenantId} sees only its own runs`).toEqual(
        new Set([mine]),
      );
      for (const foreign of theirs) expect(bodies).not.toContain(foreign);
    }
    scope = RUN_A;
  }

  it('A blowing the cap does not evict B’s or C’s certification history', () => {
    assertSurvivors(runs, 'in memory');
  });

  it('the surviving history is what a RELOAD FROM DISK produces — snapshot() capped too', async () => {
    await runs.flush();

    // The file itself, before any store interprets it. `snapshot()` used to
    // write `runs.slice(-200)`, so B's and C's rows were physically absent from
    // the JSON — which is why an in-memory-only assertion would have missed
    // half of this bug.
    const raw = JSON.parse(await fs.readFile(path, 'utf8')) as { runs: ValidationRun[] };
    const persisted = raw.runs.map((r) => r.id);
    for (const id of bIds) expect(persisted, 'B is on disk').toContain(id);
    for (const id of cIds) expect(persisted, 'C is on disk').toContain(id);
    expect(raw.runs.filter((r) => r.tenantId === RUN_B.tenantId)).toHaveLength(B_RUNS);
    expect(raw.runs.filter((r) => r.tenantId === RUN_C.tenantId)).toHaveLength(C_RUNS);
    expect(raw.runs.filter((r) => r.tenantId === RUN_A.tenantId)).toHaveLength(CAP);

    const reloaded = await openRuns();
    assertSurvivors(reloaded, 'after reload');
  });

  it('B’s newest run is still B’s newest — retention did not reorder the survivors', () => {
    scope = RUN_B;
    const recent = runs.recent(3);
    expect(recent.map((r) => r.id)).toEqual([bIds[6], bIds[5], bIds[4]]);
  });

  it('B can still write after A’s overflow, and the new run does not displace an old one', () => {
    scope = RUN_B;
    runs.add(makeRun('run-b-late', MARK_B, '2026-03-01T00:00:00.000Z'));
    expect(runs.count()).toBe(B_RUNS + 1);
    expect(runs.get('run-b-late')?.stages[0]?.name).toBe(MARK_B);
    scope = RUN_C;
    expect(runs.count()).toBe(C_RUNS);
  });

  it('A cannot reach a surviving B run by its id, and the ids are real', () => {
    scope = RUN_B;
    expect(runs.get(bIds[0]!)?.stages[0]?.name).toBe(MARK_B); // it exists…
    scope = RUN_A;
    expect(runs.get(bIds[0]!)).toBeNull(); // …and A still cannot have it
    expect(runs.get(cIds[0]!)).toBeNull();
  });

  it('the unowned bucket has its OWN budget: 250 legacy rows cannot evict a tenant’s 7', async () => {
    // A file written before ownership existed. Such rows are visible to nobody,
    // but they are still rows in the file — so under one install-wide budget
    // they and a live tenant would consume each other. They get their own
    // bucket, exactly as `graphStore.historyBucket` gives unowned history one.
    const legacyDir = join(dir, 'legacy');
    await fs.mkdir(legacyDir, { recursive: true });
    const legacyPath = join(legacyDir, 'runs.json');
    const legacy = Array.from({ length: 250 }, (_, i) =>
      makeRun(`run-legacy-${i}`, 'NP-R10-RUN-LEGACY', '2020-01-01T00:00:00.000Z'),
    );
    await fs.writeFile(legacyPath, JSON.stringify({ runs: legacy }));

    let s: TenantScope | null = RUN_B;
    const store = new ValidationRunStore(legacyPath).bindScope(() => s);
    await store.load();
    opened.push(store);

    for (let i = 0; i < B_RUNS; i += 1) {
      store.add(makeRun(`legacy-b-${i}`, MARK_B, '2026-01-01T00:00:00.000Z'));
    }
    // B keeps every one of its runs despite 250 older rows sitting in the file.
    expect(store.count()).toBe(B_RUNS);
    expect(store.all().every((r) => r.stages[0]?.name === MARK_B)).toBe(true);

    const counts = store.ownershipCounts();
    expect(counts.assigned, 'B’s rows are all owned and all present').toBe(B_RUNS);
    // The legacy rows are trimmed to their OWN budget and no further — B's
    // writes did not charge against them, and they did not charge against B's.
    expect(counts.unresolved, 'the unowned bucket keeps its own 200').toBe(CAP);
    expect(counts.total).toBe(CAP + B_RUNS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * NEW-H4 — the memory retrieval index
 * ══════════════════════════════════════════════════════════════════════════ */

const MEM_A: MemoryViewer = { tenantId: 'org-a', workspaceId: 'ws-a', userId: 'ann@a.example' };
const MEM_B: MemoryViewer = { tenantId: 'org-b', workspaceId: 'ws-b', userId: 'bo@b.example' };
const MEM_C: MemoryViewer = { tenantId: 'org-c', workspaceId: 'ws-c', userId: 'cy@c.example' };

const NOW = '2026-01-01T00:00:00.000Z';
/** The contested term. A owns one memory with it; B floods the install with it. */
const TERM = 'invoice deadline';
const B_NOTES = 200;

describe('NEW-H4 — the memory index is partitioned, so one tenant cannot starve or measure another', () => {
  let dir: string;
  let store: MemoryStore;
  /** The active viewer. Mutating this IS the tenant switch. */
  let viewer: MemoryViewer | null;
  let aMemoryId: string;

  /** The single hit A expects for its own memory, or undefined if starved out. */
  function aHit(): { score: number; lexicalScore: number | undefined; id: string } | undefined {
    viewer = MEM_A;
    const hits = store.recall({ text: TERM, limit: 25 }).hits;
    const hit = hits.find((h) => h.item.id === aMemoryId);
    if (!hit) return undefined;
    return { score: hit.score, lexicalScore: hit.ranking?.lexicalScore, id: hit.item.id };
  }

  beforeEach(async () => {
    dir = join(tmpdir(), `np-r10-mem-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    store = new MemoryStore(join(dir, 'memory.json'));
    store.bindViewer(() => viewer);
    await store.load();

    // C has a DIFFERENT corpus — it must be unaffected in both directions, and
    // it must not be able to see the contested term either.
    viewer = MEM_C;
    for (let i = 0; i < 12; i += 1) {
      store.remember(
        { kind: 'note', title: `Warehouse rota ${i}`, content: `pallet forklift rota shift ${i}` },
        NOW,
      );
    }

    // A's ONE memory containing the term.
    viewer = MEM_A;
    aMemoryId = store.remember(
      { kind: 'decision', title: 'Invoice deadline for Q1', content: 'The invoice deadline is the 30th.' },
      NOW,
    ).id;
  });

  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** B writes its 200 notes carrying the same term. This is the attack. */
  function bFloods(): void {
    viewer = MEM_B;
    for (let i = 0; i < B_NOTES; i += 1) {
      store.remember(
        {
          kind: 'note',
          title: `Invoice deadline note ${i}`,
          content: `invoice deadline reminder ${i} for the quarterly invoice deadline run`,
        },
        NOW,
      );
    }
  }

  it('A recalls its own memory both BEFORE and AFTER B writes 200 notes with the same term', () => {
    const before = aHit();
    expect(before, 'A finds its own memory before the flood').toBeDefined();
    expect(before!.id).toBe(aMemoryId);

    bFloods();

    const after = aHit();
    expect(after, 'A STILL finds its own memory after B floods the index').toBeDefined();
    expect(after!.id).toBe(aMemoryId);

    // And A's result set contains nothing of B's, at any limit.
    viewer = MEM_A;
    const wide = store.recall({ text: TERM, limit: 500 }).hits;
    expect(wide).toHaveLength(1);
    expect(wide[0]!.item.id).toBe(aMemoryId);
  });

  it('THE ORACLE: A’s lexicalScore is IDENTICAL before and after B’s corpus grows', () => {
    const before = aHit()!;
    // A has exactly one document in its own corpus, so it is its own top score
    // and normalises to 1. The exact number is asserted, not just its stability:
    // a fix that made the score stable but wrong would be a different bug.
    expect(before.lexicalScore, 'A alone in its own corpus').toBe(1);

    bFloods();
    const afterB = aHit()!;
    expect(afterB.lexicalScore, 'B’s 200 documents did not move A’s score').toBe(
      before.lexicalScore,
    );

    // Grow B's corpus AGAIN — the pre-fix score walked 1 → 0.453 → 0.229 as this
    // happened, which is what made it a binary search over B's vocabulary.
    bFloods();
    const afterMoreB = aHit()!;
    expect(afterMoreB.lexicalScore, 'and a second flood did not move it either').toBe(
      before.lexicalScore,
    );

    // C growing a corpus that does NOT contain the term must not move it either:
    // the global N was the other half of the idf, so an unrelated tenant merely
    // being busy was also observable.
    viewer = MEM_C;
    for (let i = 0; i < 150; i += 1) {
      store.remember({ kind: 'note', title: `Rota ${i}`, content: `forklift pallet ${i}` }, NOW);
    }
    expect(aHit()!.lexicalScore, 'C’s unrelated documents did not move it').toBe(
      before.lexicalScore,
    );
    expect(aHit()!.score, 'nor the blended score').toBe(before.score);
  });

  it('THE ORACLE, ISOLATED: five foreign documents — far too few to starve — must still not move A’s score', () => {
    /**
     * The test above proves the two defects together; a flood large enough to
     * starve the candidate list also happens to move the score. This one
     * separates them. FIVE documents cannot exhaust a candidate budget of
     * `max(limit * 3, 50)`, so starvation is impossible here and the ONLY thing
     * a failure can mean is that another tenant's corpus entered A's idf.
     *
     * That is the exact shape of the reported attack: the score is a channel
     * that carries a number out of another tenant's corpus without ever
     * carrying a record, so it stays open at any corpus size — including one
     * far too small to be noticed as a denial of service.
     */
    const before = aHit()!;
    expect(before.lexicalScore).toBe(1);

    viewer = MEM_B;
    for (let i = 0; i < 5; i += 1) {
      store.remember(
        {
          kind: 'note',
          title: `Invoice deadline note ${i}`,
          content: `invoice deadline reminder ${i} for the quarterly invoice deadline run`,
        },
        NOW,
      );
    }

    const after = aHit();
    expect(after, 'A is not starved by five documents — this is purely about the number').toBeDefined();
    expect(after!.lexicalScore, 'B’s five documents did not enter A’s idf').toBe(1);

    // One more, and one more again: a stable-but-wrong value would still be an
    // oracle if it moved on the second observation.
    viewer = MEM_B;
    store.remember({ kind: 'note', title: 'Invoice deadline extra', content: 'invoice deadline invoice deadline invoice deadline' }, NOW);
    expect(aHit()!.lexicalScore).toBe(1);
    viewer = MEM_C;
    store.remember({ kind: 'note', title: 'Rota extra', content: 'forklift pallet rota' }, NOW);
    expect(aHit()!.lexicalScore).toBe(1);
  });

  it('A’s counts and export stay correct while B floods — the two reads agree', () => {
    viewer = MEM_A;
    const countsBefore = store.counts();
    expect(countsBefore.total).toBe(1);

    bFloods();

    viewer = MEM_A;
    // The divergence in the proof: `counts()`/`allItems()` never touched the
    // index, so they kept seeing the memory that recall had stopped returning.
    expect(store.counts().total).toBe(countsBefore.total);
    expect(store.counts().byKind).toEqual(countsBefore.byKind);
    expect(store.allItems().map((i) => i.id)).toEqual([aMemoryId]);
    expect(store.get(aMemoryId)?.id).toBe(aMemoryId);
    // Recall and the counts now say the same thing, which is the invariant.
    expect(store.recall({ text: TERM, limit: 25 }).hits).toHaveLength(1);
  });

  it('B’s own recall works — the boundary is not "everyone gets nothing"', () => {
    bFloods();
    viewer = MEM_B;
    const hits = store.recall({ text: TERM, limit: 25 }).hits;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.item.owner?.tenantId === MEM_B.tenantId)).toBe(true);
    expect(hits.map((h) => h.item.id)).not.toContain(aMemoryId);
    expect(store.counts().total).toBe(B_NOTES);
    expect(store.allItems().every((i) => i.owner?.tenantId === MEM_B.tenantId)).toBe(true);
  });

  it('C is isolated in both directions: its corpus is its own and the term is invisible to it', () => {
    bFloods();
    viewer = MEM_C;
    expect(store.recall({ text: TERM, limit: 25 }).hits, 'C cannot see the contested term').toEqual(
      [],
    );
    const own = store.recall({ text: 'forklift pallet', limit: 25 }).hits;
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((h) => h.item.owner?.tenantId === MEM_C.tenantId)).toBe(true);
    expect(store.counts().total).toBe(12);
    expect(store.allItems().every((i) => i.owner?.tenantId === MEM_C.tenantId)).toBe(true);
  });

  it('the candidate COUNT is not an oracle either — a foreign term reports zero candidates', async () => {
    bFloods();
    viewer = MEM_C;
    // `lexicalCandidates` is returned to the renderer. Before the index was
    // partitioned it counted documents from every tenant, so `hits: []` with a
    // positive candidate count told C the term exists on this install.
    const res = await store.recallSemantic({ text: TERM, limit: 25 }, MEM_C.tenantId);
    expect(res.hits).toEqual([]);
    expect(res.retrieval?.lexicalCandidates ?? 0).toBe(0);
  });

  it('a colleague’s PERSONAL corpus is not in my idf either — the key is the visibility key, not the tenant', () => {
    /**
     * The one place this design goes further than `unified/searchBackend.ts`,
     * which keys `byTenant` on `tenantId` alone. A colleague shares A's tenant
     * AND workspace, so a tenant-keyed partition would have closed the oracle
     * between organizations and left it open between people — and PERSONAL
     * memory is one human's private notes, which is where it matters most.
     *
     * The detector is a RATIO, not a top score. A single result always
     * normalises to 1, so the only way to observe idf is to compare documents
     * against each other: the two notes below are deliberately symmetric under
     * the query (`invoice`-heavy vs `deadline`-heavy, same shape), so they score
     * EQUAL while the corpus is the colleague's own. A's private notes mention
     * only `invoice`, so if they entered the corpus they would depress
     * idf(invoice) alone and the symmetry would break.
     */
    const colleague: MemoryViewer = { ...MEM_A, userId: 'zed@a.example' };
    viewer = colleague;
    const heavyInvoice = store.remember(
      { kind: 'note', title: 'Invoice ledger', content: 'invoice invoice invoice deadline' },
      NOW,
      { visibility: 'personal' },
    );
    const heavyDeadline = store.remember(
      { kind: 'note', title: 'Deadline plan', content: 'deadline deadline deadline invoice' },
      NOW,
      { visibility: 'personal' },
    );

    const scores = (): Map<string, number | undefined> =>
      new Map(
        store.recall({ text: TERM, limit: 25 }).hits.map((h) => [h.item.id, h.ranking?.lexicalScore]),
      );

    const before = scores();
    // A's TENANT memory is readable by the colleague — the boundary is not a
    // wall inside one organization — and A's personal notes are not.
    expect([...before.keys()].sort()).toEqual(
      [aMemoryId, heavyInvoice.id, heavyDeadline.id].sort(),
    );
    expect(before.get(heavyInvoice.id), 'symmetric under the query').toBe(1);
    expect(before.get(heavyDeadline.id), 'symmetric under the query').toBe(1);

    // A now writes 40 PERSONAL notes mentioning only one of the two terms.
    viewer = MEM_A;
    for (let i = 0; i < 40; i += 1) {
      store.remember(
        { kind: 'note', title: `Private ${i}`, content: 'invoice invoice invoice' },
        NOW,
        { visibility: 'personal' },
      );
    }

    viewer = colleague;
    const after = scores();
    expect(after, 'A’s private corpus moved nothing the colleague sees').toEqual(before);
    // Not vacuously equal: the map is non-empty and every key is a live memory.
    expect(after.size).toBe(3);
    for (const id of after.keys()) expect(store.get(id)).not.toBeNull();

    // And A still reads its own, unchanged.
    viewer = MEM_A;
    expect(store.recall({ text: TERM, limit: 100 }).hits.map((h) => h.item.id)).toContain(
      aMemoryId,
    );
    expect(store.recall({ text: TERM, limit: 100 }).hits.map((h) => h.item.id)).not.toContain(
      heavyInvoice.id,
    );
  });

  it('the partition survives a RELOAD FROM DISK — it is rebuilt from stamped owners, not from who is signed in', async () => {
    bFloods();
    await store.flush();

    viewer = MEM_B; // reload while signed in as the attacker
    const reopened = new MemoryStore(join(dir, 'memory.json'));
    reopened.bindViewer(() => viewer);
    await reopened.load();

    viewer = MEM_A;
    const hits = reopened.recall({ text: TERM, limit: 25 }).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.item.id).toBe(aMemoryId);
    expect(hits[0]!.ranking?.lexicalScore).toBe(1);
    expect(reopened.counts().total).toBe(1);

    viewer = MEM_C;
    expect(reopened.recall({ text: TERM, limit: 25 }).hits).toEqual([]);
    expect(reopened.counts().total).toBe(12);
    await reopened.flush();
  });

  it('an unresolved viewer retrieves nothing at all — unbound denies, it does not widen', () => {
    bFloods();
    viewer = null;
    expect(store.recall({ text: TERM, limit: 25 }).hits).toEqual([]);
    expect(store.counts().total).toBe(0);
    expect(store.allItems()).toEqual([]);
  });
});
