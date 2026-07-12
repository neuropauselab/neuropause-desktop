/**
 * P4.1 Increment 2 — the Connector Runtime Supervisor.
 *
 * A thin, event-sourced coordination layer over the EXISTING ConnectorService. It does not own
 * accounts, tokens, or sync — it OBSERVES the service's `event` stream, projects each account's
 * runtime state through the pure FSM (`deriveRuntimeState`), and emits the `from → to` lifecycle
 * transitions the raw `ConnectorEvent` never carried. It also owns the two operator controls
 * (pause/resume per account, disable/enable per connector) backed by the persisted control store,
 * and answers "is sync suppressed?" so the service can honour a pause. No parallel runtime, no
 * duplicate manager: state ownership stays in ConnectorService; this is a projection + controller.
 */
import type {
  ConnectedAccount,
  ConnectorAccountInspection,
  ConnectorControlAction,
  ConnectorControlState,
  ConnectorEvent,
  ConnectorInspection,
  ConnectorLifecycleEvent,
  ConnectorLifecyclePhase,
  ConnectorLogEntry,
  ConnectorRuntimeState,
  ConnectorRuntimeView,
  ConnectorSyncSnapshot,
  SyncState,
} from '@neuropause/shared';
import { aggregateRuntimeState, computeIntegrationHealth, deriveRuntimeState } from '@neuropause/shared';
import { createLogger } from '../logger';

const log = createLogger('connector-runtime');
const HISTORY_CAP = 500;

/** The narrow event source the Supervisor subscribes to (the ConnectorService singleton satisfies this). */
export interface RuntimeEventSource {
  on(event: 'event', listener: (e: ConnectorEvent) => void): void;
  off(event: 'event', listener: (e: ConnectorEvent) => void): void;
}

/** The control persistence port (the ConnectorControlStore satisfies this). */
export interface RuntimeControlPort {
  controlFor(connectorId: string, accountId: string): ConnectorControlState;
  isDisabled(connectorId: string): boolean;
  isSuppressed(connectorId: string, accountId: string): boolean;
  setPaused(connectorId: string, accountId: string, paused: boolean): Promise<void>;
  setDisabled(connectorId: string, disabled: boolean): Promise<void>;
}

export interface ConnectorRuntimeSupervisorDeps {
  events: RuntimeEventSource;
  controls: RuntimeControlPort;
  /** Read one account's authoritative metadata (connectorStore.get). */
  getAccount: (connectorId: string, accountId: string) => ConnectedAccount | null;
  /** All connected accounts (connectorStore.all). */
  listAccounts: () => ConnectedAccount[];
  /** Whether a connector has client credentials configured. */
  isConfigured: (connectorId: string) => boolean;
  /** Recent activity log for a connector (connectorService.logFeed) — for the Inspector. */
  getLogs: (connectorId: string) => ConnectorLogEntry[];
  /** Broadcast the lifecycle transition to the renderer. */
  broadcast: (event: ConnectorLifecycleEvent) => void;
  now?: () => number;
  /** Optional richer sync signals (rate-limit / retry depth / offline); wired in a later increment. */
  snapshotFor?: (connectorId: string, accountId: string) => ConnectorSyncSnapshot | null;
}

/** Map a connector event type to the lifecycle phase that drove it. */
function phaseForEvent(e: ConnectorEvent): ConnectorLifecyclePhase {
  switch (e.type) {
    case 'sync':
      return 'sync';
    case 'health':
      return 'health_check';
    case 'account_added':
      return 'connect';
    case 'account_removed':
      return 'disconnect';
    case 'status':
      if (e.status === 'connecting') return 'authenticate';
      if (e.status === 'reauth_required') return 'error_recovery';
      if (e.status === 'error') return 'error_recovery';
      return 'connect';
    default:
      return 'sync';
  }
}

/** A neutral idle snapshot, so an account with no sync-state yet still scores through the health engine. */
function emptySnapshot(connectorId: string, accountId: string): ConnectorSyncSnapshot {
  return {
    connectorId, accountId, status: 'idle', lastSyncAt: null, lastDurationMs: null, nextSyncAt: null,
    entityCount: 0, lastError: null, consecutiveFailures: 0, rateLimitedUntil: null, queueSize: 0,
  };
}

