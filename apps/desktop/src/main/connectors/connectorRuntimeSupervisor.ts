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
  ConnectorModuleStat,
  ConnectorRuntimeState,
  ConnectorRuntimeView,
  ConnectorServiceCapability,
  ConnectorServiceDescriptor,
  ConnectorSyncSnapshot,
  SyncState,
} from '@neuropause/shared';
import { aggregateRuntimeState, computeIntegrationHealth, deriveRuntimeState } from '@neuropause/shared';
import { createLogger } from '../logger';
import { declareStoreScope } from '../tenancy/storeScope';

const log = createLogger('connector-runtime');
/**
 * Per WORKSPACE, not per install. See `remember`.
 *
 * Exported for the same reason `LOG_CAP` is: the isolation suite must assert the
 * real cap, not a copy of the number that survives somebody changing this one.
 */
export const HISTORY_CAP = 500;

/**
 * P13C ROUND 9 — FINDING 7, SECOND HALF. LIFECYCLE HISTORY BELONGS TO A WORKSPACE.
 *
 * `history()` filtered the ring on `connectorId` / `accountId` and nothing else,
 * so `connector:inspect` on `connectors:read` returned another workspace's
 * account ids, its from→to transitions and the provider reason strings attached
 * to them — the same disclosure as the activity log, through the read model
 * beside it. The account listing this projection is built from has been
 * workspace-scoped since P10; the transitions it recorded never were.
 *
 * Each row now carries the owner resolved from the AUTHORITATIVE account lookup
 * (`deps.getAccount`, which is `connectorStore.get` — the resolver that already
 * refuses a foreign id), and reads filter on it against the viewer's own
 * workspace. A row with no owner belongs to nobody and is returned to nobody.
 */
declareStoreScope({
  name: 'connector-lifecycle-history',
  scope: 'WORKSPACE',
  persistence: 'memory',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention: `Per workspace: the ${HISTORY_CAP}-row ring evicts only the owning workspace's own oldest transitions (remember). An install-wide splice let one workspace's churn delete another's disconnect record.`,
  reason:
    "ConnectorLifecycleEvent.workspaceId, resolved from ConnectedAccount.workspaceId at write time; unresolved reads return []. A transition names an account and carries the provider's reason string, which is one customer's own integration activity.",
});

/**
 * A lifecycle transition with the workspace whose account it happened to.
 *
 * Not on the shared `ConnectorLifecycleEvent`, because this is an enforcement
 * field rather than a payload one: it is stamped from the account the supervisor
 * resolved, filtered on at every read, and stripped before the transition is
 * broadcast to a window.
 */
export type OwnedLifecycleEvent = ConnectorLifecycleEvent & { workspaceId: string | null };

/** Drop the owner before a transition leaves the process. */
export function lifecycleToWire(evt: OwnedLifecycleEvent): ConnectorLifecycleEvent {
  const { workspaceId: _owner, ...wire } = evt;
  void _owner;
  return wire;
}

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
  /**
   * The workspace the CALLER is in — the same resolver `connectorStore` and
   * `connectorService` bind, so one boundary answers for accounts, credentials,
   * activity and lifecycle rather than four that can drift apart.
   *
   * REQUIRED, not optional. An optional seam is one a future construction site
   * can omit and still compile, and every finding in this program is a boundary
   * somebody did not know they had to draw. `''` (no workspace resolved) denies,
   * exactly as it does in `connectorService.requireWorkspace`.
   */
  workspaceId: () => string;
  /** Broadcast the lifecycle transition to the renderer. Carries its owner; see `initConnectors`. */
  broadcast: (event: OwnedLifecycleEvent) => void;
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

/**
 * P5 — Increment 4: overlay one account's live per-module runtime status onto a runtime-declared
 * service descriptor. Precedence: operator-disabled wins; then the live module stat (a swallowed 403 →
 * requires_scope, 404 → unprovisioned, ok → available); then — only when the granted-scope set is
 * actually known — an ungranted scope-gated service → requires_scope; otherwise the declared catalog
 * default (available). Pure. The live module stat always wins over the declared scope flag, so a scope
 * Google granted whose API is nonetheless disabled (a runtime 403) still reads as requires_scope.
 */
