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
