import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { formatCount, formatRelative } from '@renderer/lib/format';
import { OpsPanel, StatusBadge, StatusDot, Stat, OpsTable } from './primitives';
import { DOT_BG, TINT_TONE, TEXT_TONE, formatUptime, type OpsTone } from './lib';
import type { DiagnosticsReport, DiagnosticStatus } from '@neuropause/shared';

/** Map a diagnostic status onto the shared tone/label vocabulary. */
function diagTone(s: DiagnosticStatus): OpsTone {
  return s === 'ok' ? 'green' : s === 'degraded' ? 'orange' : s === 'down' ? 'red' : 'gray';
}
function diagLabel(s: DiagnosticStatus): string {
  return s === 'ok' ? 'Operational' : s === 'degraded' ? 'Degraded' : s === 'down' ? 'Down' : 'Unknown';
}

const CHECK_ICON: Record<string, IconName> = {
  'event-bus': 'sparkles',
  timeline: 'list',
  ipc: 'server',
  registry: 'package',
  'package-service': 'download',
  runtime: 'cpu',
  'plugin-host': 'puzzle',
  'background-services': 'refresh',
  backend: 'database',
};

interface HistoryPoint {
  at: string;
  overall: DiagnosticStatus;
}

const HISTORY_CAP = 48;
const POLL_MS = 4000;