function toServiceCapability(
  d: ConnectorServiceDescriptor,
  stat: ConnectorModuleStat | null,
  opts: { disabled: boolean; scopesKnown: boolean },
): ConnectorServiceCapability {
  let status: ConnectorServiceCapability['status'] = 'available';
  let reason: string | null = null;
  if (opts.disabled) {
    status = 'disabled';
    reason = 'Connector disabled by the operator';
  } else if (stat && stat.status === 'unauthorized') {
    status = 'requires_scope';
    reason = stat.reason;
  } else if (stat && stat.status === 'unprovisioned') {
    status = 'unprovisioned';
    reason = stat.reason;
  } else if (!stat && d.scope && opts.scopesKnown && !d.scopeGranted) {
    status = 'requires_scope';
    reason = "This service's OAuth scope was not granted for the connected account";
  }
  return {
    id: d.id,
    label: d.label,
    kind: d.kind ?? stat?.kind ?? null,
    scope: d.scope,
    status,
    objectCount: stat?.objectCount ?? null,
    lastSyncAt: stat?.lastSyncAt ?? null,
    reason,
  };
}

/** The later of two ISO timestamps (nulls lose). ISO-8601 UTC strings order lexicographically. */
function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/**
 * P5 — Increment 4: merge one account's module stat into the per-service connector-level view
 * (best-status union): any 'ok' account means the service works, object counts sum, the latest sync
 * wins, and a degradation reason is kept only while no account is 'ok'. Pure. Lets a connector family
 * with several accounts (granular per-account consent) report a service as available if ANY account
 * provides it, rather than collapsing to one account's view.
 */
function mergeModuleStat(into: Map<string, ConnectorModuleStat>, m: ConnectorModuleStat): void {
  const prev = into.get(m.id);
  if (!prev) {
    into.set(m.id, { ...m });
    return;
  }
  const status = prev.status === 'ok' || m.status === 'ok' ? 'ok' : prev.status;
  into.set(m.id, {
    ...prev,
    status,
    objectCount: prev.objectCount + m.objectCount,
    lastSyncAt: laterIso(prev.lastSyncAt, m.lastSyncAt),
    reason: status === 'ok' ? null : (prev.reason ?? m.reason),
    kind: prev.kind || m.kind,
  });
}

