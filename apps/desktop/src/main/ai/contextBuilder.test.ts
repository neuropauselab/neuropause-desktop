import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  Briefing,
  BriefingItem,
  BriefingSection,
  BriefingSectionId,
  EnterpriseSearchHit,
  EnterpriseSearchResult,
  GraphNode,
  SearchSourceKind,
  UnifiedEntity,
} from '@neuropause/shared';
import { ContextBuilder, createContextBuilder } from './contextBuilder';
import { UnifiedStore } from '../unified/unifiedStore';
import { GraphStore } from '../graph/graphStore';
import { MemoryStore } from '../memory/memoryStore';
import { AiEngine } from './aiEngine';
import { ModelRouter } from './modelRouter';
import { MockModelClient } from './mockClient';

const NOW = '2026-06-30T00:00:00.000Z';

function hit(
  p: Partial<EnterpriseSearchHit> & { id: string; source: SearchSourceKind },
): EnterpriseSearchHit {
  return {
    source: p.source,
    id: p.id,
    kind: p.kind ?? 'project',
    title: p.title ?? p.id,
    snippet: p.snippet ?? null,
    score: p.score ?? 0.5,
    connectorId: p.connectorId ?? null,
    timestamp: p.timestamp ?? null,
    url: null,
  };
}

function result(hits: EnterpriseSearchHit[]): EnterpriseSearchResult {
  return { query: 'q', hits, groups: [], total: hits.length, backends: ['lexical'] };
}

function section(id: BriefingSectionId, items: BriefingItem[]): BriefingSection {
  return { id, title: id, items, empty: items.length === 0 };
}

function bitem(text: string, evidenceId: string, at: string | null = NOW): BriefingItem {
  return {
    text,
    detail: null,
    connectorId: 'github',
    at,
    evidence: [{ kind: 'activity', id: evidenceId }],
  };
}

function briefingOf(sections: BriefingSection[]): Briefing {
  return {
    period: 'morning',
    generatedAt: NOW,
    range: { since: NOW, until: NOW },
    headline: 'test',
    sections,
    evidenceCount: sections.reduce(
      (n, s) => n + s.items.reduce((m, i) => m + i.evidence.length, 0),
      0,
    ),
    grounded: true,
  };
}

// --- Unit: mapping, ranking, budget, sources, brief, governance -------------

