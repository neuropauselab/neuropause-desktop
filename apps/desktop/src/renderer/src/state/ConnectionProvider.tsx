/**
 * Global connection status — driven entirely by REAL runtime state, no simulation. It measures:
 *   • OS network via `navigator.onLine` + window online/offline events,
 *   • app-backend reachability + latency by timing a cheap, side-effect-free IPC round-trip
 *     (`ipc.app.getInfo()`) against a real timeout, and
 *   • live-sync state (online / pending / paused / error) from the real engine `ipc.cloud.liveSyncStatus()`,
 *     refreshed on the `cloud:event` broadcast.
 * The deterministic `classifyConnection` (shared) turns those signals into a single assessment, and real
 * transitions raise real toasts (offline / degraded / slow / back-online). Reconnect re-pings immediately;
 * pause/resume drive the real sync engine (`liveSyncSetOnline`), and pausing offers a real Undo.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { classifyConnection, CONNECTION_PING_TIMEOUT_MS, type ConnectionAssessment, type ConnectionSyncInfo } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { useToast } from './ToastProvider';

const PING_INTERVAL_MS = 7000;
const SYNC_INTERVAL_MS = 20000;

interface ConnectionContextValue {
  assessment: ConnectionAssessment;
  sync: ConnectionSyncInfo | null;
  syncPaused: boolean;
  reconnect: () => void;
  pauseSync: () => void;
  resumeSync: () => void;
  syncNow: () => void;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }): JSX.Element {
  const { success, warning, error, info } = useToast();
  const [networkOnline, setNetworkOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [sync, setSync] = useState<ConnectionSyncInfo | null>(null);
  const [syncPaused, setSyncPaused] = useState(false);

  const applySync = useCallback((s: { state: string; online: boolean; pendingCount: number }) => {
    setSync({ state: s.state, online: s.online, pendingCount: s.pendingCount });
    setSyncPaused(!s.online);
  }, []);

  // One heartbeat: time a cheap side-effect-free IPC round-trip against a real timeout.
  const pingOnce = useCallback(async () => {
    const t0 = performance.now();
    try {
      await Promise.race([
        ipc.app.getInfo(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('ping timeout')), CONNECTION_PING_TIMEOUT_MS)),
      ]);
      setBackendReachable(true);
      setLatencyMs(Math.max(0, Math.round(performance.now() - t0)));
    } catch {
      setBackendReachable(false);
      setLatencyMs(null);
    }
  }, []);

  const refreshSync = useCallback(async () => {
    try {
      applySync(await ipc.cloud.liveSyncStatus());
    } catch {
      setSync(null);
    }
  }, [applySync]);

  // OS network axis.
  useEffect(() => {
    const on = (): void => setNetworkOnline(true);
    const off = (): void => setNetworkOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Heartbeat loop.
  useEffect(() => {
    let alive = true;
    void pingOnce();
    const id = setInterval(() => { if (alive) void pingOnce(); }, PING_INTERVAL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [pingOnce]);

  // Sync state: poll + refresh on the cloud change broadcast.
  useEffect(() => {
    let alive = true;
    void refreshSync();
    const id = setInterval(() => { if (alive) void refreshSync(); }, SYNC_INTERVAL_MS);
    const off = ipc.cloud.onEvent((e) => { if (e.kind === 'sync' && alive) void refreshSync(); });
    return () => { alive = false; clearInterval(id); off(); };
  }, [refreshSync]);

  const assessment = useMemo(
    () => classifyConnection({ networkOnline, backendReachable, latencyMs, sync }),
    [networkOnline, backendReachable, latencyMs, sync],
  );

  // Real transitions → real toasts (deduped so a single connection toast is ever shown).
  const prevState = useRef<string | null>(null);
  const hadIssue = useRef(false);
  useEffect(() => {
    const state = assessment.state;
    if (state === 'connecting') return;
    const was = prevState.current;
    prevState.current = state;
    if (was === null || state === was) return; // skip the first resolved reading + no-change ticks
    if (state === 'offline') { hadIssue.current = true; error('You’re offline', { message: assessment.detail, dedupeKey: 'connection', actionLabel: 'Retry', onAction: () => void pingOnce() }); }
    else if (state === 'degraded') { hadIssue.current = true; warning('Connection degraded', { message: assessment.detail, durationMs: 0, dedupeKey: 'connection', actionLabel: 'Retry', onAction: () => void pingOnce() }); }
    else if (state === 'slow') { hadIssue.current = true; warning('Slow connection', { message: assessment.detail, dedupeKey: 'connection' }); }
    else if (state === 'online' && hadIssue.current) { hadIssue.current = false; success('Back online', { message: 'Connection restored.', dedupeKey: 'connection' }); }
  }, [assessment, error, warning, success, pingOnce]);

  const reconnect = useCallback(() => { void pingOnce(); void refreshSync(); }, [pingOnce, refreshSync]);

  /**
   * D-7b Site 2 — a refused sync action must SPEAK, and a pause must never claim
   * a success it did not have.
   *
   * `ipc.cloud.liveSyncSetOnline` / `liveSyncNow` REJECT on refusal: the
   * permission gate (`cloud:manage`) throws at the secure-bridge boundary, and a
   * dead or timed-out channel throws too. The old `.catch(() => undefined)`
   * swallowed every one — so a click did nothing and said nothing — and because
   * `pauseSync`'s "Sync paused" toast sat INSIDE `.then`, a failed pause produced
   * neither the toast nor an error.
   *
   * The boundary message is surfaced VERBATIM: the D-6 `invoke` wrapper has
   * already decoded the denial code and restored the clean text, so re-wording it
   * here would mean classifying a refusal by regex on English prose — the defect
   * D-6 exists to stop. An `error` toast announces (role="alert",
   * aria-live="assertive") and persists; no Retry is offered, because a denied
   * toggle would only be denied again. Each `try` is scoped to the awaited write
   * alone, so a success-path side-effect (a state set, a toast) can never raise a
   * false failure toast. Each action carries its own dedupe key, so a pause
   * failure and a resume failure never overwrite one another and neither clobbers
   * the 'connection' banner.
   */
  const reportSyncFailure = useCallback(
    (title: string, dedupeKey: string, err: unknown) =>
      error(title, {
        message: err instanceof Error && err.message ? err.message : 'The request failed.',
        dedupeKey,
      }),
    [error],
  );
  const resumeSync = useCallback(async () => {
    try {
      applySync(await ipc.cloud.liveSyncSetOnline(true));
    } catch (err) {
      reportSyncFailure('Couldn’t resume sync', 'sync-resume', err);
    }
  }, [applySync, reportSyncFailure]);
  const pauseSync = useCallback(async () => {
    let status: Awaited<ReturnType<typeof ipc.cloud.liveSyncSetOnline>>;
    try {
      status = await ipc.cloud.liveSyncSetOnline(false);
    } catch (err) {
      reportSyncFailure('Couldn’t pause sync', 'sync-pause', err);
      return;
    }
    applySync(status);
    // Announce "paused" ONLY when the engine reports egress actually stopped.
    // With no active org the toggle resolves EMPTY_SYNC_STATUS (online:true) — a
    // no-op, not a pause — so claiming "Sync paused" there would be a false
    // statement (the D-7b class: stop claiming a success you did not have).
    if (!status.online) {
      info('Sync paused', {
        message: 'Background sync is paused — changes stay local until you resume.',
        actionLabel: 'Undo',
        onAction: () => void resumeSync(),
      });
    }
  }, [applySync, info, resumeSync, reportSyncFailure]);
  const syncNow = useCallback(async () => {
    try {
      applySync(await ipc.cloud.liveSyncNow());
    } catch (err) {
      reportSyncFailure('Couldn’t sync now', 'sync-now', err);
    }
  }, [applySync, reportSyncFailure]);

  const value: ConnectionContextValue = { assessment, sync, syncPaused, reconnect, pauseSync, resumeSync, syncNow };
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used within ConnectionProvider');
  return ctx;
}
