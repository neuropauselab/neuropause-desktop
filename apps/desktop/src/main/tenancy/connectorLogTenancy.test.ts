/**
 * P13C ROUND 9 — F7 / F12 / F6. CONNECTOR ACTIVITY, LIFECYCLE AND BROADCASTS.
 *
 * WHAT WAS WRONG
 *
 * Connector ACCOUNTS have been workspace-scoped since P10. Everything the
 * connector runtime records ABOUT those accounts was not:
 *
 *   • `connectorService.logFeed(connectorId)` filtered one install-wide array on
 *     the connector id alone. Any member holding `connectors:read` could ask for
 *     `google` and receive another workspace's account ids, the provider's
 *     verbatim error strings and its sync timings — the same rows
 *     `connectorStore.get()` refuses to resolve for them.
 *   • `ConnectorRuntimeSupervisor.history()` did the same for lifecycle
 *     transitions, and `inspect()` returns both.
 *   • Both caps (`splice(0, …)`, oldest-first) were install-wide, so one
 *     workspace's activity chose which of another's rows was destroyed.
 *   • Every connector and lifecycle event was broadcast to whatever window was
 *     open, including events produced by the per-workspace sync fan-out.
 *
 * WHAT THIS SUITE IS DESIGNED TO CATCH
 *
 * Not "A and B differ". Three workspaces write DIFFERENT, NAMED numbers of
 * records — 3, 7 and 11 — and each read is asserted to be exactly its own
 * number. An isolation suite whose positive case is empty proves nothing: zero
 * equals zero, and this program has already shipped one org-health assertion
 * that passed vacuously for that reason. So every ALLOWED read here is
 * non-empty and exact, and every DENIED read is asserted to be empty while the
 * owner's read of the same data is still full.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedAccount, ConnectorEvent, ConnectorLogEntry, SyncState } from '@neuropause/shared';
import type { ConnectorService } from '../connectors/connectorService';
import {
  ConnectorRuntimeSupervisor,
  HISTORY_CAP,
  lifecycleToWire,
  type ConnectorRuntimeSupervisorDeps,
  type OwnedLifecycleEvent,
} from '../connectors/connectorRuntimeSupervisor';

/* ── the three workspaces, and the counts that make the assertions real ── */

const WS_A = 'workspace-alpha';
const WS_B = 'workspace-beta';
const WS_C = 'workspace-gamma';

/** Deliberately different, deliberately non-zero, deliberately not each other. */
const A_ROWS = 3;
const B_ROWS = 7;
const C_ROWS = 11;

const ACCOUNT_OF: Record<string, string> = { [WS_A]: 'acct-alpha', [WS_B]: 'acct-beta', [WS_C]: 'acct-gamma' };

/* ─────────────────────── the activity log (F7 + F12) ─────────────────────── */

