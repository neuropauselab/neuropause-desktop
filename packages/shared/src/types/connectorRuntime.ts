/**
 * Enterprise Connector Runtime v2 (P4.1) — the pure runtime state machine.
 *
 * This is the single source of truth for a connector account's *runtime* state. It is a
 * DERIVED PROJECTION over the signals the existing runtime already produces — the authoritative
 * `ConnectorStatus` (owned by ConnectorService), the sync-engine `ConnectorSyncSnapshot.status`,
 * the rate-limit window, the retry depth, and two operator control flags — plus the transient
 * states the Supervisor sets during install/update/removal. It does NOT replace `ConnectorStatus`;
 * `ConnectorStatus` stays the persisted account status. Nothing here is mutated or persisted:
 * `deriveRuntimeState` is a pure function of its input, the clock is injected, and `canTransitionRuntime`
 * is a static guard table. The Supervisor (Increment 2) consumes these; there is no wiring here.
 */
import type { ConnectorId, ConnectorLifecyclePhase, ConnectorLogEntry, ConnectorStatus, ConnectorSyncSnapshot } from './connectors';
import type { IntegrationHealth } from './integrationHealth';

/**
 * A connector account's runtime state — a 15-state machine reconciling the requested lifecycle
 * (Installing → Removed) with the real signals the platform emits today. Every value is reachable
 * and grounded in a concrete source signal (see `deriveRuntimeState`).
 */
export type ConnectorRuntimeState =
  | 'disconnected' // installed/available, no active session (status 'disconnected' | 'unavailable')
  | 'installing' // setup / connect kickoff in flight (transient, Supervisor-set)
  | 'authenticating' // OAuth in flight (status 'connecting')
  | 'reauth_required' // token invalid, user action needed (status 'reauth_required')
  | 'connected' // connected, no completed sync yet (fresh session)
  | 'idle' // connected, at rest, has synced before
  | 'syncing' // actively pulling (snapshot 'syncing')
  | 'retrying' // transient failure, retry pending (retryDepth > 0)
  | 'rate_limited' // throttled, cooling down (snapshot 'rate_limited' | rateLimitedUntil > now)
  | 'offline' // network unreachable (snapshot 'offline')
  | 'paused' // operator paused sync; account stays connected (control.paused)
  | 'error' // terminal / repeated failure (status 'error')
  | 'disabled' // connector switched off entirely (control.disabled)
  | 'updating' // manifest / version migration in progress (transient, Supervisor-set)
  | 'removing'; // account teardown in flight (transient, Supervisor-set)

/** Every runtime state, for exhaustive iteration (tests, UI enumeration). */
export const RUNTIME_STATES: readonly ConnectorRuntimeState[] = [
  'disconnected',
  'installing',
  'authenticating',
  'reauth_required',
  'connected',
  'idle',
  'syncing',
  'retrying',
  'rate_limited',
  'offline',
  'paused',
  'error',
  'disabled',
  'updating',
  'removing',
];

/** The transient states the Supervisor drives explicitly (they cannot be derived from status alone). */
export type ConnectorRuntimeTransient = 'installing' | 'updating' | 'removing';

/**
 * Operator control flags for a connector account. Additive, persisted alongside the account by the
 * Supervisor (Increment 2). `paused` stops sync while keeping the session; `disabled` switches the
 * whole connector off. These take precedence in the derivation (see `deriveRuntimeState`).
 */
export interface ConnectorControlState {
  /** Operator paused synchronization; the account remains connected. */
  paused: boolean;
  /** Operator disabled the connector entirely; overrides all other states. */
  disabled: boolean;
}

export const DEFAULT_CONTROL_STATE: ConnectorControlState = { paused: false, disabled: false };

/**
 * A single runtime transition — the `from → to` signal that today's `ConnectorEvent` does not carry.
 * Emitted by the Supervisor on every state change; streamed over the lifecycle broadcast and kept in a
 * bounded history ring for tracing.
 */
