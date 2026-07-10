/**
 * PerformanceOverlay — a developer-only runtime HUD. It is visible ONLY on development (unpackaged)
 * builds — gated on the REAL `AppInfo.isPackaged` signal carried in the perf snapshot's context, the
 * same build-type signal HomeScreen/Settings use (there is no persisted "developer mode" preference in
 * the app). Every figure is a real measurement from the shared perf snapshot (FPS, renderer heap, IPC
 * latency, pending async, slow renders), plus the P1.4 context (app version, release channel, enabled
 * feature flags). It is collapsible and never intercepts pointer events except on its own toggle.
 */
import { useState } from 'react';
import { formatBytesIEC, formatDurationMs } from '@neuropause/shared';
import { usePerformance } from '@renderer/state/usePerformance';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';

function fpsColor(fps: number): string {
  if (fps <= 0) return 'text-faint';
  if (fps >= 55) return 'text-sysgreen';
  if (fps >= 45) return 'text-sysorange';
  return 'text-syspink';
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-white/45">{label}</span>
      <span className={cn('tabular-nums font-medium', tone ?? 'text-white/85')}>{value}</span>
    </div>
  );
}

export function PerformanceOverlay(): JSX.Element | null {
  const perf = usePerformance();
  const [open, setOpen] = useState(true);

  // Developer-only: hidden on packaged builds. Context defaults to packaged=true until real info loads.
  if (perf.context.isPackaged) return null;

  const warnings = perf.recommendations.filter((r) => r.severity === 'warning').length;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[100]">
      <div className="glass-panel pointer-events-auto w-[236px] overflow-hidden rounded-xl shadow-glass">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle performance overlay"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Icon name="gauge" size={13} /> Performance
            {!perf.healthy && <span className="h-1.5 w-1.5 rounded-full bg-syspink" />}
          </span>
          <span className={cn('text-xs font-semibold tabular-nums', fpsColor(perf.fps.current))}>
            {perf.fps.current || '—'} fps
          </span>
        </button>
        {open && (
          <div className="space-y-1 border-t border-white/5 px-3 py-2 text-2xs">
            <Row
              label="FPS avg / min"
              value={`${perf.fps.average} / ${perf.fps.min}`}
              tone={fpsColor(perf.fps.current)}
            />
            <Row
              label="Renderer RAM"
              value={
                perf.memory.supported
                  ? `${formatBytesIEC(perf.memory.usedBytes)}${
                      perf.memory.usedPercent !== null ? ` · ${perf.memory.usedPercent}%` : ''
                    }`
                  : 'n/a'
              }
            />
            <Row
              label="IPC p95 / max"
              value={
                perf.ipc.count
                  ? `${formatDurationMs(perf.ipc.p95Ms)} / ${formatDurationMs(perf.ipc.maxMs)}`
                  : '—'
              }
            />
            <Row
              label="Pending async"
              value={String(perf.ipc.pending)}
              tone={perf.ipc.pending >= 8 ? 'text-sysorange' : undefined}
            />
            <Row
              label="Slow renders"
              value={String(perf.slowRenders.length)}
              tone={perf.slowRenders.length ? 'text-sysorange' : undefined}
            />
            <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-white/5 pt-1.5 text-white/40">
              <span className="truncate">
                v{perf.context.appVersion || '—'}
                {perf.context.releaseChannel ? ` · ${perf.context.releaseChannel}` : ''}
              </span>
              <span className="shrink-0">
                {perf.context.flagsEnabled}/{perf.context.flagsTotal} flags
              </span>
            </div>
            {warnings > 0 && (
              <div className="mt-1 flex items-center gap-1.5 text-syspink">
                <Icon name="info" size={11} /> {warnings} warning{warnings > 1 ? 's' : ''} — see
                Diagnostics
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
