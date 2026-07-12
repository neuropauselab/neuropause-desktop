/**
 * P4.1 Increment 2 — Runtime Supervisor tests. The Supervisor is exercised over a fake event bus,
 * a fake control store, and a fake account store (pure node, injected clock). Verifies lifecycle
 * projection (from→to), operator controls + persistence, suppression, history, and aggregation.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ConnectedAccount, ConnectorEvent, ConnectorLifecycleEvent, SyncState } from '@neuropause/shared';
import { ConnectorRuntimeSupervisor, type RuntimeControlPort } from './connectorRuntimeSupervisor';

function acct(over: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id: 'a1', connectorId: 'github', label: 'octocat', externalId: null, avatarUrl: null,
    status: 'connected', health: 'healthy', grantedScopes: [], connectedAt: 'x',
    lastSyncAt: null, lastSyncState: 'never', accessTokenExpiresAt: null, error: null, ...over,
  };
}

class FakeControls implements RuntimeControlPort {
  paused = new Set<string>();
  disabled = new Set<string>();
  private key(c: string, a: string): string { return `${c}::${a}`; }
  controlFor(c: string, a: string) { return { paused: this.paused.has(this.key(c, a)), disabled: this.disabled.has(c) }; }
  isDisabled(c: string) { return this.disabled.has(c); }
  isSuppressed(c: string, a: string) { const x = this.controlFor(c, a); return x.paused || x.disabled; }
  async setPaused(c: string, a: string, p: boolean) { if (p) this.paused.add(this.key(c, a)); else this.paused.delete(this.key(c, a)); }
  async setDisabled(c: string, d: boolean) { if (d) this.disabled.add(c); else this.disabled.delete(c); }
}

function harness() {
  const bus = new EventEmitter();
  const accounts = new Map<string, ConnectedAccount>();
  const controls = new FakeControls();
  const emitted: ConnectorLifecycleEvent[] = [];
  let t = 1_000;
  const set = (a: ConnectedAccount): void => { accounts.set(`${a.connectorId}::${a.id}`, a); };
  const sup = new ConnectorRuntimeSupervisor({
    events: bus,
    controls,
    getAccount: (c, a) => accounts.get(`${c}::${a}`) ?? null,
    listAccounts: () => [...accounts.values()],
    isConfigured: () => true,
    getLogs: () => [{ id: 'l1', connectorId: 'github', accountId: 'a1', level: 'info', phase: 'sync', message: 'synced', at: 'x' }],
    broadcast: (e) => emitted.push(e),
    now: () => (t += 1_000),
  });
  const emitSync = (id: string, state: SyncState): void => {
    const cur = accounts.get(`github::${id}`);
    if (cur) set({ ...cur, lastSyncState: state, lastSyncAt: state === 'success' ? 'later' : cur.lastSyncAt });
    const ev: ConnectorEvent = { connectorId: 'github', accountId: id, type: 'sync', status: null, health: null, syncState: state, message: null, at: 'x' };
    bus.emit('event', ev);
  };
  return { bus, accounts, controls, emitted, sup, set, emitSync };
}

const path = (evs: ConnectorLifecycleEvent[]): string[] => evs.map((e) => `${e.from}->${e.to}`);

describe('ConnectorRuntimeSupervisor — lifecycle projection', () => {
  it('primes without emitting, then emits from→to on real changes', () => {
    const h = harness();
    h.set(acct());
    h.sup.prime();
    expect(h.emitted).toHaveLength(0); // prime is silent

    h.emitSync('a1', 'syncing'); // connected → syncing
    h.emitSync('a1', 'success'); // syncing → idle (has synced now)
    expect(path(h.emitted)).toEqual(['connected->syncing', 'syncing->idle']);
  });

  it('does not emit when the derived state is unchanged', () => {
    const h = harness();
    h.set(acct({ lastSyncAt: 'earlier', lastSyncState: 'success' })); // idle
    h.sup.prime();
    // a health event that changes nothing about the derivation
    h.bus.emit('event', { connectorId: 'github', accountId: 'a1', type: 'health', status: null, health: 'healthy', syncState: null, message: null, at: 'x' } satisfies ConnectorEvent);
    expect(h.emitted).toHaveLength(0);
  });

  it('ignores events without an account id', () => {
    const h = harness();
    h.set(acct());
    h.sup.prime();
    h.bus.emit('event', { connectorId: 'github', accountId: null, type: 'log', status: null, health: null, syncState: null, message: 'hi', at: 'x' } satisfies ConnectorEvent);
    expect(h.emitted).toHaveLength(0);
  });

  it('emits a final transition to disconnected on account removal, then forgets it', () => {
    const h = harness();
    h.set(acct({ lastSyncAt: 'earlier', lastSyncState: 'success' })); // idle
    h.sup.prime();
    h.bus.emit('event', { connectorId: 'github', accountId: 'a1', type: 'account_removed', status: 'disconnected', health: null, syncState: null, message: 'gone', at: 'x' } satisfies ConnectorEvent);
    expect(path(h.emitted)).toEqual(['idle->disconnected']);
  });
});

describe('ConnectorRuntimeSupervisor — operator controls', () => {
  it('pause → paused + suppressed; resume → back; persists flags', async () => {
    const h = harness();
    h.set(acct({ lastSyncAt: 'earlier', lastSyncState: 'success' })); // idle
    h.sup.prime();

    const view = await h.sup.control('github', 'a1', 'pause');
    expect(view.accounts[0].state).toBe('paused');
    expect(view.accounts[0].control.paused).toBe(true);
    expect(h.sup.isSyncSuppressed('github', 'a1')).toBe(true);
    expect(h.controls.paused.has('github::a1')).toBe(true);

    await h.sup.control('github', 'a1', 'resume');
    expect(h.sup.isSyncSuppressed('github', 'a1')).toBe(false);
    expect(path(h.emitted)).toEqual(['idle->paused', 'paused->idle']);
  });

  it('disable → all accounts disabled + view.disabled; enable → back', async () => {
    const h = harness();
    h.set(acct({ id: 'a1', lastSyncAt: 'x', lastSyncState: 'success' }));
    h.set(acct({ id: 'a2', lastSyncAt: 'x', lastSyncState: 'success' }));
    h.sup.prime();

    const disabled = await h.sup.control('github', null, 'disable');
    expect(disabled.disabled).toBe(true);
    expect(disabled.accounts.map((a) => a.state)).toEqual(['disabled', 'disabled']);
    expect(h.sup.isSyncSuppressed('github', 'a2')).toBe(true);

    const enabled = await h.sup.control('github', null, 'enable');
    expect(enabled.disabled).toBe(false);
    expect(enabled.accounts.every((a) => a.state === 'idle')).toBe(true);
  });
});

describe('ConnectorRuntimeSupervisor — reads', () => {
  it('runtimeView aggregates the most significant account state', () => {
    const h = harness();
    h.set(acct({ id: 'a1', lastSyncAt: 'x', lastSyncState: 'success' })); // idle
    h.set(acct({ id: 'a2', lastSyncState: 'syncing' })); // syncing
    h.sup.prime();
    const [view] = h.sup.runtimeView('github');
    expect(view.state).toBe('syncing');
    expect(view.accounts).toHaveLength(2);
  });

  it('history is newest-first and filterable + limitable', async () => {
    const h = harness();
    h.set(acct({ lastSyncAt: 'x', lastSyncState: 'success' }));
    h.sup.prime();
    await h.sup.control('github', 'a1', 'pause');
    await h.sup.control('github', 'a1', 'resume');
    const hist = h.sup.history({ connectorId: 'github', limit: 1 });
    expect(hist).toHaveLength(1);
    expect(`${hist[0].from}->${hist[0].to}`).toBe('paused->idle'); // newest first
  });

  it('runtimeStateOf reflects live derivation', () => {
    const h = harness();
    h.set(acct({ status: 'reauth_required' }));
    h.sup.prime();
    expect(h.sup.runtimeStateOf('github', 'a1')).toBe('reauth_required');
    expect(h.sup.runtimeStateOf('github', 'missing')).toBeNull();
  });

  it('inspect composes runtime + scored health + logs + lifecycle', () => {
    const h = harness();
    h.set(acct({ lastSyncAt: 'x', lastSyncState: 'success' }));
    h.sup.prime();
    const insp = h.sup.inspect('github');
    expect(insp.connectorId).toBe('github');
    expect(insp.runtime.accounts).toHaveLength(1);
    expect(insp.accounts[0].state).toBe('idle');
    expect(insp.accounts[0].health.score).toBeGreaterThan(0);
    expect(insp.logs).toHaveLength(1);
    expect(insp.logs[0].message).toBe('synced');
  });
});
