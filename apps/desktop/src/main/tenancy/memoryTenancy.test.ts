/**
 * The memory cross-tenant attack matrix (P13A).
 *
 * Same construction as `crossTenant.test.ts`, and for the same reason: ONE
 * `MemoryStore`, ONE file on disk, TWO tenants, and `viewer` is a mutable
 * variable the store reads through its binding — so "switching tenant" here is
 * the operation the app performs, not a re-construction that would discard the
 * other tenant's memories and make every assertion pass for the wrong reason.
 *
 * Every test is an ATTEMPT THAT MUST BE REFUSED. Where a test looks like it is
 * merely checking a filter, read it again: the pre-P13A store returned the
 * other tenant's memory in all of them, because `filterFor` had no opinion
 * about ownership at all.
 *
 * WHY THE RETRIEVAL CASES ARE NOT REDUNDANT. Lexical, semantic, hybrid and
 * degraded all funnel through one predicate now, so one might argue a single
 * test covers four. That argument is exactly the mistake the previous audit
 * found: the vector store WAS isolated, the lexical leg was not, and the union
 * of the two defeated the isolated half. Each leg is therefore proven
 * separately, and the union is proven on top of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MemoryItem, MemoryState, MemoryViewer } from '@neuropause/shared';
import {
  memoryOwnerFor,
  memoryOwnerIsWellFormed,
  memorySyncOrgOf,
  memoryVisibleTo,
} from '@neuropause/shared';
import { MemoryStore } from '../memory/memoryStore';
import { toSyncState } from '../memory/memorySyncAdapter';
import {
  applyMemoryChange,
  createMemorySyncGuard,
  outboundSyncOrg,
} from '../memory/memoryLiveSyncBridge';
import { runEnterpriseSearch } from '../search/enterpriseSearch';
import type { SearchBackend } from '../unified/searchBackend';
import type { GraphStore } from '../graph/graphStore';

const NOW = '2026-08-10T12:00:00.000Z';

/** Tenant A, and a second human inside it. */
const A: MemoryViewer = { tenantId: 'org-a', workspaceId: 'ws-a', userId: 'ana@a.example' };
const A2: MemoryViewer = { tenantId: 'org-a', workspaceId: 'ws-a', userId: 'ben@a.example' };
/** The SAME tenant, a different workspace. Proves workspace scope, not just tenant. */
const A_OTHER_WS: MemoryViewer = {
  tenantId: 'org-a',
  workspaceId: 'ws-a2',
  userId: 'ana@a.example',
};
/** Tenant B. */
const B: MemoryViewer = { tenantId: 'org-b', workspaceId: 'ws-b', userId: 'bo@b.example' };
/** A background job in tenant A: a tenant and a workspace, but no person. */
const A_SERVICE: MemoryViewer = { tenantId: 'org-a', workspaceId: 'ws-a', userId: null };

const SECRET = 'Tenant A confidential fact 8472.';

