/**
 * Phase 6 Stage 2 — Mission Control host (the live binding).
 *
 * This is the component the shell mounts for the `mission-control` section. It
 * implements the seam the provider always documented: assemble the snapshot
 * from the LIVE Enterprise Runtime over the existing IPC bridge, and hand it to
 * the pure provider + view.
 *
 * Failure-isolation contract (Stage 2 constraint):
 *   - every feed source runs INDEPENDENTLY — sources are never awaited together,
 *     so one slow/failed IPC call cannot delay or blank another tile;
 *   - a failed source marks ONLY its tile `unavailable(reason)`;
 *   - live events (connector sync/lifecycle, platform events, app runtime)
 *     re-run only the affected source, debounced;
 *   - all subscriptions and timers are torn down on unmount.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { useDashboard } from '@renderer/state/DashboardProvider';
import { useShell } from '@renderer/state/ShellProvider';
import type { SectionId } from '../shell/sections';
import { EMPTY_SNAPSHOT, MissionControlProvider } from './MissionControlProvider';
import { MissionControlView, type MissionControlNotificationsStore } from './MissionControlView';
import type { MissionControlSnapshot } from './missionControlModel';
import {
  EMPTY_EXTRAS,
  FEED_TILE_KEYS,
  emptyAvailability,
  runFeedSource,
  type FeedAvailability,
  type FeedIo,
  type FeedTileKey,
  type MissionControlExtras,
} from './missionControlFeed';

const REFRESH_INTERVAL_MS = 60_000;

/** Bind the pure feed's I/O ports to the real IPC client. */
function buildIo(): FeedIo {
  return {
    timelineQuery: (limit) => ipc.timeline.query({ limit, order: 'desc' }),
    timelineStats: () => ipc.timeline.stats(),
    executeSessions: () => ipc.execute.sessions(),
    automationMonitor: () => ipc.automations.monitor(),
    automationList: () => ipc.automations.list(),
    runtimeList: () => ipc.runtime.list(),
    connectorsList: () => ipc.connectors.list(),
    workspaceContextsList: () => ipc.workspaceContexts.list(),
    unifiedRecentFiles: (limit) =>
      ipc.unified.query({ kinds: ['file', 'document', 'attachment'], sortBy: 'updatedAt', order: 'desc', limit }),
    systemHealth: () => ipc.system.health(),
    enterpriseOrg: () => ipc.enterprise.org(),
    enterpriseWorkspaces: () => ipc.enterprise.workspaces(),
    enterpriseDashboard: () => ipc.enterprise.dashboard(),
    workforceWorkers: () => ipc.workforce.workers(),
  };
}

export function MissionControlHost({ onNavigate }: { onNavigate?: (section: SectionId) => void }): JSX.Element {
  const { openCommand } = useShell();
  const dashboard = useDashboard();

  const [snapshot, setSnapshot] = useState<MissionControlSnapshot>(EMPTY_SNAPSHOT);
  const [extras, setExtras] = useState<MissionControlExtras>(EMPTY_EXTRAS);
  const [availability, setAvailability] = useState<FeedAvailability>(emptyAvailability);
  const alive = useRef(true);
  const io = useMemo(buildIo, []);

  /** Run ONE source and merge its result — never throws, never touches other tiles. */
  const runTile = useCallback(
    (key: FeedTileKey): void => {
      // While refreshing, a tile that already has live data keeps showing it;
      // a tile that never loaded (or failed) returns to its skeleton.
      setAvailability((prev) => (prev[key].state === 'ready' ? prev : { ...prev, [key]: { state: 'loading' } }));
      void runFeedSource(io, key).then((res) => {
        if (!alive.current) return;
        if (res.ok && res.patch) {
          const { snapshot: snapPatch, extras: extrasPatch } = res.patch;
          if (snapPatch) setSnapshot((prev) => ({ ...prev, ...snapPatch }));
          if (extrasPatch) setExtras((prev) => ({ ...prev, ...extrasPatch }));
          setAvailability((prev) => ({
            ...prev,
            [key]: { state: 'ready', at: Date.now(), ...(res.note ? { note: res.note } : {}) },
          }));
        } else {
          setAvailability((prev) => ({
            ...prev,
            [key]: { state: 'unavailable', reason: res.reason ?? 'unavailable' },
          }));
        }
      });
    },
    [io],
  );

  const refreshAll = useCallback((): void => {
    for (const key of FEED_TILE_KEYS) runTile(key);
  }, [runTile]);

  // Initial load + periodic refresh. Each tile still settles independently.
  useEffect(() => {
    alive.current = true;
    refreshAll();
    const timer = setInterval(refreshAll, REFRESH_INTERVAL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refreshAll]);

  // Live events re-run only the affected source, debounced.
  useEffect(() => {
    const debounced = (key: FeedTileKey, ms: number): { fire: () => void; clear: () => void } => {
      let handle: ReturnType<typeof setTimeout> | null = null;
      return {
        fire: () => {
          if (handle) clearTimeout(handle);
          handle = setTimeout(() => runTile(key), ms);
        },
        clear: () => {
          if (handle) clearTimeout(handle);
        },
      };
    };
    const connectors = debounced('connectors', 1_000);
    const activity = debounced('activity', 2_000);
    const running = debounced('running', 1_000);
    const offs = [
      ipc.connectors.onSyncState(() => connectors.fire()),
      ipc.connectors.onLifecycle(() => connectors.fire()),
      ipc.platform.onEvent(() => activity.fire()),
      ipc.runtime.onEvent(() => running.fire()),
    ];
    return () => {
      for (const off of offs) off();
      connectors.clear();
      activity.clear();
      running.clear();
    };
  }, [runTile]);

  const notificationsStore: MissionControlNotificationsStore = {
    items: dashboard.data?.notifications ?? [],
    unreadCount: dashboard.unreadCount,
    loading: dashboard.loading,
    error: dashboard.error,
    markRead: dashboard.markNotificationRead,
    markAllRead: dashboard.markAllNotificationsRead,
  };

  return (
    <MissionControlProvider snapshot={snapshot} meta={{ availability, extras, refresh: refreshAll }}>
      <MissionControlView
        {...(onNavigate ? { onNavigate } : {})}
        onOpenPalette={openCommand}
        notificationsStore={notificationsStore}
      />
    </MissionControlProvider>
  );
}