describe('connector activity log — one workspace, one feed', () => {
  /**
   * The real service, loaded per test through a dynamic import: it is a module
   * singleton, so each test needs a fresh module graph, and Electron has to be
   * doubled before the graph loads. The TYPE is the real class.
   */
  let service: ConnectorService;
  let logCap: number;
  /** The bound resolver's answer. `''` is what production returns when nothing resolves. */
  let workspace = '';

  beforeEach(async () => {
    /**
     * The service is a module singleton, so each test gets a fresh module graph.
     * Electron stands in for the userData path only; every line of the log
     * feed, the stamp and the cap below is the real code.
     */
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: { getPath: () => '/tmp/np-connector-tenancy', getAppPath: () => '/tmp/np-connector-tenancy' },
      safeStorage: { isEncryptionAvailable: () => false },
    }));
    const mod = await import('../connectors/connectorService');
    service = mod.connectorService;
    logCap = mod.LOG_CAP;
    workspace = '';
    service.bindWorkspace(() => workspace);
  });

  afterEach(() => {
    vi.doUnmock('electron');
    vi.resetModules();
  });

  /**
   * Write `n` real activity lines as `ws`. `recordWrite` is the public recorder
   * the M365 write executor already calls, so these go through the production
   * write path — the owner is resolved from the bound workspace, never passed.
   */
  const write = (ws: string, connectorId: string, n: number, level: 'info' | 'error' = 'info'): void => {
    const before = workspace;
    workspace = ws;
    for (let i = 0; i < n; i += 1) {
      service.recordWrite(connectorId, ACCOUNT_OF[ws] ?? 'acct', level, `${ws} line ${i}`);
    }
    workspace = before;
  };

  /** Read the feed AS `ws`. */
  const readAs = (ws: string, connectorId?: string): ConnectorLogEntry[] => {
    const before = workspace;
    workspace = ws;
    const out = service.logFeed(connectorId);
    workspace = before;
    return out;
  };

  it('each workspace reads its own activity, and reads exactly its own count', () => {
    write(WS_A, 'google', A_ROWS);
    write(WS_B, 'google', B_ROWS);
    write(WS_C, 'google', C_ROWS);

    // ALLOWED, and non-empty: the numbers, not an inequality.
    expect(readAs(WS_A, 'google')).toHaveLength(A_ROWS);
    expect(readAs(WS_B, 'google')).toHaveLength(B_ROWS);
    expect(readAs(WS_C, 'google')).toHaveLength(C_ROWS);

    // The unfiltered feed is the same set — a connector id narrows, it never widens.
    expect(readAs(WS_A)).toHaveLength(A_ROWS);
    expect(readAs(WS_B)).toHaveLength(B_ROWS);
    expect(readAs(WS_C)).toHaveLength(C_ROWS);
  });

  it("A never sees B's account ids or B's message text, and B never sees A's", () => {
    write(WS_A, 'google', A_ROWS);
    write(WS_B, 'google', B_ROWS);

    const a = readAs(WS_A, 'google');
    const b = readAs(WS_B, 'google');

    expect(a).toHaveLength(A_ROWS);
    expect(b).toHaveLength(B_ROWS);
    expect(new Set(a.map((l) => l.accountId))).toEqual(new Set(['acct-alpha']));
    expect(new Set(b.map((l) => l.accountId))).toEqual(new Set(['acct-beta']));
    expect(a.some((l) => l.message.includes(WS_B))).toBe(false);
    expect(b.some((l) => l.message.includes(WS_A))).toBe(false);
  });

  it("the connector id in the request does not reach another workspace's rows (symmetric)", () => {
    // Each workspace connects a DIFFERENT provider, so the id is the only thing
    // a cross-workspace reader could be going on — which is the exploit.
    write(WS_A, 'github', A_ROWS);
    write(WS_B, 'slack', B_ROWS);

    expect(readAs(WS_A, 'github')).toHaveLength(A_ROWS); // A → A ALLOWED
    expect(readAs(WS_A, 'slack')).toEqual([]); //            A → B DENIED
    expect(readAs(WS_B, 'slack')).toHaveLength(B_ROWS); //   B → B ALLOWED
    expect(readAs(WS_B, 'github')).toEqual([]); //           B → A DENIED
  });

  it('provider error text is scoped like everything else', () => {
    write(WS_A, 'google', A_ROWS, 'error');
    write(WS_B, 'google', B_ROWS, 'error');
    const a = readAs(WS_A, 'google');
    expect(a.filter((l) => l.level === 'error')).toHaveLength(A_ROWS);
    expect(a.every((l) => l.message.startsWith(WS_A))).toBe(true);
  });

  it('an unresolved workspace reads nothing, and its writes are visible to nobody', () => {
    write(WS_A, 'google', A_ROWS);
    // A cold start / a tenant-level background principal: the resolver answers ''.
    workspace = '';
    service.recordWrite('google', 'acct-orphan', 'info', 'written with no workspace');

    expect(service.logFeed('google')).toEqual([]); // unresolved reads nothing
    expect(readAs(WS_A, 'google')).toHaveLength(A_ROWS); // the orphan is NOT adopted
    expect(readAs(WS_B, 'google')).toEqual([]);
    expect(readAs(WS_A, 'google').some((l) => l.accountId === 'acct-orphan')).toBe(false);
  });

  it('the owner is an enforcement field and never reaches the wire', () => {
    write(WS_A, 'google', A_ROWS);
    const [entry] = readAs(WS_A, 'google');
    expect(entry).toBeDefined();
    expect(Object.keys(entry).sort()).toEqual(
      ['accountId', 'at', 'connectorId', 'id', 'level', 'message', 'phase'].sort(),
    );
  });

  /**
   * F12 — RETENTION IS A WRITE. The cap used to be install-wide and oldest-first,
   * so a busy workspace did not merely consume capacity: it decided which of a
   * quiet workspace's rows was destroyed.
   */
  it("A's cap does not evict B's rows", () => {
    write(WS_B, 'github', B_ROWS);
    write(WS_A, 'github', logCap + 40); // A blows straight through the cap

    expect(readAs(WS_A, 'github')).toHaveLength(logCap); // A is capped…
    expect(readAs(WS_B, 'github')).toHaveLength(B_ROWS); // …and B is untouched
  });

  it("B's rows survive even when A is written first and A is the noisy one", () => {
    write(WS_A, 'github', 5);
    write(WS_B, 'github', B_ROWS);
    write(WS_A, 'github', logCap + 100);

    expect(readAs(WS_B, 'github')).toHaveLength(B_ROWS);
    expect(readAs(WS_A, 'github')).toHaveLength(logCap);
    // And A kept its NEWEST lines, so the eviction is still oldest-first within the owner.
    expect(readAs(WS_A, 'github')[0].message).toBe(`${WS_A} line ${logCap + 99}`);
  });

  /**
   * F6 — a live event carries the same account id and error text the feed does,
   * so an ungated broadcast is a read nobody asked for.
   */
  it('every emitted event is stamped with the workspace it happened in', async () => {
    const { ownedByViewer } = await import('../connectors/connectorService');
    const seen: { workspaceId: string | null }[] = [];
    service.on('event', (e: { workspaceId: string | null }) => seen.push(e));

    write(WS_A, 'google', A_ROWS);
    write(WS_B, 'google', B_ROWS);

    expect(seen).toHaveLength(A_ROWS + B_ROWS);
    expect(seen.filter((e) => e.workspaceId === WS_A)).toHaveLength(A_ROWS);
    expect(seen.filter((e) => e.workspaceId === WS_B)).toHaveLength(B_ROWS);

    // The predicate the composition root gates the broadcast with — the real one.
    expect(seen.filter((e) => ownedByViewer(e.workspaceId, WS_A))).toHaveLength(A_ROWS);
    expect(seen.filter((e) => ownedByViewer(e.workspaceId, WS_B))).toHaveLength(B_ROWS);
    expect(ownedByViewer(WS_B, WS_A)).toBe(false); // B's event, A's window → dropped
    expect(ownedByViewer(null, WS_A)).toBe(false); // unowned → nobody's
    expect(ownedByViewer(WS_A, null)).toBe(false); // no viewer → nothing
  });
});