describe('ContextBuilder (unit, injected ports)', () => {
  it('maps each search hit to the right abstract source with evidence', () => {
    const cb = new ContextBuilder({
      search: () =>
        result([
          hit({
            id: 'gh1',
            source: 'entity',
            connectorId: 'github',
            kind: 'project',
            title: 'repo',
          }),
          hit({ id: 'g1', source: 'graph', kind: 'person', title: 'dev' }),
          hit({ id: 'm1', source: 'memory', kind: 'decision', title: 'plan' }),
          hit({ id: 's1', source: 'entity', connectorId: 'slack', kind: 'message', title: 'msg' }),
        ]),
    });
    const items = cb.build({ worker: 'diagnostic', query: 'anything', now: NOW });
    const bySource = Object.fromEntries(items.map((i) => [i.evidence[0]?.id, i.source]));
    expect(bySource['gh1']).toBe('github');
    expect(bySource['g1']).toBe('knowledge-graph');
    expect(bySource['m1']).toBe('ai-memory');
    expect(bySource['s1']).toBe('slack');
    expect(items.find((i) => i.evidence[0]?.id === 'gh1')?.evidence).toEqual([
      { kind: 'project', id: 'gh1' },
    ]);
  });

  it('founder context draws evidence from every connected system', () => {
    const cb = new ContextBuilder({
      search: () =>
        result([
          hit({
            id: 'gh',
            source: 'entity',
            connectorId: 'github',
            kind: 'project',
            title: 'repo',
          }),
          hit({
            id: 'no',
            source: 'entity',
            connectorId: 'notion',
            kind: 'document',
            title: 'doc',
          }),
          hit({
            id: 'ca',
            source: 'entity',
            connectorId: 'google-workspace',
            kind: 'calendar_event',
            title: 'mtg',
          }),
          hit({ id: 'sl', source: 'entity', connectorId: 'slack', kind: 'message', title: 'msg' }),
        ]),
    });
    const items = cb.build({ worker: 'founder', query: 'status', now: NOW });
    const sources = new Set(items.map((i) => i.source));
    expect(sources.has('github')).toBe(true);
    expect(sources.has('notion')).toBe(true);
    expect(sources.has('calendar')).toBe(true);
    expect(sources.has('slack')).toBe(true);
  });

  it('ranks by relevance, then boosts by recency', () => {
    const cb = new ContextBuilder({
      search: () =>
        result([
          hit({
            id: 'low-old',
            source: 'entity',
            score: 0.4,
            timestamp: '2026-01-01T00:00:00.000Z',
          }),
          hit({ id: 'high-recent', source: 'entity', score: 0.95, timestamp: NOW }),
          hit({ id: 'mid-recent', source: 'entity', score: 0.6, timestamp: NOW }),
        ]),
    });
    const ids = cb
      .build({ worker: 'diagnostic', query: 'x', now: NOW })
      .map((i) => i.evidence[0]?.id);
    expect(ids[0]).toBe('high-recent');
    expect(ids.indexOf('mid-recent')).toBeLessThan(ids.indexOf('low-old'));
  });

  it('caps the number of items by the budget', () => {
    const cb = new ContextBuilder({
      search: () =>
        result(
          Array.from({ length: 6 }, (_, i) =>
            hit({ id: `e${i}`, source: 'entity', score: 1 - i * 0.1 }),
          ),
        ),
    });
    const items = cb.build({ worker: 'diagnostic', query: 'x', maxItems: 2, now: NOW });
    expect(items).toHaveLength(2);
    expect(items[0]?.evidence[0]?.id).toBe('e0'); // highest score
  });

  it('caps total characters, skipping over-budget items so smaller ones still fit', () => {
    const big = 'X'.repeat(200);
    const cb = new ContextBuilder({
      search: () =>
        result([
          hit({ id: 'big', source: 'entity', score: 0.99, title: big }),
          hit({ id: 'small', source: 'entity', score: 0.5, title: 'tiny' }),
        ]),
    });
    const items = cb.build({ worker: 'diagnostic', query: 'x', maxChars: 50, now: NOW });
    // 'big' (200 chars) is skipped; 'small' fits
    expect(items.map((i) => i.evidence[0]?.id)).toEqual(['small']);
  });

  it('respects an explicit source override, dropping other sources', () => {
    const cb = new ContextBuilder({
      search: () =>
        result([
          hit({ id: 'gh1', source: 'entity', connectorId: 'github' }),
          hit({ id: 'g1', source: 'graph' }),
          hit({ id: 'm1', source: 'memory' }),
        ]),
    });
    const items = cb.build({ worker: 'diagnostic', query: 'x', sources: ['github'], now: NOW });
    expect(items.map((i) => i.source)).toEqual(['github']);
  });

  it('pulls Mission Brief sections, skips empty ones, and prioritizes engineering risk', () => {
    const cb = new ContextBuilder({
      briefing: () =>
        briefingOf([
          section('completed', [bitem('shipped a thing', 'done-1')]),
          section('pr_health', []), // empty → skipped
          section('engineering_risk', [bitem('CI unstable on main', 'risk-1')]),
        ]),
    });
    const items = cb.build({ worker: 'engineering', query: '', now: NOW });
    expect(items.every((i) => i.source === 'mission-brief')).toBe(true);
    expect(items.some((i) => i.evidence[0]?.id === 'risk-1')).toBe(true);
    expect(items.some((i) => i.evidence[0]?.id === 'done-1')).toBe(true);
    // engineering_risk outranks completed
    const ids = items.map((i) => i.evidence[0]?.id);
    expect(ids.indexOf('risk-1')).toBeLessThan(ids.indexOf('done-1'));
  });

  it('applies the governance filter before assembling', () => {
    const cb = new ContextBuilder({
      search: () =>
        result([
          hit({ id: 'ok', source: 'entity', title: 'normal item' }),
          hit({ id: 'blocked', source: 'entity', title: 'a secret item' }),
        ]),
      governanceFilter: (item) => !item.text.includes('secret'),
    });
    const items = cb.build({ worker: 'diagnostic', query: 'x', now: NOW });
    expect(items.map((i) => i.evidence[0]?.id)).toEqual(['ok']);
  });

  it('skips search when the query is empty but still includes the brief', () => {
    let searched = false;
    const cb = new ContextBuilder({
      search: () => {
        searched = true;
        return result([]);
      },
      briefing: () => briefingOf([section('ci_health', [bitem('8/8 failing', 'ci-1')])]),
    });
    const items = cb.build({ worker: 'engineering', query: '   ', now: NOW });
    expect(searched).toBe(false);
    expect(items.some((i) => i.evidence[0]?.id === 'ci-1')).toBe(true);
  });

  it('returns nothing when no ports are wired', () => {
    expect(new ContextBuilder().build({ worker: 'founder', query: 'anything' })).toEqual([]);
  });
});

