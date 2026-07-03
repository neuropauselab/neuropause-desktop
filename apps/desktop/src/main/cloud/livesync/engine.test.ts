import { beforeEach, describe, expect, it } from 'vitest';
import type {
  MergeOutcome,
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
  private pullIdx = 0;

  async push(_orgId: string, _deviceId: string, changes: SyncChange[]): Promise<SyncPushResponse> {
    if (this.pushError) throw this.pushError;
    this.pushCalls.push(changes);
    return {
      results: changes.map((c) => ({
        entityType: c.entityType,
        entityId: c.entityId,
        status: 'applied',
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
});