export class ConnectorRuntimeSupervisor {
  private readonly deps: ConnectorRuntimeSupervisorDeps;
  private readonly now: () => number;
  /**
   * Last known state per account, WITH the workspace that owned the account
   * when it was observed.
   *
   * The owner is carried here so a removal can still be attributed: by the time
   * `account_removed` arrives, `connectorStore.remove` has already run and the
   * authoritative lookup returns null. Taking the owner from the last resolved
   * account keeps the removal row's owner sourced from the store rather than
   * from the event — an event is a message, and a message is not authority.
   */
  private readonly last = new Map<string, { state: ConnectorRuntimeState; owner: string | null }>();
  private historyRing: OwnedLifecycleEvent[] = [];
  private snapshotFor?: (connectorId: string, accountId: string) => ConnectorSyncSnapshot | null;
  private serviceSource?: (connectorId: string, grantedScopes: readonly string[]) => ConnectorServiceDescriptor[];
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
      if (state) this.last.set(this.key(a.connectorId, a.id), { state, owner: a.workspaceId ?? null });
    }
    log.info('Runtime supervisor primed', { accounts: this.last.size });
  }

  /** Late-inject the richer sync-signal source (rate-limit / retry / offline). Idempotent. */
  setSnapshotSource(fn: (connectorId: string, accountId: string) => ConnectorSyncSnapshot | null): void {
    this.snapshotFor = fn;
  }

  /**
   * P5 — Increment 4: late-inject the sync layer's runtime-declared service source (the Connector
   * Center's per-service capability list is projected from this — never hardcoded). Idempotent.
   * Mirrors `setSnapshotSource`; wired at the runtime-core composition seam once both subsystems exist.
   */
  setServiceCapabilitySource(
    fn: (connectorId: string, grantedScopes: readonly string[]) => ConnectorServiceDescriptor[],
  ): void {
    this.serviceSource = fn;
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
  ): OwnedLifecycleEvent | null {
    /**
     * THE AUTHORITATIVE LOOKUP IS THE FIRST STEP, NOT THE LAST.
     *
     * `getAccount` is `connectorStore.get`, which resolves an id only inside the
     * caller's workspace and returns the account's own `workspaceId`. So the
     * owner of this row is read from the account the transition is ABOUT —
     * never from the connector id that arrived on the event, and never from
     * "whichever workspace is active when somebody reads it later".
     */
    const account = this.deps.getAccount(connectorId, accountId);
    const to = this.computeAccount(connectorId, accountId);
    if (!account || !to) return null;
    const k = this.key(connectorId, accountId);
    const from = this.last.get(k)?.state ?? 'disconnected';
    const owner = account.workspaceId ?? null;
    if (from === to) {
      // Still worth remembering the owner: the removal path reads it.
      this.last.set(k, { state: to, owner });
      return null;
    }
    this.last.set(k, { state: to, owner });
    const evt: OwnedLifecycleEvent = {
      connectorId,
      accountId,
      phase,
      from,
      to,
      reason,
      at: new Date(this.now()).toISOString(),
      workspaceId: owner,
    };
    this.remember(evt);
    this.deps.broadcast(evt);
    return evt;
  }

  /**
   * Append a transition and evict the OWNER'S oldest beyond the cap.
   * P13C ROUND 9 — FINDING 12.
   *
   * `historyRing.splice(0, length - HISTORY_CAP)` was install-wide and
   * oldest-first: a workspace whose connectors flapped 500 times evicted another
   * workspace's transitions — including the `→ disconnected` and
   * `→ reauth_required` rows the Inspector shows an operator. A filter hides; a
   * cap deletes, and this one deleted across a boundary every read now respects.
   */
  private remember(evt: OwnedLifecycleEvent): void {
    this.historyRing.push(evt);
    const mine = this.historyRing.filter((h) => h.workspaceId === evt.workspaceId);
    if (mine.length <= HISTORY_CAP) return;
    const doomed = new Set(mine.slice(0, mine.length - HISTORY_CAP));
    this.historyRing = this.historyRing.filter((h) => !doomed.has(h));
  }

  /**
   * The workspace whose lifecycle history is visible, or null.
   *
   * `''` is what the bound resolver returns when nothing resolves — a
   * tenant-level or system background principal, or a cold start before the
   * workspace file is read — and it denies rather than matching the rows that
   * also have no owner.
   */
  private viewer(): string | null {
    const id = this.deps.workspaceId();
    return id === undefined || id === null || id === '' ? null : id;
  }

  private handleEvent(e: ConnectorEvent): void {
    if (!e.accountId) return; // connector-level logs carry no account; nothing to project
    if (e.type === 'account_removed') {
      const k = this.key(e.connectorId, e.accountId);
      const previous = this.last.get(k);
      const from = previous?.state ?? 'disconnected';
      if (from !== 'disconnected') {
        const evt: OwnedLifecycleEvent = {
          connectorId: e.connectorId,
          accountId: e.accountId,
          phase: 'disconnect',
          from,
          to: 'disconnected',
          reason: e.message,
          at: new Date(this.now()).toISOString(),
          /**
           * The owner of the account AS THE STORE LAST RESOLVED IT. The row is
           * gone from `connectorStore` by now, so there is nothing left to look
           * up — but this supervisor only ever recorded a state for an account
           * the workspace-scoped resolver returned, so the remembered owner is
           * still store-sourced. An account it never saw resolve leaves the row
           * unowned, and an unowned row is visible to nobody.
           */
          workspaceId: previous?.owner ?? null,
        };
        this.remember(evt);
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
        /**
         * P13C ROUND 6 — THE `accountId` BRANCH BYPASSED THE ONLY SCOPED LIST.
         *
         * `accountId` arrives from the renderer payload. The `null` branch goes
         * through `listAccounts()`, which is workspace-filtered; the id branch
         * went straight to `controls.setPaused` with whatever was sent. Pausing
         * an account is a SYNC KILL — `isSuppressed` consults the flag inside the
         * per-workspace fan-out — so a `connectors:manage` holder in one tenant
         * could silently stop another tenant's GitHub from ever syncing again.
         *
         * `deps.getAccount` is `connectorStore.get`, the workspace-scoped
         * resolver, and it was ALREADY on this object and already used twice in
         * this file. The same shape was fixed in `m365/executor.ts` this round by
         * adding `ownsAccount`; the control path was missed because a key that
         * looks specific (`connectorId::accountId`) reads like a boundary. A KEY
         * IS NOT AN AUTHORIZATION CHECK.
         */
        const targets = accountId
          ? this.deps.getAccount(connectorId, accountId) !== null
            ? [accountId]
            : []
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
      services: this.computeServices(connectorId, runtime),
      logs: this.deps.getLogs(connectorId).slice(0, 50),
      lifecycle: this.history({ connectorId, limit: 50 }),
      generatedAt: new Date(nowMs).toISOString(),
    };
  }

  /**
   * P5 — Increment 4: the connector's per-service capabilities. Runtime-driven end to end: the DECLARED
   * service list comes from the injected sync-layer source (never hardcoded), and each service's live
   * status is overlaid from the primary account's per-module sync stats + the operator control flag.
   * Returns `[]` when no source is wired (older builds) or the connector declares no services.
   */
  private computeServices(connectorId: string, runtime: ConnectorRuntimeView): ConnectorServiceCapability[] {
    if (!this.serviceSource) return [];
    const disabled = this.deps.controls.isDisabled(connectorId);
    // Only CONNECTED accounts can vouch for a service's live availability — a reauth_required /
    // disconnected / error account must never report its services as "available". Union across all
    // connected accounts (Google supports granular per-account consent, so a service is available to
    // the connector if ANY connected account granted + syncs it).
    const connectedAccounts = runtime.accounts
      .map((a) => this.deps.getAccount(connectorId, a.accountId))
      .filter((a): a is ConnectedAccount => a?.status === 'connected');

    // Nothing connected and not disabled → we cannot assert per-service availability, so surface no
    // services (the accounts section already shows the connect/reauth state). Prevents a misleading
    // all-green list for a connector whose only account needs reauth or is disconnected.
    if (connectedAccounts.length === 0 && !disabled) return [];

    const grantedScopes = [...new Set(connectedAccounts.flatMap((a) => a.grantedScopes))];
    const declared = this.serviceSource(connectorId, grantedScopes);
    if (declared.length === 0) return [];

    // Merge each service's live module stat across the connected accounts, so the connector-level
    // report reflects the whole family (best status wins, counts sum, latest sync kept).
    const merged = new Map<string, ConnectorModuleStat>();
    for (const a of connectedAccounts) {
      const snapshot = this.snapshotFor?.(connectorId, a.id) ?? null;
      for (const m of snapshot?.modules ?? []) mergeModuleStat(merged, m);
    }
    const scopesKnown = grantedScopes.length > 0;
    return declared.map((d) => toServiceCapability(d, merged.get(d.id) ?? null, { disabled, scopesKnown }));
  }

  /**
   * The CALLER'S WORKSPACE'S lifecycle history (newest first), optionally filtered.
   *
   * The owner check comes FIRST and is not part of `filter`: the connector and
   * account ids in `filter` arrive from a renderer request and narrow a set the
   * caller is already entitled to. A caller with no workspace sees nothing.
   */
  history(filter?: { connectorId?: string; accountId?: string; limit?: number }): ConnectorLifecycleEvent[] {
    const viewer = this.viewer();
    if (viewer === null) return [];
    let out = this.historyRing.filter((h) => h.workspaceId === viewer);
    if (filter?.connectorId) out = out.filter((h) => h.connectorId === filter.connectorId);
    if (filter?.accountId) out = out.filter((h) => h.accountId === filter.accountId);
    const reversed = out.reverse().map(lifecycleToWire);
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
