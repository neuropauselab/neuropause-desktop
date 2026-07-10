import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnifiedStore } from '../unifiedStore';
import { SyncStateStore, stateToSnapshot } from './syncStateStore';
import { RateLimiter } from './rateLimiter';
import { SyncOrchestrator, type OrchestratorPorts } from './orchestrator';
import { makeEntity, type ConnectorAdapter, type SyncContext, type SyncPage } from './adapterSdk';
import { NetworkError } from './http';
import type { PlatformEventInput } from '@neuropause/shared';

let dir: string;
beforeEach(async () => {
  dir = join(tmpdir(), `nps-orch-${Math.random().toString(36).slice(2)}`);
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
  const s = new SyncStateStore(join(dir, `s-${Math.random().toString(36).slice(2)}.json`));
  await s.load();
  return s;
}

function ent(sourceId: string, title: string, updatedAt: string, now: string) {
  return makeEntity({ connectorId: 'github', accountId: 'a1', kind: 'task', sourceId, title, createdAt: updatedAt, updatedAt, now });
}

function fakeAdapter(pull: (ctx: SyncContext) => Promise<SyncPage>): ConnectorAdapter {
  return { connectorId: 'github', resources: [{ id: 'items', label: 'Items', kind: 'task', pull }] };
}

function ports(
  store: UnifiedStore,
  state: SyncStateStore,
  adapter: ConnectorAdapter | null,
  events: PlatformEventInput[],
): OrchestratorPorts {
  return {
    upsertMany: (e) => store.upsertMany(e),
    markDeleted: (ids, at) => store.markDeleted(ids, at),
    countForConnector: (c) => store.countForConnector(c),
    syncState: state,
    getAccessToken: async () => 'tok',
    getAdapter: () => adapter,
    manifestName: () => 'GitHub',
    listConnectedAccounts: () => [{ connectorId: 'github', accountId: 'a1' }],
    publish: (e) => { events.push(e); },
    rate: new RateLimiter(0),
  };
}

describe('SyncOrchestrator', () => {
  it('pages through a resource, upserts entities, persists the cursor, emits events', async () => {
    const store = await newStore();
    const state = await newState();
    const events: PlatformEventInput[] = [];
    let calls = 0;
    const adapter = fakeAdapter(async (ctx) => {
      calls += 1;
      if (calls === 1) {
        return {
          entities: [ent('1', 'One', '2026-01-01T00:00:00.000Z', ctx.now), ent('2', 'Two', '2026-01-01T00:00:00.000Z', ctx.now)],
          cursor: 'page2',
          hasMore: true,
        };
      }
      return { entities: [ent('3', 'Three', '2026-01-01T00:00:00.000Z', ctx.now)], cursor: 'end', hasMore: false };
    });
    const orch = new SyncOrchestrator(ports(store, state, adapter, events));

    const o = await orch.runAccountSync('github', 'a1');
    orch.stop();

    expect(o.ok).toBe(true);
    expect(o.hadAdapter).toBe(true);
    expect(o.created).toBe(3);
    expect(calls).toBe(2);
    expect(store.counts().total).toBe(3);
    expect(state.getCursor('github', 'a1', 'items')).toBe('end');

    const types = events.map((e) => e.type);
    expect(types).toContain('connector.sync_started');
    expect(types).toContain('connector.sync_completed');
    expect(types).toContain('knowledge.entity_created');
    expect(state.get('github', 'a1').status).toBe('success');

    // Per-module stats are recorded for the resource (drives the M365 module panel).
    const res = state.get('github', 'a1').resources['items'];
    expect(res.objectCount).toBe(3);
    expect(res.status).toBe('ok');
    expect(res.label).toBe('Items');
    const snap = stateToSnapshot(state.get('github', 'a1'), 0);
    expect(snap.modules?.find((m) => m.id === 'items')).toMatchObject({ objectCount: 3, status: 'ok' });
  });

  it('records a swallowed 403/404 as a degraded module and surfaces it in the snapshot', async () => {
    const store = await newStore();
    const state = await newState();
    const adapter = fakeAdapter(async (ctx) => ({
      entities: [],
      cursor: ctx.cursor,
      hasMore: false,
      degraded: { kind: 'unauthorized', reason: 'Missing Graph permission or module not licensed (403)' },
    }));
    const orch = new SyncOrchestrator(ports(store, state, adapter, []));
    const o = await orch.runAccountSync('github', 'a1');
    orch.stop();

    // The account sync still succeeds (graceful degradation never fails the run)…
    expect(o.ok).toBe(true);
    expect(o.created).toBe(0);
    // …but the module is recorded as unauthorized with a reason and a zero count.
    const res = state.get('github', 'a1').resources['items'];
    expect(res.status).toBe('unauthorized');
    expect(res.objectCount).toBe(0);
    const mod = stateToSnapshot(state.get('github', 'a1'), 0).modules?.find((m) => m.id === 'items');
    expect(mod?.status).toBe('unauthorized');
    expect(mod?.reason).toContain('403');
  });

  it('keeps a resource cursor intact when recording module stats (incremental sync survives)', async () => {
    const store = await newStore();
    const state = await newState();
    const adapter = fakeAdapter(async (ctx) => {
      // First run pages once to a deltaLink; the recorded stats must not wipe that cursor.
      if (ctx.cursor === null) return { entities: [ent('1', 'One', '2026-01-01T00:00:00.000Z', ctx.now)], cursor: 'DELTA', hasMore: false };
      return { entities: [], cursor: ctx.cursor, hasMore: false };
    });
    const orch = new SyncOrchestrator(ports(store, state, adapter, []));
    await orch.runAccountSync('github', 'a1');
    orch.stop();
    expect(state.getCursor('github', 'a1', 'items')).toBe('DELTA');
    expect(state.get('github', 'a1').resources['items'].objectCount).toBe(1);
  });

  it('passes the stored cursor back on the next run (incremental sync)', async () => {
    const store = await newStore();
    const state = await newState();
    await state.setCursor('github', 'a1', 'items', 'CURSOR123', new Date().toISOString());
    let seen: string | null | undefined;
    const adapter = fakeAdapter(async (ctx) => {
      seen = ctx.cursor;
      return { entities: [], cursor: ctx.cursor, hasMore: false };
    });
    const orch = new SyncOrchestrator(ports(store, state, adapter, []));
    await orch.runAccountSync('github', 'a1');
    orch.stop();
    expect(seen).toBe('CURSOR123');
  });

  it('soft-deletes entities the adapter reports as removed', async () => {
    const store = await newStore();
    const state = await newState();
    await store.upsertMany([ent('99', 'ToDelete', '2026-01-01T00:00:00.000Z', new Date().toISOString())]);
    const adapter = fakeAdapter(async () => ({ entities: [], deletedSourceIds: ['99'], cursor: 'c', hasMore: false }));
    const orch = new SyncOrchestrator(ports(store, state, adapter, []));
    const o = await orch.runAccountSync('github', 'a1');
    orch.stop();
    expect(o.deleted).toBe(1);
    expect(store.query({ kinds: ['task'] }).total).toBe(0);
    expect(store.query({ kinds: ['task'], includeDeleted: true }).total).toBe(1);
  });

  it('treats a network failure as retryable + offline and emits connector.offline', async () => {
    const store = await newStore();
    const state = await newState();
    const events: PlatformEventInput[] = [];
    const adapter = fakeAdapter(async () => {
      throw new NetworkError('ECONNREFUSED');
    });
    const orch = new SyncOrchestrator(ports(store, state, adapter, events));
    const o = await orch.runAccountSync('github', 'a1');
    orch.stop();
    expect(o.ok).toBe(false);
    expect(o.retryable).toBe(true);
    expect(o.offline).toBe(true);
    expect(events.map((e) => e.type)).toContain('connector.offline');
    expect(state.get('github', 'a1').status).toBe('offline');
  });

  it('reports verify-only (no data sync) for a connector without an adapter', async () => {
    const store = await newStore();
    const state = await newState();
    const orch = new SyncOrchestrator(ports(store, state, null, []));
    const o = await orch.runAccountSync('chatgpt', 'x');
    orch.stop();
    expect(o.hadAdapter).toBe(false);
    expect(o.ok).toBe(true);
    expect(o.created).toBe(0);
  });
});
