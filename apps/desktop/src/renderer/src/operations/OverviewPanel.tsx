import { useMemo } from 'react';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { formatRelative } from '@renderer/lib/format';
import { useOperations } from './OperationsProvider';
import { OpsPanel, Stat, StatusBadge, StatusDot } from './primitives';
import { formatBytes, glyphFor, runtimeStatusMeta, toneFor } from './lib';
import type { OpsTab } from './OperationsView';

/** Runtime Overview: at-a-glance health of everything NeuroPause manages. */
export function OverviewPanel({ onNavigate }: { onNavigate: (tab: OpsTab) => void }): JSX.Element {
  const { instances, plugins, operations, registry, stats } = useOperations();

  const running = instances.filter((i) => i.status === 'running').length;
  const activeOps = operations.filter((o) => !['completed', 'failed', 'cancelled'].includes(o.status)).length;
  const enabledPlugins = plugins.filter((p) => p.state === 'enabled').length;
  const unhealthy = instances.filter((i) => i.health === 'unhealthy' || i.status === 'crashed').length;

  const overallTone = unhealthy > 0 ? 'red' : running > 0 ? 'green' : 'gray';
  const overallLabel = unhealthy > 0 ? `${unhealthy} need attention` : 'All systems nominal';

  const recentApps = useMemo(
    () =>
      [...registry]
        .sort((a, b) => (b.lastLaunchedAt ?? '').localeCompare(a.lastLaunchedAt ?? ''))
        .slice(0, 5),
    [registry],
  );

  return (
    <div>
      <OpsPanel title="Runtime Overview" subtitle="Everything installed, running, and managed by NeuroPause">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon="package" label="Installed apps" value={stats?.totalInstalled ?? registry.length} tone="blue" />
          <Stat icon="play" label="Running now" value={running} tone="green" />
          <Stat icon="puzzle" label="Active plugins" value={enabledPlugins} tone="purple" />
          <Stat icon="download" label="Active downloads" value={activeOps} tone="orange" />
        </div>
      </OpsPanel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <OpsPanel
          title="System health"
          subtitle="Live status across the runtime"
          actions={
            <button
              type="button"
              onClick={() => onNavigate('health')}
              className="text-xs font-medium text-accent hover:underline"
            >
              Open Health
            </button>
          }
        >
          <div className="surface-raised rounded-2xl p-4 shadow-card">
            <div className="flex items-center gap-2">
              <StatusDot tone={overallTone} pulse={overallTone === 'green'} />
              <span className="text-sm font-medium">{overallLabel}</span>
            </div>
            <dl className="mt-4 space-y-2.5 text-sm">
              <Row label="Disk used by apps" value={formatBytes(stats?.totalDiskBytes ?? 0)} />
              <Row label="Total launches" value={String(stats?.totalLaunches ?? 0)} />
              <Row label="Pinned" value={String(stats?.pinnedCount ?? 0)} />
              <Row label="Favorites" value={String(stats?.favoriteCount ?? 0)} />
            </dl>
          </div>
        </OpsPanel>

        <OpsPanel
          title="Recent activity"
          subtitle="Last launched applications"
          actions={
            <button
              type="button"
              onClick={() => onNavigate('installed')}
              className="text-xs font-medium text-accent hover:underline"
            >
              All apps
            </button>
          }
        >
          <div className="surface-raised rounded-2xl p-2 shadow-card">
            {recentApps.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-faint">No applications installed yet.</p>
            ) : (
              recentApps.map((app) => {
                const meta = runtimeStatusMeta(app.runtimeStatus);
                return (
                  <div key={app.slug} className="flex items-center gap-3 rounded-xl px-2 py-2 fill-hover">
                    <AppGlyph glyph={glyphFor(app.name)} tone={toneFor(app.slug)} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{app.name}</div>
                      <div className="text-2xs text-faint">
                        {app.lastLaunchedAt ? formatRelative(app.lastLaunchedAt) : 'Never launched'}
                      </div>
                    </div>
                    <StatusBadge tone={meta.tone} label={meta.label} />
                  </div>
                );
              })
            )}
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-faint">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
