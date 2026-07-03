import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { OpsPanel, StatusBadge } from './primitives';
import { formatBytes, type OpsTone } from './lib';

interface Probe {
  key: string;
  label: string;
  icon: IconName;
  description: string;
  run: () => Promise<string>;
}

interface ProbeResult {
  status: 'healthy' | 'degraded' | 'down' | 'checking';
  detail: string;
  ms: number | null;
}

/**
 * Health Center — live reachability of every public service the Operations
 * Center depends on. Each row is a real, timed IPC round-trip (not a mock):
 * green under 800 ms, amber when slow, red when the call fails.
 */
export function HealthPanel(): JSX.Element {
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [checking, setChecking] = useState(false);

  const probes: Probe[] = [
    { key: 'runtime', label: 'Runtime Supervisor', icon: 'cpu', description: 'Lifecycle & resource sampling', run: async () => `${(await ipc.runtime.list()).length} instances` },
    { key: 'registry', label: 'Local Registry', icon: 'package', description: 'Installed application records', run: async () => `${(await ipc.registry.stats()).totalInstalled} apps` },
    { key: 'nps', label: 'Package Service', icon: 'download', description: 'Install / update / verify pipeline', run: async () => `${(await ipc.nps.operations()).length} operations` },
    { key: 'plugins', label: 'Plugin Host', icon: 'puzzle', description: 'Sandboxed plugin runtime', run: async () => `${(await ipc.plugins.list()).length} plugins` },
    { key: 'backend', label: 'Store API · Database', icon: 'database', description: 'Backend, Postgres & cache path', run: async () => `${(await ipc.catalog.categories()).items.length} categories` },
  ];

  const runAll = useCallback(async () => {
    setChecking(true);
    setResults((prev) => {
      const next: Record<string, ProbeResult> = { ...prev };
      for (const p of probes) next[p.key] = { status: 'checking', detail: '', ms: null };
      return next;
    });
    await Promise.all(
      probes.map(async (p) => {
        const t0 = performance.now();
        try {
          const detail = await p.run();
          const ms = Math.round(performance.now() - t0);
          setResults((prev) => ({ ...prev, [p.key]: { status: ms < 800 ? 'healthy' : 'degraded', detail, ms } }));
        } catch (err) {
          setResults((prev) => ({ ...prev, [p.key]: { status: 'down', detail: (err as Error).message, ms: null } }));
        }
      }),
    );
    setChecking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void runAll();
  }, [runAll]);

  const anyOk = Object.values(results).some((r) => r.status === 'healthy' || r.status === 'degraded');
  const anyDown = Object.values(results).some((r) => r.status === 'down');

  // Derived rows: the IPC bridge is healthy if any probe answered; storage from registry stats.
  const [disk, setDisk] = useState<number | null>(null);
  useEffect(() => {
    void ipc.registry.stats().then((s) => setDisk(s.totalDiskBytes)).catch(() => undefined);
  }, []);

  const toneFor = (s: ProbeResult['status']): OpsTone =>
    s === 'healthy' ? 'green' : s === 'degraded' ? 'orange' : s === 'down' ? 'red' : 'gray';
  const labelFor = (s: ProbeResult['status']): string =>
    s === 'healthy' ? 'Healthy' : s === 'degraded' ? 'Slow' : s === 'down' ? 'Down' : 'Checking…';

  return (
    <OpsPanel
      title="Health Center"
      subtitle="Live reachability across NeuroPause services"
      actions={
        <Button size="sm" variant="secondary" icon="refresh" onClick={() => void runAll()} disabled={checking}>
          {checking ? 'Checking…' : 'Re-check'}
        </Button>
      }
    >
      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-[var(--hairline)] px-4 py-3 [background:var(--fill-1)]">
        <Icon name={anyDown ? 'info' : 'check'} size={18} className={anyDown ? 'text-syspink' : 'text-sysgreen'} />
        <span className="text-sm font-medium">
          {anyDown ? 'One or more services need attention' : anyOk ? 'All services responding' : 'Checking services…'}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
        {probes.map((p, idx) => {
          const r = results[p.key] ?? { status: 'checking' as const, detail: '', ms: null };
          return (
            <div
              key={p.key}
              className={`flex items-center gap-3 px-4 py-3 ${idx > 0 ? 'border-t border-[var(--hairline)]' : ''}`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg [background:var(--fill-2)] text-muted">
                <Icon name={p.icon} size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{p.label}</div>
                <div className="truncate text-2xs text-faint">{r.detail || p.description}</div>
              </div>
              {r.ms != null && <span className="tabular-nums text-2xs text-faint">{r.ms} ms</span>}
              <StatusBadge tone={toneFor(r.status)} label={labelFor(r.status)} />
            </div>
          );
        })}

        {/* Derived rows */}
        <div className="flex items-center gap-3 border-t border-[var(--hairline)] px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg [background:var(--fill-2)] text-muted">
            <Icon name="connectors" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Secure IPC Bridge</div>
            <div className="text-2xs text-faint">Context-isolated channel to the main process</div>
          </div>
          <StatusBadge tone={anyOk ? 'green' : 'gray'} label={anyOk ? 'Healthy' : 'Checking…'} />
        </div>
        <div className="flex items-center gap-3 border-t border-[var(--hairline)] px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg [background:var(--fill-2)] text-muted">
            <Icon name="server" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Disk &amp; Storage</div>
            <div className="text-2xs text-faint">Used by installed applications</div>
          </div>
          <span className="tabular-nums text-xs font-medium text-muted">{formatBytes(disk)}</span>
        </div>
      </div>
    </OpsPanel>
  );
}
