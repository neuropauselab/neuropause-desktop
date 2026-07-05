import { useEffect, useState } from 'react';
import type { SystemHealthLevel, SystemHealthSnapshot } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Card } from '@renderer/components/ui/Card';
import { TEXT_TONE, TINT_TONE, type OpsTone } from '@renderer/operations/lib';

function levelTone(level: SystemHealthLevel): OpsTone {
  switch (level) {
    case 'healthy':
      return 'green';
    case 'degraded':
      return 'orange';
    case 'critical':
      return 'red';
    case 'offline':
      return 'gray';
    default:
      return 'blue';
  }
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * NeuroCore Runtime Health panel (V5.0). Renders the composed system-health
 * snapshot — score, per-subsystem levels, throughput. Reuses ipc.system.health;
 * refreshes periodically (no polling storm — one lightweight call every 5s).
 */
export function RuntimeHealthPanel(): JSX.Element | null {
  const [health, setHealth] = useState<SystemHealthSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      ipc.system
        .health()
        .then((h) => {
          if (alive) setHealth(h);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!health) return null;

  const tone = levelTone(health.level);

  return (
    <Card variant="flat" flush className="mb-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-white/50">
            System health
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className={cn('text-2xl font-semibold', TEXT_TONE[tone])}>{health.score}</span>
            <span className="text-xs text-white/40">/ 100</span>
            <span
              className={cn(
                'ml-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase',
                TINT_TONE[tone],
                TEXT_TONE[tone],
              )}
            >
              {health.level}
            </span>
          </div>
        </div>
        <div className="text-right text-[11px] text-white/40">
          <div>Uptime {fmtUptime(health.uptimeMs)}</div>
          <div>
            CPU {health.telemetry.cpuPercent}% · RAM {health.telemetry.memoryUsedMb}MB
          </div>
          <div>
            {health.throughput.eventsPerMinute}/min ·{' '}
            {health.telemetry.backendLatencyMs !== null
              ? `${health.telemetry.backendLatencyMs}ms API`
              : 'API —'}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {health.subsystems.map((s) => {
          const st = levelTone(s.level);
          return (
            <div
              key={s.id}
              className="rounded-lg border border-white/5 [background:var(--fill-1)] p-2"
              title={s.detail ?? s.level}
            >
              <div className="flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', DOT[st])} aria-hidden="true" />
                <span className="truncate text-[11px] text-white/60">{s.label}</span>
              </div>
              <div className={cn('mt-0.5 text-xs font-medium capitalize', TEXT_TONE[st])}>
                {s.level}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const DOT: Record<OpsTone, string> = {
  green: 'bg-emerald-400',
  orange: 'bg-amber-400',
  red: 'bg-rose-400',
  blue: 'bg-sky-400',
  gray: 'bg-white/30',
  purple: 'bg-violet-400',
  accent: 'bg-sky-400',
};