/* ────────────────── lifecycle history + inspect (F7 + F12) ────────────────── */

/** A faithful double of `connectorStore`: the id resolves only inside its own workspace. */
function accountStore() {
  const rows = new Map<string, ConnectedAccount>();
  let viewer = '';
  return {
    get viewer(): string {
      return viewer;
    },
    set viewer(v: string) {
      viewer = v;
    },
    put(ws: string, connectorId: string, accountId: string): void {
      rows.set(`${connectorId}::${accountId}`, {
        id: accountId,
        connectorId,
        workspaceId: ws,
        label: `${ws} ${connectorId}`,
        externalId: null,
        avatarUrl: null,
        status: 'connected',
        health: 'healthy',
        grantedScopes: [],
        connectedAt: 'x',
        lastSyncAt: null,
        lastSyncState: 'never',
        accessTokenExpiresAt: null,
        error: null,
      });
    },
    sync(connectorId: string, accountId: string, state: SyncState): void {
      const cur = rows.get(`${connectorId}::${accountId}`);
      if (cur) {
        rows.set(`${connectorId}::${accountId}`, {
          ...cur,
          lastSyncState: state,
          lastSyncAt: state === 'success' ? 'later' : cur.lastSyncAt,
        });
      }
    },
    drop(connectorId: string, accountId: string): void {
      rows.delete(`${connectorId}::${accountId}`);
    },
    /** `connectorStore.get` — a foreign id does not resolve. */
    get(connectorId: string, accountId: string): ConnectedAccount | null {
      const found = rows.get(`${connectorId}::${accountId}`) ?? null;
      if (found === null || viewer === '' || found.workspaceId !== viewer) return null;
      return found;
    },
    /** `connectorStore.all` — the active workspace's accounts. */
    all(): ConnectedAccount[] {
      return [...rows.values()].filter((a) => viewer !== '' && a.workspaceId === viewer);
    },
  };
}

