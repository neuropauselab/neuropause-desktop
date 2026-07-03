import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  NpsOperationDto,
  NpsOperationKind,
  NpsOperationStatus,
  PluginDto,
  RegistryEntryDto,
  RegistryStats,
  RuntimeInstanceDto,
  RuntimePermissionKey,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { prefs, PrefKey } from '@renderer/lib/preferences';
import { useShell } from '@renderer/state/ShellProvider';
import type { OpsTone } from './lib';

const log = createLogger('operations');

const POLL_MS = 3000;
const LOG_CAP = 500;
const HISTORY_CAP = 100;

export type OpsLogSource = 'runtime' | 'plugin' | 'download' | 'permission' | 'registry' | 'system';

export interface OpsLogEntry {
  id: string;
  at: string;
  source: OpsLogSource;
  kind: string;
  title: string;
  detail: string | null;
  tone: OpsTone;
}

export interface DownloadRate {
  bytesPerSec: number;
  etaSeconds: number | null;
}

export interface DownloadHistoryEntry {
  id: string;
  appSlug: string;
  kind: NpsOperationKind;
  status: NpsOperationStatus;
  bytesTotal: number | null;
  at: string;
}

interface OperationsContextValue {
  instances: RuntimeInstanceDto[];
  plugins: PluginDto[];
  operations: NpsOperationDto[];
  registry: RegistryEntryDto[];
  stats: RegistryStats | null;
  logEntries: OpsLogEntry[];
  rates: Record<string, DownloadRate>;
  history: DownloadHistoryEntry[];
  ready: boolean;

  refreshAll: () => Promise<void>;
  refreshRuntime: () => Promise<void>;
  refreshRegistry: () => Promise<void>;
  refreshPlugins: () => Promise<void>;
  refreshOperations: () => Promise<void>;
  appendLog: (e: Omit<OpsLogEntry, 'id' | 'at'>) => void;
  clearDownloadHistory: () => void;

  // App / runtime actions.
  runtimeLaunch: (slug: string, name: string) => Promise<void>;
  runtimeSuspend: (instanceId: string, name: string) => Promise<void>;
  runtimeResume: (instanceId: string, name: string) => Promise<void>;
  runtimeRestart: (instanceId: string, name: string) => Promise<void>;
  runtimeStop: (instanceId: string, name: string) => Promise<void>;
  appUninstall: (slug: string, name: string) => Promise<void>;
  appVerify: (slug: string, name: string) => Promise<void>;
  appRepair: (slug: string, name: string) => Promise<void>;
  setFlags: (slug: string, flags: { pinned?: boolean; favorite?: boolean }) => Promise<void>;

  // Plugin actions.
  pluginEnable: (id: string, name: string) => Promise<void>;
  pluginDisable: (id: string, name: string) => Promise<void>;
  pluginReload: (id: string, name: string) => Promise<void>;
  pluginUpdate: (id: string, name: string) => Promise<void>;
  pluginRemove: (id: string, name: string) => Promise<void>;
  pluginGrant: (id: string, name: string, permission: RuntimePermissionKey) => Promise<void>;
  pluginRevoke: (id: string, name: string, permission: RuntimePermissionKey) => Promise<void>;

  // Download actions.
  dlPause: (id: string, slug: string) => Promise<void>;
  dlResume: (id: string, slug: string) => Promise<void>;
  dlCancel: (id: string, slug: string) => Promise<void>;
  dlRetry: (slug: string) => Promise<void>;
}

const OperationsContext = createContext<OperationsContextValue | null>(null);

let seq = 0;
const TERMINAL: NpsOperationStatus[] = ['completed', 'failed', 'cancelled'];

