import { describe, expect, it } from 'vitest';
import {
  hashMemoryContent,
  resolveMemorySync,
  verifyHistoryIntegrity,
  type MemoryState,
  type MemoryVersion,
} from '@neuropause/shared';

// ── builders ──

function mkVersion(
  over: Partial<MemoryVersion> & { versionId: string; timestamp: string },
): MemoryVersion {
  const text = over.text ?? `text-${over.versionId}`;
  const metadata = over.metadata ?? null;
  return {
    memoryId: over.memoryId ?? 'mem-1',
    orgId: over.orgId ?? 'org-1',
    deviceId: over.deviceId ?? 'devA',
    userId: over.userId ?? 'user-1',
    parentVersion: over.parentVersion ?? null,
    previousHash: over.previousHash ?? null,
    contentHash: over.contentHash ?? hashMemoryContent(text, metadata),
    deleted: over.deleted ?? false,
    text,
    metadata,
    versionId: over.versionId,
    timestamp: over.timestamp,
  };
}

/** A child version correctly linked to its parent (parentVersion + previousHash). */
function child(
  parent: MemoryVersion,
  over: Partial<MemoryVersion> & { versionId: string; timestamp: string },
): MemoryVersion {
  const text = over.text ?? `text-${over.versionId}`;
  const metadata = over.metadata ?? null;
  return mkVersion({
    ...over,
    text,
    metadata,
    parentVersion: parent.versionId,
    previousHash: parent.contentHash,
    contentHash: hashMemoryContent(text, metadata),
  });
}

function state(head: MemoryVersion, history: MemoryVersion[] = []): MemoryState {
  return { memoryId: head.memoryId, orgId: head.orgId, head, history };
}

const v1 = mkVersion({ versionId: 'v1', timestamp: '2026-07-06T10:00:00.000Z' });

describe('resolveMemorySync — linear cases', () => {
  it('identical heads → no-op, no conflict, nothing to embed or sync', () => {
    const r = resolveMemorySync(state(v1), state(v1));
    expect(r.mergeType).toBe('identical');
    expect(r.conflict).toBe(false);
    expect(r.winner.versionId).toBe('v1');
    expect(r.requiredEmbeddings).toEqual([]);
    expect(r.syncActions).toEqual([]);
  });

  it('remote ahead → fast-forward, applies remote head, requires its embedding', () => {
    const v2 = child(v1, { versionId: 'v2', timestamp: '2026-07-06T10:01:00.000Z' });
    const r = resolveMemorySync(state(v1), state(v2, [v1]));
    expect(r.mergeType).toBe('fast_forward');
    expect(r.conflict).toBe(false);
    expect(r.winner.versionId).toBe('v2');
    expect(r.requiredEmbeddings).toEqual(['v2']);
    expect(r.syncActions).toContainEqual({ type: 'apply_head', versionId: 'v2' });
  });

  it('local ahead → fast-forward keeps local, asks caller to push, no re-embed', () => {
    const v2 = child(v1, { versionId: 'v2', timestamp: '2026-07-06T10:01:00.000Z' });
    const r = resolveMemorySync(state(v2, [v1]), state(v1));
    expect(r.mergeType).toBe('fast_forward');
    expect(r.winner.versionId).toBe('v2');
    expect(r.requiredEmbeddings).toEqual([]);
    expect(r.syncActions).toContainEqual({ type: 'push', versionId: 'v2' });
  });

  it('stale remote (an ancestor of local head) is ignored, no data loss', () => {
    const v2 = child(v1, { versionId: 'v2', timestamp: '2026-07-06T10:01:00.000Z' });
    const v3 = child(v2, { versionId: 'v3', timestamp: '2026-07-06T10:02:00.000Z' });
    const r = resolveMemorySync(state(v3, [v1, v2]), state(v1));
    expect(r.winner.versionId).toBe('v3');
    expect(r.conflict).toBe(false);
    expect(r.history.map((h) => h.versionId).sort()).toEqual(['v1', 'v2', 'v3']);
  });

  it('metadata-only linear change fast-forwards', () => {
    const v2 = child(v1, {
      versionId: 'v2',
      timestamp: '2026-07-06T10:01:00.000Z',
      text: v1.text,
      metadata: { pinned: true },
    });
    const r = resolveMemorySync(state(v1), state(v2, [v1]));
    expect(r.mergeType).toBe('fast_forward');
    expect(r.winner.metadata).toEqual({ pinned: true });
  });
});

