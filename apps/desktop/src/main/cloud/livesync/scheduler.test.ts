/**
 * P13C ROUND 9 — F3. The pause cases below changed shape because PRODUCTION
 * changed: `setOnline` used to pause the one engine and cancel the one timer, so
 * one organization's administrator stopped the loop for every organization on
 * the machine. It now pauses one organization; the loop keeps ticking, and a
 * cycle for a paused organization is a no-op. The assertions that state the
 * pausing tenant's own behaviour are unchanged — nothing left the device before
 * and nothing does now — and the cross-tenant cases are new.
 */
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
  /** Mirrors the real engine: pause is PER ORGANIZATION. */
  paused = new Set<string>();
  pauseCalls: { orgId: string; paused: boolean }[] = [];
  /** The principal each cycle ran under, so the test can prove there was one. */
  principals: (string | null)[] = [];

  constructor(private readonly currentPrincipalTenant: () => string | null = () => null) {}

  async syncOnce(orgId: string): Promise<SyncStatus> {
    if (this.paused.has(orgId)) return this.getStatus(orgId);
    this.syncCalls += 1;
    this.syncedOrgs.push(orgId);
    this.principals.push(this.currentPrincipalTenant());
    return this.current;
  }
  getStatus(orgId: string | null): SyncStatus {
    return orgId !== null && this.paused.has(orgId)
      ? { ...this.current, state: 'offline', online: false }
      : this.current;
  }
  nextRetryDelay(): number {
    return this.retryDelay;
  }
  setPaused(orgId: string, paused: boolean): void {
    if (paused) this.paused.add(orgId);
    else this.paused.delete(orgId);
    this.pauseCalls.push({ orgId, paused });
  }
  isPaused(orgId: string | null): boolean {
    return orgId !== null && this.paused.has(orgId);
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

  it('syncNow syncs the named org and reschedules at the interval on success', async () => {
    const s = make('org-1', 30000);
    s.start();
    await s.syncNow('org-1');
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
    await s.syncNow('org-1');
    expect(scheduled?.ms).toBe(4000);
  });

  it('does not sync when there is no active org', async () => {
    const s = make(null);
    s.start();
    await s.syncNow(null);
    expect(engine.syncCalls).toBe(0);
  });

  it('stop clears the timer and prevents rescheduling', async () => {
    const s = make('org-1');
    s.start();
    s.stop();
    expect(s.isRunning()).toBe(false);
    scheduled = null;
    await s.syncNow('org-1');
    expect(scheduled).toBeNull();
  });

  it('resuming after a pause triggers a sync while running', async () => {
    const s = make('org-1');
    s.start();
    s.setOnline('org-1', false);
    engine.syncCalls = 0;
    s.setOnline('org-1', true);
    await flush();
    expect(engine.syncCalls).toBeGreaterThanOrEqual(1);
    expect(s.isPaused('org-1')).toBe(false);
  });

  it('setOnline is idempotent — re-asserting the current mode does nothing', async () => {
    const s = make('org-1');
    s.start();
    engine.syncCalls = 0;
    s.setOnline('org-1', true);
    await flush();
    expect(engine.syncCalls).toBe(0);
    expect(engine.pauseCalls).toEqual([]);
  });

  it('setOnline(false) pauses that organization and runs no cycle for it', async () => {
    const s = make('org-1');
    s.start();
    engine.syncCalls = 0;
    s.setOnline('org-1', false);
    await flush();
    expect(engine.syncCalls).toBe(0);
    expect(engine.pauseCalls).toEqual([{ orgId: 'org-1', paused: true }]);
    expect(s.isPaused('org-1')).toBe(true);
  });

  it('a paused organization’s cycle is a no-op that reports the paused status', async () => {
    const s = make('org-1');
    s.start();
    s.setOnline('org-1', false);
    engine.syncCalls = 0;
    statuses = [];
    const result = await s.syncNow('org-1');
    expect(engine.syncCalls).toBe(0);
    expect(result.state).toBe('offline');
    expect(result.online).toBe(false);
    expect(statuses).toHaveLength(1);
  });

  it('start() on a scheduler whose active org is paused still runs the loop', () => {
    const s = make('org-1');
    s.setOnline('org-1', false);
    s.start();
    expect(s.isRunning()).toBe(true);
    expect(s.isPaused('org-1')).toBe(true);
    // THE FIX: the timer is NOT cancelled. It used to be, so one organization's
    // pause stopped the background loop for every organization on the machine.
    expect(scheduled?.ms).toBe(0);
  });

  /* ── P13C ROUND 9 — F3. One organization's toggle is its own. ───────────── */

  it('A’s pause leaves B syncing, and the loop keeps ticking for B', async () => {
    const s = make('org-2');
    s.start();
    s.setOnline('org-1', false);
    engine.syncCalls = 0;
    engine.syncedOrgs = [];

    await s.syncNow('org-2');
    expect(engine.syncedOrgs).toEqual(['org-2']);
    expect(s.isPaused('org-2')).toBe(false);
    expect(scheduled).not.toBeNull();
  });

  it('A cannot resume B: setOnline names the organization it acts on', async () => {
    const s = make('org-2');
    s.start();
    s.setOnline('org-2', false); // B stopped its own egress
    s.setOnline('org-1', true); // A resumes itself
    engine.syncCalls = 0;
    await s.syncNow('org-2');
    expect(engine.syncCalls).toBe(0); // B is still paused
    expect(s.isPaused('org-2')).toBe(true);
  });
});

/* ── P13C ROUND 9 — the background cycle carries a principal. ────────────── */

describe('a background cycle acts as the organization it syncs', () => {
  it('runs syncOnce inside a tenant principal for that organization', async () => {
    const { currentPrincipal } = await import('../../tenancy/backgroundPrincipal');
    const engine = new StubEngine(() => currentPrincipal()?.tenantId ?? null);
    const scheduler = new SyncScheduler({
      engine,
      getActiveOrgId: () => 'org-7',
      setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined,
    });
    await scheduler.syncNow('org-7');
    expect(engine.syncedOrgs).toEqual(['org-7']);
    expect(engine.principals).toEqual(['org-7']);
  });

  it('the status fan-out runs OUTSIDE that principal', async () => {
    const { currentPrincipal } = await import('../../tenancy/backgroundPrincipal');
    const seen: (string | null)[] = [];
    const engine = new StubEngine(() => currentPrincipal()?.tenantId ?? null);
    const scheduler = new SyncScheduler({
      engine,
      getActiveOrgId: () => 'org-7',
      setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined,
      // A listener fans this towards the renderer, which may be showing a
      // different organization; it must not resolve as the job.
      onStatus: () => seen.push(currentPrincipal()?.tenantId ?? null),
    });
    await scheduler.syncNow('org-7');
    expect(seen).toEqual([null]);
  });
});
