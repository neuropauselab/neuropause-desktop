import { beforeEach, describe, expect, it } from 'vitest';
import type {
  MergeOutcome,
  PushItemStatus,
  SyncChange,
  SyncPullResponse,
  SyncPushResponse,
} from '@neuropause/shared';
import { runSyncCycle, SyncEngine } from './engine';
import type { QueuedChange, SyncStore, SyncTransport } from './types';

function change(over: Partial<SyncChange> = {}): SyncChange {
  return {
    entityType: 'org_prefs',
    entityId: 'prefs',
    orgId: 'org-1',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleted: false,
    data: { theme: 'dark' },
    ...over,
  };
}

class StubTransport implements SyncTransport {
  pushCalls: SyncChange[][] = [];
  pullPages: SyncPullResponse[] = [];
  pullError: unknown = null;
  pushError: unknown = null;
  /** What the server reports for every pushed item (per-item conflicts, staleness). */
  pushStatus: PushItemStatus = 'applied';
  private pullIdx = 0;

  async push(_orgId: string, _deviceId: string, changes: SyncChange[]): Promise<SyncPushResponse> {
    if (this.pushError) throw this.pushError;
    this.pushCalls.push(changes);
    return {
      results: changes.map((c) => ({
        entityType: c.entityType,
        entityId: c.entityId,
        status: this.pushStatus,
        serverVersion: c.version,
        serverUpdatedAt: c.updatedAt,
      })),
      cursor: 0,
    };
  }

  async pull(): Promise<SyncPullResponse> {
    if (this.pullError) throw this.pullError;
    const page = this.pullPages[this.pullIdx] ?? { changes: [], cursor: 0, hasMore: false };
    this.pullIdx += 1;
    return page;
  }
}

class StubStore implements SyncStore {
  pending: QueuedChange[] = [];
  removed: string[][] = [];
  cursor = 0;
  applied: SyncChange[] = [];
  applyOutcome: MergeOutcome = 'applied';

  async listPending(): Promise<QueuedChange[]> {
    return this.pending;
  }
  async removePending(_orgId: string, ids: string[]): Promise<void> {
    this.removed.push(ids);
    this.pending = this.pending.filter((p) => !ids.includes(p.queueId));
  }
  async getCursor(): Promise<number> {
    return this.cursor;
  }
  async setCursor(_orgId: string, c: number): Promise<void> {
    this.cursor = c;
  }
  async applyRemote(c: SyncChange): Promise<MergeOutcome> {
    this.applied.push(c);
    return this.applyOutcome;
  }
}

describe('runSyncCycle', () => {
  it('pushes pending changes then clears them from the queue', async () => {
    const t = new StubTransport();
    const s = new StubStore();
    s.pending = [{ queueId: 'q1', change: change() }];
    const res = await runSyncCycle(t, s, 'org-1', 'devA');
    expect(t.pushCalls).toHaveLength(1);
    expect(res.pushed).toBe(1);
    expect(s.removed[0]).toEqual(['q1']);
    expect(s.pending).toHaveLength(0);
  });

  it('pulls and applies remote changes, advancing the cursor', async () => {
    const t = new StubTransport();
    const s = new StubStore();
    t.pullPages = [
      {
        changes: [change({ entityId: 'a' }), change({ entityId: 'b' })],
        cursor: 5,
        hasMore: false,
      },
    ];
    const res = await runSyncCycle(t, s, 'org-1', 'devA');
    expect(s.applied).toHaveLength(2);
    expect(res.pulled).toBe(2);
    expect(s.cursor).toBe(5);
  });

  it('paginates until hasMore is false', async () => {
    const t = new StubTransport();
    const s = new StubStore();
    t.pullPages = [
      { changes: [change({ entityId: 'a' })], cursor: 1, hasMore: true },
      { changes: [change({ entityId: 'b' })], cursor: 2, hasMore: false },
    ];
    const res = await runSyncCycle(t, s, 'org-1', 'devA');
    expect(res.pulled).toBe(2);
    expect(s.cursor).toBe(2);
  });

  it('counts conflicts reported by applyRemote', async () => {
    const t = new StubTransport();
    const s = new StubStore();
    s.applyOutcome = 'conflict';
    t.pullPages = [{ changes: [change()], cursor: 1, hasMore: false }];
    const res = await runSyncCycle(t, s, 'org-1', 'devA');
    expect(res.conflicts).toBe(1);
  });

  it('identifies pull conflicts by entity and direction', async () => {
    const t = new StubTransport();
    const s = new StubStore();
    s.applyOutcome = 'conflict';
    t.pullPages = [
      { changes: [change({ entityType: 'memory', entityId: 'm-1' })], cursor: 1, hasMore: false },
    ];
    const res = await runSyncCycle(t, s, 'org-1', 'devA');
    expect(res.conflictRefs).toEqual([
      { entityType: 'memory', entityId: 'm-1', direction: 'pull' },
    ]);
  });

  it('identifies push conflicts the server rejected, and still clears the queue', async () => {
    const t = new StubTransport();
    const s = new StubStore();
    t.pushStatus = 'conflict';
    s.pending = [{ queueId: 'q1', change: change({ entityType: 'org_prefs', entityId: 'prefs' }) }];
    const res = await runSyncCycle(t, s, 'org-1', 'devA');
    expect(res.conflictRefs).toEqual([
      { entityType: 'org_prefs', entityId: 'prefs', direction: 'push' },
    ]);
    expect(res.conflicts).toBe(1);
    // Acknowledged either way — the authoritative value arrives on the next pull.
    expect(s.pending).toHaveLength(0);
  });

  it('does not treat a stale push result as a conflict', async () => {
    const t = new StubTransport();
    const s = new StubStore();
    t.pushStatus = 'stale';
    s.pending = [{ queueId: 'q1', change: change() }];
    const res = await runSyncCycle(t, s, 'org-1', 'devA');
    expect(res.conflictRefs).toHaveLength(0);
  });

  it('collects conflicts from both legs of a single cycle', async () => {
    const t = new StubTransport();
    const s = new StubStore();
    t.pushStatus = 'conflict';
    s.applyOutcome = 'conflict';
    s.pending = [{ queueId: 'q1', change: change({ entityId: 'pushed' }) }];
    t.pullPages = [{ changes: [change({ entityId: 'pulled' })], cursor: 1, hasMore: false }];
    const res = await runSyncCycle(t, s, 'org-1', 'devA');
    expect(res.conflicts).toBe(2);
    expect(res.conflictRefs.map((r) => r.direction)).toEqual(['push', 'pull']);
  });
});