// --- Integration: real UnifiedStore + GraphStore + MemoryStore --------------

function entity(p: Partial<UnifiedEntity> & { id: string; kind: string }): UnifiedEntity {
  return {
    id: p.id,
    kind: p.kind as never,
    connectorId: p.connectorId ?? 'github',
    accountId: 'acct1',
    sourceId: p.id,
    createdAt: NOW,
    updatedAt: NOW,
    syncState: 'active',
    syncedAt: NOW,
    metadata: {},
    title: p.title ?? p.id,
    url: null,
    parentId: null,
    containerId: null,
    body: p.body ?? null,
    status: null,
    author: null,
    timestamp: null,
    endTimestamp: null,
    labels: [],
  } as UnifiedEntity;
}

function gnode(id: string, type: string, label: string): GraphNode {
  return {
    id,
    type: type as never,
    label,
    sourceKind: 'test',
    sourceId: id,
    connectorId: 'github',
    createdAt: NOW,
    updatedAt: NOW,
    metadata: {},
  };
}

describe('ContextBuilder (integration, real subsystems)', () => {
  let dir: string;
  const closeables: Array<{ flush: () => Promise<void> }> = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'ctxb-'));
  });
  afterEach(async () => {
    await Promise.all(closeables.map((c) => c.flush()));
    closeables.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function stand(): Promise<ContextBuilder> {
    const us = new UnifiedStore(join(dir, 'u.json'));
    await us.load();
    await us.upsertMany([
      entity({
        id: 'np-focus',
        kind: 'project',
        title: 'neurocover-focus',
        body: 'CI failing on main, 8 of 8 runs',
      }),
      entity({ id: 'task-milk', kind: 'task', title: 'buy milk', body: 'groceries for the week' }),
    ]);

    const gs = new GraphStore(join(dir, 'g.json'));
    await gs.load();
    gs.apply([gnode('np-focus-node', 'project', 'neurocover-focus')], [], NOW);

    const ms = new MemoryStore(join(dir, 'm.json'));
    await ms.load();
    ms.remember({
      kind: 'decision',
      title: 'neurocover release plan',
      content: 'ship neurocover v1.2 next week',
    });

    closeables.push(gs, ms);
    return createContextBuilder({
      searchSources: { entity: us.searchBackend, graph: gs, memory: ms },
    });
  }

  it('retrieves relevant evidence from graph, memory, and GitHub entities — and excludes the irrelevant', async () => {
    const cb = await stand();
    const items = cb.build({ worker: 'engineering', query: 'neurocover' });

    const sources = new Set(items.map((i) => i.source));
    expect(sources.has('github')).toBe(true); // the UDM/GitHub project
    expect(sources.has('knowledge-graph')).toBe(true); // the graph node
    expect(sources.has('ai-memory')).toBe(true); // the decision

    const evidenceIds = items.flatMap((i) => i.evidence.map((e) => e.id));
    expect(evidenceIds).toContain('np-focus');
    // the unrelated "buy milk" task must not be assembled for "neurocover"
    expect(evidenceIds).not.toContain('task-milk');
  });

  it('feeds the assembled context straight into the AI Engine (full chain)', async () => {
    const cb = await stand();
    const context = cb.build({ worker: 'engineering', query: 'neurocover' });

    const engine = new AiEngine({ router: new ModelRouter({ client: new MockModelClient() }) });
    const res = await engine.run({ worker: 'engineering', promptId: 'generic.summary', context });

    expect(res.grounded).toBe(true);
    // evidence assembled by the builder is carried through to the engine response
    expect(res.evidence.some((e) => e.id === 'np-focus')).toBe(true);
    expect(res.contextSources).toContain('github');
  });
});