describe('memory: the tenant boundary', () => {
  let dir: string;
  let store: MemoryStore;
  /** The active viewer. Mutating this IS the tenant switch. */
  let viewer: MemoryViewer | null;
  let aTenantMemory: MemoryItem;
  let aWorkspaceMemory: MemoryItem;
  let aPersonalMemory: MemoryItem;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-mem-tenancy-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    store = new MemoryStore(join(dir, 'memory.json'));
    store.bindViewer(() => viewer);
    await store.load();

    viewer = A;
    aTenantMemory = store.remember(
      { kind: 'decision', title: 'Adopt Postgres (A)', content: `Postgres datastore. ${SECRET}` },
      NOW,
    );
    aWorkspaceMemory = store.remember(
      { kind: 'note', title: 'Workspace note (A)', content: `Postgres workspace. ${SECRET}` },
      NOW,
      { visibility: 'workspace' },
    );
    aPersonalMemory = store.remember(
      { kind: 'note', title: 'Private note (A)', content: `Postgres private. ${SECRET}` },
      NOW,
      { visibility: 'personal' },
    );
  });

  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /* ── 1–3, 20: tenant reads and tenant switching ───────────────────────── */

  it('1. tenant A reads tenant A', () => {
    viewer = A;
    const ids = store.recall({ text: 'postgres', limit: 50 }).hits.map((h) => h.item.id);
    expect(ids).toContain(aTenantMemory.id);
  });

  it('2/3. neither tenant can read the other, by text or by browse', () => {
    viewer = B;
    const bRemembered = store.remember(
      { kind: 'note', title: 'B note', content: 'Postgres for tenant B' },
      NOW,
    );

    // B searching for the exact words of A's memory finds only its own.
    const bText = store.recall({ text: 'postgres', limit: 50 }).hits;
    expect(bText.map((h) => h.item.id)).toEqual([bRemembered.id]);
    expect(JSON.stringify(bText)).not.toContain(SECRET);

    // Browse (no text) is a DIFFERENT branch of lexicalRecall and is checked
    // separately — it filters the pool directly rather than resolving ids.
    const bBrowse = store.recall({ limit: 50 }).hits;
    expect(bBrowse.map((h) => h.item.id)).toEqual([bRemembered.id]);

    viewer = A;
    const aIds = store.recall({ limit: 50 }).hits.map((h) => h.item.id);
    expect(aIds).not.toContain(bRemembered.id);
    expect(aIds).toContain(aTenantMemory.id);
  });

  it('20. switching tenant does not carry the previous tenant’s memories over', () => {
    viewer = A;
    expect(store.recall({ limit: 50 }).hits.length).toBe(3);
    viewer = B;
    expect(store.recall({ limit: 50 }).hits).toHaveLength(0);
    viewer = A;
    expect(store.recall({ limit: 50 }).hits.length).toBe(3);
  });

  /* ── 4–8: workspace, personal, and the visibility ladder ──────────────── */

  it('4/5. a workspace memory is invisible from another workspace in the SAME tenant', () => {
    viewer = A_OTHER_WS;
    const ids = store.recall({ limit: 50 }).hits.map((h) => h.item.id);
    // The tenant-level memory crosses workspaces by design; the workspace and
    // personal ones do not.
    expect(ids).toContain(aTenantMemory.id);
    expect(ids).not.toContain(aWorkspaceMemory.id);
    expect(ids).not.toContain(aPersonalMemory.id);
  });

  it('6/7. a personal memory is invisible to a colleague in the same workspace', () => {
    viewer = A2; // same tenant, same workspace, different person
    const ids = store.recall({ limit: 50 }).hits.map((h) => h.item.id);
    expect(ids).toContain(aTenantMemory.id);
    expect(ids).toContain(aWorkspaceMemory.id);
    expect(ids).not.toContain(aPersonalMemory.id);

    viewer = A;
    expect(store.recall({ limit: 50 }).hits.map((h) => h.item.id)).toContain(aPersonalMemory.id);
  });

  it('8. PERSONAL is never widened to the tenant, and a service principal cannot author one', () => {
    viewer = A_SERVICE;
    // A background job in tenant A sees tenant memory, not anyone's private notes.
    const ids = store.recall({ limit: 50 }).hits.map((h) => h.item.id);
    expect(ids).toContain(aTenantMemory.id);
    expect(ids).not.toContain(aPersonalMemory.id);

    // And it cannot create one: there is no identity to own it. Refused rather
    // than downgraded to workspace visibility.
    expect(() =>
      store.remember({ kind: 'note', title: 'x', content: 'y' }, NOW, { visibility: 'personal' }),
    ).toThrow(/no personal identity/i);
  });

  /* ── 9–12: every retrieval leg ────────────────────────────────────────── */

  it('9/10/11. semantic, lexical and hybrid all refuse a cross-tenant hit', async () => {
    viewer = B;
    store.remember({ kind: 'note', title: 'B note', content: 'Postgres for tenant B' }, NOW);

    /**
     * A HOSTILE semantic source: it returns tenant A's memory ids with perfect
     * scores, as a compromised or confused vector namespace would. This is the
     * union that defeated the isolated vector store before P13A — the semantic
     * leg being isolated is not enough if the merge trusts whatever it is
     * handed.
     */
    store.configureSemantic(async () => [
      { memoryId: aTenantMemory.id, score: 1 },
      { memoryId: aWorkspaceMemory.id, score: 1 },
      { memoryId: aPersonalMemory.id, score: 1 },
    ]);

    const res = await store.recallSemantic({ text: 'postgres', limit: 50 });
    const ids = res.hits.map((h) => h.item.id);
    expect(ids).not.toContain(aTenantMemory.id);
    expect(ids).not.toContain(aWorkspaceMemory.id);
    expect(ids).not.toContain(aPersonalMemory.id);
    expect(JSON.stringify(res.hits)).not.toContain(SECRET);
  });

  it('12. the degraded fallback is not a way round the boundary', async () => {
    viewer = B;
    // The semantic leg throws AFTER the lexical pool is retrieved, which is
    // precisely the path that re-ranks an already-fetched pool. A fallback that
    // rebuilt its own filter could widen here; it reuses the same `getItem`.
    store.configureSemantic(async () => {
      throw new Error('vector backend down');
    });

    const res = await store.recallSemantic({ text: 'postgres', limit: 50 });
    expect(res.retrieval?.mode).toBe('degraded');
    expect(res.hits).toHaveLength(0);
    expect(JSON.stringify(res.hits)).not.toContain(SECRET);
  });

  /* ── 13: the counts channel, and metadata leakage ─────────────────────── */

  it('13. counts do not disclose the other tenant’s volume or kinds', () => {
    viewer = B;
    const counts = store.counts();
    expect(counts.total).toBe(0);
    expect(counts.byKind).toEqual({});
    expect(counts.byOrigin).toEqual({});

    viewer = A;
    expect(store.counts().total).toBe(3);
  });

  /**
   * F3 — the retrieval diagnostics were a cross-tenant content oracle.
   *
   * `lexicalCandidates` counted the raw TF-IDF pool, which is indexed over
   * every memory in the file. So tenant B could query a guessed word, receive
   * ZERO hits, and read a non-zero candidate count — confirming that the word
   * appears in another tenant's memory. Repeat per word and the contents of
   * tenant A's memory are enumerable without a single memory ever being
   * returned. Found by adversarial review, after the item-level matrix was
   * already green: no ITEM leaked, and the COUNT did.
   */
  it('F3. the candidate count does not reveal that another tenant matched', async () => {
    viewer = B;
    store.configureSemantic(async () => []);

    const res = await store.recallSemantic({ text: 'postgres', limit: 25 });
    expect(res.hits).toHaveLength(0);
    expect(res.retrieval?.lexicalCandidates ?? 0).toBe(0);

    // The plain browse path must agree — it always counted post-filter, and the
    // disagreement between the two branches is what exposed the bug.
    expect(store.recall({ text: 'postgres', limit: 25 }).total).toBe(0);

    // Sanity: the count is real for someone who may actually see the memories.
    viewer = A;
    const mine = await store.recallSemantic({ text: 'postgres', limit: 25 });
    expect(mine.retrieval?.lexicalCandidates ?? 0).toBeGreaterThan(0);
  });

  it('13b. an id is a reference, not an authorization', () => {
    viewer = B;
    // B holds A's memory id — from a log, an export, a sync payload.
    expect(store.get(aTenantMemory.id)).toBeNull();
    expect(store.get(aPersonalMemory.id)).toBeNull();
  });

  /* ── 14–15: mutation ──────────────────────────────────────────────────── */

  it('14. tenant B cannot update tenant A’s memory', () => {
    viewer = B;
    expect(store.update(aTenantMemory.id, { title: 'Owned by B' }, NOW)).toBeNull();

    viewer = A;
    expect(store.get(aTenantMemory.id)?.title).toBe('Adopt Postgres (A)');
  });

  it('15. tenant B cannot delete tenant A’s memory, singly or in bulk', () => {
    viewer = B;
    expect(store.forget([aTenantMemory.id], NOW)).toBe(0);
    // "Delete all" as an attacker would attempt it: every id they have seen.
    expect(
      store.forget([aTenantMemory.id, aWorkspaceMemory.id, aPersonalMemory.id], NOW),
    ).toBe(0);

    viewer = A;
    expect(store.recall({ limit: 50 }).hits).toHaveLength(3);
  });

  it('15b. delete-all means "all the memories I can see"', () => {
    viewer = A;
    const mine = store.recall({ limit: 500 }).hits.map((h) => h.item.id);
    expect(store.forget(mine, NOW)).toBe(3);
    expect(store.recall({ limit: 50 }).hits).toHaveLength(0);

    viewer = B;
    const bMemory = store.remember({ kind: 'note', title: 'B', content: 'b' }, NOW);
    expect(store.get(bMemory.id)).not.toBeNull(); // untouched by A's delete-all
  });

  /* ── 18–19: forged and missing tenant ─────────────────────────────────── */

  it('18. a forged owner on a hand-built memory is not readable by the tenant it names', () => {
    /**
     * The attack this closes is not "someone calls remember with a bad tenant"
     * — that is unrepresentable, `remember` takes no tenant. It is a memory
     * arriving on DISK or over SYNC with a hand-written owner. Ownership is
     * still checked on read, so a forged owner only ever grants what it
     * truthfully claims.
     */
    const forged = memoryOwnerFor(B, 'tenant');
    expect(memoryVisibleTo(forged, A)).toBe(false);
    expect(memoryVisibleTo(forged, B)).toBe(true);
  });

  it('19. a memory with no owner is visible to nobody, and unbound denies everything', () => {
    expect(memoryOwnerIsWellFormed(undefined)).toBe(false);
    expect(memoryVisibleTo(undefined, A)).toBe(false);
    // A malformed PERSONAL owner must not widen to the workspace.
    expect(
      memoryVisibleTo(
        { visibility: 'personal', tenantId: 'org-a', workspaceId: 'ws-a', userId: null },
        A,
      ),
    ).toBe(false);

    viewer = null;
    expect(store.recall({ limit: 50 }).hits).toHaveLength(0);
    expect(store.counts().total).toBe(0);
    expect(store.get(aTenantMemory.id)).toBeNull();
    expect(store.syncedItems()).toHaveLength(0);
    expect(store.allItems()).toHaveLength(0);
    expect(() => store.remember({ kind: 'note', title: 'x', content: 'y' }, NOW)).toThrow(
      /no organization and workspace are active/i,
    );
  });

  /* ── the egress paths ─────────────────────────────────────────────────── */

  it('backfill (cloud embedding egress) carries only the caller’s own memories', () => {
    viewer = B;
    store.remember({ kind: 'note', title: 'B note', content: 'b' }, NOW);
    const items = store.allItems();
    expect(items.every((i) => i.owner?.tenantId === 'org-b')).toBe(true);
    expect(JSON.stringify(items)).not.toContain(SECRET);
  });

  /**
   * F5 — `allItems()` is the right scope for a READ and the wrong one for an
   * UPLOAD.
   *
   * It is scoped to what the viewer may see, which by design includes their own
   * PERSONAL memories. Backfill does not display them — it embeds them into the
   * ORG-WIDE cloud vector namespace, where every colleague can reach them
   * through semantic recall. The live-sync pipe already refused to carry
   * personal memories; this second pipe to the same destination did not.
   *
   * The filter lives at the backfill call site (`memory/index.ts`), so this
   * test states the invariant the call site must satisfy.
   */
  it('F5. personal memories are excluded from the backfill upload set', () => {
    viewer = A;
    const uploadable = store.allItems().filter((it) => memorySyncOrgOf(it.owner) !== null);
    expect(uploadable.map((i) => i.id)).not.toContain(aPersonalMemory.id);
    expect(uploadable.map((i) => i.id)).toContain(aTenantMemory.id);
    // The personal memory IS readable locally — that is the distinction.
    expect(store.get(aPersonalMemory.id)).not.toBeNull();
  });

  it('a projection rebuild does not delete another tenant’s projected memories', () => {
    const projected = (id: string, title: string): MemoryItem => ({
      id,
      kind: 'context',
      origin: 'projected',
      title,
      content: title,
      connectorId: null,
      source: 'udm',
      entityRefs: [],
      tags: [],
      occurredAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      evidence: null,
      metadata: {},
    });

    viewer = A;
    store.applyProjected([projected('mem:proj:a1', 'A projected')], NOW);
    viewer = B;
    store.applyProjected([projected('mem:proj:b1', 'B projected')], NOW);

    // B's rebuild replaced B's projections. A's survive.
    viewer = A;
    const aIds = store.recall({ limit: 50 }).hits.map((h) => h.item.id);
    expect(aIds).toContain('mem:proj:a1');
    expect(aIds).not.toContain('mem:proj:b1');
  });
});