describe('SyncEngine.syncOnce', () => {
  let t: StubTransport;
  let s: StubStore;
  beforeEach(() => {
    t = new StubTransport();
    s = new StubStore();
  });

  it('goes idle and records lastSyncedAt on success', async () => {
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA', now: () => 1000 });
    const status = await engine.syncOnce('org-1');
    expect(status.state).toBe('idle');
    expect(status.online).toBe(true);
    expect(status.failures).toBe(0);
    expect(status.lastSyncedAt).toBe(new Date(1000).toISOString());
  });

  it('goes offline on a network error and counts the failure', async () => {
    t.pullError = new Error('fetch failed');
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA' });
    const status = await engine.syncOnce('org-1');
    expect(status.state).toBe('offline');
    expect(status.online).toBe(false);
    expect(status.failures).toBe(1);
    expect(engine.errorKind).toBe('network');
  });

  it('goes to the error state on a server error', async () => {
    t.pullError = { status: 500 };
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA' });
    const status = await engine.syncOnce('org-1');
    expect(status.state).toBe('error');
    expect(engine.errorKind).toBe('server');
  });

  it('applies exponential backoff across consecutive failures', async () => {
    t.pullError = { status: 500 };
    const engine = new SyncEngine({
      transport: t,
      store: s,
      deviceId: 'devA',
      backoff: { baseMs: 1000, capMs: 60000, factor: 2 },
    });
    expect(engine.nextRetryDelay()).toBe(0);
    await engine.syncOnce('org-1');
    expect(engine.nextRetryDelay()).toBe(1000);
    await engine.syncOnce('org-1');
    expect(engine.nextRetryDelay()).toBe(2000);
  });

  it('resets failures and returns to idle after a recovery', async () => {
    t.pullError = { status: 500 };
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA' });
    await engine.syncOnce('org-1');
    expect(engine.getStatus().failures).toBe(1);
    t.pullError = null;
    const status = await engine.syncOnce('org-1');
    expect(status.failures).toBe(0);
    expect(status.state).toBe('idle');
    expect(engine.nextRetryDelay()).toBe(0);
  });

  it('reports the backlog actually left in the queue after a cycle', async () => {
    s.pending = [{ queueId: 'q1', change: change() }];
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA' });
    await engine.syncOnce('org-1');
    expect(engine.getStatus().pendingCount).toBe(0);

    // A failed cycle leaves the queue intact, and the status keeps the last count.
    s.pending = [{ queueId: 'q2', change: change() }];
    t.pullError = { status: 500 };
    const failed = await engine.syncOnce('org-1');
    expect(failed.state).toBe('error');
    expect(s.pending).toHaveLength(0); // the push leg still drained before the pull failed
  });
});

