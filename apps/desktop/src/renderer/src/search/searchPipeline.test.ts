/**
 * Phase 6 Stage 3 — pipeline tests. Locks the Stage 2 isolation contract on
 * the search pipeline: independent per-source settle with streamed updates,
 * explicit unavailable(reason) on failure/timeout (incl. the semantic
 * sign-in case), scope routing to existing services only, module fan-out with
 * no silent caps, cancelation, caching, and real measured timings.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { planSearch } from './queryPlanner';
import { applyScope, type ResolvedPlan } from './searchModel';
import {
  CACHE_TTL_MS,
  clearSearchCache,
  idleAvailability,
  planKey,
  runUnifiedSearch,
  withTimeout,
  type SearchIo,
  type SearchRunUpdate,
} from './searchPipeline';

const NOW = new Date(2026, 6, 30, 12, 0, 0);

const ENGINE_RESULT = {
  query: 'contract',
  hits: [
    { source: 'memory', id: 'm1', kind: 'note', title: 'Contract memo', snippet: 'x', score: 0.7, connectorId: null, timestamp: '2026-07-29T10:00:00Z', url: null },
    { source: 'timeline', id: 't1', kind: 'app.launched', title: 'contract sync ran', snippet: null, score: 0.5, connectorId: 'github', timestamp: '2026-07-30T09:00:00Z', url: null },
  ],
  groups: [],
  total: 2,
  backends: ['local'],
};

const UNIFIED_RESULT = {
  hits: [{ id: 'u1', kind: 'document', connectorId: 'google-drive', title: 'The contract', snippet: 'contract body', score: 3.2 }],
  total: 1,
  backend: 'local',
};

function makeIo(over: Partial<SearchIo> = {}): SearchIo & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const count = (k: string): void => { calls[k] = (calls[k] ?? 0) + 1; };
  return {
    calls,
    enterpriseSearch: (q) => { count('enterprise'); void q; return Promise.resolve(ENGINE_RESULT); },
    unifiedSearch: (q) => { count('unified'); void q; return Promise.resolve(UNIFIED_RESULT); },
    semanticRecall: () => { count('semantic'); return Promise.resolve({ hits: [{ item: { id: 'sm1', title: 'K8s talk', content: 'kubernetes rollout', kind: 'decision', occurredAt: '2026-07-28T10:00:00Z', connectorId: null }, score: 0.81 }], total: 1, retriever: 'qdrant' }); },
    decisionsList: () => { count('decisions'); return Promise.resolve({ decisions: [{ id: 'd1', title: 'Contract approval', description: 'finance', status: 'pending', createdAt: '2026-07-20T00:00:00Z' }] }); },
    automationsList: () => { count('automations'); return Promise.resolve({ rules: [{ id: 'w1', name: 'Contract watcher', description: '', actions: [], status: 'active', createdAt: '', updatedAt: '' }], summary: { total: 1, active: 1, paused: 0, draft: 0 } }); },
    connectorsList: () => { count('connectors'); return Promise.resolve([{ id: 'github', name: 'GitHub', lifecycle: 'production', configured: true, status: 'connected', health: 'healthy', accounts: [{}], lastSyncAt: '2026-07-30T08:00:00Z' }]); },
    workspaceContextsList: () => { count('workspaces'); return Promise.resolve({ workspaces: [{ id: 'ws1', name: 'Contract work', snapshot: { tabs: [] }, lastOpenedAt: 1753800000000 }], activeId: 'ws1' }); },
    executeSessions: () => { count('sessions'); return Promise.resolve({ sessions: [{ id: 's1', label: 'Summarize contract', state: 'running', completedAt: null, startedAt: '2026-07-30T11:00:00Z' }], stats: {} }); },
    executeHistory: () => { count('history'); return Promise.resolve({ records: [] }); },
    enterpriseOrg: () => { count('org'); return Promise.resolve({ users: [{ id: 'p1', name: 'John Contract', title: 'PM', kind: 'human' }] }); },
    modulesList: () => { count('modules'); return Promise.resolve([{ id: 'finance.invoice', title: 'Invoices', singular: 'invoice', plural: 'invoices' }, { id: 'sales.order', title: 'Orders', singular: 'order', plural: 'orders' }]); },
    moduleSearch: (moduleId) => { count(`moduleSearch:${moduleId}`); return Promise.resolve([{ id: 'inv1', title: 'INV-0042', status: 'open', updatedAt: '2026-07-30T07:00:00Z' }]); },
    listApps: () => { count('apps'); return [{ id: 'notes', name: 'Contract Notes', category: 'Writing', developer: 'x', tagline: 'notes', tone: 'blue', glyph: 'CN' }]; },
    listSections: () => { count('sections'); return [{ id: 'search', label: 'Search' }]; },
    ...over,
  };
}

const rp = (query: string, scope: Parameters<typeof applyScope>[1] = 'all'): ResolvedPlan =>
  applyScope(planSearch(query, NOW), scope);

const reject = (msg: string) => (): Promise<unknown> => Promise.reject(new Error(msg));
const hang = (): Promise<unknown> => new Promise(() => undefined);

beforeEach(() => clearSearchCache());

describe('runUnifiedSearch — routing + mapping', () => {
  it('runs every scoped source and merges mapped items', async () => {
    const io = makeIo();
    const result = await runUnifiedSearch(rp('contract'), io).done;
    expect(result.fromCache).toBe(false);
    const types = new Set(result.items.map((i) => i.type));
    for (const t of ['memory', 'timeline', 'entity', 'decision', 'workflow'] as const) expect(types.has(t)).toBe(true);
    expect(result.items.length).toBeGreaterThan(4);
    expect(result.availability.engine.state).toBe('ready');
    expect(result.availability.records.state).toBe('ready');
    expect(result.availability.semantic.state).toBe('ready');
  });

  it('entity filters route through unified.search with kinds + connector (existing IPC)', async () => {
    let seen: unknown = null;
    const io = makeIo({ unifiedSearch: (q) => { seen = q; return Promise.resolve(UNIFIED_RESULT); } });
    await runUnifiedSearch(rp('search gmail for the contract'), io).done;
    expect(seen).toMatchObject({ kinds: expect.arrayContaining(['document']), connectorId: 'gmail' });
    // the federated engine still serves the non-entity sources
    expect(io.calls.enterprise).toBe(1);
  });

  it('record-scoped plans hit only the records feeds they name', async () => {
    const io = makeIo();
    await runUnifiedSearch(rp('show decisions'), io).done;
    expect(io.calls.decisions).toBe(1);
    expect(io.calls.connectors).toBeUndefined();
    expect(io.calls.enterprise).toBeUndefined(); // no free text → engine skipped
  });

  it('module terms fan out ONLY to matching modules and never silently cap', async () => {
    const io = makeIo();
    const result = await runUnifiedSearch(rp("today's invoices"), io).done;
    expect(io.calls['moduleSearch:finance.invoice']).toBe(1);
    expect(io.calls['moduleSearch:sales.order']).toBeUndefined();
    expect(result.items.some((i) => i.type === 'business')).toBe(true);
  });
});

describe('failure isolation + honest degradation', () => {
  it('a failed source degrades only itself', async () => {
    const io = makeIo({ enterpriseSearch: reject('engine down'), unifiedSearch: reject('engine down') });
    const result = await runUnifiedSearch(rp('contract'), io).done;
    expect(result.availability.engine).toMatchObject({ state: 'unavailable' });
    expect(result.availability.records.state).toBe('ready');
    expect(result.items.some((i) => i.type === 'decision')).toBe(true);
  });

  it('a partially failed engine (one of two retrieval calls) stays alive with a note', async () => {
    const io = makeIo({ enterpriseSearch: reject('federated engine down') });
    const result = await runUnifiedSearch(rp('contract'), io).done; // 'contract' implies entity filters → unified.search still answers
    const st = result.availability.engine;
    expect(st.state).toBe('ready');
    expect(st.state === 'ready' && st.note).toContain('federated engine down');
    expect(result.items.some((i) => i.type === 'entity')).toBe(true);
  });

  it('semantic sign-in failure surfaces the reason verbatim-ish', async () => {
    const io = makeIo({ semanticRecall: reject('Sign in to use semantic search.') });
    const result = await runUnifiedSearch(rp('contract'), io).done;
    const st = result.availability.semantic;
    expect(st.state).toBe('unavailable');
    expect(st.state === 'unavailable' && st.reason).toContain('Sign in');
  });

  it('a hung source times out into unavailable instead of blocking the run', async () => {
    const io = makeIo({ semanticRecall: hang });
    const result = await runUnifiedSearch(rp('contract'), io, { timeoutMs: 20 }).done;
    expect(result.availability.semantic.state).toBe('unavailable');
    expect(result.availability.engine.state).toBe('ready');
  });

  /* ── A6: a RESOLVED semantic call that did not actually retrieve ─────────
   *
   * The whole class of bug this increment closes. Every case below has the
   * recall promise fulfilling normally — the failure is inside the payload,
   * which is exactly why it used to render as a healthy source.
   */

  const withRetrieval = (retrieval: unknown, hits: unknown[] = []): Partial<SearchIo> => ({
    semanticRecall: () => Promise.resolve({ hits, total: hits.length, retriever: 'lexical', retrieval }),
  });

  const LEXICAL_HIT = {
    item: { id: 'lx1', title: 'Rollout notes', content: 'kubernetes rollout', kind: 'decision', occurredAt: '2026-07-28T10:00:00Z', connectorId: null },
    score: 0.4,
  };

  it('a degraded retrieval reports unavailable, not a healthy source', async () => {
    // Before A6 this answered `ready` with `note: 'retriever: lexical'`, and
    // SearchView renders a ready note only as a hover tooltip — so a user saw
    // results and no indication that vector search was down.
    const io = makeIo(
      withRetrieval({
        mode: 'degraded',
        semantic: { state: 'failed', kind: 'dependency_down', retryable: true, code: 'qdrant_unavailable', detail: 'Vector store returned 503.', latencyMs: 91 },
      }),
    );
    const result = await runUnifiedSearch(rp('contract'), io).done;
    const st = result.availability.semantic;
    expect(st.state).toBe('unavailable');
    expect(st.state === 'unavailable' && st.reason).toContain('temporarily unavailable');
    expect(st.state === 'unavailable' && st.reason).toContain('Vector store returned 503.');
  });

  it('still merges the lexical hits a degraded retrieval DID return', async () => {
    // `unavailable` describes the source's health, not its output. Dropping the
    // results it managed to produce would turn an honest warning into real data
    // loss — the user would be told less AND shown less.
    const io = makeIo(
      withRetrieval(
        { mode: 'degraded', semantic: { state: 'skipped', reason: 'circuit_open' } },
        [LEXICAL_HIT],
      ),
    );
    const result = await runUnifiedSearch(rp('contract'), io).done;
    expect(result.availability.semantic.state).toBe('unavailable');
    expect(result.items.some((i) => i.id.includes('lx1'))).toBe(true);
  });

  it('streams the degraded state to the caller like any other source update', async () => {
    const io = makeIo(
      withRetrieval({ mode: 'degraded', semantic: { state: 'failed', kind: 'timeout', retryable: true, code: 'deadline', detail: '', latencyMs: 4000 } }, [LEXICAL_HIT]),
    );
    const updates: SearchRunUpdate[] = [];
    await runUnifiedSearch(rp('contract'), io, { onUpdate: (u) => updates.push(u) }).done;
    const semantic = updates.find((u) => u.source === 'semantic');
    expect(semantic?.state.state).toBe('unavailable');
    expect(semantic?.items.length).toBe(1); // items still stream, alongside the warning
  });

  it('a healthy hybrid retrieval stays ready', async () => {
    const io = makeIo(
      withRetrieval({ mode: 'hybrid', semantic: { state: 'ok', hits: 1, latencyMs: 120 } }, [LEXICAL_HIT]),
    );
    const result = await runUnifiedSearch(rp('contract'), io).done;
    expect(result.availability.semantic.state).toBe('ready');
  });

  it('a by-design lexical mode stays ready — it is not a failure', async () => {
    // `not_configured` is the common single-user case. Reporting it as an outage
    // would put a permanent orange warning on a correctly-working install.
    const io = makeIo(
      withRetrieval({ mode: 'lexical', semantic: { state: 'skipped', reason: 'not_configured' } }, [LEXICAL_HIT]),
    );
    const result = await runUnifiedSearch(rp('contract'), io).done;
    const st = result.availability.semantic;
    expect(st.state).toBe('ready');
    expect(st.state === 'ready' && st.note).toContain('not configured');
  });

  it('ignores a malformed envelope instead of degrading on it', async () => {
    // Defensive: a shape this build cannot read is not evidence of an outage.
    for (const bad of [null, 'degraded', { mode: 'degraded' }, { mode: 'weird', semantic: { state: 'failed' } }, { semantic: { state: 'nope' } }]) {
      const io = makeIo(withRetrieval(bad, [LEXICAL_HIT]));
      const result = await runUnifiedSearch(rp('contract'), io).done;
      clearSearchCache();
      expect(result.availability.semantic.state).toBe('ready');
    }
  });

  it('an absent envelope behaves exactly as it did before A6', async () => {
    // Backward compatibility: makeIo()'s default semanticRecall carries no
    // `retrieval` field, so it doubles as a pre-A6 producer.
    const result = await runUnifiedSearch(rp('contract'), makeIo()).done;
    const st = result.availability.semantic;
    expect(st.state).toBe('ready');
    expect(st.state === 'ready' && st.note).toBe('retriever: qdrant');
  });

  it('partial records failures keep the source alive with an honest note', async () => {
    const io = makeIo({ decisionsList: reject('decision store locked') });
    const result = await runUnifiedSearch(rp('contract'), io).done;
    const st = result.availability.records;
    expect(st.state).toBe('ready');
    expect(st.state === 'ready' && st.note).toContain('decision store locked');
  });

  it('streams one update per source as it settles', async () => {
    const io = makeIo();
    const updates: SearchRunUpdate[] = [];
    await runUnifiedSearch(rp('contract'), io, { onUpdate: (u) => updates.push(u) }).done;
    const sources = updates.map((u) => u.source).sort();
    expect(sources).toEqual(['engine', 'modules', 'records', 'semantic']);
  });

  it('cancel stops further updates', async () => {
    const io = makeIo({ enterpriseSearch: () => new Promise((res) => setTimeout(() => res(ENGINE_RESULT), 30)) });
    const updates: SearchRunUpdate[] = [];
    const handle = runUnifiedSearch(rp('contract'), io, { onUpdate: (u) => updates.push(u) });
    handle.cancel();
    await handle.done;
    expect(updates.length).toBe(0);
  });
});

