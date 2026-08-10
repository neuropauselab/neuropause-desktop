/**
 * The cross-domain attack matrix: Unified Store, Search, Graph, AI retrieval (P13B).
 *
 * Same construction as the memory and provenance matrices — ONE store of each
 * kind, ONE file each, TWO tenants, and `scope` is a mutable variable the stores
 * read through their bindings, so switching tenant is the operation the app
 * performs rather than a re-construction that would make every assertion pass
 * for the wrong reason.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE MEMORY ONE. Program 13A secured the
 * leaves. These four are the ROOT: the unified store is what memory and the
 * graph project FROM, the index is a second copy of it, and the AI context
 * builder fans out to all three. A boundary on the leaves with none at the root
 * is a boundary that launders — which is precisely the limitation 13A recorded
 * and could not fix from inside Memory.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  GraphEdge,
  GraphNode,
  TenantScope,
  UnifiedEntity,
  UnifiedEntityKind,
} from '@neuropause/shared';
import { UnifiedStore } from '../unified/unifiedStore';
import { GraphStore } from '../graph/graphStore';
import { makeUnifiedId } from '../unified/ids';
import { runEnterpriseSearch } from '../search/enterpriseSearch';
import { MemoryStore } from '../memory/memoryStore';

const NOW = '2026-08-10T12:00:00.000Z';

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };

/** The canary. If this string ever reaches tenant B, the boundary failed. */
const A_SECRET = 'CONFIDENTIAL PROJECT PHOENIX NP-A-8472';

