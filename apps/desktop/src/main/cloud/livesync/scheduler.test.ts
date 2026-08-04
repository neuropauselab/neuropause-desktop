import { beforeEach, describe, expect, it } from 'vitest';
import type { SyncStatus } from './types';
import { computeNextDelay, SyncScheduler, type SyncEngineLike } from './scheduler';

function status(over: Partial<SyncStatus> = {}): SyncStatus {
  return {
    state: 'idle',
    online: true,
    pendingCount: 0,
    failures: 0,
    lastError: null,
    lastSyncedAt: null,
    cursor: 0,
    ...over,
  };
}

class StubEngine implements SyncEngineLike {
  current: SyncStatus = status();
  retryDelay = 0;
  syncCalls = 0;
  syncedOrgs: string[] = [];
  /** Mirrors the real engine: paused refuses cycles and reports offline. */
  paused = false;
  pauseCalls: boolean[] = [];
  async syncOnce(orgId: string): Promise<SyncStatus> {
    if (this.paused) return this.getStatus();
    this.syncCalls += 1;
    this.syncedOrgs.push(orgId);
    return this.current;
  }
  getStatus(): SyncStatus {
    return this.paused ? { ...this.current, state: 'offline', online: false } : this.current;
  }
  nextRetryDelay(): number {
    return this.retryDelay;
  }
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.pauseCalls.push(paused);
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('computeNextDelay', () => {
  it('uses the interval when idle', () => {
    expect(computeNextDelay(status({ state: 'idle' }), 60000, 5000)).toBe(60000);
  });
  it('backs off when offline', () => {
    expect(computeNextDelay(status({ state: 'offline' }), 60000, 5000)).toBe(5000);
  });
  it('backs off when in error', () => {
    expect(computeNextDelay(status({ state: 'error' }), 60000, 8000)).toBe(8000);
  });
  it('falls back to the interval when there is no retry delay', () => {
    expect(computeNextDelay(status({ state: 'offline' }), 60000, 0)).toBe(60000);
  });
});

describe('SyncScheduler', () => {
  let engine: StubEngine;
  let scheduled: { fn: () => void; ms: number } | null;
  let statuses: SyncStatus[];
  const handleValue = 7 as unknown as ReturnType<typeof setTimeout>;
  const setTimer = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    scheduled = { fn, ms };
    return handleValue;
  };
  const clearTimer = (): void => {
    scheduled = null;
  };

  function make(orgId: string | null, intervalMs = 60000): SyncScheduler {
    return new SyncScheduler({
      engine,
      getActiveOrgId: () => orgId,
      intervalMs,
      setTimer,
      clearTimer,
      onStatus: (s) => statuses.push(s),
    });
  }

  beforeEach(() => {
    engine = new StubEngine();
    scheduled = null;
    statuses = [];
  });

  it('schedules an initial cycle on start', () => {
    const s = make('org-1');
    s.start();
    expect(scheduled?.ms).toBe(0);
    expect(s.isRunning()).toBe(true);
  });

  it('syncNow syncs the active org and reschedules at the interval on success', async () => {
    const s = make('org-1', 30000);
    s.start();
    await s.syncNow();
    expect(engine.syncCalls).toBeGreaterThanOrEqual(1);
    expect(engine.syncedOrgs).toContain('org-1');
    expect(scheduled?.ms).toBe(30000);
    expect(statuses.length).toBeGreaterThanOrEqual(1);
  });

  it('reschedules with backoff after a failure', async () => {
    engine.current = status({ state: 'offline', online: false, failures: 2 });
    engine.retryDelay = 4000;
    const s = make('org-1', 30000);
    s.start();
    await s.syncNow();
    expect(scheduled?.ms).toBe(4000);
  });

  it('does not sync when there is no active org', async () => {
    const s = make(null);
    s.start();
    await s.syncNow();
    expect(engine.syncCalls).toBe(0);
  });

  it('stop clears the timer and prevents rescheduling', async () => {
    const s = make('org-1');
    s.start();
    s.stop();
    expect(s.isRunning()).toBe(false);
    scheduled = null;
    await s.syncNow();
    expect(scheduled).toBeNull();
  });

  it('resuming after a pause triggers a sync while running', async () => {
    const s = make('org-1');
    s.start();
    s.setOnline(false);
    engine.syncCalls = 0;
    s.setOnline(true);
    await flush();
    expect(engine.syncCalls).toBeGreaterThanOrEqual(1);
    expect(s.isPaused()).toBe(false);
  });

  it('setOnline is idempotent — re-asserting the current mode does nothing', async () => {
    const s = make('org-1');
    s.start();
    engine.syncCalls = 0;
    s.setOnline(true);
    await flush();
    expect(engine.syncCalls).toBe(0);
    expect(engine.pauseCalls).toEqual([]);
  });

  it('setOnline(false) pauses the engine, cancels the timer, and does not sync', async () => {
    const s = make('org-1');
    s.start();
    engine.syncCalls = 0;
    s.setOnline(false);
    await flush();
    expect(engine.syncCalls).toBe(0);
    expect(engine.pauseCalls).toEqual([true]);
    expect(s.isPaused()).toBe(true);
    expect(scheduled).toBeNull();
  });

  it('a paused scheduler refuses cycles and reports the paused status', async () => {
    const s = make('org-1');
    s.start();
    s.setOnline(false);
    engine.syncCalls = 0;
    statuses = [];
    const result = await s.syncNow();
    expect(engine.syncCalls).toBe(0);
    expect(result.state).toBe('offline');
    expect(result.online).toBe(false);
    expect(statuses).toHaveLength(1);
    expect(scheduled).toBeNull();
  });

  it('start() on a paused scheduler does not schedule a cycle', () => {
    const s = make('org-1');
    s.setOnline(false);
    s.start();
    expect(s.isRunning()).toBe(true);
    expect(s.isPaused()).toBe(true);
    expect(scheduled).toBeNull();
  });
});