export interface ConnectorLifecycleEvent {
  connectorId: ConnectorId;
  accountId: string | null;
  /** The phase that drove the transition (reuses the existing phase vocabulary). */
  phase: ConnectorLifecyclePhase;
  from: ConnectorRuntimeState;
  to: ConnectorRuntimeState;
  /** Human-readable reason for the transition, if any. */
  reason: string | null;
  /** ISO timestamp. */
  at: string;
}

/** The signals `deriveRuntimeState` reads. All optional except `status` + `nowMs`; the clock is injected. */
export interface RuntimeStateInput {
  /** The authoritative account status owned by ConnectorService. */
  status: ConnectorStatus;
  /** The sync-engine snapshot status, if a snapshot exists for this account. */
  syncStatus?: ConnectorSyncSnapshot['status'] | null;
  /** Rate-limit window end (ISO), if the account is throttled. */
  rateLimitedUntil?: string | null;
  /** Pending retries for this account (from the retry queue / DLQ). */
  retryDepth?: number;
  /** Whether the account has ever completed a sync (lastSyncAt != null) — distinguishes fresh vs settled. */
  hasSyncedBefore?: boolean;
  /** Operator control flags. */
  control?: ConnectorControlState;
  /** A transient state the Supervisor is driving (install/update/remove); wins over derived-from-status. */
  transient?: ConnectorRuntimeTransient | null;
  /** Injected clock (epoch ms) for the rate-limit window comparison. */
  nowMs: number;
}

/**
 * Derive an account's runtime state deterministically from its signals. Pure. The precedence is fixed
 * and total (every input maps to exactly one state):
 *
 *   1. disabled flag                      → 'disabled'
 *   2. transient override                 → 'installing' | 'updating' | 'removing'
 *   3. status 'error'                     → 'error'
 *   4. status 'reauth_required'           → 'reauth_required'
 *   5. status 'connecting'                → 'authenticating'
 *   6. status 'disconnected'|'unavailable'→ 'disconnected'
 *   7. status 'connected':
 *        paused flag                      → 'paused'
 *        snapshot 'offline'               → 'offline'
 *        snapshot 'rate_limited' | window → 'rate_limited'
 *        retryDepth > 0                   → 'retrying'
 *        snapshot 'syncing'               → 'syncing'
 *        else                             → hasSyncedBefore ? 'idle' : 'connected'
 */
export function deriveRuntimeState(input: RuntimeStateInput): ConnectorRuntimeState {
  const control = input.control ?? DEFAULT_CONTROL_STATE;

  if (control.disabled) return 'disabled';
  if (input.transient) return input.transient;

  switch (input.status) {
    case 'error':
      return 'error';
    case 'reauth_required':
      return 'reauth_required';
    case 'connecting':
      return 'authenticating';
    case 'disconnected':
    case 'unavailable':
      return 'disconnected';
    case 'connected':
      break;
  }

  // status === 'connected' from here.
  if (control.paused) return 'paused';

  const sync = input.syncStatus ?? null;
  // Note: a bare sync 'error' (status still 'connected') intentionally does NOT move the runtime
  // state — a single transient sync failure is tracked by health + `consecutiveFailures`, not the
  // lifecycle. Repeated failures surface as 'retrying' (retryDepth) or, once the snapshot source is
  // wired, as 'error' via status. The terminal 'error' state is reserved for status === 'error'.
  if (sync === 'offline') return 'offline';

  const rateLimited = sync === 'rate_limited' || isWindowOpen(input.rateLimitedUntil, input.nowMs);
  if (rateLimited) return 'rate_limited';

  if ((input.retryDepth ?? 0) > 0) return 'retrying';
  if (sync === 'syncing') return 'syncing';

  return input.hasSyncedBefore ? 'idle' : 'connected';
}

function isWindowOpen(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t > nowMs;
}