function supervisorHarness(overrides: Partial<ConnectorRuntimeSupervisorDeps> = {}) {
  const store = accountStore();
  const bus = {
    listeners: [] as ((e: ConnectorEvent) => void)[],
    on(_: 'event', l: (e: ConnectorEvent) => void) {
      this.listeners.push(l);
    },
    off(_: 'event', l: (e: ConnectorEvent) => void) {
      this.listeners = this.listeners.filter((x) => x !== l);
    },
    emit(e: ConnectorEvent) {
      for (const l of [...this.listeners]) l(e);
    },
  };
  const broadcast: OwnedLifecycleEvent[] = [];
  let t = 1_000;
  const sup = new ConnectorRuntimeSupervisor({
    events: bus,
    controls: {
      controlFor: () => ({ paused: false, disabled: false }),
      isDisabled: () => false,
      isSuppressed: () => false,
      setPaused: async () => undefined,
      setDisabled: async () => undefined,
    },
    getAccount: (c, a) => store.get(c, a),
    listAccounts: () => store.all(),
    isConfigured: () => true,
    getLogs: () => [],
    workspaceId: () => store.viewer,
    broadcast: (e) => broadcast.push(e),
    now: () => (t += 1_000),
    ...overrides,
  });

  /** Drive exactly `n` real transitions for one workspace's account. */
  const drive = (ws: string, connectorId: string, n: number): void => {
    const accountId = ACCOUNT_OF[ws] ?? `acct-${ws}`;
    const before = store.viewer;
    store.viewer = ws;
    store.put(ws, connectorId, accountId);
    for (let i = 0; i < n; i += 1) {
      const state: SyncState = i % 2 === 0 ? 'syncing' : 'success';
      store.sync(connectorId, accountId, state);
      bus.emit({
        connectorId,
        accountId,
        type: 'sync',
        status: null,
        health: null,
        syncState: state,
        message: `${ws} sync ${i}`,
        at: 'x',
      });
    }
    store.viewer = before;
  };

  const historyAs = (ws: string, filter?: { connectorId?: string; accountId?: string; limit?: number }) => {
    const before = store.viewer;
    store.viewer = ws;
    const out = sup.history(filter);
    store.viewer = before;
    return out;
  };

  const inspectAs = (ws: string, connectorId: string) => {
    const before = store.viewer;
    store.viewer = ws;
    const out = sup.inspect(connectorId);
    store.viewer = before;
    return out;
  };

  return { store, bus, sup, broadcast, drive, historyAs, inspectAs };
}