/** Map the account's persisted SyncState onto the snapshot status vocabulary the FSM reads. */
function syncStateToStatus(state: SyncState): ConnectorSyncSnapshot['status'] {
  switch (state) {
    case 'syncing':
      return 'syncing';
    case 'success':
      return 'success';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

export class ConnectorRuntimeSupervisor {
  private readonly deps: ConnectorRuntimeSupervisorDeps;
  private readonly now: () => number;
  private readonly last = new Map<string, ConnectorRuntimeState>();
  private readonly historyRing: ConnectorLifecycleEvent[] = [];
  private snapshotFor?: (connectorId: string, accountId: string) => ConnectorSyncSnapshot | null;
  private readonly onEvent = (e: ConnectorEvent): void => this.handleEvent(e);

  constructor(deps: ConnectorRuntimeSupervisorDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.snapshotFor = deps.snapshotFor;
    deps.events.on('event', this.onEvent);
  }

  /** Seed the last-known state for every existing account WITHOUT emitting transitions. */
  prime(): void {
    for (const a of this.deps.listAccounts()) {
      const state = this.computeAccount(a.connectorId, a.id);
      if (state) this.last.set(this.key(a.connectorId, a.id), state);
    }
    log.info('Runtime supervisor primed', { accounts: this.last.size });
  }

  /** Late-inject the richer sync-signal source (rate-limit / retry / offline). Idempotent. */
  setSnapshotSource(fn: (connectorId: string, accountId: string) => ConnectorSyncSnapshot | null): void {
    this.snapshotFor = fn;
  }

  private key(connectorId: string, accountId: string): string {
    return `${connectorId}::${accountId}`;
  }

  private computeAccount(connectorId: string, accountId: string): ConnectorRuntimeState | null {
    const account = this.deps.getAccount(connectorId, accountId);
    if (!account) return null;
    const snap = this.snapshotFor?.(connectorId, accountId) ?? null;
    return deriveRuntimeState({
      status: account.status,
      syncStatus: snap?.status ?? syncStateToStatus(account.lastSyncState),
      rateLimitedUntil: snap?.rateLimitedUntil ?? null,
      retryDepth: snap?.queueSize ?? 0,
      hasSyncedBefore: account.lastSyncAt !== null,
      control: this.deps.controls.controlFor(connectorId, accountId),
      nowMs: this.now(),
    });
  }

  /** Recompute an account's state; on change, record + broadcast a from→to transition. Returns it (or null). */
  private reconcile(
    connectorId: string,
    accountId: string,
    phase: ConnectorLifecyclePhase,
    reason: string | null,
  ): ConnectorLifecycleEvent | null {
    const to = this.computeAccount(connectorId, accountId);
    if (!to) return null;
    const k = this.key(connectorId, accountId);
    const from = this.last.get(k) ?? 'disconnected';
    if (from === to) return null;
    this.last.set(k, to);
    const evt: ConnectorLifecycleEvent = {
      connectorId,
      accountId,
      phase,
      from,
      to,
      reason,
      at: new Date(this.now()).toISOString(),
    };
    this.historyRing.push(evt);
    if (this.historyRing.length > HISTORY_CAP) this.historyRing.splice(0, this.historyRing.length - HISTORY_CAP);
    this.deps.broadcast(evt);
    return evt;
  }

  private handleEvent(e: ConnectorEvent): void {
    if (!e.accountId) return; // connector-level logs carry no account; nothing to project
    if (e.type === 'account_removed') {
      const k = this.key(e.connectorId, e.accountId);
      const from = this.last.get(k) ?? 'disconnected';
      if (from !== 'disconnected') {
        const evt: ConnectorLifecycleEvent = {
          connectorId: e.connectorId,
          accountId: e.accountId,
          phase: 'disconnect',
          from,
          to: 'disconnected',
          reason: e.message,
          at: new Date(this.now()).toISOString(),
        };
        this.historyRing.push(evt);
        if (this.historyRing.length > HISTORY_CAP) this.historyRing.splice(0, this.historyRing.length - HISTORY_CAP);
        this.deps.broadcast(evt);
      }
      this.last.delete(k);
      return;
    }
    this.reconcile(e.connectorId, e.accountId, phaseForEvent(e), e.message);
  }

  /* ── operator controls ── */

  /** Apply a control command; persists the flag, then re-projects the affected account(s). */
  async control(connectorId: string, accountId: string | null, action: ConnectorControlAction): Promise<ConnectorRuntimeView> {
    switch (action) {
      case 'disable':
        await this.deps.controls.setDisabled(connectorId, true);
        this.reconcileConnector(connectorId, 'disconnect', 'operator disabled');
        break;
      case 'enable':
        await this.deps.controls.setDisabled(connectorId, false);
        this.reconcileConnector(connectorId, 'connect', 'operator enabled');
        break;
      case 'pause':
      case 'resume': {
        const paused = action === 'pause';
        const targets = accountId
          ? [accountId]
          : this.deps.listAccounts().filter((a) => a.connectorId === connectorId).map((a) => a.id);
        for (const id of targets) {
          await this.deps.controls.setPaused(connectorId, id, paused);
          this.reconcile(connectorId, id, 'sync', paused ? 'operator paused' : 'operator resumed');
        }
        break;
      }
    }
    log.info('Connector control applied', { connectorId, accountId, action });
    return this.viewFor(connectorId);
  }

  private reconcileConnector(connectorId: string, phase: ConnectorLifecyclePhase, reason: string): void {
    for (const a of this.deps.listAccounts()) {
      if (a.connectorId === connectorId) this.reconcile(connectorId, a.id, phase, reason);
    }
  }

  /* ── reads ── */

  /** Current runtime state for one account (derived live). */
  runtimeStateOf(connectorId: string, accountId: string): ConnectorRuntimeState | null {
    return this.computeAccount(connectorId, accountId);
  }

  private viewFor(connectorId: string): ConnectorRuntimeView {
    const accounts = this.deps.listAccounts().filter((a) => a.connectorId === connectorId);
    const accountViews = accounts.map((a) => ({
      accountId: a.id,
      state: this.computeAccount(connectorId, a.id) ?? 'disconnected',
      control: this.deps.controls.controlFor(connectorId, a.id),
    }));
    return {
      connectorId,
      state: aggregateRuntimeState(accountViews.map((v) => v.state), { configured: this.deps.isConfigured(connectorId) }),
      disabled: this.deps.controls.isDisabled(connectorId),
      accounts: accountViews,
    };
  }

  /** Runtime view for all connectors that have accounts (or one specific connector). */
  runtimeView(connectorId?: string): ConnectorRuntimeView[] {
    if (connectorId) return [this.viewFor(connectorId)];
    const ids = [...new Set(this.deps.listAccounts().map((a) => a.connectorId))];
    return ids.map((id) => this.viewFor(id));
  }

  /**
   * P4.1 — the Live Connector Inspector projection for one connector: runtime view + per-account snapshot
   * & scored health (via the existing integration-health engine) + recent logs + recent lifecycle
   * transitions. A read model composed from existing sources; exposes status/metrics only, never tokens.
   */
  inspect(connectorId: string): ConnectorInspection {
    const nowMs = this.now();
    const runtime = this.viewFor(connectorId);
    const accounts: ConnectorAccountInspection[] = runtime.accounts.map((a) => {
      const snapshot = this.snapshotFor?.(connectorId, a.accountId) ?? null;
      const health = computeIntegrationHealth(snapshot ?? emptySnapshot(connectorId, a.accountId), nowMs);
      return { accountId: a.accountId, state: a.state, control: a.control, snapshot, health };
    });
    return {
      connectorId,
      runtime,
      accounts,
      logs: this.deps.getLogs(connectorId).slice(0, 50),
      lifecycle: this.history({ connectorId, limit: 50 }),
      generatedAt: new Date(nowMs).toISOString(),
    };
  }

  /** The lifecycle transition history (newest first), optionally filtered. */
  history(filter?: { connectorId?: string; accountId?: string; limit?: number }): ConnectorLifecycleEvent[] {
    let out = this.historyRing;
    if (filter?.connectorId) out = out.filter((h) => h.connectorId === filter.connectorId);
    if (filter?.accountId) out = out.filter((h) => h.accountId === filter.accountId);
    const reversed = [...out].reverse();
    return filter?.limit ? reversed.slice(0, filter.limit) : reversed;
  }

  /** Whether sync must be suppressed for this account (paused or connector disabled). */
  isSyncSuppressed(connectorId: string, accountId: string): boolean {
    return this.deps.controls.isSuppressed(connectorId, accountId);
  }

  /**
   * P4.1 — an external sync-signal change (rate-limit / offline / retry depth, from the sync-state store)
   * for one account. Re-projects it so `rate_limited` / `offline` / `retrying` surface as live transitions.
   * A no-op when the derived state is unchanged.
   */
  notifySignalChange(connectorId: string, accountId: string): void {
    this.reconcile(connectorId, accountId, 'sync', 'sync signal update');
  }

  dispose(): void {
    this.deps.events.off('event', this.onEvent);
  }
}
