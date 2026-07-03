import { describe, expect, it } from 'vitest';
import type { EnterpriseTimelineEntry, UnifiedEntity } from '@neuropause/shared';
import { projectGraph } from '../graph/projector';
import { projectMemory } from '../memory/memoryProjector';
import { LexicalMemoryRetriever } from '../memory/memoryRetriever';
import { LocalSearchBackend } from '../unified/searchBackend';
import { EnterpriseTimeline } from '../timeline/enterpriseTimeline';
import { generateBriefing } from '../intelligence/briefingGenerator';
import { generateRecommendations } from '../recommendations/recommendationEngine';

/**
 * Performance benchmark for the deterministic intelligence engines. It builds a
 * synthetic workspace at scale, then measures each hot path and prints a compact
 * table. The assertions are generous regression guards, not the headline — the
 * point is the measured timings, which are recorded in
 * docs/intelligence/performance-benchmarks.md.
 */

const N = 5000;
const NOW = '2026-02-10T18:00:00.000Z';
const WORDS = ['apollo', 'zephyr', 'login', 'billing', 'export', 'sync', 'review', 'launch', 'design', 'infra', 'spec', 'roadmap'];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length] as T;
}

function buildEntities(n: number): UnifiedEntity[] {
  const out: UnifiedEntity[] = [];
  const projectIds: string[] = [];
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  for (let i = 0; i < n; i++) {
    const r = i % 10;
    const ts = new Date(base + i * 600_000).toISOString();
    const title = `${pick(WORDS, i)} ${pick(WORDS, i * 7 + 3)} ${i}`;
    const common = {
      connectorId: 'github',
      accountId: 'acct1',
      sourceId: `s${i}`,
      createdAt: ts,
      updatedAt: ts,
      syncState: 'active' as const,
      syncedAt: ts,
      metadata: {} as Record<string, never>,
      url: null,
      parentId: null,
      body: `${pick(WORDS, i * 3)} ${pick(WORDS, i * 5)} details for item ${i}`,
      author: `user${i % 50}`,
      endTimestamp: null,
      labels: [] as string[],
    };
    if (r === 0) {
      const id = `proj${i}`;
      projectIds.push(id);
      out.push({ ...common, id, kind: 'project', title, status: 'active', containerId: null, timestamp: null } as UnifiedEntity);
    } else if (r <= 5) {
      out.push({
        ...common,
        id: `task${i}`,
        kind: 'task',
        title,
        status: i % 3 === 0 ? 'closed' : 'open',
        containerId: projectIds.length ? (pick(projectIds, i) as string) : null,
        timestamp: null,
      } as UnifiedEntity);
    } else if (r <= 7) {
      out.push({ ...common, id: `doc${i}`, kind: 'document', title, status: 'active', containerId: null, timestamp: null } as UnifiedEntity);
    } else if (r === 8) {
      out.push({ ...common, id: `msg${i}`, kind: 'message', title, status: null, containerId: `chan${i % 20}`, timestamp: ts } as UnifiedEntity);
    } else {
      out.push({
        ...common,
        id: `evt${i}`,
        kind: 'calendar_event',
        title,
        status: 'confirmed',
        containerId: null,
        timestamp: new Date(base + i * 900_000).toISOString(),
        metadata: { attendees: 3 } as never,
      } as UnifiedEntity);
    }
  }
  return out;
}

function ms(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return Math.round((performance.now() - t0) * 100) / 100;
}

describe('intelligence performance', () => {
  it(`runs every engine over ${N} entities within budget`, () => {
    const entities = buildEntities(N);
    const timings: Record<string, number> = {};

    timings['graph.project'] = ms(() => {
      projectGraph({ entities, connectors: [{ id: 'github', name: 'GitHub' }], applications: [], now: NOW });
    });

    let memItems = projectMemory(entities, NOW);
    timings['memory.project'] = ms(() => {
      memItems = projectMemory(entities, NOW);
    });
    const retriever = new LexicalMemoryRetriever();
    timings['memory.index'] = ms(() => retriever.index(memItems));
    timings['memory.recall'] = ms(() => retriever.search('apollo login review', 25));

    const backend = new LocalSearchBackend();
    timings['search.index'] = ms(() => backend.index(entities));
    timings['search.query'] = ms(() => backend.search({ text: 'apollo billing export', limit: 25 }));

    const timeline = new EnterpriseTimeline({
      platformQuery: () => ({ events: [], nextCursor: null, total: 0 }),
      listEntities: () => entities,
    });
    let events: EnterpriseTimelineEntry[] = [];
    timings['timeline.query'] = ms(() => {
      events = timeline.query({ limit: 100, order: 'desc' }).entries;
    });

    timings['briefing.generate'] = ms(() => {
      generateBriefing('weekly', { entities, events, now: NOW });
    });
    timings['recommendations.generate'] = ms(() => {
      generateRecommendations({ entities, events, now: NOW }, { limit: 50 });
    });

    // eslint-disable-next-line no-console
    console.log(`\n  Performance over ${N} entities:`);
    for (const [k, v] of Object.entries(timings)) {
      // eslint-disable-next-line no-console
      console.log(`    ${k.padEnd(26)} ${v.toFixed(2)} ms`);
    }

    // generous regression guards
    for (const [k, v] of Object.entries(timings)) {
      expect(v, `${k} should stay well under budget`).toBeLessThan(2000);
    }
  });
});