describe('connector lifecycle history — one workspace, one history', () => {
  it('each workspace reads exactly its own transitions', () => {
    const h = supervisorHarness();
    h.drive(WS_A, 'google', A_ROWS);
    h.drive(WS_B, 'google', B_ROWS);
    h.drive(WS_C, 'google', C_ROWS);

    expect(h.historyAs(WS_A)).toHaveLength(A_ROWS);
    expect(h.historyAs(WS_B)).toHaveLength(B_ROWS);
    expect(h.historyAs(WS_C)).toHaveLength(C_ROWS);
  });

  it("A's history names only A's account; B's names only B's (symmetric)", () => {
    const h = supervisorHarness();
    h.drive(WS_A, 'google', A_ROWS);
    h.drive(WS_B, 'google', B_ROWS);

    const a = h.historyAs(WS_A);
    const b = h.historyAs(WS_B);
    expect(a).toHaveLength(A_ROWS);
    expect(b).toHaveLength(B_ROWS);
    expect(new Set(a.map((e) => e.accountId))).toEqual(new Set(['acct-alpha']));
    expect(new Set(b.map((e) => e.accountId))).toEqual(new Set(['acct-beta']));
    expect(a.some((e) => (e.reason ?? '').includes(WS_B))).toBe(false);
    expect(b.some((e) => (e.reason ?? '').includes(WS_A))).toBe(false);
  });

  it('a filter argument cannot reach across the boundary it does not own', () => {
    const h = supervisorHarness();
    h.drive(WS_A, 'github', A_ROWS);
    h.drive(WS_B, 'slack', B_ROWS);

    expect(h.historyAs(WS_A, { connectorId: 'github' })).toHaveLength(A_ROWS); // A → A
    expect(h.historyAs(WS_A, { connectorId: 'slack' })).toEqual([]); //           A → B
    expect(h.historyAs(WS_B, { connectorId: 'slack' })).toHaveLength(B_ROWS); //  B → B
    expect(h.historyAs(WS_B, { connectorId: 'github' })).toEqual([]); //          B → A
    // The account id is a caller argument too, and it authorizes nothing.
    expect(h.historyAs(WS_A, { accountId: 'acct-beta' })).toEqual([]);
    expect(h.historyAs(WS_B, { accountId: 'acct-alpha' })).toEqual([]);
  });

  it('an unresolved workspace reads no history at all', () => {
    const h = supervisorHarness();
    h.drive(WS_A, 'google', A_ROWS);
    h.store.viewer = '';
    expect(h.sup.history()).toEqual([]);
    expect(h.sup.history({ connectorId: 'google' })).toEqual([]);
    expect(h.historyAs(WS_A)).toHaveLength(A_ROWS); // still there for its owner
  });

  it('the disconnect transition is owned by the workspace that owned the account', () => {
    const h = supervisorHarness();
    h.drive(WS_A, 'google', A_ROWS);
    h.drive(WS_B, 'google', B_ROWS);

    // B disconnects: the account row is gone before the event arrives, exactly
    // as `connectorService.disconnect` does it.
    h.store.viewer = WS_B;
    h.store.drop('google', 'acct-beta');
    h.bus.emit({
      connectorId: 'google',
      accountId: 'acct-beta',
      type: 'account_removed',
      status: 'disconnected',
      health: null,
      syncState: null,
      message: 'gone',
      at: 'x',
    });

    expect(h.historyAs(WS_B)).toHaveLength(B_ROWS + 1);
    expect(h.historyAs(WS_B)[0].to).toBe('disconnected');
    expect(h.historyAs(WS_A)).toHaveLength(A_ROWS); // A's history did not grow
    expect(h.historyAs(WS_A).some((e) => e.accountId === 'acct-beta')).toBe(false);
  });

  it('a transition for an account this supervisor never resolved is owned by nobody', () => {
    const h = supervisorHarness();
    h.drive(WS_A, 'google', A_ROWS);
    // An event naming an account no workspace of ours can resolve.
    h.store.viewer = WS_A;
    h.bus.emit({
      connectorId: 'google',
      accountId: 'acct-unknown',
      type: 'sync',
      status: null,
      health: null,
      syncState: 'error',
      message: 'from nowhere',
      at: 'x',
    });
    expect(h.historyAs(WS_A)).toHaveLength(A_ROWS);
    expect(h.historyAs(WS_B)).toEqual([]);
    expect(h.historyAs(WS_C)).toEqual([]);
  });

  /** F12 again, for the ring. */
  it("A's transition volume does not evict B's history", () => {
    const h = supervisorHarness();
    h.drive(WS_B, 'google', B_ROWS);
    h.drive(WS_A, 'google', HISTORY_CAP + 30);

    expect(h.historyAs(WS_A)).toHaveLength(HISTORY_CAP);
    expect(h.historyAs(WS_B)).toHaveLength(B_ROWS);
  });

  it('the broadcast carries its owner, and the wire form does not', () => {
    const h = supervisorHarness();
    h.drive(WS_A, 'google', A_ROWS);
    h.drive(WS_B, 'google', B_ROWS);

    expect(h.broadcast.filter((e) => e.workspaceId === WS_A)).toHaveLength(A_ROWS);
    expect(h.broadcast.filter((e) => e.workspaceId === WS_B)).toHaveLength(B_ROWS);
    expect(h.broadcast.some((e) => e.workspaceId === null)).toBe(false);
    expect('workspaceId' in lifecycleToWire(h.broadcast[0])).toBe(false);
  });
});