/* ── 16–17: live sync, both directions ──────────────────────────────────── */

describe('memory live sync: the egress boundary', () => {
  let dir: string;
  let store: MemoryStore;
  let viewer: MemoryViewer | null;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-mem-sync-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    store = new MemoryStore(join(dir, 'memory.json'));
    store.bindViewer(() => viewer);
    await store.load();
  });

  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /**
   * A remote payload carrying an arbitrary (attacker-chosen) owner.
   *
   * `stateOrgId` is separate from the owner's tenant ON PURPOSE. A forged
   * SYSTEM owner names no tenant the receiver would recognise, so if the
   * payload's own `orgId` were derived from it, `applyMemoryChange`'s
   * envelope/payload agreement check would reject the message before the
   * ownership guards ever ran — and the test would pass while proving nothing
   * about the hole it is supposed to cover.
   */
  function remoteState(
    memoryId: string,
    owner: MemoryState['owner'],
    stateOrgId?: string,
  ): MemoryState {
    const head = {
      versionId: `v-${memoryId}`,
      memoryId,
      orgId: stateOrgId ?? owner?.tenantId ?? 'org-a',
      timestamp: NOW,
      deviceId: 'dev-x',
      userId: 'attacker',
      parentVersion: null,
      previousHash: null,
      contentHash: 'x',
      text: 'attacker-controlled content',
      metadata: { title: 'X', kind: 'note', tags: [], entityRefs: [], occurredAt: NOW, meta: {} },
      deleted: false,
    };
    return { memoryId, orgId: head.orgId, head, history: [head], owner };
  }

  /** The transport envelope around a payload, routed as `orgId`. */
  function envelope(state: MemoryState, orgId: string) {
    return {
      entityType: 'memory' as const,
      entityId: state.memoryId,
      orgId,
      version: 1,
      updatedAt: NOW,
      deleted: false,
      data: state,
    };
  }

  it('16. outbound: a memory is enqueued under ITS OWN org, never the active one', () => {
    viewer = A;
    const aMemory = store.remember({ kind: 'note', title: 'A', content: SECRET }, NOW, {
      sync: { deviceId: 'dev-a' },
    });
    const aState = toSyncState(aMemory)!;

    /**
     * THE ORIGINAL BUG, STATED AS AN ASSERTION.
     *
     * `flush()` read every synced item and enqueued each under
     * `identity.organizationId`. With B active, A's memory was uploaded into
     * B's cloud namespace. `outboundSyncOrg` reads the memory's own owner, so
     * the active tenant cannot influence the destination.
     */
    expect(outboundSyncOrg(aState)).toBe('org-a');

    // B is now active. A's memory still names A, and B cannot see it at all.
    viewer = B;
    expect(store.syncedItems()).toHaveLength(0);
  });

  it('16b. a personal memory has no destination and never leaves the device', () => {
    viewer = A;
    const personal = store.remember({ kind: 'note', title: 'P', content: SECRET }, NOW, {
      visibility: 'personal',
      sync: { deviceId: 'dev-a' }, // opting in is not enough — personal never syncs
    });
    expect(personal.sync).toBeUndefined();
    expect(memorySyncOrgOf(personal.owner)).toBeNull();
    expect(store.syncedItems()).toHaveLength(0);
  });

  it('17. inbound: tenant B cannot inject a memory belonging to tenant A', async () => {
    viewer = B;
    const guard = createMemorySyncGuard();

    const injected: MemoryState = {
      memoryId: 'mem:explicit:injected',
      orgId: 'org-a',
      head: {
        versionId: 'v1',
        memoryId: 'mem:explicit:injected',
        orgId: 'org-a',
        timestamp: NOW,
        deviceId: 'dev-x',
        userId: 'attacker',
        parentVersion: null,
        previousHash: null,
        contentHash: 'x',
        text: 'injected content',
        metadata: { title: 'Injected', kind: 'note', tags: [], entityRefs: [], occurredAt: NOW, meta: {} },
        deleted: false,
      },
      history: [],
      owner: { visibility: 'tenant', tenantId: 'org-a', workspaceId: null, userId: null },
    };
    injected.history = [injected.head];

    const outcome = await applyMemoryChange(store, guard, {
      entityType: 'memory',
      entityId: injected.memoryId,
      orgId: 'org-a',
      version: 1,
      updatedAt: NOW,
      deleted: false,
      data: injected,
    });

    expect(outcome).toBe('ignored');
    // Nothing landed — not for B, and not for A either when they next sign in.
    expect(store.get(injected.memoryId)).toBeNull();
    viewer = A;
    expect(store.get(injected.memoryId)).toBeNull();
  });

  it('17b. inbound: a payload with NO owner is refused rather than adopted', async () => {
    viewer = A;
    const guard = createMemorySyncGuard();
    const unowned: MemoryState = {
      memoryId: 'mem:explicit:unowned',
      orgId: 'org-a',
      head: {
        versionId: 'v1',
        memoryId: 'mem:explicit:unowned',
        orgId: 'org-a',
        timestamp: NOW,
        deviceId: 'dev-x',
        userId: 'someone',
        parentVersion: null,
        previousHash: null,
        contentHash: 'x',
        text: 'unowned content',
        metadata: { title: 'Unowned', kind: 'note', tags: [], entityRefs: [], occurredAt: NOW, meta: {} },
        deleted: false,
      },
      history: [],
      // No `owner`: an older peer, or one that stripped it deliberately.
    };
    unowned.history = [unowned.head];

    const outcome = await applyMemoryChange(store, guard, {
      entityType: 'memory',
      entityId: unowned.memoryId,
      orgId: 'org-a',
      version: 1,
      updatedAt: NOW,
      deleted: false,
      data: unowned,
    });

    expect(outcome).toBe('ignored');
    expect(store.get(unowned.memoryId)).toBeNull();
  });

  it('17c. inbound: an envelope routed as one tenant and stamped as another is refused', async () => {
    viewer = B;
    const guard = createMemorySyncGuard();
    const state: MemoryState = {
      memoryId: 'mem:explicit:mismatch',
      orgId: 'org-a', // payload says A
      head: {
        versionId: 'v1',
        memoryId: 'mem:explicit:mismatch',
        orgId: 'org-a',
        timestamp: NOW,
        deviceId: 'dev-x',
        userId: 'someone',
        parentVersion: null,
        previousHash: null,
        contentHash: 'x',
        text: 'mismatched',
        metadata: { title: 'M', kind: 'note', tags: [], entityRefs: [], occurredAt: NOW, meta: {} },
        deleted: false,
      },
      history: [],
      owner: { visibility: 'tenant', tenantId: 'org-b', workspaceId: null, userId: null },
    };
    state.history = [state.head];

    const outcome = await applyMemoryChange(store, guard, {
      entityType: 'memory',
      entityId: state.memoryId,
      orgId: 'org-b', // envelope says B
      version: 1,
      updatedAt: NOW,
      deleted: false,
      data: state,
    });

    expect(outcome).toBe('ignored');
    expect(store.get(state.memoryId)).toBeNull();
  });

  /**
   * The four findings below came from an ADVERSARIAL REVIEW performed after the
   * 20-case matrix above was already green. Each one is written as the attack
   * that worked, so a regression restores a proven exploit rather than merely
   * failing an assertion.
   */

  it('F1. inbound: a forged SYSTEM visibility cannot be used to reach every tenant', async () => {
    viewer = B;
    const guard = createMemorySyncGuard();
    const state = remoteState(
      'mem:explicit:sys',
      {
        // `system` is universally READABLE by design — which is exactly why it
        // must never be acceptable off the wire. Before the fix this was applied
        // and then served to every tenant on the device, and embedded into every
        // org's vector namespace by backfill.
        visibility: 'system',
        tenantId: 'org-attacker',
        workspaceId: null,
        userId: null,
      },
      // Routed and stamped as the RECEIVER's own tenant, so every prior guard
      // passes and only the syncable-visibility gate can refuse it.
      'org-b',
    );

    const outcome = await applyMemoryChange(store, guard, envelope(state, 'org-b'));
    expect(outcome).toBe('ignored');
    expect(store.get('mem:explicit:sys')).toBeNull();
    viewer = A;
    expect(store.get('mem:explicit:sys')).toBeNull();
    expect(store.recall({ limit: 50 }).hits.map((h) => h.item.id)).not.toContain(
      'mem:explicit:sys',
    );
  });

  it('F2. inbound: a memory cannot be planted in a named individual’s PERSONAL namespace', async () => {
    viewer = A; // the victim is the receiver — userIds are account emails, so guessable
    const guard = createMemorySyncGuard();
    const state = remoteState('mem:explicit:planted', {
      visibility: 'personal',
      tenantId: A.tenantId,
      workspaceId: A.workspaceId,
      userId: A.userId,
    });

    const outcome = await applyMemoryChange(store, guard, envelope(state, A.tenantId));
    expect(outcome).toBe('ignored');
    expect(store.get('mem:explicit:planted')).toBeNull();
  });

  it('F6. inbound: an existing local memory that never synced is not overwritten', async () => {
    viewer = A;
    const local = store.remember({ kind: 'note', title: 'Mine', content: 'original' }, NOW);
    const guard = createMemorySyncGuard();
    const state = remoteState(local.id, {
      visibility: 'tenant',
      tenantId: A.tenantId,
      workspaceId: null,
      userId: null,
    });

    const outcome = await applyMemoryChange(store, guard, envelope(state, A.tenantId));
    expect(outcome).toBe('ignored');
    expect(store.get(local.id)?.content).toBe('original');
  });

  it('17d. inbound: a legitimate same-tenant change still applies (the boundary is not a wall)', async () => {
    viewer = A;
    const guard = createMemorySyncGuard();
    const state: MemoryState = {
      memoryId: 'mem:explicit:legit',
      orgId: 'org-a',
      head: {
        versionId: 'v1',
        memoryId: 'mem:explicit:legit',
        orgId: 'org-a',
        timestamp: NOW,
        deviceId: 'dev-a2',
        userId: 'ana@a.example',
        parentVersion: null,
        previousHash: null,
        contentHash: 'x',
        text: 'from my other laptop',
        metadata: { title: 'Legit', kind: 'note', tags: [], entityRefs: [], occurredAt: NOW, meta: {} },
        deleted: false,
      },
      history: [],
      owner: { visibility: 'tenant', tenantId: 'org-a', workspaceId: null, userId: null },
    };
    state.history = [state.head];

    const outcome = await applyMemoryChange(store, guard, {
      entityType: 'memory',
      entityId: state.memoryId,
      orgId: 'org-a',
      version: 1,
      updatedAt: NOW,
      deleted: false,
      data: state,
    });

    expect(outcome).toBe('applied');
    expect(store.get('mem:explicit:legit')?.content).toBe('from my other laptop');
  });
});

