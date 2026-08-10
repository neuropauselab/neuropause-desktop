import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryItem } from '@neuropause/shared';
import { MemoryStore } from './memoryStore';
import { TEST_MEMORY_VIEWER } from '../tenancy/testScope';
import { SemanticUnavailableError } from './semanticFailure';
import type { SemanticSearchFn } from './memorySemanticRecall';

const NOW = '2026-01-01T00:00:00.000Z';

function projected(id: string, kind: string, title: string, content = title): MemoryItem {
  return {
    id: `mem:${id}`,
    kind: kind as never,
    origin: 'projected',
    title,
    content,
    connectorId: 'github',
    source: 'github',
    entityRefs: [id],
    tags: [],
    occurredAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    evidence: { kind: 'document', id },
    metadata: {},
  };
}

describe('MemoryStore', () => {
  let dir: string;
  let path: string;
  const opened: MemoryStore[] = [];

  async function open(p: string): Promise<MemoryStore> {
    const store = new MemoryStore(p);
    await store.load();
    opened.push(store);
    return store;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'mem-'));
    path = join(dir, 'memory.json');
  });
  afterEach(async () => {
    await Promise.all(opened.map((s) => s.flush()));
    opened.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('remembers explicit items and recalls them by relevance', async () => {
    const store = await open(path);
    const a = store.remember({
      kind: 'decision',
      title: 'Adopt Postgres',
      content: 'We will use Postgres as the primary datastore for the platform',
    });
    store.remember({
      kind: 'note',
      title: 'Standup note',
      content: 'Frontend is blocked on the API',
    });

    expect(a.origin).toBe('explicit');
    expect(a.id.startsWith('mem:explicit:')).toBe(true);

    const res = store.recall({ text: 'postgres datastore' });
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.hits[0]?.item.id).toBe(a.id);
    expect(res.hits[0]?.score).toBeGreaterThan(0);
    expect(res.hits[0]?.score).toBeLessThanOrEqual(1);
    expect(res.retriever).toBe('lexical');
  });

  it('updates an item metadata, bumps updatedAt, and persists; returns null for unknown id', async () => {
    const store = await open(path);
    const a = store.remember({
      kind: 'decision',
      title: 'D',
      content: 'ship it',
      metadata: { pinned: false, status: 'open' },
    });

    const updated = store.update(
      a.id,
      { metadata: { pinned: true, status: 'resolved' } },
      '2026-07-01T00:00:00.000Z',
    );
    expect(updated?.metadata.pinned).toBe(true);
    expect(updated?.metadata.status).toBe('resolved');
    expect(updated?.updatedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(store.update('nope', { metadata: { pinned: true } })).toBeNull();

    await store.flush();
    const reopened = await open(path);
    expect(reopened.get(a.id)?.metadata.pinned).toBe(true);
  });

  it('filters recall by kind, tag, and entity ref, and browses with no text', async () => {
    const store = await open(path);
    store.remember({
      kind: 'decision',
      title: 'D1',
      content: 'alpha',
      tags: ['arch'],
      entityRefs: ['proj1'],
    });
    store.remember({ kind: 'note', title: 'N1', content: 'alpha', tags: ['misc'] });

    expect(store.recall({ kinds: ['decision'] }).hits.length).toBe(1);
    expect(store.recall({ tag: 'arch' }).hits.length).toBe(1);
    expect(store.recall({ entityRef: 'proj1' }).hits.length).toBe(1);
    expect(store.recall({}).hits.length).toBe(2);
  });

  it('replaces the projected set but preserves explicit memories', async () => {
    const store = await open(path);
    const note = store.remember({ kind: 'note', title: 'Keep me', content: 'explicit knowledge' });

    const r1 = store.applyProjected(
      [projected('d1', 'document', 'Doc One'), projected('d2', 'document', 'Doc Two')],
      NOW,
    );
    expect(r1.added).toBe(2);
    expect(store.counts().total).toBe(3);

    const r2 = store.applyProjected(
      [projected('d1', 'document', 'Doc One'), projected('d3', 'document', 'Doc Three')],
      NOW,
    );
    expect(r2.removed).toBe(1);
    expect(store.get('mem:d2')).toBeNull();
    expect(store.get('mem:d3')).not.toBeNull();
    expect(store.get(note.id)).not.toBeNull();
    expect(store.counts().byOrigin.explicit).toBe(1);
    expect(store.counts().byOrigin.projected).toBe(2);
  });

  it('forgets items and persists across reloads (index rebuilt on load)', async () => {
    const store = await open(path);
    const a = store.remember({ kind: 'note', title: 'A', content: 'first memory' });
    store.remember({ kind: 'note', title: 'B', content: 'second memory' });
    expect(store.forget([a.id])).toBe(1);
    expect(store.counts().total).toBe(1);
    await store.flush();

    const reopened = await open(path);
    expect(reopened.counts().total).toBe(1);
    expect(reopened.get(a.id)).toBeNull();
    expect(reopened.recall({ text: 'second' }).hits.length).toBe(1);
  });
});