/**
 * The legal transition graph, used to validate OPERATOR and TRANSIENT commands and to drive UI
 * affordances (which controls to offer from a given state). It is deliberately NOT applied to the
 * derived projection stream: an account can appear directly in many states after being absent (a
 * fresh connect seeds `disconnected` then jumps straight to `connected`, because the intermediate
 * `connecting` fires before the account row exists), so the projection is authoritative and permissive.
 * A no-op (`from === to`) is not a transition and returns false — mirroring the `canTransitionExecution`
 * convention in the sandbox core. `disconnected` therefore lists every state an account can first
 * surface in.
 */
const RUNTIME_TRANSITIONS: Record<ConnectorRuntimeState, readonly ConnectorRuntimeState[]> = {
  disconnected: ['installing', 'authenticating', 'connected', 'idle', 'reauth_required', 'error', 'disabled', 'removing'],
  installing: ['authenticating', 'connected', 'error', 'disconnected', 'disabled'],
  authenticating: ['connected', 'idle', 'reauth_required', 'error', 'disconnected', 'disabled'],
  reauth_required: ['authenticating', 'connected', 'idle', 'error', 'disconnected', 'disabled', 'removing'],
  connected: ['idle', 'syncing', 'paused', 'offline', 'rate_limited', 'error', 'reauth_required', 'disabled', 'removing', 'updating'],
  idle: ['syncing', 'retrying', 'rate_limited', 'offline', 'paused', 'connected', 'error', 'reauth_required', 'disabled', 'removing', 'updating'],
  syncing: ['idle', 'connected', 'retrying', 'rate_limited', 'offline', 'error', 'reauth_required', 'paused', 'disabled'],
  retrying: ['syncing', 'idle', 'rate_limited', 'offline', 'error', 'paused', 'disabled'],
  rate_limited: ['idle', 'syncing', 'retrying', 'offline', 'error', 'paused', 'disabled'],
  offline: ['idle', 'connected', 'syncing', 'retrying', 'rate_limited', 'error', 'paused', 'disabled'],
  paused: ['idle', 'connected', 'error', 'disabled', 'removing'],
  error: ['authenticating', 'idle', 'connected', 'retrying', 'reauth_required', 'disabled', 'removing'],
  disabled: ['disconnected', 'idle', 'connected', 'removing'],
  updating: ['idle', 'connected', 'error', 'disconnected', 'disabled'],
  removing: ['disconnected'],
};

/** Whether a runtime transition `from → to` is legal. `from === to` is not a transition (false). */
export function canTransitionRuntime(from: ConnectorRuntimeState, to: ConnectorRuntimeState): boolean {
  if (from === to) return false;
  return RUNTIME_TRANSITIONS[from].includes(to);
}

/** The legal next states from a given runtime state (defensive copy). */
export function runtimeTransitions(from: ConnectorRuntimeState): ConnectorRuntimeState[] {
  return [...RUNTIME_TRANSITIONS[from]];
}

/** A coarse severity for UI tone + diagnostics rollup. Monochrome-friendly (brightness, not hue). */
export type RuntimeSeverity = 'off' | 'idle' | 'active' | 'warn' | 'error';

interface RuntimeStateMeta {
  label: string;
  severity: RuntimeSeverity;
  /** True while the account is doing (or about to do) work. */
  active: boolean;
  /** True when the state needs operator attention. */
  fault: boolean;
}

const RUNTIME_STATE_META: Record<ConnectorRuntimeState, RuntimeStateMeta> = {
  disconnected: { label: 'Disconnected', severity: 'off', active: false, fault: false },
  installing: { label: 'Installing', severity: 'active', active: true, fault: false },
  authenticating: { label: 'Authenticating', severity: 'active', active: true, fault: false },
  reauth_required: { label: 'Reauth required', severity: 'warn', active: false, fault: true },
  connected: { label: 'Connected', severity: 'idle', active: false, fault: false },
  idle: { label: 'Idle', severity: 'idle', active: false, fault: false },
  syncing: { label: 'Syncing', severity: 'active', active: true, fault: false },
  retrying: { label: 'Retrying', severity: 'warn', active: true, fault: false },
  rate_limited: { label: 'Rate limited', severity: 'warn', active: false, fault: false },
  offline: { label: 'Offline', severity: 'warn', active: false, fault: true },
  paused: { label: 'Paused', severity: 'off', active: false, fault: false },
  error: { label: 'Error', severity: 'error', active: false, fault: true },
  disabled: { label: 'Disabled', severity: 'off', active: false, fault: false },
  updating: { label: 'Updating', severity: 'active', active: true, fault: false },
  removing: { label: 'Removing', severity: 'off', active: true, fault: false },
};

