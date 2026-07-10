/**
 * UX infrastructure core — the DETERMINISTIC model behind the Enterprise Toast system and the global
 * Connection-status indicator. Pure (no I/O, no clock read): the renderer providers own the side effects
 * (timers, IPC pings, navigator events) and call these functions to compute the next state, and the tests
 * exercise the exact same logic. This adds no framework — it is the small, testable heart the renderer-only
 * providers build on.
 */

/* ── toast queue ─────────────────────────────────────────────────────────────────── */

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error';

/** The serializable model of one toast (the live renderer type extends this with an action callback). */
export interface ToastModel {
  id: string;
  severity: ToastSeverity;
  title: string;
  message?: string;
  /** Auto-dismiss after this many ms; 0 = persistent (must be dismissed or actioned). */
  durationMs: number;
  /** When set, a newer toast with the same key REPLACES the existing one (no stacking of dupes). */
  dedupeKey?: string;
  /** Label for the toast's action button (e.g. "Undo", "Retry"); the callback lives in the provider. */
  actionLabel?: string;
  createdAt: number;
}

/** Max simultaneously-visible toasts. Excess are dropped oldest-first, preferring to keep errors. */
export const TOAST_CAP = 5;

/** Default auto-dismiss per severity. Errors are persistent (0) so they are never silently lost. */
export const TOAST_DURATIONS: Record<ToastSeverity, number> = { success: 4000, info: 4500, warning: 6000, error: 0 };
export function defaultToastDuration(severity: ToastSeverity): number {
  return TOAST_DURATIONS[severity];
}

/** Drop oldest toasts beyond the cap, keeping persistent errors when possible. Newest-first list. */
function capToasts<T extends ToastModel>(list: T[], cap: number): T[] {
  if (list.length <= cap) return list;
  const out = [...list];
  while (out.length > cap) {
    let idx = -1;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (out[i].severity !== 'error') { idx = i; break; }
    }
    if (idx === -1) idx = out.length - 1; // all errors → drop the oldest
    out.splice(idx, 1);
  }
  return out;
}

/** Enqueue a toast (newest-first). A matching `dedupeKey` replaces in place; otherwise prepend + cap. Pure. */
export function enqueueToast<T extends ToastModel>(list: T[], toast: T, cap: number = TOAST_CAP): T[] {
  const next =
    toast.dedupeKey && list.some((t) => t.dedupeKey === toast.dedupeKey)
      ? list.map((t) => (t.dedupeKey === toast.dedupeKey ? toast : t))
      : [toast, ...list];
  return capToasts(next, cap);
}

export function dismissToast<T extends ToastModel>(list: T[], id: string): T[] {
  return list.filter((t) => t.id !== id);
}
export function dismissAllToasts<T extends ToastModel>(_list: T[]): T[] {
  return [];
}

/* ── connection status ───────────────────────────────────────────────────────────── */

export type ConnectionState = 'online' | 'slow' | 'degraded' | 'offline' | 'connecting';
export type ConnectionTone = 'green' | 'orange' | 'red' | 'gray';

/** The (real) live-sync fields the classifier reads — from `ipc.cloud.liveSyncStatus()`. */
export interface ConnectionSyncInfo {
  state: string; // idle | syncing | offline | error
  online: boolean;
  pendingCount: number;
}

export interface ConnectionInput {
  /** navigator.onLine — the OS network axis. */
  networkOnline: boolean;
  /** Did the last IPC heartbeat resolve? null = not probed yet (initial). */
  backendReachable: boolean | null;
  /** Measured IPC round-trip latency (ms) of the last heartbeat, or null. */
  latencyMs: number | null;
  sync?: ConnectionSyncInfo | null;
}

export interface ConnectionAssessment {
  state: ConnectionState;
  label: string;
  detail: string;
  tone: ConnectionTone;
  latencyMs: number | null;
  pending: number;
  syncing: boolean;
}

/** Latency (ms) at/above which the app backend is "slow". */
export const CONNECTION_SLOW_MS = 250;
/** Latency (ms) at/above which the app backend is "very slow" (degraded). */
export const CONNECTION_DEGRADED_MS = 1000;
/** How long a heartbeat ping may take before it counts as unreachable. */
export const CONNECTION_PING_TIMEOUT_MS = 3000;

/** Classify the connection from real runtime signals. Pure + deterministic. */
export function classifyConnection(input: ConnectionInput): ConnectionAssessment {
  const pending = Math.max(0, input.sync?.pendingCount ?? 0);
  const syncing = input.sync?.state === 'syncing';
  const base = { latencyMs: input.latencyMs, pending, syncing };
  const ms = (n: number): string => `${Math.round(n)}ms`;

  if (input.backendReachable === null) {
    return { state: 'connecting', label: 'Connecting…', detail: 'Establishing a connection to the app backend.', tone: 'gray', ...base };
  }
  if (!input.networkOnline) {
    return { state: 'offline', label: 'Offline', detail: 'No network connection. Working from local data — changes sync when you reconnect.', tone: 'red', ...base };
  }
  if (input.backendReachable === false) {
    return { state: 'degraded', label: 'Backend unreachable', detail: 'The app backend is not responding to heartbeats. Retrying…', tone: 'red', ...base };
  }
  if (input.sync?.state === 'error') {
    return { state: 'degraded', label: 'Sync error', detail: `Sync failed${pending > 0 ? ` · ${pending} change(s) pending` : ''}.`, tone: 'orange', ...base };
  }
  if (input.latencyMs !== null && input.latencyMs >= CONNECTION_DEGRADED_MS) {
    return { state: 'degraded', label: 'Very slow', detail: `The app backend is responding very slowly (${ms(input.latencyMs)}).`, tone: 'red', ...base };
  }
  if (input.latencyMs !== null && input.latencyMs >= CONNECTION_SLOW_MS) {
    return { state: 'slow', label: 'Slow', detail: `Elevated backend latency (${ms(input.latencyMs)}).`, tone: 'orange', ...base };
  }
  const detail =
    pending > 0 ? `Connected · ${pending} change(s) pending sync.`
      : syncing ? 'Connected · syncing…'
        : input.latencyMs !== null ? `Connected · ${ms(input.latencyMs)}.`
          : 'Connected.';
  return { state: 'online', label: 'Connected', detail, tone: 'green', ...base };
}
