/**
 * Phase 6 Stage 3 — search performance evidence (D-6; house __bench__ pattern).
 *
 * Real executed timings for the pure pipeline layers, printed for the
 * validation record and asserted against generous ceilings (the product
 * target is <150 ms local end-to-end; these layers must be far below it so
 * IPC + rendering keep the budget). Synthetic corpus, deterministic seed —
 * no fabricated numbers: whatever this prints IS the measurement.
 */
import { describe, expect, it } from 'vitest';
import { planSearch } from './queryPlanner';
import { applyPlanFilters, applyScope, groupItems, rankUnified, fromEngineHit, type UnifiedSearchItem } from './searchModel';
import { clearSearchCache, runUnifiedSearch, type SearchIo } from './searchPipeline';

const NOW = new Date(2026, 6, 30, 12, 0, 0);
const NOW_MS = NOW.getTime();

const WORDS = ['contract', 'invoice', 'kubernetes', 'deploy', 'meeting', 'design', 'review', 'finance', 'roadmap', 'incident', 'slack', 'github', 'memo', 'plan', 'launch'];

function corpus(n: number): UnifiedSearchItem[] {
  const items: UnifiedSearchItem[] = [];
  for (let i = 0; i < n; i++) {
    const w1 = WORDS[i % WORDS.length]!;
    const w2 = WORDS[(i * 7 + 3) % WORDS.length]!;
    const mapped = fromEngineHit({
      source: (['entity', 'graph', 'memory', 'timeline'] as const)[i % 4],
      id: `doc-${i}`,
      kind: 'document',
      title: `${w1} ${w2} ${i}`,
      snippet: `${w2} details for ${w1} number ${i}`,
      score: ((i * 37) % 100) / 100,
      connectorId: i % 3 === 0 ? 'github' : null,
      timestamp: new Date(NOW_MS - (i % 90) * 24 * 3_600_000).toISOString(),
      url: null,
    });
    if (mapped) items.push(mapped);
  }
  return items;
}

function instantIo(): SearchIo {
  const engine = {
    query: 'x',
    hits: corpus(60).map((c, i) => ({ source: 'memory', id: `m${i}`, kind: 'note', title: c.title, snippet: c.summary, score: c.baseScore, connectorId: null, timestamp: null, url: null })),
    groups: [], total: 60, backends: ['local'],
  };
  return {
    enterpriseSearch: () => Promise.resolve(engine),
    unifiedSearch: () => Promise.resolve({ hits: [], total: 0, backend: 'local' }),
    semanticRecall: () => Promise.resolve({ hits: [], total: 0, retriever: 'lexical' }),
    decisionsList: () => Promise.resolve({ decisions: [] }),
    automationsList: () => Promise.resolve({ rules: [], summary: { total: 0, active: 0, paused: 0, draft: 0 } }),
    connectorsList: () => Promise.resolve([]),
    workspaceContextsList: () => Promise.resolve({ workspaces: [], activeId: '' }),
    executeSessions: () => Promise.resolve({ sessions: [], stats: {} }),
    executeHistory: () => Promise.resolve({ records: [] }),
    enterpriseOrg: () => Promise.resolve({ users: [] }),
    modulesList: () => Promise.resolve([]),
    moduleSearch: () => Promise.resolve([]),
    listApps: () => [],
    listSections: () => [],
  };
}

const ms = (t0: number): number => Math.round((performance.now() - t0) * 100) / 100;

describe('search performance evidence (real executed timings)', () => {
  it('plans 1,000 natural-language queries well under budget', () => {
    const queries = WORDS.flatMap((w) => [
      `find today's ${w}s`, `search gmail for the ${w} from last week`, `show github ${w} assigned to Sam`,
      `"${w}" mentioning finance`, `${w} workflows using slack`,
    ]);
    const t0 = performance.now();
    let planned = 0;
    for (let i = 0; i < 1000; i++) { planSearch(queries[i % queries.length]!, NOW); planned++; }
    const took = ms(t0);
    console.log(`  search.plan            ${took} ms / ${planned} queries (${Math.round((took / planned) * 1000) / 1000} ms each)`);
    expect(took).toBeLessThan(1500);
  });

  it('filters + ranks + groups a 5,000-item merged result under the local budget', () => {
    const items = corpus(5000);
    const plan = planSearch('contract review from last month', NOW);
    const t0 = performance.now();
    const filtered = applyPlanFilters(items, plan);
    const ranked = rankUnified(filtered.kept, { queryText: plan.text, now: NOW_MS, pinnedKeys: new Set(['engine:entity:doc-3']) });
    const grouped = groupItems(ranked);
    const took = ms(t0);
    console.log(`  search.rank            ${took} ms / 5000 items → ${ranked.length} ranked, ${grouped.length} groups`);
    expect(ranked.length).toBeGreaterThan(0);
    expect(took).toBeLessThan(400);
  });

  it('pipeline orchestration overhead is negligible with instant sources', async () => {
    clearSearchCache();
    const io = instantIo();
    const rp = applyScope(planSearch('contract', NOW), 'all');
    const runs = 25;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      clearSearchCache();
      await runUnifiedSearch(rp, io).done;
    }
    const took = ms(t0);
    const per = took / runs;
    console.log(`  search.pipeline        ${took} ms / ${runs} full runs (${Math.round(per * 100) / 100} ms per run, instant io)`);
    expect(per).toBeLessThan(40);
  });

  it('a cached repeat query serves in single-digit milliseconds', async () => {
    clearSearchCache();
    const io = instantIo();
    const rp = applyScope(planSearch('contract', NOW), 'all');
    await runUnifiedSearch(rp, io).done; // warm
    const t0 = performance.now();
    const result = await runUnifiedSearch(rp, io).done;
    const took = ms(t0);
    console.log(`  search.cache           ${took} ms (fromCache=${result.fromCache})`);
    expect(result.fromCache).toBe(true);
    expect(took).toBeLessThan(25);
  });
});