export function runtimeStateLabel(state: ConnectorRuntimeState): string {
  return RUNTIME_STATE_META[state].label;
}

export function runtimeStateSeverity(state: ConnectorRuntimeState): RuntimeSeverity {
  return RUNTIME_STATE_META[state].severity;
}

/** Whether the account is actively working (installing/authenticating/syncing/retrying/updating/removing). */
export function isActiveRuntimeState(state: ConnectorRuntimeState): boolean {
  return RUNTIME_STATE_META[state].active;
}

/** Whether the state needs operator attention (reauth_required/offline/error). */
export function isFaultRuntimeState(state: ConnectorRuntimeState): boolean {
  return RUNTIME_STATE_META[state].fault;
}

/**
 * Roll up a connector's per-account runtime states into a single connector-level state. `!configured`
 * → 'disconnected' (nothing to run); no accounts → 'disconnected' (installed, no session); otherwise the
 * most significant account state wins (faults and active work surface over resting states). Pure.
 */
export function aggregateRuntimeState(
  accountStates: readonly ConnectorRuntimeState[],
  opts: { configured: boolean },
): ConnectorRuntimeState {
  if (!opts.configured || accountStates.length === 0) return 'disconnected';
  return [...accountStates].sort((a, b) => AGGREGATE_RANK[b] - AGGREGATE_RANK[a])[0];
}

/** An operator control command over a connector or one of its accounts. */
export type ConnectorControlAction = 'pause' | 'resume' | 'disable' | 'enable';

/** Runtime view of a single account: its derived state + operator control flags. */
export interface ConnectorRuntimeAccountView {
  accountId: string;
  state: ConnectorRuntimeState;
  control: ConnectorControlState;
}

/** Runtime view of a connector: the aggregate state + per-account states + disabled flag. */
export interface ConnectorRuntimeView {
  connectorId: ConnectorId;
  /** Connector-level rollup of the account states (or 'disconnected' when none/unconfigured). */
  state: ConnectorRuntimeState;
  disabled: boolean;
  accounts: ConnectorRuntimeAccountView[];
}

/** P4.1 — a single account's deep inspection: runtime state + control + live sync snapshot + scored health. */
export interface ConnectorAccountInspection {
  accountId: string;
  state: ConnectorRuntimeState;
  control: ConnectorControlState;
  snapshot: ConnectorSyncSnapshot | null;
  health: IntegrationHealth;
}

/**
 * P4.1 — the Live Connector Inspector projection for one connector: its runtime view, per-account
 * inspection (state + snapshot + health), recent activity logs, and recent lifecycle transitions.
 * Composed from EXISTING sources (Supervisor + sync snapshots + the integration-health engine +
 * the connector log feed) — a read model, never a new store. Status/metrics only; no secrets.
 */
export interface ConnectorInspection {
  connectorId: ConnectorId;
  runtime: ConnectorRuntimeView;
  accounts: ConnectorAccountInspection[];
  logs: ConnectorLogEntry[];
  lifecycle: ConnectorLifecycleEvent[];
  generatedAt: string;
}

/** Higher rank = more significant when rolling up (error/reauth first, resting states last). */
const AGGREGATE_RANK: Record<ConnectorRuntimeState, number> = {
  error: 100,
  reauth_required: 95,
  offline: 90,
  disabled: 85,
  rate_limited: 80,
  retrying: 75,
  removing: 70,
  updating: 65,
  installing: 60,
  authenticating: 55,
  syncing: 50,
  paused: 40,
  connected: 30,
  idle: 20,
  disconnected: 10,
};