describe('resolveMemorySync — concurrent conflicts (never lose data)', () => {
  const a = child(v1, { versionId: 'v2a', timestamp: '2026-07-06T10:05:00.000Z', text: 'edit-A' });
  const b = child(v1, { versionId: 'v2b', timestamp: '2026-07-06T10:06:00.000Z', text: 'edit-B' });

  it('divergent edits → conflict, both preserved in history', () => {
    const r = resolveMemorySync(state(a, [v1]), state(b, [v1]));
    expect(r.mergeType).toBe('concurrent');
    expect(r.conflict).toBe(true);
    const ids = r.history.map((h) => h.versionId);
    expect(ids).toContain('v2a');
    expect(ids).toContain('v2b');
    expect(r.syncActions).toContainEqual({
      type: 'record_conflict',
      versionIds: ['v2a', 'v2b'],
    });
  });

  it('the losing edit is retained (no data loss)', () => {
    const r = resolveMemorySync(state(a, [v1]), state(b, [v1]));
    const loserId = r.winner.versionId === 'v2a' ? 'v2b' : 'v2a';
    expect(r.history.map((h) => h.versionId)).toContain(loserId);
  });

  it('is order-independent: resolve(A,B) and resolve(B,A) pick the same head', () => {
    const ab = resolveMemorySync(state(a, [v1]), state(b, [v1]));
    const ba = resolveMemorySync(state(b, [v1]), state(a, [v1]));
    expect(ab.winner.versionId).toBe(ba.winner.versionId);
    expect(ab.history.map((h) => h.versionId)).toEqual(ba.history.map((h) => h.versionId));
  });

  it('rename vs rename (concurrent) keeps both', () => {
    const r = resolveMemorySync(state(a, [v1]), state(b, [v1]));
    expect(r.conflict).toBe(true);
    expect(r.history.length).toBe(3); // v1, v2a, v2b
  });
});

describe('resolveMemorySync — deletes and tombstones', () => {
  it('delete vs edit → keeps the EDIT as head, tombstone retained + recoverable', () => {
    const edit = child(v1, {
      versionId: 'v2e',
      timestamp: '2026-07-06T10:05:00.000Z',
      text: 'kept',
    });
    const del = child(v1, {
      versionId: 'v2d',
      timestamp: '2026-07-06T10:06:00.000Z',
      deleted: true,
    });
    const r = resolveMemorySync(state(edit, [v1]), state(del, [v1]));
    expect(r.mergeType).toBe('delete_vs_edit');
    expect(r.conflict).toBe(true);
    expect(r.winner.deleted).toBe(false);
    expect(r.winner.versionId).toBe('v2e');
    // The delete is not lost — it stays in history, recoverable / re-appliable.
    expect(r.history.map((h) => h.versionId)).toContain('v2d');
  });

  it('both deleted → converges on a tombstone, no conflict', () => {
    const da = child(v1, {
      versionId: 'v2da',
      timestamp: '2026-07-06T10:05:00.000Z',
      deleted: true,
    });
    const db = child(v1, {
      versionId: 'v2db',
      timestamp: '2026-07-06T10:06:00.000Z',
      deleted: true,
    });
    const r = resolveMemorySync(state(da, [v1]), state(db, [v1]));
    expect(r.mergeType).toBe('both_deleted');
    expect(r.conflict).toBe(false);
    expect(r.winner.deleted).toBe(true);
  });

  it('restore (edit descending from a delete) fast-forwards to the restore', () => {
    const del = child(v1, {
      versionId: 'v2',
      timestamp: '2026-07-06T10:05:00.000Z',
      deleted: true,
    });
    const restore = child(del, {
      versionId: 'v3',
      timestamp: '2026-07-06T10:06:00.000Z',
      text: 'back',
    });
    const r = resolveMemorySync(state(restore, [v1, del]), state(del, [v1]));
    expect(r.mergeType).toBe('fast_forward');
    expect(r.winner.versionId).toBe('v3');
    expect(r.winner.deleted).toBe(false);
  });

  it('pre-delete version stays in history (delete never physically removes)', () => {
    const del = child(v1, {
      versionId: 'v2',
      timestamp: '2026-07-06T10:05:00.000Z',
      deleted: true,
    });
    const r = resolveMemorySync(state(del, [v1]), state(v1));
    expect(r.history.map((h) => h.versionId)).toContain('v1');
  });
});

