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
  const resumeSync = useCallback(() => {
    void ipc.cloud.liveSyncSetOnline(true).then(applySync).catch(() => undefined);
  }, [applySync]);
  const pauseSync = useCallback(() => {
    void ipc.cloud
      .liveSyncSetOnline(false)
      .then((s) => {
        applySync(s);
        info('Sync paused', { message: 'Background sync is paused — changes stay local until you resume.', actionLabel: 'Undo', onAction: resumeSync });
      })
      .catch(() => undefined);
  }, [applySync, info, resumeSync]);
  const syncNow = useCallback(() => {
    void ipc.cloud.liveSyncNow().then(applySync).catch(() => undefined);
  }, [applySync]);

  const value: ConnectionContextValue = { assessment, sync, syncPaused, reconnect, pauseSync, resumeSync, syncNow };
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used within ConnectionProvider');
  return ctx;
}