describe('cache + keys + plumbing', () => {
  it('serves a repeat query from cache without re-calling the services', async () => {
    const io = makeIo();
    await runUnifiedSearch(rp('contract'), io).done;
    const callsAfterFirst = { ...io.calls };
    const second = await runUnifiedSearch(rp('contract'), io).done;
    expect(second.fromCache).toBe(true);
    expect(io.calls).toEqual(callsAfterFirst);
  });

  it('bypassCache re-runs the services', async () => {
    const io = makeIo();
    await runUnifiedSearch(rp('contract'), io).done;
    const second = await runUnifiedSearch(rp('contract'), io, { bypassCache: true }).done;
    expect(second.fromCache).toBe(false);
    expect(io.calls.enterprise).toBe(2);
  });

  it('different scopes and plans produce different cache keys', () => {
    expect(planKey(rp('contract'))).not.toBe(planKey(rp('contract', 'knowledge')));
    expect(planKey(rp('contract'))).not.toBe(planKey(rp('invoice')));
    expect(CACHE_TTL_MS).toBeGreaterThan(0);
  });

  it('records real per-source timings', async () => {
    const io = makeIo();
    const result = await runUnifiedSearch(rp('contract'), io).done;
    expect(Object.keys(result.timings).sort()).toEqual(['engine', 'modules', 'records', 'semantic']);
    for (const ms of Object.values(result.timings)) expect(ms).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('withTimeout + idleAvailability behave', async () => {
    await expect(withTimeout(Promise.resolve(1), 50, 'x')).resolves.toBe(1);
    await expect(withTimeout(new Promise(() => undefined), 10, 'slow')).rejects.toThrow(/timed out/);
    const idle = idleAvailability();
    expect(Object.values(idle).every((s) => s.state === 'idle')).toBe(true);
  });
});
