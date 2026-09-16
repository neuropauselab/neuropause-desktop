import { useCallback, useEffect, useState } from 'react';
import type {
  LiveSyncStatus,
  SystemHealthLevel,
  SystemHealthSnapshot,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { fetchActiveCloudOrg, AMBIGUOUS_ORG_MESSAGE } from '@renderer/lib/activeOrg';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Skeleton } from '@renderer/components/ui/Skeleton';

/**
 * Enterprise Overview (V6.6 Module 8). Self-contained commercial/cloud widgets
 * that READ existing data — device registry (V6.5), the livesync engine status,
 * and the NeuroCore health snapshot (incl. the V6.6 cloud-sync subsystem). No new
 * IPC, no backend, and no edits to the Executive Center internals; it reuses what
 * already exists. Drop it into the Executive Center view (or Settings).
 */

const SYNC_LABEL: Record<LiveSyncStatus['state'], string> = {
  idle: 'Up to date',
  syncing: 'Syncing…',
  offline: 'Offline',
  error: 'Retrying',
};

const LEVEL_LABEL: Record<SystemHealthLevel, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  critical: 'Critical',
  offline: 'Offline',
  unknown: 'Unknown',
};

function levelTone(level: SystemHealthLevel | null): string {
  if (level === 'critical') return 'text-white';
  if (level === 'degraded' || level === 'offline') return 'text-white/80';
  return 'text-ink';
}

interface Widget {
  icon: IconName;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}

export function EnterpriseOverview(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const [sync, setSync] = useState<LiveSyncStatus | null>(null);
  const [cloudLevel, setCloudLevel] = useState<SystemHealthLevel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Round 36 — Gate 15: the FINDING-6 `orgs[0]` guess is gone (shared
      // resolver), and a failed org/device read throws into the error state
      // instead of rendering "0 devices" as a real figure. The sync/health
      // probes keep their null-degradation — null renders as unknown, which
      // is honest, and both self-heal on the next poll.
      const { orgs, active } = await fetchActiveCloudOrg();
      if (active === null && orgs.length > 0) throw new Error(AMBIGUOUS_ORG_MESSAGE);

      const [devices, syncStatus, health] = await Promise.all([
        active ? ipc.devices.list(active.orgId) : Promise.resolve([]),
        ipc.cloud.liveSyncStatus().catch(() => null as LiveSyncStatus | null),
        ipc.system.health().catch(() => null as SystemHealthSnapshot | null),
      ]);

      setDeviceCount(devices.length);
      setSync(syncStatus);
      // Prefer the dedicated cloud-sync subsystem level (V6.6); fall back to overall.
      const syncSub = health?.subsystems?.find((s) => s.id === 'sync');
      setCloudLevel(syncSub?.level ?? health?.level ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <p className="mb-2 text-xs text-white/70">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-ink hover:bg-white/15"
        >
          Retry
        </button>
      </div>
    );
  }

  const widgets: Widget[] = [
    {
      icon: 'command',
      label: 'Registered devices',
      value: deviceCount === null ? '—' : String(deviceCount),
      sub: 'trusted this org',
    },
    {
      icon: 'refresh',
      label: 'Sync status',
      value: sync ? SYNC_LABEL[sync.state] : '—',
      sub: sync ? (sync.online ? 'online' : 'offline') : undefined,
      tone: sync && (sync.state === 'error' || !sync.online) ? 'text-white/80' : 'text-ink',
    },
    {
      icon: 'clock',
      label: 'Pending sync',
      value: sync ? String(sync.pendingCount) : '—',
      sub: sync?.failures ? `${sync.failures} retrying` : 'changes queued',
    },
    {
      icon: 'shield',
      label: 'Cloud health',
      value: cloudLevel ? LEVEL_LABEL[cloudLevel] : '—',
      tone: levelTone(cloudLevel),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {widgets.map((w) => (
        <div
          key={w.label}
          className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-3.5"
        >
          <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
            <Icon name={w.icon} size={15} />
          </div>
          <div className={cn('text-lg font-semibold', w.tone ?? 'text-ink')}>{w.value}</div>
          <div className="mt-0.5 text-[11px] text-white/45">{w.label}</div>
          {w.sub && <div className="text-[10px] text-white/30">{w.sub}</div>}
        </div>
      ))}
    </div>
  );
}
