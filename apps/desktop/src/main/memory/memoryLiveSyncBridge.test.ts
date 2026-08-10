import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryState, MemorySyncResult, MemoryVersion } from '@neuropause/shared';
import { MemoryStore } from './memoryStore';
import {
  createMemorySyncGuard,
  memoryStateToSyncChange,
  memorySyncSignal,
  syncChangeToMemoryState,
} from './memoryLiveSyncBridge';

function version(id: string, deleted = false): MemoryVersion {
  return {
    versionId: id,
    memoryId: 'mem-1',
    orgId: 'org-1',
    timestamp: '2026-07-06T00:00:00.000Z',
    deviceId: 'dev-1',
    userId: 'user-1',
    parentVersion: null,
    previousHash: null,
    contentHash: 'hash',
    text: 'content',
    metadata: null,
    deleted,
  };
}

function state(head: MemoryVersion, history: MemoryVersion[]): MemoryState {
  return { memoryId: 'mem-1', orgId: 'org-1', head, history };
}

function result(mergeType: MemorySyncResult['mergeType'], winnerId: string): MemorySyncResult {
  return {
    memoryId: 'mem-1',
    winner: version(winnerId),
    history: [version(winnerId)],
    conflict: mergeType === 'concurrent' || mergeType === 'delete_vs_edit',
    mergeType,
    requiredEmbeddings: [],
    syncActions: [],
  };
}

describe('memory bridge serialization', () => {
  it('serializes a memory state into a memory sync change', () => {
    const v = version('v1');
    const change = memoryStateToSyncChange(state(v, [v]));
    expect(change.entityType).toBe('memory');
    expect(change.entityId).toBe('mem-1');
    expect(change.version).toBe(1);
    expect(change.data).toBeTruthy();
  });

  it('version equals history length (monotonic per memory)', () => {
    const v1 = version('v1');
    const v2 = version('v2');
    expect(memoryStateToSyncChange(state(v2, [v1, v2])).version).toBe(2);
  });

  it('round-trips through deserialize', () => {
    const v = version('v1');
    const change = memoryStateToSyncChange(state(v, [v]));
    const back = syncChangeToMemoryState(change);
    expect(back?.memoryId).toBe('mem-1');
    expect(back?.head.versionId).toBe('v1');
  });

  it('deserialize returns null for a non-memory entity', () => {
    expect(
      syncChangeToMemoryState({
        entityType: 'org_prefs',
        entityId: 'x',
        orgId: 'org-1',
        version: 1,
        updatedAt: 'now',
        deleted: false,
        data: {},
      }),
    ).toBeNull();
  });

  it('deserialize returns null for null or malformed data', () => {
    const base = {
      entityType: 'memory' as const,
      entityId: 'mem-1',
      orgId: 'org-1',
      version: 1,
      updatedAt: 'now',
      deleted: false,
    };
    expect(syncChangeToMemoryState({ ...base, data: null })).toBeNull();
    expect(syncChangeToMemoryState({ ...base, data: { memoryId: 'mem-1' } })).toBeNull();
  });

  it('memorySyncSignal changes on head or history-length change', () => {
    const v1 = version('v1');
    const v2 = version('v2');
    const a = memorySyncSignal(state(v1, [v1]));
    const b = memorySyncSignal(state(v2, [v1, v2])); // head + length changed
    const c = memorySyncSignal(state(v1, [v1, v2])); // same head, length grew (conflict merge)
    expect(a).not.toBe(b);
    expect(a).not.toBe(c); // history growth alone still re-enqueues
  });
});

describe('memory sync loop guard', () => {
  it('marks fast-forward and identical applies (echo suppressed)', () => {
    const guard = createMemorySyncGuard();
    guard.noteApplied(result('fast_forward', 'v1'));
    guard.noteApplied(result('identical', 'v2'));
    expect(guard.consumeEcho('v1')).toBe(true);
    expect(guard.consumeEcho('v2')).toBe(true);
  });

  it('does NOT mark conflict merges (they must re-enqueue to converge)', () => {
    const guard = createMemorySyncGuard();
    guard.noteApplied(result('concurrent', 'v1'));
    guard.noteApplied(result('delete_vs_edit', 'v2'));
    expect(guard.consumeEcho('v1')).toBe(false);
    expect(guard.consumeEcho('v2')).toBe(false);
  });

  it('consumeEcho is one-shot (clears the mark)', () => {
    const guard = createMemorySyncGuard();
    guard.noteApplied(result('fast_forward', 'v1'));
    expect(guard.consumeEcho('v1')).toBe(true);
    expect(guard.consumeEcho('v1')).toBe(false); // already consumed
    expect(guard.size()).toBe(0);
  });
});

describe('MemoryStore.syncedItems', () => {
  let dir: string;
  let path: string;
  const opened: MemoryStore[] = [];
  // P13A — a device id only. The org comes from the resolved viewer.
  const SYNCED = { sync: { deviceId: 'dev-1' } };

  async function open(p: string): Promise<MemoryStore> {
    const store = new MemoryStore(p);
    await store.load();
    opened.push(store);
    return store;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'memsynced-'));
    path = join(dir, 'memory.json');
  });
  afterEach(async () => {
    await Promise.all(opened.map((s) => s.flush()));
    opened.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns only items carrying sync fields', async () => {
    const store = await open(path);
    store.remember({ kind: 'note', title: 'local', content: 'x' });
    const synced = store.remember(
      { kind: 'note', title: 'shared', content: 'y' },
      undefined,
      SYNCED,
    );
    const items = store.syncedItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(synced.id);
  });
});
