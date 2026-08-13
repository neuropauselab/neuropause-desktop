import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnifiedStore } from './unifiedStore';
import { LocalSearchBackend } from './searchBackend';
import type { UnifiedEntity, UnifiedEntityKind } from '@neuropause/shared';

function entity(over: Partial<UnifiedEntity> & { id: string; kind: UnifiedEntityKind }): UnifiedEntity {
  return {
    /**
     * P13B — every fixture entity now declares its owner.
     *
     * `org-test` matches the ambient scope in `vitest.setup.ts`, so these tests
     * keep reading their own records. An entity WITHOUT this field is not a
     * "plain" entity any more — it is an unowned one, visible to nobody and
     * absent from the index, which is the production behaviour for rows written
     * before P13B.
     */
    tenantId: 'org-test',
    workspaceId: null,
    connectorId: 'github',
    accountId: 'acct_1',
    sourceId: over.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    syncState: 'active',
    syncedAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
    title: 'Untitled',
    url: null,
    parentId: null,
    containerId: null,
    body: null,
    status: null,
    author: null,
    timestamp: null,
    endTimestamp: null,
    labels: [],
    ...over,
  };
}

let path: string;
beforeEach(() => {
  path = join(tmpdir(), `nps-unified-${Math.random().toString(36).slice(2)}.json`);
});
afterEach(async () => {
  await fs.rm(path, { force: true });
  await fs.rm(`${path}.tmp`, { force: true });
});

describe('UnifiedStore', () => {
  it('inserts, then resolves conflicts by source updatedAt', async () => {
    const store = new UnifiedStore(path);
    await store.load();
    const r1 = await store.upsertMany([
      entity({ id: 'a', kind: 'task', title: 'Fix login', updatedAt: '2026-01-02T00:00:00.000Z' }),
      entity({ id: 'b', kind: 'project', title: 'Web App' }),
    ]);
    expect(r1).toEqual({ created: 2, updated: 0, unchanged: 0, conflicts: 0 });

    // A stale re-sync (older updatedAt) must NOT clobber fresher local state.
    const r2 = await store.upsertMany([
      entity({ id: 'a', kind: 'task', title: 'STALE', updatedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(r2.unchanged).toBe(1);
    expect(store.get('a')?.title).toBe('Fix login');

    // A newer record wins.
    const r3 = await store.upsertMany([
      entity({ id: 'a', kind: 'task', title: 'Fix login bug', updatedAt: '2026-01-03T00:00:00.000Z' }),
    ]);
    expect(r3.updated).toBe(1);
    expect(store.get('a')?.title).toBe('Fix login bug');
  });

  it('queries by kind and text, and hides soft-deleted records', async () => {
    const store = new UnifiedStore(path);
    await store.load();
    await store.upsertMany([
      entity({ id: 't1', kind: 'task', title: 'Write tests' }),
      entity({ id: 't2', kind: 'task', title: 'Ship release' }),
      entity({ id: 'd1', kind: 'document', title: 'Design doc' }),
    ]);
    expect(store.query({ kinds: ['task'] }).total).toBe(2);
    expect(store.query({ text: 'ship' }).items.map((e) => e.id)).toEqual(['t2']);

    await store.markDeleted(['t1'], '2026-02-01T00:00:00.000Z');
    expect(store.query({ kinds: ['task'] }).total).toBe(1);
    expect(store.query({ kinds: ['task'], includeDeleted: true }).total).toBe(2);
  });

  it('paginates with a cursor', async () => {
    const store = new UnifiedStore(path);
    await store.load();
    await store.upsertMany(
      Array.from({ length: 5 }, (_v, i) => entity({ id: `n${i}`, kind: 'task', title: `n${i}` })),
    );
    const page1 = store.query({ kinds: ['task'], limit: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.nextCursor).toBe('2');
    const page2 = store.query({ kinds: ['task'], limit: 2, cursor: page1.nextCursor });
    expect(page2.items.length).toBe(2);
  });

  it('aggregates counts by kind and connector', async () => {
    const store = new UnifiedStore(path);
    await store.load();
    await store.upsertMany([
      entity({ id: 'x', kind: 'task', connectorId: 'github' }),
      entity({ id: 'y', kind: 'message', connectorId: 'slack' }),
      entity({ id: 'z', kind: 'message', connectorId: 'slack' }),
    ]);
    const c = store.counts();
    expect(c.total).toBe(3);
    expect(c.byKind.message).toBe(2);
    expect(c.byConnector.slack).toBe(2);
  });

  it('persists across reloads', async () => {
    const a = new UnifiedStore(path);
    await a.load();
    await a.upsertMany([entity({ id: 'p', kind: 'project', title: 'Persisted' })]);
    const b = new UnifiedStore(path);
    await b.load();
    expect(b.get('p')?.title).toBe('Persisted');
  });
});

describe('LocalSearchBackend', () => {
  it('indexes and ranks by relevance with snippets', () => {
    const idx = new LocalSearchBackend();
    idx.index([
      entity({ id: '1', kind: 'document', title: 'Quarterly roadmap', body: 'plans for the quarter and roadmap goals' }),
      entity({ id: '2', kind: 'task', title: 'Update roadmap slide' }),
      entity({ id: '3', kind: 'message', title: 'Lunch', body: 'anyone for lunch later' }),
    ]);
    const hits = idx.search({ text: 'roadmap' });
    expect(hits.length).toBe(2);
    expect(hits.every((h) => `${h.title} ${h.snippet}`.toLowerCase().includes('roadmap'))).toBe(true);
  });

  it('filters by kind and removes entities', () => {
    const idx = new LocalSearchBackend();
    idx.index([
      entity({ id: '1', kind: 'document', title: 'roadmap doc' }),
      entity({ id: '2', kind: 'task', title: 'roadmap task' }),
    ]);
    expect(idx.search({ text: 'roadmap', kinds: ['task'] }).map((h) => h.id)).toEqual(['2']);
    idx.remove(['2']);
    expect(idx.search({ text: 'roadmap', kinds: ['task'] }).length).toBe(0);
  });
});