export function OperationsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { openApp } = useShell();
  const [instances, setInstances] = useState<RuntimeInstanceDto[]>([]);
  const [plugins, setPlugins] = useState<PluginDto[]>([]);
  const [operations, setOperations] = useState<NpsOperationDto[]>([]);
  const [registry, setRegistry] = useState<RegistryEntryDto[]>([]);
  const [stats, setStats] = useState<RegistryStats | null>(null);
  const [logEntries, setLog] = useState<OpsLogEntry[]>([]);
  const [rates, setRates] = useState<Record<string, DownloadRate>>({});
  const [history, setHistory] = useState<DownloadHistoryEntry[]>(() =>
    prefs.read<DownloadHistoryEntry[]>(PrefKey.downloadHistory, []),
  );
  const [ready, setReady] = useState(false);

  const opStatus = useRef<Map<string, string>>(new Map());
  const rateSamples = useRef<Map<string, { bytes: number; at: number }>>(new Map());

  const appendLog = useCallback((e: Omit<OpsLogEntry, 'id' | 'at'>) => {
    setLog((prev) => {
      const entry: OpsLogEntry = { ...e, id: `log_${Date.now().toString(36)}_${(seq++).toString(36)}`, at: new Date().toISOString() };
      const next = [entry, ...prev];
      return next.length > LOG_CAP ? next.slice(0, LOG_CAP) : next;
    });
  }, []);

  const clearDownloadHistory = useCallback(() => {
    setHistory([]);
    prefs.remove(PrefKey.downloadHistory);
  }, []);

  const refreshRuntime = useCallback(async () => {
    try {
      setInstances(await ipc.runtime.list());
    } catch (err) {
      log.warn('runtime.list failed', { message: (err as Error).message });
    }
  }, []);

  const refreshOperations = useCallback(async () => {
    try {
      setOperations(await ipc.nps.operations());
    } catch {
      /* package service may have no ops */
    }
  }, []);

  const refreshPlugins = useCallback(async () => {
    try {
      setPlugins(await ipc.plugins.list());
    } catch {
      /* no plugins */
    }
  }, []);

  const refreshRegistry = useCallback(async () => {
    try {
      const [entries, s] = await Promise.all([ipc.registry.list(), ipc.registry.stats()]);
      setRegistry(entries);
      setStats(s);
    } catch (err) {
      log.warn('registry refresh failed', { message: (err as Error).message });
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshRuntime(), refreshOperations(), refreshPlugins(), refreshRegistry()]);
    setReady(true);
  }, [refreshRuntime, refreshOperations, refreshPlugins, refreshRegistry]);

  // Initial load + live subscriptions + polling.
  useEffect(() => {
    void refreshAll();

    const offRuntime = ipc.runtime.onEvent((e) => {
      appendLog({
        source: 'runtime',
        kind: e.type,
        title: `${e.appSlug} · ${e.type}`,
        detail: e.message ?? e.status ?? null,
        tone: e.type === 'crash' ? 'red' : e.type === 'health' ? 'orange' : 'blue',
      });
      void refreshRuntime();
    });

    const offPlugin = ipc.plugins.onEvent((e) => {
      appendLog({
        source: 'plugin',
        kind: e.type,
        title: `${e.pluginId} · ${e.type}`,
        detail: e.message ?? e.status ?? null,
        tone: e.type === 'crash' ? 'red' : 'blue',
      });
      void refreshPlugins();
    });

    const offNps = ipc.nps.onProgress((e) => {
      // Live-patch the operation so progress animates between polls.
      setOperations((prev) => {
        const idx = prev.findIndex((o) => o.id === e.id);
        if (idx === -1) {
          void refreshOperations();
          return prev;
        }
        const next = prev.slice();
        next[idx] = { ...next[idx], status: e.status, progress: e.progress, bytesDownloaded: e.bytesDownloaded, bytesTotal: e.bytesTotal, message: e.message, updatedAt: new Date().toISOString() };
        return next;
      });

      // Derive transfer rate + ETA from bytes-over-time.
      if (e.bytesDownloaded != null) {
        const now = Date.now();
        const prev = rateSamples.current.get(e.id);
        if (prev && now > prev.at && e.bytesDownloaded > prev.bytes) {
          const bytesPerSec = ((e.bytesDownloaded - prev.bytes) * 1000) / (now - prev.at);
          const remaining = e.bytesTotal != null ? e.bytesTotal - e.bytesDownloaded : null;
          const etaSeconds = remaining != null && bytesPerSec > 0 ? remaining / bytesPerSec : null;
          setRates((r) => ({ ...r, [e.id]: { bytesPerSec, etaSeconds } }));
        }
        rateSamples.current.set(e.id, { bytes: e.bytesDownloaded, at: now });
      }

      // Log + persist history only on status transitions.
      if (opStatus.current.get(e.id) !== e.status) {
        opStatus.current.set(e.id, e.status);
        appendLog({
          source: 'download',
          kind: e.status,
          title: `${e.appSlug} · ${e.status}`,
          detail: e.message,
          tone: e.status === 'failed' ? 'red' : e.status === 'completed' ? 'green' : 'blue',
        });
        if (TERMINAL.includes(e.status)) {
          rateSamples.current.delete(e.id);
          setRates((r) => {
            const { [e.id]: _drop, ...rest } = r;
            return rest;
          });
          setHistory((prevH) => {
            const entry: DownloadHistoryEntry = { id: e.id, appSlug: e.appSlug, kind: 'install', status: e.status, bytesTotal: e.bytesTotal, at: new Date().toISOString() };
            const next = [entry, ...prevH.filter((h) => h.id !== e.id)].slice(0, HISTORY_CAP);
            prefs.write(PrefKey.downloadHistory, next);
            return next;
          });
          if (e.status === 'completed') void refreshRegistry();
        }
      }
    });

    const interval = window.setInterval(() => {
      void refreshRuntime();
      void refreshOperations();
    }, POLL_MS);

    return () => {
      offRuntime();
      offPlugin();
      offNps();
      window.clearInterval(interval);
    };
  }, [refreshAll, refreshRuntime, refreshOperations, refreshPlugins, refreshRegistry, appendLog]);

  /* ── runtime / app actions ── */

  const runtimeLaunch = useCallback(
    async (slug: string, name: string) => {
      try {
        await ipc.runtime.launch(slug);
        openApp(slug, name);
        appendLog({ source: 'runtime', kind: 'launch', title: `Launched ${name}`, detail: null, tone: 'green' });
      } catch (err) {
        appendLog({ source: 'runtime', kind: 'launch', title: `Launch failed: ${name}`, detail: (err as Error).message, tone: 'red' });
      }
      void refreshRuntime();
      void refreshRegistry();
    },
    [openApp, appendLog, refreshRuntime, refreshRegistry],
  );

  const wrap = useCallback(
    (source: OpsLogSource, kind: string, refresh: () => Promise<void>) =>
      async (fn: () => Promise<unknown>, name: string, ok: string, tone: OpsTone = 'blue'): Promise<void> => {
        try {
          await fn();
          appendLog({ source, kind, title: `${ok} ${name}`, detail: null, tone });
        } catch (err) {
          appendLog({ source, kind, title: `${kind} failed: ${name}`, detail: (err as Error).message, tone: 'red' });
        }
        void refresh();
      },
    [appendLog],
  );

  const runtimeSuspend = useCallback((id: string, name: string) => wrap('runtime', 'suspend', refreshRuntime)(() => ipc.runtime.suspend(id), name, 'Suspended'), [wrap, refreshRuntime]);
  const runtimeResume = useCallback((id: string, name: string) => wrap('runtime', 'resume', refreshRuntime)(() => ipc.runtime.resume(id), name, 'Resumed'), [wrap, refreshRuntime]);
  const runtimeRestart = useCallback((id: string, name: string) => wrap('runtime', 'restart', refreshRuntime)(() => ipc.runtime.restart(id), name, 'Restarted'), [wrap, refreshRuntime]);
  const runtimeStop = useCallback((id: string, name: string) => wrap('runtime', 'terminate', refreshRuntime)(() => ipc.runtime.stop(id), name, 'Terminated'), [wrap, refreshRuntime]);

  const appUninstall = useCallback(
    async (slug: string, name: string) => {
      try {
        const res = await ipc.nps.uninstall(slug);
        appendLog({ source: 'registry', kind: 'uninstall', title: res.ok ? `Uninstalled ${name}` : `Uninstall failed: ${name}`, detail: res.message, tone: res.ok ? 'orange' : 'red' });
      } catch (err) {
        appendLog({ source: 'registry', kind: 'uninstall', title: `Uninstall failed: ${name}`, detail: (err as Error).message, tone: 'red' });
      }
      void refreshRegistry();
      void refreshRuntime();
    },
    [appendLog, refreshRegistry, refreshRuntime],
  );

  const appVerify = useCallback(
    async (slug: string, name: string) => {
      try {
        const res = await ipc.nps.verify(slug);
        appendLog({ source: 'registry', kind: 'verify', title: res.ok ? `Verified ${name}` : `Verification failed: ${name}`, detail: res.reason, tone: res.ok ? 'green' : 'red' });
      } catch (err) {
        appendLog({ source: 'registry', kind: 'verify', title: `Verification failed: ${name}`, detail: (err as Error).message, tone: 'red' });
      }
    },
    [appendLog],
  );

  const appRepair = useCallback(
    async (slug: string, name: string) => {
      try {
        const res = await ipc.nps.repair(slug);
        appendLog({ source: 'registry', kind: 'repair', title: res.ok ? `Repaired ${name}` : `Repair failed: ${name}`, detail: res.message, tone: res.ok ? 'green' : 'red' });
      } catch (err) {
        appendLog({ source: 'registry', kind: 'repair', title: `Repair failed: ${name}`, detail: (err as Error).message, tone: 'red' });
      }
      void refreshRegistry();
    },
    [appendLog, refreshRegistry],
  );

  const setFlags = useCallback(
    async (slug: string, flags: { pinned?: boolean; favorite?: boolean }) => {
      try {
        await ipc.registry.setFlags(slug, flags);
      } catch (err) {
        log.warn('setFlags failed', { message: (err as Error).message });
      }
      void refreshRegistry();
    },
    [refreshRegistry],
  );

  /* ── plugin actions ── */

  const pluginEnable = useCallback((id: string, name: string) => wrap('plugin', 'enable', refreshPlugins)(() => ipc.plugins.enable(id), name, 'Enabled', 'green'), [wrap, refreshPlugins]);
  const pluginDisable = useCallback((id: string, name: string) => wrap('plugin', 'disable', refreshPlugins)(() => ipc.plugins.disable(id), name, 'Disabled', 'orange'), [wrap, refreshPlugins]);
  const pluginReload = useCallback((id: string, name: string) => wrap('plugin', 'reload', refreshPlugins)(() => ipc.plugins.reload(id), name, 'Reloaded'), [wrap, refreshPlugins]);
  const pluginRemove = useCallback((id: string, name: string) => wrap('plugin', 'uninstall', refreshPlugins)(() => ipc.plugins.remove(id), name, 'Uninstalled', 'orange'), [wrap, refreshPlugins]);
  const pluginGrant = useCallback((id: string, name: string, permission: RuntimePermissionKey) => wrap('permission', 'grant', refreshPlugins)(() => ipc.plugins.grant(id, permission), `${permission} → ${name}`, 'Granted', 'green'), [wrap, refreshPlugins]);
  const pluginRevoke = useCallback((id: string, name: string, permission: RuntimePermissionKey) => wrap('permission', 'revoke', refreshPlugins)(() => ipc.plugins.revoke(id, permission), `${permission} → ${name}`, 'Revoked', 'orange'), [wrap, refreshPlugins]);

  const pluginUpdate = useCallback(
    async (id: string, name: string) => {
      try {
        const res = await ipc.plugins.update(id);
        appendLog({ source: 'plugin', kind: 'update', title: res.ok ? `Updated ${name}` : `Update failed: ${name}`, detail: res.message, tone: res.ok ? 'green' : 'red' });
      } catch (err) {
        appendLog({ source: 'plugin', kind: 'update', title: `Update failed: ${name}`, detail: (err as Error).message, tone: 'red' });
      }
      void refreshPlugins();
    },
    [appendLog, refreshPlugins],
  );

  /* ── download actions ── */

  const dlPause = useCallback((id: string, slug: string) => wrap('download', 'pause', refreshOperations)(() => ipc.nps.pause(id), slug, 'Paused', 'orange'), [wrap, refreshOperations]);
  const dlResume = useCallback((id: string, slug: string) => wrap('download', 'resume', refreshOperations)(() => ipc.nps.resume(id), slug, 'Resumed'), [wrap, refreshOperations]);
  const dlCancel = useCallback((id: string, slug: string) => wrap('download', 'cancel', refreshOperations)(() => ipc.nps.cancel(id), slug, 'Cancelled', 'orange'), [wrap, refreshOperations]);
  const dlRetry = useCallback((slug: string) => wrap('download', 'retry', refreshOperations)(() => ipc.nps.install({ slug }), slug, 'Retrying'), [wrap, refreshOperations]);

  const value = useMemo<OperationsContextValue>(
    () => ({
      instances, plugins, operations, registry, stats, logEntries, rates, history, ready,
      refreshAll, refreshRuntime, refreshRegistry, refreshPlugins, refreshOperations, appendLog, clearDownloadHistory,
      runtimeLaunch, runtimeSuspend, runtimeResume, runtimeRestart, runtimeStop,
      appUninstall, appVerify, appRepair, setFlags,
      pluginEnable, pluginDisable, pluginReload, pluginUpdate, pluginRemove, pluginGrant, pluginRevoke,
      dlPause, dlResume, dlCancel, dlRetry,
    }),
    [
      instances, plugins, operations, registry, stats, logEntries, rates, history, ready,
      refreshAll, refreshRuntime, refreshRegistry, refreshPlugins, refreshOperations, appendLog, clearDownloadHistory,
      runtimeLaunch, runtimeSuspend, runtimeResume, runtimeRestart, runtimeStop,
      appUninstall, appVerify, appRepair, setFlags,
      pluginEnable, pluginDisable, pluginReload, pluginUpdate, pluginRemove, pluginGrant, pluginRevoke,
      dlPause, dlResume, dlCancel, dlRetry,
    ],
  );

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useOperations(): OperationsContextValue {
  const ctx = useContext(OperationsContext);
  if (!ctx) throw new Error('useOperations must be used within OperationsProvider');
  return ctx;
}
