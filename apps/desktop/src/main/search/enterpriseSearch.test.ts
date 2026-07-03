import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GraphNode, UnifiedEntity } from '@neuropause/shared';
import { UnifiedStore } from '../unified/unifiedStore';
import { GraphStore } from '../graph/graphStore';
import { MemoryStore } from '../memory/memoryStore';
import { runEnterpriseSearch } from './enterpriseSearch';

const NOW = '2026-01-01T00:00:00.000Z';

function entity(partial: Partial<UnifiedEntity> & { id: string; kind: string }): UnifiedEntity {
  return {
    id: partial.id,
    kind: partial.kind as never,
    connectorId: partial.connectorId ?? 'github',
    accountId: 'acct1',
    sourceId: partial.id,
    createdAt: NOW,
    updatedAt: NOW,
    syncState: 'active',
    syncedAt: NOW,
    metadata: {},
    title: partial.title ?? partial.id,
    url: partial.url ?? null,
    parentId: null,
    containerId: null,
    body: partial.body ?? null,
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

describe('runEnterpriseSearch', () => {
  let dir: string;
  const closeables: Array<{ flush: () => Promise<void> }> = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'esearch-'));
  });
  afterEach(async () => {
    await Promise.all(closeables.map((c) => c.flush()));
    closeables.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function stand(): Promise<{ entity: UnifiedStore; graph: GraphStore; memory: MemoryStore }> {
    const us = new UnifiedStore(join(dir, 'u.json'));
    await us.load();
    await us.upsertMany([
      entity({ id: 'p1', kind: 'project', title: 'Apollo Platform', body: 'mission control rewrite' }),
      entity({ id: 't1', kind: 'task', title: 'Unrelated chore', body: 'take out the trash' }),
    ]);

    const gs = new GraphStore(join(dir, 'g.json'));
    await gs.load();
    gs.apply([gnode('p1', 'project', 'Apollo Platform'), gnode('person:github:dev', 'person', 'dev')], [], NOW);

    const ms = new MemoryStore(join(dir, 'm.json'));
    await ms.load();
    ms.remember({ kind: 'decision', title: 'Apollo rollout plan', content: 'Phase the Apollo launch over two quarters' });

    closeables.push(gs, ms);
    return { entity: us, graph: gs, memory: ms };
  }

  it('federates entity + graph + memory into one ranked result with per-source groups', async () => {
    const { entity: us, graph, memory } = await stand();
    const result = runEnterpriseSearch(
      { text: 'apollo' },
      { entity: us.searchBackend, graph, memory },
    );

    expect(result.groups.map((g) => g.source).sort()).toEqual(['entity', 'graph', 'memory']);

    const sources = new Set(result.hits.map((h) => h.source));
    expect(sources.has('entity')).toBe(true);
    expect(sources.has('graph')).toBe(true);
    expect(sources.has('memory')).toBe(true);

    // every score normalized to 0..1, merged list sorted descending
    expect(result.hits.every((h) => h.score >= 0 && h.score <= 1)).toBe(true);
    for (let i = 1; i < result.hits.length; i++) {
      expect(result.hits[i - 1]!.score).toBeGreaterThanOrEqual(result.hits[i]!.score);
    }

    expect(result.backends).toContain('lexical');
    // the unrelated chore should not surface for "apollo"
    expect(result.hits.find((h) => h.id === 't1')).toBeUndefined();
  });

  it('honors the sources filter', async () => {
    const { entity: us, graph, memory } = await stand();
    const result = runEnterpriseSearch(
      { text: 'apollo', sources: ['graph'] },
      { entity: us.searchBackend, graph, memory },
    );
    expect(result.groups.map((g) => g.source)).toEqual(['graph']);
    expect(result.hits.every((h) => h.source === 'graph')).toBe(true);
  });

  it('includes the timeline source when one is provided', async () => {
    const { entity: us, graph, memory } = await stand();
    const timeline = {
      search: (text: string) =>
        text.toLowerCase().includes('apollo')
          ? [
              {
                id: 'activity:x1',
                source: 'activity' as const,
                at: NOW,
                kind: 'message',
                category: 'activity',
                title: 'Apollo standup',
                summary: 'discussed the apollo launch',
                actorId: null,
                actorLabel: null,
                connectorId: 'slack',
                resourceId: 'x1',
                entityRefs: ['x1'],
                url: null,
                metadata: {},
              },
            ]
          : [],
    };
    const result = runEnterpriseSearch(
      { text: 'apollo' },
      { entity: us.searchBackend, graph, memory, timeline },
    );
    expect(result.groups.map((g) => g.source)).toContain('timeline');
    expect(result.hits.some((h) => h.source === 'timeline' && h.id === 'activity:x1')).toBe(true);
    expect(result.backends).toContain('timeline');
  });
});