describe('MemoryStore.recallSemantic — retrieval diagnostics (A6)', () => {
  /**
   * P13A — the vector namespace is the VIEWER's tenant, not the fixture's.
   *
   * `recallSemantic` still takes an org argument, but it is asserted rather
   * than trusted: a value that disagrees with the resolved viewer is treated as
   * a forgery and the semantic leg is skipped. Deriving `ORG` from the ambient
   * viewer keeps these diagnostics tests testing diagnostics; the forged-org
   * case is proven deliberately in the cross-tenant suite instead.
   */
  const ORG = TEST_MEMORY_VIEWER.tenantId;
  const QUERY = { text: 'postgres datastore', limit: 25 };
  let dir: string;
  let store: MemoryStore;
  let seeded: MemoryItem;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'mem-sem-'));
    store = new MemoryStore(join(dir, 'memory.json'));
    await store.load();
    seeded = store.remember({
      kind: 'decision',
      title: 'Adopt Postgres',
      content: 'We will use Postgres as the primary datastore for the platform',
    });
  });
  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('the gate — semantic declines to run', () => {
    it('labels an unconfigured build lexical, not degraded, and counts the pool it did search', async () => {
      const res = await store.recallSemantic(QUERY, ORG);
      expect(res.retriever).toBe('lexical');
      expect(res.retrieval?.mode).toBe('lexical');
      expect(res.retrieval?.semantic).toEqual({ state: 'skipped', reason: 'not_configured' });
      expect(res.retrieval?.lexicalCandidates).toBeGreaterThan(0);
      expect(res.hits[0]?.item.id).toBe(seeded.id);
    });

    /**
     * P13A — the invariant survives, its CAUSE changed.
     *
     * Pre-P13A "an absent org" meant the caller passed `undefined`, so this
     * test proved the store did not invent one. The org is no longer the
     * caller's to pass, so absence now means NO VIEWER RESOLVES — cold start,
     * signed out, or a suspended membership. Asserting the old form would test
     * a parameter that no longer decides anything.
     */
    it('never queries semantic when no tenant resolves', async () => {
      const searchSemantic = vi.fn(async () => []);
      store.configureSemantic(searchSemantic);
      store.bindViewer(() => null); // a per-store binding beats the ambient one
      const res = await store.recallSemantic(QUERY);
      expect(searchSemantic).not.toHaveBeenCalled();
      expect(res.retrieval?.semantic).toEqual({ state: 'skipped', reason: 'no_org' });
      expect(res.retrieval?.mode).toBe('lexical');
      // And the lexical leg returns nothing either: unbound denies everywhere.
      expect(res.hits).toHaveLength(0);
    });

    /**
     * A forged org must not reach the vector store's namespace filter.
     *
     * The vector store's isolation is real, which is precisely what made this
     * argument dangerous: naming another tenant's org would have had the
     * isolated store faithfully return that tenant's neighbours. Skipped rather
     * than silently corrected, so the disagreement is visible in diagnostics.
     */
    it('refuses a supplied org that disagrees with the resolved tenant', async () => {
      const searchSemantic = vi.fn(async () => []);
      store.configureSemantic(searchSemantic);
      const res = await store.recallSemantic(QUERY, 'org-someone-else');
      expect(searchSemantic).not.toHaveBeenCalled();
      expect(res.retrieval?.semantic).toEqual({ state: 'skipped', reason: 'no_org' });
      // The caller still gets THEIR OWN memories from the lexical leg.
      expect(res.hits[0]?.item.id).toBe(seeded.id);
    });

    it('skips an empty query and still browses, reporting the browse pool size', async () => {
      store.configureSemantic(async () => []);
      const res = await store.recallSemantic({ limit: 25 }, ORG);
      expect(res.retrieval?.semantic).toEqual({ state: 'skipped', reason: 'no_query_text' });
      expect(res.retrieval?.lexicalCandidates).toBe(1);
      expect(res.hits).toHaveLength(1);
    });
  });

  describe('the healthy path', () => {
    it('claims the semantic retriever only when the semantic leg actually served', async () => {
      store.configureSemantic(async (_q, options) => {
        options?.onOutcome?.({ state: 'ok', hits: 1, latencyMs: 11 });
        return [{ memoryId: seeded.id, score: 0.95 }];
      });
      const res = await store.recallSemantic(QUERY, ORG);
      expect(res.retriever).toBe('lexical+semantic');
      expect(res.retrieval?.mode).toBe('hybrid');
      expect(res.retrieval?.semantic).toEqual({ state: 'ok', hits: 1, latencyMs: 11 });
      expect(res.retrieval?.lexicalCandidates).toBeGreaterThan(0);
    });

    it('passes the org through as the vector namespace and asks for a wider net than it returns', async () => {
      const searchSemantic = vi.fn(async () => []);
      store.configureSemantic(searchSemantic);
      await store.recallSemantic({ text: 'postgres', limit: 5 }, ORG);
      expect(searchSemantic.mock.calls[0][0]).toMatchObject({ orgId: ORG, text: 'postgres' });
      expect(searchSemantic.mock.calls[0][0].topK).toBeGreaterThanOrEqual(5);
    });
  });

  describe('degradation — the semantic leg fails', () => {
    const boom: SemanticSearchFn = async () => {
      throw new Error('backend 503');
    };

    it('absorbs the failure and answers from the pool it already retrieved', async () => {
      store.configureSemantic(boom);
      const res = await store.recallSemantic(QUERY, ORG);
      expect(res.retriever).toBe('lexical');
      expect(res.hits[0]?.item.id).toBe(seeded.id);
      expect(res.retrieval?.mode).toBe('degraded');
      expect(res.retrieval?.semantic.state).toBe('failed');
      // Present, and drawn from the single lexical pass this recall already made:
      // pre-A6 the throw escaped to the handler, which re-ran the retriever from
      // scratch — a second full lexical pass on every semantic failure.
      expect(res.retrieval?.lexicalCandidates).toBeGreaterThan(0);
    });

    it('prefers the source’s own classified verdict over re-deriving one', async () => {
      const outcome = {
        state: 'failed',
        kind: 'auth',
        retryable: false,
        code: 'not_authenticated',
        detail: 'Sign in to use semantic search.',
        latencyMs: 3,
      } as const;
      store.configureSemantic(async (_q, options) => {
        options?.onOutcome?.(outcome);
        throw new SemanticUnavailableError(outcome);
      });
      const res = await store.recallSemantic(QUERY, ORG);
      expect(res.retrieval?.semantic).toEqual(outcome);
    });

    it('classifies for a source that throws without reporting', async () => {
      store.configureSemantic(boom);
      const semantic = (await store.recallSemantic(QUERY, ORG)).retrieval?.semantic;
      expect(semantic).toMatchObject({ state: 'failed', kind: 'network', code: 'unknown_error' });
    });

    it('re-throws when the semantic leg already succeeded — that is a defect, not a degradation', async () => {
      // A throw *after* a reported success cannot have come from retrieval, so
      // absorbing it would disguise a real bug as a degraded answer.
      store.configureSemantic(async (_q, options) => {
        options?.onOutcome?.({ state: 'ok', hits: 1, latencyMs: 2 });
        throw new Error('ranker blew up');
      });
      await expect(store.recallSemantic(QUERY, ORG)).rejects.toThrow('ranker blew up');
    });
  });

  it('leaves the synchronous recall envelope-free, exactly as it was pre-A6', () => {
    const res = store.recall(QUERY);
    expect(res.retriever).toBe('lexical');
    expect(res.retrieval).toBeUndefined();
    expect(res.hits[0]?.item.id).toBe(seeded.id);
  });
});
