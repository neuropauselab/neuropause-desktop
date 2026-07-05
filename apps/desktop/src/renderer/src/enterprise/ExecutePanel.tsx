import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ExecutionRequest,
  ExecutionSession,
  ExecutionState,
  ExecutionStats,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';

/**
 * Execute panel (V5.4) — the front-end of the unified Execute Engine. The task
 * input runs through the engine (kind: 'task'), and a live dashboard shows every
 * execution's session lifecycle, stats, and history. Rendered defensively so a
 * malformed session can never crash the Command Center.
 */
function fmtDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function stateDot(state: ExecutionState): string {
  switch (state) {
    case 'completed':
      return 'bg-white/70';
    case 'failed':
      return 'bg-white';
    case 'running':
    case 'waiting':
      return 'bg-white/80 animate-pulse';
    case 'cancelled':
      return 'bg-white/30';
    default:
      return 'bg-white/40';
  }
}

type ExecMode = 'task' | 'automation' | 'decision';

interface PickTarget {
  id: string;
  label: string;
  disabled?: boolean;
}

export function ExecutePanel(): JSX.Element {
  const [mode, setMode] = useState<ExecMode>('task');
  const [task, setTask] = useState('');
  const [targets, setTargets] = useState<PickTarget[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecutionSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ExecutionSession[]>([]);
  const [stats, setStats] = useState<ExecutionStats | null>(null);
  const [history, setHistory] = useState<ExecutionSession[]>([]);

  // Load selectable targets when switching to a target-based mode.
  useEffect(() => {
    let alive = true;
    if (mode === 'automation') {
      ipc.automations
        ?.list?.()
        .then((r) => {
          if (!alive) return;
          const list = (r?.rules ?? []).map((x) => ({
            id: x.id,
            label: x.name,
            disabled: x.status !== 'active',
          }));
          setTargets(list);
          setSelected(list.find((t) => !t.disabled)?.id ?? '');
        })
        .catch(() => setTargets([]));
    } else if (mode === 'decision') {
      ipc.decisions
        ?.list?.()
        .then((r) => {
          if (!alive) return;
          const list = (r?.decisions ?? []).map((d) => ({
            id: d.id,
            label: `${d.title ?? 'Decision'} · ${d.status}`,
          }));
          setTargets(list);
          setSelected(list[0]?.id ?? '');
        })
        .catch(() => setTargets([]));
    } else {
      setTargets([]);
      setSelected('');
    }
    return () => {
      alive = false;
    };
  }, [mode]);

  const refresh = useCallback(() => {
    ipc.execute
      ?.sessions?.()
      .then((s) => {
        setActive(s?.sessions ?? []);
        setStats(s?.stats ?? null);
      })
      .catch(() => {});
    ipc.execute
      ?.history?.()
      .then((h) => setHistory(h?.records ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [refresh]);

  const execute = async (): Promise<void> => {
    if (running) return;
    let req: ExecutionRequest | null = null;
    if (mode === 'task') {
      const text = task.trim();
      if (!text) return;
      req = { kind: 'task', input: text };
    } else if (mode === 'automation') {
      if (!selected) return;
      req = { kind: 'automation', targetId: selected };
    } else if (mode === 'decision') {
      if (!selected) return;
      req = { kind: 'decision', targetId: selected };
    }
    if (!req) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const session = await ipc.execute.run(req);
      setResult(session);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const canExecute = mode === 'task' ? task.trim().length > 0 : selected.length > 0;

  const statCells = useMemo(
    () =>
      stats
        ? [
            { label: 'Active', value: String(stats.active) },
            { label: 'Queued', value: String(stats.queued) },
            { label: 'Completed', value: String(stats.completed) },
            { label: 'Failed', value: String(stats.failed) },
            { label: 'Success', value: stats.successRate === null ? '—' : `${stats.successRate}%` },
            { label: 'Avg', value: fmtDuration(stats.averageRuntimeMs) },
          ]
        : [],
    [stats],
  );

  return (
    <section className="mb-5 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10">
          <Icon name="bolt" size={14} />
        </span>
        <h3 className="text-sm font-semibold text-ink">Execute</h3>
        <span className="text-xs text-faint">One pipeline for every execution.</span>
      </div>

      <div className="mb-2.5 inline-flex rounded-lg border border-[var(--hairline)] [background:var(--fill-2)] p-0.5">
        {(['task', 'automation', 'decision'] as ExecMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium capitalize transition',
              mode === m ? 'bg-white text-black' : 'text-white/50 hover:text-white',
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {mode === 'task' ? (
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void execute();
            }}
            placeholder="e.g. Summarize today's activity, draft the investor update, find open risks…"
            aria-label="Task to execute"
            disabled={running}
            className="min-w-0 flex-1 rounded-xl border border-[var(--hairline)] [background:var(--fill-2)] px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus-visible:shadow-focus disabled:opacity-60"
          />
        ) : (
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={running || targets.length === 0}
            aria-label={`Select ${mode} to run`}
            className="min-w-0 flex-1 rounded-xl border border-[var(--hairline)] [background:var(--fill-2)] px-3 py-2.5 text-sm text-ink outline-none focus-visible:shadow-focus disabled:opacity-60"
          >
            {targets.length === 0 ? (
              <option value="">No {mode}s available</option>
            ) : (
              targets.map((t) => (
                <option key={t.id} value={t.id} disabled={t.disabled}>
                  {t.label}
                  {t.disabled ? ' (inactive)' : ''}
                </option>
              ))
            )}
          </select>
        )}
        <button
          type="button"
          onClick={() => void execute()}
          disabled={running || !canExecute}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition',
            'bg-white text-black hover:opacity-90 disabled:opacity-40',
          )}
        >
          {running ? (
            <>
              <Icon name="refresh" size={14} className="animate-spin" /> Running…
            </>
          ) : (
            <>
              <Icon name="play" size={14} /> Execute
            </>
          )}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-white/10 bg-white/5 p-2.5 text-xs text-white/70">
          Couldn't run that: {error}
        </p>
      )}

      {result && (
        <div className="mt-3 rounded-xl border border-[var(--hairline)] [background:var(--fill-2)] p-3.5">
          <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-faint">
            <span className={cn('h-1.5 w-1.5 rounded-full', stateDot(result.state))} />
            <span>{result.state}</span>
            <span className="text-faint">· {fmtDuration(result.durationMs)}</span>
          </div>
          <p className="text-sm leading-relaxed text-ink">
            {result.resultSummary ?? result.error ?? 'Completed'}
          </p>
        </div>
      )}

      {/* Live execution dashboard (V5.4). */}
      {stats && (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {statCells.map((c) => (
            <div key={c.label} className="rounded-lg [background:var(--fill-2)] p-2">
              <div className="text-[10px] uppercase tracking-wide text-white/35">{c.label}</div>
              <div className="text-sm font-semibold text-ink">{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {active.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-white/50">
            Running now
          </div>
          {active.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/5 [background:var(--fill-2)] p-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', stateDot(s.state))} />
                <span className="truncate text-xs text-ink">{s.label}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-[10px] text-white/40">
                <span>
                  {s.currentStep >= 0 && s.steps[s.currentStep]
                    ? s.steps[s.currentStep].label
                    : s.kind}
                </span>
                <button
                  type="button"
                  onClick={() => void ipc.execute.cancel(s.id).then(refresh)}
                  className="rounded px-1.5 py-0.5 text-white/50 hover:bg-white/10 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-white/50">
            Recent executions
          </div>
          <div className="space-y-1">
            {history.slice(0, 8).map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-lg [background:var(--fill-2)] px-2 py-1.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', stateDot(s.state))} />
                  <span className="truncate text-xs text-white/70">{s.label}</span>
                  <span className="shrink-0 rounded bg-white/5 px-1 py-0.5 text-[9px] uppercase text-white/40">
                    {s.kind}
                  </span>
                </div>
                <span className="shrink-0 text-[10px] text-white/35">
                  {fmtDuration(s.durationMs)} · {relativeTime(s.completedAt ?? s.startedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
