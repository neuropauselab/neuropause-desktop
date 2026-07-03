import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { useOperations } from './OperationsProvider';
import { OpsPanel, OpsTable, IconAction, StatusBadge } from './primitives';
import { adapterLabel, formatUptime, glyphFor, healthMeta, runtimeStatusMeta, toneFor } from './lib';
import type { OpsTab } from './OperationsView';

/**
 * Runtime Monitor — every runtime instance with live status, health, resource
 * usage, and lifecycle controls. Resource samples come from the runtime
 * supervisor; native child processes that don't expose metrics show "—".
 */
export function SessionsPanel({ onNavigate }: { onNavigate: (tab: OpsTab) => void }): JSX.Element {
  const { instances, runtimeLaunch, runtimeSuspend, runtimeResume, runtimeRestart, runtimeStop } = useOperations();

  return (
    <OpsPanel
      title="Running Sessions"
      subtitle={`${instances.filter((i) => i.status === 'running').length} running · ${instances.length} tracked`}
    >
      {instances.length === 0 ? (
        <div className="surface-raised rounded-2xl shadow-card">
          <EmptyState
            icon="play"
            title="No running sessions"
            description="Launch an app from Installed Applications or the AI Store to see it here."
          />
        </div>
      ) : (
        <OpsTable
          head={
            <>
              <th className="py-2.5 pl-4 pr-3 font-semibold">Application</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Health</th>
              <th className="px-3 py-2.5 font-semibold">CPU</th>
              <th className="px-3 py-2.5 font-semibold">Memory</th>
              <th className="px-3 py-2.5 font-semibold">Uptime</th>
              <th className="px-3 py-2.5 font-semibold">Restarts</th>
              <th className="py-2.5 pl-3 pr-4 text-right font-semibold">Actions</th>
            </>
          }
        >
          {instances.map((i) => {
            const status = runtimeStatusMeta(i.status);
            const health = healthMeta(i.health);
            const isRunning = i.status === 'running';
            const isSuspended = i.status === 'suspended';
            const isStopped = ['stopped', 'crashed', 'failed'].includes(i.status);
            return (
              <tr key={i.instanceId} className="border-t border-[var(--hairline)] align-middle">
                <td className="py-2.5 pl-4 pr-3">
                  <div className="flex items-center gap-2.5">
                    <AppGlyph glyph={glyphFor(i.appName)} tone={toneFor(i.appSlug)} size={30} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{i.appName}</div>
                      <div className="text-2xs text-faint">{adapterLabel(i.kind)}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge tone={status.tone} label={status.label} pulse={isRunning} />
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge tone={health.tone} label={health.label} />
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted">
                  {i.resource?.cpuPercent != null ? `${i.resource.cpuPercent.toFixed(0)}%` : '—'}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted">
                  {i.resource?.memoryMb != null ? `${i.resource.memoryMb.toFixed(0)} MB` : '—'}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted">{isRunning ? formatUptime(i.uptimeMs) : '—'}</td>
                <td className="px-3 py-2.5 tabular-nums text-muted">{i.restarts}</td>
                <td className="py-2 pl-3 pr-3">
                  <div className="flex items-center justify-end gap-0.5">
                    {isStopped && (
                      <IconAction icon="play" label="Launch" tone="green" onClick={() => void runtimeLaunch(i.appSlug, i.appName)} />
                    )}
                    {isRunning && (
                      <IconAction icon="pause" label="Suspend" onClick={() => void runtimeSuspend(i.instanceId, i.appName)} />
                    )}
                    {isSuspended && (
                      <IconAction icon="play" label="Resume" tone="green" onClick={() => void runtimeResume(i.instanceId, i.appName)} />
                    )}
                    {!isStopped && (
                      <IconAction icon="refresh" label="Restart" onClick={() => void runtimeRestart(i.instanceId, i.appName)} />
                    )}
                    {!isStopped && (
                      <IconAction icon="stop" label="Terminate" tone="red" onClick={() => void runtimeStop(i.instanceId, i.appName)} />
                    )}
                    <IconAction icon="list" label="Open logs" onClick={() => onNavigate('logs')} />
                    <IconAction icon="package" label="Registry entry" onClick={() => onNavigate('installed')} />
                  </div>
                </td>
              </tr>
            );
          })}
        </OpsTable>
      )}
      {instances.some((i) => i.lastError) && (
        <p className="mt-3 text-2xs text-faint">
          Tip: instances showing Crashed expose their last error in the Activity Log.
        </p>
      )}
    </OpsPanel>
  );
}