describe('the data fabric: two tenants, one install', () => {
  let dir: string;
  let store: UnifiedStore;
  let graph: GraphStore;
  let memory: MemoryStore;
  /** The active scope. Mutating this IS the tenant switch. */
  let scope: TenantScope | null;

  /** A record in the CALLER's tenant, with a tenant-qualified id. */
  function entity(
    tenant: TenantScope,
    kind: UnifiedEntityKind,
    sourceId: string,
    title: string,
    body: string,
  ): UnifiedEntity {
    return {
      id: makeUnifiedId(tenant.tenantId, 'hubspot', 'acct-shared', kind, sourceId),
      kind,
      connectorId: 'hubspot',
      accountId: 'acct-shared',
      sourceId,
      createdAt: NOW,
      updatedAt: NOW,
      syncState: 'active',
      syncedAt: NOW,
      metadata: {},
      title,
      url: null,
      parentId: null,
      containerId: null,
      body,
      status: null,
      author: null,
      timestamp: NOW,
      endTimestamp: null,
      labels: [],
    };
  }

  beforeEach(async () => {
    dir = join(tmpdir(), `np-fabric-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    store = new UnifiedStore(join(dir, 'unified.json')).bindScope(() => scope);
    graph = new GraphStore(join(dir, 'graph.json')).bindScope(() => scope);
    memory = new MemoryStore(join(dir, 'memory.json'));
    memory.bindViewer(() =>
      scope === null ? null : { tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: 'u@x' },
    );
    await store.load();
    await graph.load();
    await memory.load();

    /**
     * TENANT A: one record per business domain, as Phase 33 requires. Every one
     * carries the canary, so a leak through ANY domain is caught by the same
     * assertion rather than by remembering to check each.
     */
    scope = A;
    await store.upsertMany([
      entity(A, 'organization', 'a-fin', 'A-FIN Finance', `Finance. ${A_SECRET}`),
      entity(A, 'contact', 'a-crm', 'A-CRM Customer', `CRM. ${A_SECRET}`),
      entity(A, 'task', 'a-erp', 'A-ERP Order', `ERP. ${A_SECRET}`),
      entity(A, 'contact', 'a-hr', 'A-HR Employee', `HR. ${A_SECRET}`),
      entity(A, 'document', 'a-doc', 'A-DOC Contract', `Document. ${A_SECRET}`),
    ]);

    scope = B;
    await store.upsertMany([
      entity(B, 'organization', 'b-fin', 'B-FIN Finance', 'Finance for B'),
      entity(B, 'contact', 'b-crm', 'B-CRM Customer', 'CRM for B'),
    ]);

    scope = A;
  });

  afterEach(async () => {
    /**
     * Flush EVERY store before removing the directory.
     *
     * All three persist in the background and coalesce, so removing the temp
     * dir first leaves a write landing in a directory that no longer exists —
     * ENOTEMPTY/ENOENT depending on the platform, and a flaky suite. Awaiting
     * each one is the fixture's half of the same durability contract the
     * stores expose.
     */
    await Promise.all([graph.flush(), memory.flush(), store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  /* ── Unified Store ────────────────────────────────────────────────────── */

  it('query, counts and get are all bounded by the caller’s tenant', () => {
    scope = A;
    expect(store.query({ limit: 1_000_000 }).items).toHaveLength(5);
    expect(store.counts().total).toBe(5);

    scope = B;
    const bItems = store.query({ limit: 1_000_000 }).items;
    expect(bItems).toHaveLength(2);
    expect(JSON.stringify(bItems)).not.toContain(A_SECRET);
    expect(store.counts().total).toBe(2);
    // `total` is the pagination count and must agree with what was returned.
    expect(store.query({ limit: 1 }).total).toBe(2);
  });

  it('a direct id is a reference, not an authorization (IDOR)', () => {
    const aDocId = makeUnifiedId('org-a', 'hubspot', 'acct-shared', 'document', 'a-doc');
    scope = B;
    expect(store.get(aDocId)).toBeNull();
    scope = A;
    expect(store.get(aDocId)?.title).toBe('A-DOC Contract');
  });

  it('the same provider object under two tenants is two records, not one', async () => {
    /**
     * THE COLLISION THAT COULD NOT BE FILTERED.
     *
     * Both tenants sync the SAME provider account (`acct-shared`) and the SAME
     * provider object id. Before the tenant entered the identity domain both
     * produced the identical Unified Identifier, so they were one row in one
     * Map — and `upsertMany`'s last-updated-wins merge decided which tenant
     * owned it. No read filter could have separated them; they could not
     * coexist.
     */
    scope = A;
    await store.upsertMany([entity(A, 'contact', 'shared-101', 'Asha (A)', A_SECRET)]);
    scope = B;
    await store.upsertMany([entity(B, 'contact', 'shared-101', 'Ravi (B)', 'B copy')]);

    const bHit = store.query({ limit: 100, kinds: ['contact'] }).items.find((e) => e.sourceId === 'shared-101');
    expect(bHit?.title).toBe('Ravi (B)');
    scope = A;
    const aHit = store.query({ limit: 100, kinds: ['contact'] }).items.find((e) => e.sourceId === 'shared-101');
    expect(aHit?.title).toBe('Asha (A)');
  });

  it('tenant B cannot soft-delete tenant A’s records, singly or in bulk', async () => {
    const aIds = (() => {
      scope = A;
      return store.query({ limit: 1_000_000 }).items.map((e) => e.id);
    })();

    scope = B;
    expect(await store.markDeleted(aIds, NOW)).toBe(0);

    scope = A;
    expect(store.query({ limit: 1_000_000 }).items).toHaveLength(5);
  });

  it('disconnecting a shared connector purges only the disconnecting tenant', async () => {
    scope = B;
    expect(await store.removeConnector('hubspot')).toBe(2);
    expect(store.counts().total).toBe(0);

    scope = A;
    expect(store.counts().total).toBe(5);
  });

  it('the writer’s tenant comes from the active scope, never from the payload', async () => {
    scope = B;
    const forged = { ...entity(B, 'task', 'forged', 'Forged', 'x'), tenantId: 'org-a', workspaceId: 'ws-a' };
    await store.upsertMany([forged]);

    scope = A;
    expect(store.query({ limit: 1_000_000 }).items.map((e) => e.sourceId)).not.toContain('forged');
    scope = B;
    expect(store.query({ limit: 1_000_000 }).items.map((e) => e.sourceId)).toContain('forged');
  });

  it('unbound denies reads and refuses writes', async () => {
    scope = null;
    expect(store.query({ limit: 100 }).items).toEqual([]);
    expect(store.counts().total).toBe(0);
    expect(store.searchBackend.search({ text: 'phoenix' })).toEqual([]);
    await expect(store.upsertMany([entity(A, 'task', 'x', 'x', 'x')])).rejects.toThrow(
      /no organization and workspace are active/i,
    );
  });

  /* ── Search: the existence oracle ─────────────────────────────────────── */

  it('search for another tenant’s exact words returns nothing and reveals nothing', () => {
    scope = B;
    const hits = store.searchBackend.search({ text: 'phoenix confidential' });
    expect(hits).toEqual([]);
    expect(JSON.stringify(hits)).not.toContain(A_SECRET);

    scope = A;
    expect(store.searchBackend.search({ text: 'phoenix' }).length).toBeGreaterThan(0);
  });

  it('index statistics do not disclose another tenant’s corpus size', () => {
    scope = B;
    expect(store.searchBackend.stats()).toEqual({ documents: 2, terms: expect.any(Number) });
    const bTerms = store.searchBackend.stats().terms;
    scope = A;
    expect(store.searchBackend.stats().documents).toBe(5);
    // The two tenants have genuinely different vocabularies, not one shared count.
    expect(store.searchBackend.stats().terms).not.toBe(bTerms);
  });

  /**
   * THE IDF ORACLE, stated as an assertion.
   *
   * TF-IDF weights a term by how RARE it is across the corpus. If the corpus
   * were shared, a term appearing in many of tenant A's documents would score
   * lower for tenant B — so B could measure A's document frequency for any word
   * through a number that merely looks like a relevance score, without ever
   * receiving one of A's records. Partitioning the index makes the scores
   * depend only on the caller's own corpus.
   */
  it('relevance scores do not encode another tenant’s document frequency', async () => {
    scope = B;
    await store.upsertMany([entity(B, 'task', 'b-probe', 'Phoenix probe', 'phoenix phoenix')]);
    const before = store.searchBackend.search({ text: 'phoenix' })[0]?.score;

    // Tenant A now floods its own corpus with the same term.
    scope = A;
    await store.upsertMany(
      Array.from({ length: 20 }, (_, i) =>
        entity(A, 'task', `a-flood-${i}`, `Phoenix ${i}`, 'phoenix phoenix phoenix'),
      ),
    );

    scope = B;
    const after = store.searchBackend.search({ text: 'phoenix' })[0]?.score;
    expect(after).toBe(before);
  });

  /* ── Graph ────────────────────────────────────────────────────────────── */

  describe('graph traversal', () => {
    const node = (id: string, label: string): GraphNode => ({
      id,
      type: 'entity',
      label,
      sourceKind: 'task',
      sourceId: id,
      connectorId: 'hubspot',
      createdAt: NOW,
      updatedAt: NOW,
      metadata: {},
    });

    beforeEach(() => {
      scope = A;
      graph.apply([node('a1', 'A one'), node('a2', `A two ${A_SECRET}`)], [
        { id: 'a1|rel|a2', type: 'rel', from: 'a1', to: 'a2', label: 'rel', createdAt: NOW, updatedAt: NOW, evidence: null, metadata: {} },
      ], NOW);
      scope = B;
      graph.apply([node('b1', 'B one')], [], NOW);
    });

    it('a rebuild does not destroy the other tenant’s graph', () => {
      scope = A;
      expect(graph.counts().nodes).toBe(2);
      scope = B;
      expect(graph.counts().nodes).toBe(1);
    });

    it('node reads, search and counts are scoped', () => {
      scope = B;
      expect(graph.getNode('a2')).toBeNull();
      expect(graph.listNodes({ text: 'phoenix' })).toEqual([]);
      expect(graph.counts().nodes).toBe(1);
      expect(JSON.stringify(graph.listNodes({ limit: 100 }))).not.toContain(A_SECRET);
    });

    /**
     * PHASE 17 — the malicious edge is planted and DELIBERATELY LEFT IN PLACE.
     *
     * The point is not that the data is clean; it is that traversal is checked
     * at every hop, so a corrupt or planted edge is a dead end rather than a
     * bridge. Deleting the edge before asserting would test the fixture instead
     * of the boundary.
     */
    it('a cross-tenant edge does not bridge neighbors, subgraph or path', () => {
      scope = B;
      const malicious: GraphEdge = {
        id: 'b1|rel|a2',
        type: 'rel',
        from: 'b1',
        to: 'a2', // tenant A's node
        label: 'planted',
        createdAt: NOW,
        updatedAt: NOW,
        evidence: null,
        metadata: {},
      };
      graph.apply([node('b1', 'B one')], [malicious], NOW);

      // The edge exists and is owned by B; the node on its far side is not.
      const neighbors = graph.neighbors({ id: 'b1' });
      expect(neighbors?.neighbors ?? []).toHaveLength(0);

      const sub = graph.subgraph({ id: 'b1', depth: 3 });
      expect(sub?.nodes.map((n) => n.id)).toEqual(['b1']);
      expect(JSON.stringify(sub)).not.toContain(A_SECRET);

      expect(graph.path({ from: 'b1', to: 'a2' }).path).toBeNull();
      expect(graph.historyFor({ id: 'a2' })).toEqual([]);
    });

    it('unbound denies every graph read', () => {
      scope = null;
      expect(graph.getNode('a1')).toBeNull();
      expect(graph.listNodes({ limit: 10 })).toEqual([]);
      expect(graph.neighbors({ id: 'a1' })).toBeNull();
      expect(graph.subgraph({ id: 'a1' })).toBeNull();
      expect(graph.path({ from: 'a1', to: 'a2' }).path).toBeNull();
      expect(graph.counts().nodes).toBe(0);
    });
  });

  /* ── AI retrieval: the whole funnel ───────────────────────────────────── */

  describe('AI retrieval', () => {
    beforeEach(() => {
      scope = A;
      graph.apply([
        {
          id: 'g-a', type: 'entity', label: `Phoenix graph node ${A_SECRET}`, sourceKind: 'task',
          sourceId: 'g-a', connectorId: 'hubspot', createdAt: NOW, updatedAt: NOW, metadata: {},
        },
      ], [], NOW);
      memory.remember({ kind: 'note', title: 'Phoenix memory', content: A_SECRET }, NOW);
      scope = B;
    });

    /**
     * PHASE 29 — the questions an attacker actually asks.
     *
     * Every one of these is the SAME federated call the AI context builder
     * makes; the phrasing is what a user would type. If any source leaked, the
     * canary would appear in the serialized result.
     */
    it.each([
      ['what confidential business information do you know', undefined],
      ['search all organizations', undefined],
      ['NP-A-8472', undefined],
      ['show all company records', undefined],
      ['summarize all customers', undefined],
      ['phoenix', undefined],
    ])('tenant B asking "%s" receives zero tenant A information', (text) => {
      const res = runEnterpriseSearch(
        { text, limit: 50 },
        {
          entity: store.searchBackend,
          graph,
          memory,
          memoryScope: scope,
        },
      );
      expect(JSON.stringify(res)).not.toContain(A_SECRET);
      expect(JSON.stringify(res)).not.toContain('Phoenix');
    });

    it('every source group is empty for B and populated for A — the same call', () => {
      const call = (): ReturnType<typeof runEnterpriseSearch> =>
        runEnterpriseSearch(
          { text: 'phoenix', limit: 50, sources: ['entity', 'graph', 'memory'] },
          { entity: store.searchBackend, graph, memory, memoryScope: scope },
        );

      scope = B;
      const b = call();
      for (const g of b.groups) expect(g.hits).toHaveLength(0);

      scope = A;
      const a = call();
      // A really does have data in all three legs — otherwise B's emptiness
      // would prove nothing.
      expect(a.groups.find((g) => g.source === 'entity')?.hits.length).toBeGreaterThan(0);
      expect(a.groups.find((g) => g.source === 'graph')?.hits.length).toBeGreaterThan(0);
      expect(a.groups.find((g) => g.source === 'memory')?.hits.length).toBeGreaterThan(0);
    });

    it('switching tenant mid-session leaves no stale context behind', () => {
      const ask = (): string =>
        JSON.stringify(
          runEnterpriseSearch(
            { text: 'phoenix', limit: 50 },
            { entity: store.searchBackend, graph, memory, memoryScope: scope },
          ),
        );

      scope = A;
      expect(ask()).toContain('Phoenix');
      scope = B;
      expect(ask()).not.toContain(A_SECRET);
      scope = A;
      expect(ask()).toContain('Phoenix');
    });
  });

  /* ── findings from the adversarial review ─────────────────────────────── */

  /**
   * The sync orchestrator resolved its tenant once per RUN and the store
   * stamped ownership once per PAGE. A paginated sync that spanned a workspace
   * switch therefore wrote its later pages into the tenant that happened to be
   * active by then — and `recordInScope` reads the stamped field, not the id,
   * so the new tenant read the old tenant's records as its own. The
   * orchestrator's own comment claimed this could not happen.
   */
  it('a write refuses if the active organization changed while it was in flight', async () => {
    scope = A;
    const page = [entity(A, 'task', 'inflight', 'In flight', 'x')];

    // The switch happens between the orchestrator resolving its tenant and the
    // page landing — exactly the window an awaited provider call opens.
    scope = B;
    await expect(store.upsertMany(page, 'org-a')).rejects.toThrow(/changed while this write was in flight/i);

    scope = A;
    expect(store.query({ limit: 1_000_000 }).items.map((e) => e.sourceId)).not.toContain('inflight');
    scope = B;
    expect(store.query({ limit: 1_000_000 }).items.map((e) => e.sourceId)).not.toContain('inflight');
  });

  it('a graph rebuild cannot take over a node id another tenant already owns', () => {
    const shared = (label: string): GraphNode => ({
      id: 'person:shared-handle', // a pre-P13B style un-qualified id
      type: 'person',
      label,
      sourceKind: 'person',
      sourceId: 'shared',
      connectorId: 'slack',
      createdAt: NOW,
      updatedAt: NOW,
      metadata: {},
    });

    scope = A;
    graph.apply([shared(`A person ${A_SECRET}`)], [], NOW);
    scope = B;
    graph.apply([shared('B person')], [], NOW);

    // B did not take it, and cannot read it.
    expect(graph.getNode('person:shared-handle')).toBeNull();
    scope = A;
    expect(graph.getNode('person:shared-handle')?.label).toContain(A_SECRET);
  });

  it('graph counts do not leak another tenant’s build time', () => {
    scope = A;
    graph.apply([
      { id: 'g1', type: 'entity', label: 'A', sourceKind: 'task', sourceId: 'g1', connectorId: null, createdAt: NOW, updatedAt: NOW, metadata: {} },
    ], [], '2026-08-10T09:00:00.000Z');

    scope = B;
    // B has never rebuilt, so it has no build time — not A's.
    expect(graph.counts().lastBuiltAt).toBeNull();
    scope = null;
    expect(graph.counts().lastBuiltAt).toBeNull();
  });

  /* ── projected memory: the 13A limitation, now closed at the source ────── */

  it('a memory projected from the unified store inherits a TRUSTWORTHY owner', () => {
    /**
     * Program 13A stamped projected memories with the projecting viewer's
     * tenant and said plainly that the stamp was not evidence, because the
     * unified store it projected from had no owner of its own. It does now: a
     * projection run as tenant B can only have READ tenant B's entities, so the
     * owner it stamps is derived rather than assumed.
     */
    scope = B;
    const visibleToB = store.query({ limit: 1_000_000 }).items;
    expect(visibleToB.every((e) => e.tenantId === 'org-b')).toBe(true);
    expect(JSON.stringify(visibleToB)).not.toContain(A_SECRET);

    // And the projected ids are tenant-distinct, so two tenants' projections of
    // the "same" provider object no longer collide on one key.
    const aId = makeUnifiedId('org-a', 'hubspot', 'acct-shared', 'document', 'a-doc');
    const bId = makeUnifiedId('org-b', 'hubspot', 'acct-shared', 'document', 'a-doc');
    expect(aId).not.toBe(bId);
  });
});