describe('resolveMemorySync — idempotency & convergence', () => {
  const a = child(v1, { versionId: 'v2a', timestamp: '2026-07-06T10:05:00.000Z', text: 'A' });
  const b = child(v1, { versionId: 'v2b', timestamp: '2026-07-06T10:06:00.000Z', text: 'B' });

  it('re-resolving a merged state against the same remote is a no-op', () => {
    const first = resolveMemorySync(state(a, [v1]), state(b, [v1]));
    const merged = {
      memoryId: 'mem-1',
      orgId: 'org-1',
      head: first.winner,
      history: first.history,
    };
    const second = resolveMemorySync(merged, state(b, [v1]));
    expect(second.winner.versionId).toBe(first.winner.versionId);
    expect(second.history.map((h) => h.versionId)).toEqual(first.history.map((h) => h.versionId));
  });

  it('repeated merge is stable (merge(merge(A,B),B) == merge(A,B))', () => {
    const first = resolveMemorySync(state(a, [v1]), state(b, [v1]));
    const merged = {
      memoryId: 'mem-1',
      orgId: 'org-1',
      head: first.winner,
      history: first.history,
    };
    const again = resolveMemorySync(merged, state(b, [v1]));
    const yetAgain = resolveMemorySync(
      { memoryId: 'mem-1', orgId: 'org-1', head: again.winner, history: again.history },
      state(b, [v1]),
    );
    expect(yetAgain.winner.versionId).toBe(first.winner.versionId);
    expect(yetAgain.history.length).toBe(first.history.length);
  });

  it('duplicate remote application does not duplicate history entries', () => {
    const v2 = child(v1, { versionId: 'v2', timestamp: '2026-07-06T10:05:00.000Z' });
    const once = resolveMemorySync(state(v1), state(v2, [v1]));
    const merged = { memoryId: 'mem-1', orgId: 'org-1', head: once.winner, history: once.history };
    const twice = resolveMemorySync(merged, state(v2, [v1]));
    expect(twice.history.map((h) => h.versionId).sort()).toEqual(['v1', 'v2']);
  });
});

describe('resolveMemorySync — history log guarantees', () => {
  const a = child(v1, { versionId: 'v2a', timestamp: '2026-07-06T10:05:00.000Z', text: 'A' });
  const b = child(v1, { versionId: 'v2b', timestamp: '2026-07-06T10:06:00.000Z', text: 'B' });

  it('history is the union of all input versions (append-only)', () => {
    const r = resolveMemorySync(state(a, [v1]), state(b, [v1]));
    expect(r.history.map((h) => h.versionId).sort()).toEqual(['v1', 'v2a', 'v2b']);
  });

  it('history is deterministically ordered by timestamp then versionId', () => {
    const r = resolveMemorySync(state(a, [v1]), state(b, [v1]));
    expect(r.history.map((h) => h.versionId)).toEqual(['v1', 'v2a', 'v2b']);
  });

  it('history dedupes versions shared by both sides', () => {
    const shared = child(v1, { versionId: 'vShared', timestamp: '2026-07-06T10:04:00.000Z' });
    const r = resolveMemorySync(state(shared, [v1]), state(shared, [v1]));
    expect(r.history.filter((h) => h.versionId === 'vShared')).toHaveLength(1);
  });
});

describe('verifyHistoryIntegrity', () => {
  it('accepts a well-formed hash chain', () => {
    const v2 = child(v1, { versionId: 'v2', timestamp: '2026-07-06T10:01:00.000Z' });
    const v3 = child(v2, { versionId: 'v3', timestamp: '2026-07-06T10:02:00.000Z' });
    expect(verifyHistoryIntegrity([v1, v2, v3])).toBe(true);
  });

  it('rejects a tampered version (content no longer matches its hash)', () => {
    const v2 = child(v1, { versionId: 'v2', timestamp: '2026-07-06T10:01:00.000Z' });
    const tampered = { ...v2, text: 'secretly changed' }; // contentHash now stale
    expect(verifyHistoryIntegrity([v1, tampered])).toBe(false);
  });

  it('rejects a broken chain link (previousHash mismatch)', () => {
    const v2 = child(v1, { versionId: 'v2', timestamp: '2026-07-06T10:01:00.000Z' });
    const broken = { ...v2, previousHash: 'deadbeefdeadbeef' };
    expect(verifyHistoryIntegrity([v1, broken])).toBe(false);
  });
});