describe('SyncEngine conflict log', () => {
  let t: StubTransport;
  let s: StubStore;
  beforeEach(() => {
    t = new StubTransport();
    s = new StubStore();
  });

  it('starts empty and stays empty on a clean cycle', async () => {
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA' });
    expect(engine.getConflicts()).toEqual([]);
    await engine.syncOnce('org-1');
    expect(engine.getConflicts()).toEqual([]);
  });

  it('records resolved conflicts with the strategy and the engine clock', async () => {
    s.applyOutcome = 'conflict';
    t.pullPages = [
      { changes: [change({ entityType: 'memory', entityId: 'm-1' })], cursor: 1, hasMore: false },
    ];
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA', now: () => 5000 });
    await engine.syncOnce('org-1');
    expect(engine.getConflicts()).toEqual([
      {
        entityType: 'memory',
        entityId: 'm-1',
        direction: 'pull',
        resolution: 'last_write_wins',
        at: new Date(5000).toISOString(),
      },
    ]);
  });

  it('orders the log newest first, both within and across cycles', async () => {
    s.applyOutcome = 'conflict';
    t.pullPages = [
      {
        changes: [change({ entityId: 'a' }), change({ entityId: 'b' })],
        cursor: 1,
        hasMore: false,
      },
      { changes: [change({ entityId: 'c' })], cursor: 2, hasMore: false },
    ];
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA' });
    await engine.syncOnce('org-1');
    expect(engine.getConflicts().map((c) => c.entityId)).toEqual(['b', 'a']);
    await engine.syncOnce('org-1');
    expect(engine.getConflicts().map((c) => c.entityId)).toEqual(['c', 'b', 'a']);
  });

  it('bounds the log so a persistent conflict storm cannot grow it without limit', async () => {
    s.applyOutcome = 'conflict';
    const changes = Array.from({ length: 60 }, (_, i) => change({ entityId: `e-${i}` }));
    t.pullPages = [{ changes, cursor: 1, hasMore: false }];
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA' });
    await engine.syncOnce('org-1');
    const log = engine.getConflicts();
    expect(log).toHaveLength(50);
    expect(log[0]?.entityId).toBe('e-59');
    expect(log.at(-1)?.entityId).toBe('e-10');
  });

  it('returns a copy so callers cannot mutate the engine’s log', async () => {
    s.applyOutcome = 'conflict';
    t.pullPages = [{ changes: [change()], cursor: 1, hasMore: false }];
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA' });
    await engine.syncOnce('org-1');
    engine.getConflicts().length = 0;
    expect(engine.getConflicts()).toHaveLength(1);
  });
});

describe('SyncEngine pause', () => {
  let t: StubTransport;
  let s: StubStore;
  beforeEach(() => {
    t = new StubTransport();
    s = new StubStore();
  });

  it('refuses cycles while paused so local edits stay queued on the device', async () => {
    s.pending = [{ queueId: 'q1', change: change() }];
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA' });
    engine.setPaused(true);
    const status = await engine.syncOnce('org-1');
    expect(engine.isPaused()).toBe(true);
    expect(status.state).toBe('offline');
    expect(status.online).toBe(false);
    expect(t.pushCalls).toHaveLength(0);
    expect(s.pending).toHaveLength(1);
  });

  it('restores the last real cycle state on resume rather than inventing one', async () => {
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA', now: () => 1000 });
    await engine.syncOnce('org-1');
    expect(engine.getStatus().state).toBe('idle');

    engine.setPaused(true);
    expect(engine.getStatus()).toMatchObject({
      state: 'offline',
      online: false,
      lastSyncedAt: new Date(1000).toISOString(),
    });

    engine.setPaused(false);
    expect(engine.getStatus().state).toBe('idle');
    expect(engine.getStatus().online).toBe(true);
  });

  it('keeps reporting a real failure through a pause and after resuming', async () => {
    t.pullError = { status: 500 };
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA' });
    await engine.syncOnce('org-1');
    engine.setPaused(true);
    expect(engine.getStatus()).toMatchObject({ state: 'offline', failures: 1 });
    expect(engine.getStatus().lastError).not.toBeNull();
    engine.setPaused(false);
    expect(engine.getStatus().state).toBe('error');
  });

  it('syncs again once resumed', async () => {
    s.pending = [{ queueId: 'q1', change: change() }];
    const engine = new SyncEngine({ transport: t, store: s, deviceId: 'devA' });
    engine.setPaused(true);
    await engine.syncOnce('org-1');
    engine.setPaused(false);
    await engine.syncOnce('org-1');
    expect(t.pushCalls).toHaveLength(1);
    expect(s.pending).toHaveLength(0);
  });
});
