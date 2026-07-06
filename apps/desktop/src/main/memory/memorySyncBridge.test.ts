import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyHistoryIntegrity } from '@neuropause/shared';
import { MemoryStore } from './memoryStore';
import { memoryFieldsFromVersion, memoryVersionPayload, toSyncState } from './memorySyncAdapter';

const NOW = '2026-07-06T00:00:00.000Z';
const SCOPE = { orgId: 'org-1', deviceId: 'devA', userId: 'user-1' };

describe('memory sync adapter (pure)', () => {
  const item = {
    id: 'mem:explicit:1',
    kind: 'note' as const,
    origin: 'explicit' as const,
    title: 'Investor deck',
    content: 'Series A narrative draft',
    connectorId: null,
    source: 'manual',
    entityRefs: ['proj:1'],
    tags: ['fundraising'],
    occurredAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    evidence: null,
    metadata: { pinned: true },
  };

  it('memoryVersionPayload puts content in text and the rest in metadata', () => {
    const p = memoryVersionPayload(item);
    expect(p.text).toBe('Series A narrative draft');
    expect(p.metadata).toMatchObject({
      title: 'Investor deck',
      kind: 'note',
      tags: ['fundraising'],
      entityRefs: ['proj:1'],
      occurredAt: NOW,
      meta: { pinned: true },
    });
  });

  it('memoryFieldsFromVersion inverts the payload (round-trip)', () => {
    const p = memoryVersionPayload(item);
    const back = memoryFieldsFromVersion({
      versionId: 'v1',
      memoryId: item.id,
      orgId: 'org-1',
      timestamp: NOW,
      deviceId: 'devA',
      userId: 'user-1',
      parentVersion: null,
      previousHash: null,
      contentHash: 'x',
      text: p.text,
      metadata: p.metadata,
      deleted: false,
    });
    expect(back.content).toBe(item.content);
    expect(back.title).toBe(item.title);
    expect(back.tags).toEqual(item.tags);
    expect(back.metadata).toEqual(item.metadata);
  });

  it('toSyncState returns null for a local-only item', () => {
    expect(toSyncState(item)).toBeNull();
  });
});

describe('MemoryStore.remember — org scope (V6.6.2)', () => {
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
    dir = await fs.mkdtemp(join(tmpdir(), 'memsync-'));
    path = join(dir, 'memory.json');
  });
  afterEach(async () => {
    await Promise.all(opened.map((s) => s.flush()));
    opened.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('without scope stays local-only (sync undefined) — unchanged behavior', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'local only' }, NOW);
    expect(m.sync).toBeUndefined();
  });

  it('with scope seeds an initial synced version', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'shared' }, NOW, SCOPE);
    expect(m.sync).toBeDefined();
    expect(m.sync?.orgId).toBe('org-1');
    expect(m.sync?.parentVersion).toBeNull();
    expect(m.sync?.deleted).toBe(false);
    expect(m.sync?.history).toHaveLength(1);
    expect(m.sync?.history[0].versionId).toBe(m.sync?.versionId);
  });

  it('the seeded version is a valid, integrity-checked first version', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'shared' }, NOW, SCOPE);
    const head = m.sync!.history[0];
    expect(head.parentVersion).toBeNull();
    expect(head.previousHash).toBeNull();
    expect(verifyHistoryIntegrity(m.sync!.history)).toBe(true);
  });

  it('a scoped memory converts to a MemoryState with its head', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'shared' }, NOW, SCOPE);
    const state = toSyncState(m);
    expect(state).not.toBeNull();
    expect(state?.memoryId).toBe(m.id);
    expect(state?.head.versionId).toBe(m.sync?.versionId);
    expect(state?.head.text).toBe('shared');
  });
});

