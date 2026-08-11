/**
 * P4.1 Increment 3 — reliability tests: retry backoff (jitter + cap) + dead-letter callback, the
 * durable DLQ + crash reconciler in the state store, and the orchestrator's per-account mutex,
 * tick suppression, bounded worker pool, and clear-dead-letter-on-success. Pure node, temp paths.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlatformEventInput } from '@neuropause/shared';
import { UnifiedStore } from '../unifiedStore';
import { SyncStateStore, stateToSnapshot } from './syncStateStore';
import { RateLimiter } from './rateLimiter';
import { RetryQueue } from './retryQueue';
import { SyncOrchestrator, MAX_CONCURRENT_SYNCS, type OrchestratorPorts } from './orchestrator';
import { makeEntity, type ConnectorAdapter, type SyncContext, type SyncPage } from './adapterSdk';

/** P13C Round 5 — sync rows are stamped with the writing workspace. */
const SYNC_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const asSyncScope = (): typeof SYNC_SCOPE => SYNC_SCOPE;

let dir: string;
beforeEach(async () => {
  dir = join(tmpdir(), `nps-rel-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function newStore(): Promise<UnifiedStore> {
  const s = new UnifiedStore(join(dir, `u-${Math.random().toString(36).slice(2)}.json`));
  await s.load();
  return s;
}
async function newState(): Promise<SyncStateStore> {
  const s = new SyncStateStore(join(dir, `s-${Math.random().toString(36).slice(2)}.json`)).bindScope(asSyncScope);
  await s.load();
  return s;
}
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ent = (sid: string, now: string) =>
  makeEntity({ tenantId: 'org-test', connectorId: 'github', accountId: 'a1', kind: 'task', sourceId: sid, title: sid, createdAt: now, updatedAt: now, now });

function ports(over: Partial<OrchestratorPorts> & { store: UnifiedStore; state: SyncStateStore; adapter: ConnectorAdapter | null }): OrchestratorPorts {
  return {
    activeTenantId: () => 'org-test',
    upsertMany: (e) => over.store.upsertMany(e),
    markDeleted: (ids, at) => over.store.markDeleted(ids, at),
    countForConnector: (c) => over.store.countForConnector(c),
    syncState: over.state,
    getAccessToken: async () => 'tok',
    getAdapter: () => over.adapter,
    manifestName: () => 'GitHub',
    listConnectedAccounts: () => [{ connectorId: 'github', accountId: 'a1' }],
    publish: (_e: PlatformEventInput) => undefined,
    rate: new RateLimiter(0),
    ...over,
  };
}
function adapterWith(pull: (ctx: SyncContext) => Promise<SyncPage>): ConnectorAdapter {
  return { connectorId: 'github', resources: [{ id: 'items', label: 'Items', kind: 'task', pull }] };
}

describe('RetryQueue — backoff jitter + cap + dead-letter', () => {
  it('applies equal jitter within [exp/2, exp] and caps the exponential term', () => {
    const lo = new RetryQueue(async () => false, { baseDelayMs: 1000, maxDelayMs: 4000, rng: () => 0 });
    const hi = new RetryQueue(async () => false, { baseDelayMs: 1000, maxDelayMs: 4000, rng: () => 1 });
    expect(lo.backoffFor(1)).toBe(500); // exp=1000, half=500, +0
    expect(hi.backoffFor(1)).toBe(1000); // half + 1*half
    // attempt 10 would be 1000*512 uncapped; capped at 4000 → [2000, 4000]
    expect(lo.backoffFor(10)).toBe(2000);
    expect(hi.backoffFor(10)).toBe(4000);
  });

  it('fires onExhausted once when the attempt budget is exceeded, then drops the item', () => {
    const dead: Array<{ c: string; a: string; n: number }> = [];
    const rq = new RetryQueue(async () => true, {
      maxAttempts: 3,
      baseDelayMs: 100_000, // large so the scheduled timer never fires during the test
      onExhausted: (c, a, n) => dead.push({ c, a, n }),
    });
    rq.enqueue('github', 'a1'); // attempt 1
    rq.enqueue('github', 'a1'); // attempt 2
    rq.enqueue('github', 'a1'); // attempt 3
    expect(rq.size('github', 'a1')).toBe(1);
    rq.enqueue('github', 'a1'); // attempt 4 > 3 → exhausted
    expect(dead).toEqual([{ c: 'github', a: 'a1', n: 3 }]);
    expect(rq.size('github', 'a1')).toBe(0);
    rq.stop();
  });
});

describe('SyncStateStore — DLQ + crash reconciler', () => {
  it('records + clears a dead-letter and projects it into the snapshot', async () => {
    const state = await newState();
    await state.recordDeadLetter('github', 'a1', { at: 'now', attempts: 5, error: 'boom' });
    expect(state.deadLettered().map((s) => s.accountId)).toEqual(['a1']);
    const snap = stateToSnapshot(state.get('github', 'a1'), 0);
    expect(snap.deadLettered).toBe(true);
    expect(snap.deadLetterReason).toBe('boom');
    await state.clearDeadLetter('github', 'a1');
    expect(state.deadLettered()).toHaveLength(0);
    expect(stateToSnapshot(state.get('github', 'a1'), 0).deadLettered).toBe(false);
  });

  it('recordDeadLetter is idempotent — no duplicate write or broadcast', async () => {
    const state = await newState();
    let changes = 0;
    state.on('changed', () => { changes += 1; });
    await state.recordDeadLetter('github', 'a1', { at: 'now', attempts: 5, error: 'boom' });
    await state.recordDeadLetter('github', 'a1', { at: 'later', attempts: 9, error: 'other' });
    expect(state.deadLettered()).toHaveLength(1);
    expect(state.get('github', 'a1').deadLetter?.error).toBe('boom'); // first write wins
    expect(changes).toBe(1);
  });

  it('reconcile resets an account stuck in syncing → idle, leaving others alone', async () => {
    const state = await newState();
    await state.recordRun('github', 'a1', { status: 'syncing' }); // simulate a crash mid-sync
    await state.recordRun('github', 'a2', { status: 'success' });
    const { reset } = await state.reconcile();
    expect(reset).toBe(1);
    expect(state.get('github', 'a1').status).toBe('idle');
    expect(state.get('github', 'a2').status).toBe('success');
  });
});

describe('SyncOrchestrator — mutex, suppression, worker pool, DLQ clear', () => {
  it('coalesces a concurrent sync of the same account (no double-pull)', async () => {
    const store = await newStore();
    const state = await newState();
    let pulls = 0;
    const adapter = adapterWith(async (ctx) => {
      pulls += 1;
      await delay(10);
      return { entities: [ent('1', ctx.now)], cursor: 'c', hasMore: false };
    });
    const orch = new SyncOrchestrator(ports({ store, state, adapter }));
    const [o1, o2] = await Promise.all([orch.runAccountSync('github', 'a1'), orch.runAccountSync('github', 'a1')]);
    orch.stop();
    expect(pulls).toBe(1); // second call coalesced onto the first
    expect(o1).toBe(o2);
  });

  it('runAccountSync is a non-retryable no-op when the account is suppressed (retry path is safe)', async () => {
    const store = await newStore();
    const state = await newState();
    let pulls = 0;
    const adapter = adapterWith(async (ctx) => { pulls += 1; return { entities: [], cursor: ctx.cursor, hasMore: false }; });
    const orch = new SyncOrchestrator(ports({ store, state, adapter, isSuppressed: () => true }));
    const o = await orch.runAccountSync('github', 'a1');
    orch.stop();
    expect(pulls).toBe(0);
    expect(o.ok).toBe(true);
    expect(o.retryable).toBe(false); // → retry queue drops it instead of looping
  });

  it('tick skips suppressed accounts', async () => {
    const store = await newStore();
    const state = await newState();
    let pulls = 0;
    const adapter = adapterWith(async (ctx) => { pulls += 1; return { entities: [], cursor: ctx.cursor, hasMore: false }; });
    const orch = new SyncOrchestrator(ports({ store, state, adapter, isSuppressed: () => true }));
    await orch.tick();
    orch.stop();
    expect(pulls).toBe(0);
  });

  it('bounds concurrency to the worker-pool cap across many due accounts', async () => {
    const store = await newStore();
    const state = await newState();
    const N = MAX_CONCURRENT_SYNCS + 2;
    const accounts = Array.from({ length: N }, (_, i) => ({ connectorId: 'github', accountId: `a${i}` }));
    let active = 0;
    let peak = 0;
    const adapter = adapterWith(async (ctx) => {
      active += 1;
      peak = Math.max(peak, active);
      await delay(15);
      active -= 1;
      return { entities: [], cursor: ctx.cursor, hasMore: false };
    });
    const orch = new SyncOrchestrator(ports({ store, state, adapter, listConnectedAccounts: () => accounts }));
    await orch.tick();
    orch.stop();
    expect(peak).toBe(MAX_CONCURRENT_SYNCS); // never exceeds the cap, and reaches it with N > cap due
  });

  it('a successful sync clears a prior dead-letter (replay recovered)', async () => {
    const store = await newStore();
    const state = await newState();
    await state.recordDeadLetter('github', 'a1', { at: 'now', attempts: 5, error: 'boom' });
    const adapter = adapterWith(async (ctx) => ({ entities: [ent('1', ctx.now)], cursor: 'c', hasMore: false }));
    const orch = new SyncOrchestrator(ports({ store, state, adapter }));
    const o = await orch.runAccountSync('github', 'a1');
    orch.stop();
    expect(o.ok).toBe(true);
    expect(state.get('github', 'a1').deadLetter ?? null).toBeNull();
    expect(state.deadLettered()).toHaveLength(0);
  });
});