/** Triggers a client-side file download for a text payload. */
function downloadText(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Diagnostics Center — the production health surface. Every figure here is a
 * real snapshot from the main process (`diagnostics:get`): the Event Bus and
 * Timeline metrics, plus live probes of IPC, the registry, the package service,
 * the runtime, the plugin host, background services, and the backend. It polls
 * while open, keeps a short health history, surfaces recovery recommendations,
 * and exports both the report and the full event log.
 */
export function DiagnosticsPanel(): JSX.Element {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  const load = useCallback(async () => {
    try {
      const r = await ipc.diagnostics.get();
      setReport(r);
      setError(null);
      setHistory((prev) => [...prev, { at: r.generatedAt, overall: r.overall }].slice(-HISTORY_CAP));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diagnostics');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (liveRef.current) void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const exportReport = (): void => {
    if (report) downloadText(`neuropause-diagnostics-${Date.now()}.json`, JSON.stringify(report, null, 2));
  };
  const exportLog = async (): Promise<void> => {
    setExporting(true);
    try {
      const ex = await ipc.timeline.export();
      downloadText(`neuropause-timeline-${Date.now()}.jsonl`, ex.data || '', 'application/x-ndjson');
    } catch {
      /* ignore — best effort */
    } finally {
      setExporting(false);
    }
  };

  if (!report) {
    return (
      <OpsPanel title="Diagnostics Center" subtitle="System health across the platform">
        <div className="rounded-2xl border border-[var(--hairline)] px-4 py-10 text-center text-sm text-faint [background:var(--fill-1)]">
          {error ? `Couldn't reach diagnostics: ${error}` : 'Gathering diagnostics…'}
        </div>
      </OpsPanel>
    );
  }

  const overallTone = diagTone(report.overall);
  const m = report.metrics;

  return (
    <OpsPanel
      title="Diagnostics Center"
      subtitle="Live system health, metrics, and recovery guidance"
      actions={
        <>
          <Button size="sm" variant="secondary" icon={live ? 'pause' : 'refresh'} onClick={() => setLive((v) => !v)}>
            {live ? 'Live' : 'Paused'}
          </Button>
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => void load()}>
            Refresh
          </Button>
          <Button size="sm" variant="secondary" icon="doc" onClick={exportReport}>
            Export
          </Button>
          <Button size="sm" variant="secondary" icon="download" onClick={() => void exportLog()} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Event log'}
          </Button>
        </>
      }
    >
      {/* Overall banner + health history */}
      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl p-5 shadow-card surface-raised">
        <span className={cn('flex h-12 w-12 items-center justify-center rounded-xl', TINT_TONE[overallTone])}>
          <Icon name={report.overall === 'ok' ? 'verified' : 'info'} size={22} />
        </span>
        <div className="min-w-[180px] flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{diagLabel(report.overall)}</h2>
            <StatusDot tone={overallTone} pulse={report.overall !== 'ok'} />
          </div>
          <p className="mt-0.5 text-xs text-faint">
            Uptime {formatUptime(report.uptimeMs)} · checked {formatRelative(report.generatedAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-end gap-[3px]" style={{ height: 32 }}>
            {history.map((h, i) => (
              <span
                key={`${h.at}-${i}`}
                title={`${diagLabel(h.overall)} · ${new Date(h.at).toLocaleTimeString()}`}
                className={cn('w-1.5 rounded-sm', DOT_BG[diagTone(h.overall)])}
                style={{ height: h.overall === 'ok' ? 10 : h.overall === 'degraded' ? 20 : h.overall === 'down' ? 32 : 6 }}
              />
            ))}
          </div>
          <span className="text-2xs text-faint">Health history</span>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon="sparkles" label="Events published" value={formatCount(m.eventsPublished)} tone="accent" />
        <Stat icon="pulse" label="Events / min" value={formatCount(m.eventsPerMinute)} tone="blue" />
        <Stat icon="connectors" label="Subscribers" value={m.subscribers} tone="purple" />
        <Stat icon="info" label="Dropped" value={m.droppedEvents} tone={m.droppedEvents > 0 ? 'red' : 'green'} />
        <Stat icon="clock" label="Avg dispatch" value={`${m.avgDispatchMs}ms`} tone="green" />
        <Stat icon="list" label="Timeline" value={formatCount(report.timeline.total)} tone="orange" />
      </div>

      {/* Checks */}
      <h3 className="mb-2 text-sm font-semibold text-muted">Service checks</h3>
      <div className="mb-6 space-y-2">
        {report.checks.map((c) => {
          const tone = diagTone(c.status);
          return (
            <div key={c.id} className="rounded-2xl border border-[var(--hairline)] p-3.5 [background:var(--fill-1)]">
              <div className="flex items-center gap-3">
                <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT_TONE[tone])}>
                  <Icon name={CHECK_ICON[c.id] ?? 'info'} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{c.label}</span>
                    {c.latencyMs !== null && <span className="text-2xs text-faint">{c.latencyMs}ms</span>}
                  </div>
                  {c.detail && <p className="truncate text-xs text-faint">{c.detail}</p>}
                </div>
                <StatusBadge tone={tone} label={diagLabel(c.status)} pulse={c.status === 'down'} />
              </div>
              {c.recommendation && c.status !== 'ok' && (
                <div className="mt-2.5 flex items-start gap-2 rounded-xl px-3 py-2 [background:var(--fill-2)]">
                  <Icon name="lightbulb" size={14} className={cn('mt-0.5 shrink-0', TEXT_TONE[tone])} />
                  <span className="text-xs text-muted">{c.recommendation}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Subscriber status */}
      <h3 className="mb-2 text-sm font-semibold text-muted">Subscriber status</h3>
      <OpsTable
        head={
          <>
            <th className="px-3 py-2">Subscriber</th>
            <th className="px-3 py-2 text-right">Events</th>
            <th className="px-3 py-2 text-right">Errors</th>
            <th className="px-3 py-2 text-right">Avg</th>
          </>
        }
      >
        {[...report.subscribers]
          .sort((a, b) => b.events - a.events)
          .map((s) => (
            <tr key={s.id} className="border-t border-[var(--hairline)]">
              <td className="px-3 py-2 font-medium text-ink">{s.id}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{formatCount(s.events)}</td>
              <td className={cn('px-3 py-2 text-right tabular-nums', s.errors > 0 ? 'text-syspink' : 'text-faint')}>{s.errors}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{s.avgMs}ms</td>
            </tr>
          ))}
      </OpsTable>
    </OpsPanel>
  );
}