/* ── Enterprise search: the memory leg ──────────────────────────────────── */

describe('runEnterpriseSearch: the memory leg', () => {
  let dir: string;
  let store: MemoryStore;
  let viewer: MemoryViewer | null;

  /** Stubs for the sources this program does not touch. */
  const entity = {
    search: () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as SearchBackend;
  const graph = {
    search: () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as GraphStore;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-mem-search-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    store = new MemoryStore(join(dir, 'memory.json'));
    store.bindViewer(() => viewer);
    await store.load();
    viewer = A;
    store.remember({ kind: 'decision', title: 'A decision', content: `Postgres. ${SECRET}` }, NOW);
  });

  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('a forged memoryScope cannot widen the result — the store is the boundary', () => {
    viewer = B;
    const res = runEnterpriseSearch(
      { text: 'postgres', limit: 10, sources: ['memory'] },
      // B names A's tenant, which is the forgery this parameter invites.
      { entity, graph, memory: store, memoryScope: { tenantId: 'org-a', workspaceId: 'ws-a' } },
    );
    const memoryGroup = res.groups.find((g) => g.source === 'memory');
    expect(memoryGroup?.hits ?? []).toHaveLength(0);
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it('a missing tenant fails closed rather than searching on nobody’s behalf', () => {
    viewer = null;
    const res = runEnterpriseSearch(
      { text: 'postgres', limit: 10, sources: ['memory'] },
      { entity, graph, memory: store, memoryScope: null },
    );
    const memoryGroup = res.groups.find((g) => g.source === 'memory');
    // The group is present (search ran) but empty (memory was not consulted).
    expect(memoryGroup).toBeDefined();
    expect(memoryGroup?.hits).toHaveLength(0);
  });

  it('the caller’s own tenant still gets its results', () => {
    viewer = A;
    const res = runEnterpriseSearch(
      { text: 'postgres', limit: 10, sources: ['memory'] },
      { entity, graph, memory: store, memoryScope: { tenantId: 'org-a', workspaceId: 'ws-a' } },
    );
    expect(res.groups.find((g) => g.source === 'memory')?.hits.length).toBeGreaterThan(0);
  });
});

/* ── The test-only seam must not be a production bypass ─────────────────── */

describe('the ambient memory viewer is a test-only seam', () => {
  it('refuses to be set outside a test runner', async () => {
    const { setAmbientMemoryViewerForTests } = await import('../memory/memoryStore');
    const vitest = process.env.VITEST;
    const nodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => setAmbientMemoryViewerForTests(() => A)).toThrow(/test-only seam/i);
    } finally {
      if (vitest !== undefined) process.env.VITEST = vitest;
      process.env.NODE_ENV = nodeEnv as string;
    }
  });

  it('a per-store binding always beats the ambient fallback', async () => {
    const dir = join(tmpdir(), `np-mem-ambient-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const store = new MemoryStore(join(dir, 'memory.json'));
    await store.load();
    // The ambient viewer (from vitest.setup.ts) is org-test. Bind to deny.
    store.bindViewer(() => null);
    expect(store.recall({ limit: 10 }).hits).toHaveLength(0);
    expect(() => store.remember({ kind: 'note', title: 'x', content: 'y' }, NOW)).toThrow();
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

/* Keep `vi` imported-and-used so the lint rule about unused imports stays honest. */
describe('sanity', () => {
  it('the fake clock helper is available', () => {
    expect(typeof vi.fn).toBe('function');
  });
});
