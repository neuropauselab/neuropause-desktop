import { useCallback, useEffect, useState } from 'react';
import type { CloudOrganizationSummary, Device } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Skeleton } from '@renderer/components/ui/Skeleton';

/**
 * Trusted Devices (V6.5). Registers THIS device on mount (identity assembled
 * main-side) and lists the org's devices. Sources the org directly via
 * ipc.org.list — Settings isn't under CloudOrgProvider. Reuses the license/org
 * infrastructure; no device logic is duplicated in the renderer.
 */

const OS_LABEL: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const secs = Math.round((Date.now() - t) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

export function TrustedDevices(): JSX.Element {
  const [org, setOrg] = useState<CloudOrganizationSummary | null>(null);
  const [orgLoaded, setOrgLoaded] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const orgs = await ipc.org.list().catch(() => [] as CloudOrganizationSummary[]);
      const active = orgs?.[0] ?? null;
      setOrg(active);
      setOrgLoaded(true);
      if (!active) return;

      // Register this device first (idempotent upsert), then list.
      try {
        const { device } = await ipc.devices.registerCurrent(active.orgId);
        setCurrentId(device.deviceId);
      } catch {
        // Registration failure shouldn't block showing the list.
      }
      const list = await ipc.devices.list(active.orgId);
      setDevices(list ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (deviceId: string): Promise<void> => {
    if (!org) return;
    try {
      await ipc.devices.revoke(org.orgId, deviceId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke device');
    }
  };

  if (loading) {
    return <Skeleton className="h-28 w-full rounded-2xl" />;
  }

  if (orgLoaded && !org) {
    return (
      <p className="text-xs text-white/50">
        Devices appear here once your account has an organization.
      </p>
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

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)]">
      {devices.length === 0 ? (
        <p className="p-4 text-xs text-white/50">No devices registered yet.</p>
      ) : (
        devices.map((d, i) => {
          const isCurrent = d.deviceId === currentId;
          return (
            <div
              key={d.deviceId}
              className={cn(
                'flex items-center gap-3 p-3.5',
                i > 0 && 'border-t border-white/5',
                d.trustStatus === 'revoked' && 'opacity-50',
              )}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <Icon name={d.os === 'darwin' ? 'command' : 'globe'} size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-ink">{d.name}</span>
                  {isCurrent && (
                    <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-ink">
                      This device
                    </span>
                  )}
                  {d.trustStatus === 'revoked' && (
                    <span className="shrink-0 text-[10px] text-white/50">Revoked</span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-white/45">
                  {OS_LABEL[d.os] ?? d.os} · {d.arch} · v{d.appVersion} · seen{' '}
                  {relativeTime(d.lastSeen)}
                </div>
              </div>
              {!isCurrent && d.trustStatus !== 'revoked' && (
                <button
                  type="button"
                  onClick={() => void revoke(d.deviceId)}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] text-white/50 hover:bg-white/10 hover:text-white"
                  title="Revoke this device"
                >
                  Revoke
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
