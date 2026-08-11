/**
 * P4.1 Increment 2 — Runtime Supervisor tests. The Supervisor is exercised over a fake event bus,
 * a fake control store, and a fake account store (pure node, injected clock). Verifies lifecycle
 * projection (from→to), operator controls + persistence, suppression, history, and aggregation.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type {
  ConnectedAccount,
  ConnectorEvent,
  ConnectorLifecycleEvent,
  ConnectorModuleStat,
  ConnectorServiceDescriptor,
  ConnectorSyncSnapshot,
  SyncState,
} from '@neuropause/shared';
import { ConnectorRuntimeSupervisor, type RuntimeControlPort } from './connectorRuntimeSupervisor';

/**
 * P13C ROUND 9 — F7. Every fixture account now names the WORKSPACE THAT OWNS IT.
 *
 * It is not decoration. Lifecycle history is stamped from
 * `ConnectedAccount.workspaceId` at write time and filtered by it on read, so a
 * fixture with no workspace produces rows owned by nobody — which is the correct
 * production behaviour for a pre-boundary account and useless as a test default.
 * Wiring the owner here is what makes the isolation suite below able to fail.
 */
const WS_MAIN = 'workspace-main';
const WS_OTHER = 'workspace-other';

function acct(over: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id: 'a1', connectorId: 'github', workspaceId: WS_MAIN, label: 'octocat', externalId: null, avatarUrl: null,
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
  /** The workspace the caller is in — the harness's `connectorStore` boundary. */
  let workspace = WS_MAIN;
  const set = (a: ConnectedAccount): void => { accounts.set(`${a.connectorId}::${a.id}`, a); };
  /**
   * `getAccount` and `listAccounts` are `connectorStore.get` / `.all` in
   * production, and BOTH are workspace-scoped there. The doubles were not, so
   * the harness could not express the cross-workspace case at all — the reason
   * a whole class of finding survived a passing suite.
   */
  const sup = new ConnectorRuntimeSupervisor({
    events: bus,
    controls,
    getAccount: (c, a) => {
      const found = accounts.get(`${c}::${a}`) ?? null;
      return found !== null && found.workspaceId === workspace ? found : null;
    },
    listAccounts: () => [...accounts.values()].filter((a) => a.workspaceId === workspace),
    isConfigured: () => true,
    getLogs: () => [{ id: 'l1', connectorId: 'github', accountId: 'a1', level: 'info', phase: 'sync', message: 'synced', at: 'x' }],
    workspaceId: () => workspace,
    broadcast: (e) => emitted.push(e),
    now: () => (t += 1_000),
  });
  const emitSync = (id: string, state: SyncState): void => {
    const cur = accounts.get(`github::${id}`);
    if (cur) set({ ...cur, lastSyncState: state, lastSyncAt: state === 'success' ? 'later' : cur.lastSyncAt });
    const ev: ConnectorEvent = { connectorId: 'github', accountId: id, type: 'sync', status: null, health: null, syncState: state, message: null, at: 'x' };
    bus.emit('event', ev);
  };
  /** Act as another workspace, the way a workspace switch or a fanned-out job does. */
  const asWorkspace = (ws: string): void => { workspace = ws; };
  return { bus, accounts, controls, emitted, sup, set, emitSync, asWorkspace };
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
    expect(h.sup.history({ connectorId: 'github' })).toHaveLength(2); // the owner sees both
    const hist = h.sup.history({ connectorId: 'github', limit: 1 });
    expect(hist).toHaveLength(1);
    expect(`${hist[0].from}->${hist[0].to}`).toBe('paused->idle'); // newest first
  });

  /**
   * P13C ROUND 9 — F7. The case the old harness could not express.
   *
   * Before the fix, `history()` filtered on `connectorId` and nothing else, so
   * this read returned WS_MAIN's two transitions — its account id, its
   * from→to states and the reasons attached to them — to a caller in a
   * different workspace holding only `connectors:read`.
   */
  it('another workspace reads none of it, and the owner still reads all of it', async () => {
    const h = harness();
    h.set(acct({ lastSyncAt: 'x', lastSyncState: 'success' }));
    h.sup.prime();
    await h.sup.control('github', 'a1', 'pause');
    await h.sup.control('github', 'a1', 'resume');

    h.asWorkspace(WS_OTHER);
    expect(h.sup.history()).toEqual([]); // the whole ring
    expect(h.sup.history({ connectorId: 'github' })).toEqual([]); // by connector id
    expect(h.sup.history({ accountId: 'a1' })).toEqual([]); // by the other workspace's account id
    expect(h.sup.inspect('github').lifecycle).toEqual([]); // and through the read model

    h.asWorkspace(WS_MAIN);
    expect(h.sup.history({ connectorId: 'github' })).toHaveLength(2); // ALLOWED, non-empty
  });

  it('a workspace with no connectors of its own sees an empty inspector, not the neighbour’s', () => {
    const h = harness();
    h.set(acct({ id: 'a1', lastSyncAt: 'x', lastSyncState: 'success' }));
    h.set(acct({ id: 'b1', workspaceId: WS_OTHER, lastSyncAt: 'x', lastSyncState: 'success' }));
    h.sup.prime();
    h.emitSync('a1', 'syncing'); // WS_MAIN's account transitions

    h.asWorkspace(WS_OTHER);
    const insp = h.sup.inspect('github');
    expect(insp.runtime.accounts.map((a) => a.accountId)).toEqual(['b1']); // only its own account
    expect(insp.lifecycle).toEqual([]); // and none of WS_MAIN's transitions

    h.asWorkspace(WS_MAIN);
    expect(h.sup.inspect('github').lifecycle).toHaveLength(1);
    expect(h.sup.inspect('github').runtime.accounts.map((a) => a.accountId)).toEqual(['a1']);
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

/**
 * P5 — Increment 4: the runtime-driven per-service capability projection. The Supervisor overlays a
 * connected account's live per-module sync stats + the operator control flag onto the sync-layer's
 * runtime-declared service descriptors. These tests inject a fake descriptor source + snapshot source
 * (mirroring the runtime-core wiring) and assert the overlay precedence, never hardcoding a service list.
 */
describe('ConnectorRuntimeSupervisor — service capabilities (P5 Inc 4)', () => {
  const snap = (modules: ConnectorModuleStat[]): ConnectorSyncSnapshot => ({
    connectorId: 'google-workspace', accountId: 'a1', status: 'success', lastSyncAt: 't1', lastDurationMs: 10,
    nextSyncAt: null, entityCount: 12, lastError: null, consecutiveFailures: 0, rateLimitedUntil: null,
    queueSize: 0, modules,
  });

  it('reports no services when no capability source is wired (older builds)', () => {
    const h = harness();
    h.set(acct({ lastSyncAt: 'x', lastSyncState: 'success' }));
    h.sup.prime();
    expect(h.sup.inspect('github').services).toEqual([]);
  });

  it('overlays declared services with live module status + scope gating', () => {
    const h = harness();
    h.set(acct({ connectorId: 'google-workspace', id: 'a1', grantedScopes: ['scope.gmail', 'scope.drive'], lastSyncAt: 'x', lastSyncState: 'success' }));
    const declared: ConnectorServiceDescriptor[] = [
      { id: 'gmail', label: 'Gmail', kind: 'message', scope: 'scope.gmail', scopeGranted: true },
      { id: 'calendar', label: 'Calendar', kind: 'calendar_event', scope: 'scope.cal', scopeGranted: false },
      { id: 'drive', label: 'Drive', kind: 'file', scope: 'scope.drive', scopeGranted: true },
    ];
    h.sup.setServiceCapabilitySource(() => declared);
    h.sup.setSnapshotSource(() => snap([
      { id: 'gmail', label: 'Gmail', kind: 'message', objectCount: 12, status: 'ok', reason: null, lastSyncAt: 't1' },
      { id: 'drive', label: 'Drive', kind: 'file', objectCount: 0, status: 'unprovisioned', reason: 'no Drive', lastSyncAt: null },
    ]));

    const byId = Object.fromEntries(h.sup.inspect('google-workspace').services.map((s) => [s.id, s]));
    // Live 'ok' module → available, with its object count + kind + lastSyncAt surfaced.
    expect(byId.gmail).toMatchObject({ status: 'available', objectCount: 12, kind: 'message', lastSyncAt: 't1' });
    // No module + scope known-and-ungranted → requires_scope (objectCount null; never synced).
    expect(byId.calendar).toMatchObject({ status: 'requires_scope', objectCount: null });
    // Live 'unprovisioned' module → unprovisioned, with the swallowed-404 reason.
    expect(byId.drive).toMatchObject({ status: 'unprovisioned', reason: 'no Drive' });
  });

  it('a swallowed 403 (module unauthorized) reads as requires_scope even when the scope was granted', () => {
    const h = harness();
    h.set(acct({ connectorId: 'google-workspace', id: 'a1', grantedScopes: ['scope.gmail'], lastSyncAt: 'x', lastSyncState: 'success' }));
    h.sup.setServiceCapabilitySource(() => [{ id: 'gmail', label: 'Gmail', kind: 'message', scope: 'scope.gmail', scopeGranted: true }]);
    h.sup.setSnapshotSource(() => snap([
      { id: 'gmail', label: 'Gmail', kind: 'message', objectCount: 0, status: 'unauthorized', reason: 'API disabled (403)', lastSyncAt: null },
    ]));
    const [svc] = h.sup.inspect('google-workspace').services;
    expect(svc.status).toBe('requires_scope');
    expect(svc.reason).toBe('API disabled (403)'); // the live runtime truth wins over the declared scope flag
  });

  it('does not falsely mark a scope-gated service as requires_scope when the granted set is unknown', () => {
    const h = harness();
    h.set(acct({ connectorId: 'google-workspace', id: 'a1', grantedScopes: [], lastSyncAt: 'x', lastSyncState: 'success' }));
    h.sup.setServiceCapabilitySource(() => [{ id: 'gmail', label: 'Gmail', kind: null, scope: 'scope.gmail', scopeGranted: false }]);
    const [svc] = h.sup.inspect('google-workspace').services;
    expect(svc.status).toBe('available'); // unknown granted set → catalog default, not a misleading 'requires_scope'
  });

  it('a disabled connector reports every service as disabled', async () => {
    const h = harness();
    h.set(acct({ connectorId: 'google-workspace', id: 'a1', grantedScopes: ['scope.gmail'], lastSyncAt: 'x', lastSyncState: 'success' }));
    h.sup.setServiceCapabilitySource(() => [
      { id: 'gmail', label: 'Gmail', kind: 'message', scope: 'scope.gmail', scopeGranted: true },
      { id: 'drive', label: 'Drive', kind: 'file', scope: 'scope.drive', scopeGranted: false },
    ]);
    await h.sup.control('google-workspace', null, 'disable');
    const services = h.sup.inspect('google-workspace').services;
    expect(services).toHaveLength(2);
    expect(services.every((s) => s.status === 'disabled')).toBe(true);
  });

  it('unions granted scopes across connected accounts (a service granted by ANY account is available)', () => {
    const h = harness();
    h.set(acct({ connectorId: 'google-workspace', id: 'a1', grantedScopes: ['scope.gmail'], lastSyncAt: 'x', lastSyncState: 'success' }));
    h.set(acct({ connectorId: 'google-workspace', id: 'a2', grantedScopes: ['scope.gmail', 'scope.drive'], lastSyncAt: 'x', lastSyncState: 'success' }));
    // A scope-aware source (like the real Google one) so the union across accounts actually matters.
    h.sup.setServiceCapabilitySource((_c, scopes) => [
      { id: 'gmail', label: 'Gmail', kind: 'message', scope: 'scope.gmail', scopeGranted: scopes.includes('scope.gmail') },
      { id: 'drive', label: 'Drive', kind: 'file', scope: 'scope.drive', scopeGranted: scopes.includes('scope.drive') },
    ]);
    const byId = Object.fromEntries(h.sup.inspect('google-workspace').services.map((s) => [s.id, s]));
    // 'drive' is granted only by a2 — with a single-account view it would read 'requires_scope';
    // the union correctly reports it available for the connector family.
    expect(byId.drive.status).toBe('available');
    expect(byId.gmail.status).toBe('available');
  });

  it('reports no services when no account is connected (reauth/disconnected must not read as available)', () => {
    const h = harness();
    h.set(acct({ connectorId: 'google-workspace', id: 'a1', status: 'reauth_required', grantedScopes: ['scope.gmail'], lastSyncAt: 'x', lastSyncState: 'success' }));
    h.sup.setServiceCapabilitySource(() => [{ id: 'gmail', label: 'Gmail', kind: 'message', scope: 'scope.gmail', scopeGranted: true }]);
    // The account can't sync until it re-authenticates — asserting the service is "available" would
    // contradict the connector's own reauth_required state, so the Services view stays empty.
    expect(h.sup.inspect('google-workspace').services).toEqual([]);
  });
});