describe('connector inspect — the read model composed from both', () => {
  it("composes only the caller's logs and only the caller's lifecycle", async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: { getPath: () => '/tmp/np-connector-tenancy', getAppPath: () => '/tmp/np-connector-tenancy' },
      safeStorage: { isEncryptionAvailable: () => false },
    }));
    const { connectorService } = await import('../connectors/connectorService');

    // Wire the real service into the supervisor the way `initConnectors` does:
    // one resolver answers for accounts, activity and lifecycle.
    let viewer = '';
    connectorService.bindWorkspace(() => viewer);
    const h = supervisorHarness({ getLogs: (id) => connectorService.logFeed(id) });
    const bindViewer = (ws: string): void => {
      viewer = ws;
      h.store.viewer = ws;
    };

    bindViewer(WS_A);
    for (let i = 0; i < A_ROWS; i += 1) connectorService.recordWrite('google', 'acct-alpha', 'info', `${WS_A} ${i}`);
    bindViewer(WS_B);
    for (let i = 0; i < B_ROWS; i += 1) connectorService.recordWrite('google', 'acct-beta', 'error', `${WS_B} ${i}`);
    bindViewer('');

    h.drive(WS_A, 'google', A_ROWS);
    h.drive(WS_B, 'google', B_ROWS);

    bindViewer(WS_A);
    const a = h.sup.inspect('google');
    bindViewer(WS_B);
    const b = h.sup.inspect('google');
    bindViewer('');
    const nobody = h.sup.inspect('google');

    expect(a.logs).toHaveLength(A_ROWS);
    expect(a.lifecycle).toHaveLength(A_ROWS);
    expect(a.runtime.accounts.map((x) => x.accountId)).toEqual(['acct-alpha']);
    expect(b.logs).toHaveLength(B_ROWS);
    expect(b.lifecycle).toHaveLength(B_ROWS);
    expect(b.runtime.accounts.map((x) => x.accountId)).toEqual(['acct-beta']);

    expect(a.logs.some((l) => l.accountId === 'acct-beta')).toBe(false);
    expect(b.logs.some((l) => l.accountId === 'acct-alpha')).toBe(false);
    expect(a.lifecycle.some((e) => e.accountId === 'acct-beta')).toBe(false);
    expect(b.lifecycle.some((e) => e.accountId === 'acct-alpha')).toBe(false);

    // No workspace resolved → the inspector shows nothing rather than everything.
    expect(nobody.logs).toEqual([]);
    expect(nobody.lifecycle).toEqual([]);
    expect(nobody.runtime.accounts).toEqual([]);

    vi.doUnmock('electron');
    vi.resetModules();
  });
});