describe('MemoryStore.update — append version for synced items (V6.6.2)', () => {
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
    dir = await fs.mkdtemp(join(tmpdir(), 'memupd-'));
    path = join(dir, 'memory.json');
  });
  afterEach(async () => {
    await Promise.all(opened.map((s) => s.flush()));
    opened.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('synced item + actor + content change appends a new version (never overwrites)', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'v1 text' }, NOW, SCOPE);
    const firstVersionId = m.sync!.versionId;
    const updated = store.update(m.id, { content: 'v2 text' }, '2026-07-06T01:00:00.000Z', {
      deviceId: 'devA',
      userId: 'user-1',
    });
    expect(updated?.sync?.history).toHaveLength(2);
    expect(updated?.sync?.parentVersion).toBe(firstVersionId);
    expect(updated?.sync?.versionId).not.toBe(firstVersionId);
    // The original version is preserved — no data loss.
    expect(updated?.sync?.history.some((v) => v.versionId === firstVersionId)).toBe(true);
  });

  it('the appended history stays a valid integrity-checked chain', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'v1' }, NOW, SCOPE);
    const updated = store.update(m.id, { content: 'v2' }, '2026-07-06T01:00:00.000Z', {
      deviceId: 'devA',
      userId: 'user-1',
    });
    expect(verifyHistoryIntegrity(updated!.sync!.history)).toBe(true);
  });

  it('synced item + actor + NO content change does not append a redundant version', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'same' }, NOW, SCOPE);
    const updated = store.update(m.id, { content: 'same' }, '2026-07-06T01:00:00.000Z', {
      deviceId: 'devA',
      userId: 'user-1',
    });
    expect(updated?.sync?.history).toHaveLength(1);
  });

  it('synced item WITHOUT actor patches locally and leaves history untouched', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'v1' }, NOW, SCOPE);
    const updated = store.update(m.id, { metadata: { pinned: true } }, '2026-07-06T01:00:00.000Z');
    expect(updated?.metadata.pinned).toBe(true);
    expect(updated?.sync?.history).toHaveLength(1); // unchanged
  });

  it('non-synced item updates in place, unchanged behavior (no sync appears)', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'local' }, NOW);
    const updated = store.update(m.id, { metadata: { pinned: true } }, '2026-07-06T01:00:00.000Z', {
      deviceId: 'devA',
      userId: 'user-1',
    });
    expect(updated?.metadata.pinned).toBe(true);
    expect(updated?.sync).toBeUndefined();
  });
});

describe('MemoryStore.forget — soft-delete for synced items (V6.6.2)', () => {
  let dir: string;
  let path: string;
  const opened: MemoryStore[] = [];
  const ACTOR = { deviceId: 'devA', userId: 'user-1' };

  async function open(p: string): Promise<MemoryStore> {
    const store = new MemoryStore(p);
    await store.load();
    opened.push(store);
    return store;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'memdel-'));
    path = join(dir, 'memory.json');
  });
  afterEach(async () => {
    await Promise.all(opened.map((s) => s.flush()));
    opened.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('soft-deletes a synced item: it stays as a tombstone, not removed', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'shared' }, NOW, SCOPE);
    const firstVersionId = m.sync!.versionId;
    const n = store.forget([m.id], '2026-07-06T02:00:00.000Z', ACTOR);
    expect(n).toBe(1);
    const still = store.get(m.id);
    expect(still).not.toBeNull();
    expect(still?.sync?.deleted).toBe(true);
    expect(still?.sync?.history).toHaveLength(2);
    // The pre-delete version is preserved — recoverable, no data loss.
    expect(still?.sync?.history.some((v) => v.versionId === firstVersionId && !v.deleted)).toBe(
      true,
    );
  });

  it('the tombstone is a valid chained delete version', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'shared' }, NOW, SCOPE);
    store.forget([m.id], '2026-07-06T02:00:00.000Z', ACTOR);
    const t = store.get(m.id)!;
    const head = t.sync!.history.find((v) => v.versionId === t.sync!.versionId)!;
    expect(head.deleted).toBe(true);
    expect(verifyHistoryIntegrity(t.sync!.history)).toBe(true);
  });

  it('soft-deletes even without an actor (system fallback preserves history)', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'shared' }, NOW, SCOPE);
    store.forget([m.id], '2026-07-06T02:00:00.000Z');
    const still = store.get(m.id);
    expect(still?.sync?.deleted).toBe(true);
    expect(still?.sync?.history).toHaveLength(2);
  });

  it('hard-deletes a local-only item, unchanged behavior', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'local' }, NOW);
    store.forget([m.id], '2026-07-06T02:00:00.000Z', ACTOR);
    expect(store.get(m.id)).toBeNull();
  });

  it('tombstoned memory is excluded from recall and counts', async () => {
    const store = await open(path);
    const keep = store.remember({ kind: 'note', title: 'Keep', content: 'alpha' }, NOW, SCOPE);
    const drop = store.remember({ kind: 'note', title: 'Drop', content: 'beta' }, NOW, SCOPE);
    store.forget([drop.id], '2026-07-06T02:00:00.000Z', ACTOR);
    const recalled = store.recall({ limit: 10 }).hits.map((h) => h.item.id);
    expect(recalled).toContain(keep.id);
    expect(recalled).not.toContain(drop.id);
    expect(store.counts().total).toBe(1);
  });

  it('forgetting an already-tombstoned item is idempotent', async () => {
    const store = await open(path);
    const m = store.remember({ kind: 'note', title: 'A', content: 'shared' }, NOW, SCOPE);
    store.forget([m.id], '2026-07-06T02:00:00.000Z', ACTOR);
    store.forget([m.id], '2026-07-06T03:00:00.000Z', ACTOR);
    expect(store.get(m.id)?.sync?.history).toHaveLength(2); // no duplicate tombstone
  });
});
