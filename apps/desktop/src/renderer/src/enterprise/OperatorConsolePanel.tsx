/**
 * Enterprise → Operator Console (MES). The real-time shop-floor execution surface for a dispatched,
 * committed Production Schedule. It renders — from the read-only `ipc.enterprise.executionExplore`
 * model — the live KPI strip, real-time progress, the executions with their full lifecycle controls
 * (start / pause / resume / complete / abort / block / inspect + pass/fail / scrap / rework / quality
 * hold / operator assignment), the Operator Console, Machine Status, Work Orders, Quality queue, and
 * the Execution Timeline, plus a deterministic AI narrative that explains the floor. Every mutation
 * flows through the RBAC-gated execution-module actions; the model itself is read-only and refreshes
 * live (poll + module events). Material, finished goods, downtime, timeline and audit are never
 * touched here — they remain their owning subsystems' authority.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ConsoleExecutionRow,
  ConsoleMachineRow,
  ConsoleOperatorRow,
  ConsoleQualityRow,
  ConsoleWorkOrderRow,
  ExecutionConsoleModel,
  MesExecutionState,
} from '@neuropause/shared';
import { PRODUCTION_EXECUTIONS_MODULE_ID, MANUFACTURING_EVENTS_MODULE_ID } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Spinner } from '@renderer/components/Spinner';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Button } from '@renderer/components/ui/Button';
import { VirtualList } from '@renderer/components/ui/VirtualList';
import { OpsPanel, Stat, StatusBadge, Bar } from '../operations/primitives';
import { TEXT_TONE, TINT_TONE, type OpsTone } from './lib';

const EXEC = PRODUCTION_EXECUTIONS_MODULE_ID;

/* ── tone + format helpers ─────────────────────────────────────────────────────── */

function bandTone(band?: 'healthy' | 'watch' | 'at-risk' | 'critical'): OpsTone {
  if (band === 'healthy') return 'green';
  if (band === 'watch') return 'orange';
  if (band === 'at-risk' || band === 'critical') return 'red';
  return 'accent';
}
function statusTone(s: MesExecutionState): OpsTone {
  switch (s) {
    case 'running':
      return 'green';
    case 'completed':
      return 'green';
    case 'inspection':
      return 'blue';
    case 'paused':
      return 'orange';
    case 'blocked':
      return 'red';
    case 'cancelled':
      return 'gray';
    default:
      return 'blue';
  }
}
function statusIcon(s: MesExecutionState): IconName {
  switch (s) {
    case 'running':
      return 'play';
    case 'paused':
      return 'pause';
    case 'blocked':
      return 'stop';
    case 'inspection':
      return 'search';
    case 'completed':
      return 'check';
    case 'cancelled':
      return 'close';
    default:
      return 'clock';
  }
}
function machineStateTone(s: string): OpsTone {
  switch (s) {
    case 'running':
      return 'green';
    case 'idle':
    case 'released':
      return 'blue';
    case 'paused':
    case 'inspection':
      return 'orange';
    case 'blocked':
    case 'downtime':
      return 'red';
    default:
      return 'gray';
  }
}
function qualityTone(s: string): OpsTone {
  switch (s) {
    case 'pass':
      return 'green';
    case 'fail':
      return 'red';
    case 'rework':
      return 'orange';
    default:
      return 'blue';
  }
}
function fmtMin(min: number): string {
  if (min <= 0) return '0m';
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/* ── the lifecycle control set (contextual to execution status) ───────────────────── */

type PendingKind = 'block' | 'qualityHold' | 'scrap' | 'rework' | 'assignOperator';

interface Pending {
  id: string;
  kind: PendingKind;
  reason: string;
  operator: string;
  qty: string;
}

function actionsFor(status: MesExecutionState): { simple: Array<{ action: string; label: string; icon: IconName; variant: 'primary' | 'secondary' | 'ghost' | 'danger' }>; needsInput: PendingKind[] } {
  const simple: Array<{ action: string; label: string; icon: IconName; variant: 'primary' | 'secondary' | 'ghost' | 'danger' }> = [];
  const needsInput: PendingKind[] = [];
  const queued = status === 'scheduled' || status === 'released' || status === 'dispatched' || status === 'waiting';
  if (queued) simple.push({ action: 'start', label: 'Start', icon: 'play', variant: 'primary' });
  if (status === 'running') {
    simple.push({ action: 'pause', label: 'Pause', icon: 'pause', variant: 'secondary' });
    simple.push({ action: 'inspect', label: 'Inspect', icon: 'search', variant: 'secondary' });
    simple.push({ action: 'complete', label: 'Complete', icon: 'check', variant: 'primary' });
    needsInput.push('qualityHold', 'block', 'scrap');
  }
  if (status === 'paused') {
    simple.push({ action: 'resume', label: 'Resume', icon: 'play', variant: 'primary' });
    simple.push({ action: 'complete', label: 'Complete', icon: 'check', variant: 'secondary' });
    needsInput.push('qualityHold');
  }
  if (status === 'blocked') {
    simple.push({ action: 'resume', label: 'Resume', icon: 'play', variant: 'primary' });
    needsInput.push('rework');
  }
  if (status === 'inspection') {
    simple.push({ action: 'inspectPass', label: 'Pass', icon: 'check', variant: 'primary' });
    simple.push({ action: 'inspectFail', label: 'Fail', icon: 'close', variant: 'danger' });
    needsInput.push('rework');
  }
  if (queued || status === 'running' || status === 'paused' || status === 'blocked' || status === 'inspection') {
    needsInput.push('assignOperator');
    simple.push({ action: 'cancel', label: 'Abort', icon: 'close', variant: 'ghost' });
  }
  return { simple, needsInput };
}

const INPUT_META: Record<PendingKind, { label: string; icon: IconName }> = {
  block: { label: 'Machine Hold', icon: 'stop' },
  qualityHold: { label: 'Quality Hold', icon: 'shield' },
  scrap: { label: 'Scrap', icon: 'trash' },
  rework: { label: 'Rework', icon: 'refresh' },
  assignOperator: { label: 'Assign', icon: 'user' },
};

/* ── real-time progress card (a live running execution) ───────────────────────────── */

function ProgressCard({ e }: { e: ConsoleExecutionRow }): JSX.Element {
  return (
    <div className="surface-raised rounded-2xl p-4 shadow-card">
      <div className="flex items-center gap-2">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT_TONE[statusTone(e.status)])}>
          <Icon name={statusIcon(e.status)} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{e.executionNumber} · {e.operation || 'operation'}</div>
          <div className="truncate text-2xs text-faint">{e.productionOrder} · {e.machine || 'no machine'} · {e.operator || 'unassigned'}</div>
        </div>
        <span className="text-sm font-semibold tabular">{e.progress}%</span>
      </div>
      <div className="mt-2"><Bar value={e.progress / 100} tone={e.progress >= 80 ? 'green' : e.progress >= 40 ? 'blue' : 'orange'} /></div>
      <div className="mt-2 flex items-center justify-between text-2xs text-faint">
        <span>{e.goodQuantity}/{e.plannedQuantity} good · {e.remainingQuantity} left</span>
        <span>{fmtMin(e.elapsedMinutes)} elapsed{e.remainingMinutes > 0 ? ` · ~${fmtMin(e.remainingMinutes)} left` : ''}</span>
      </div>
    </div>
  );
}

/* ── execution row (with contextual lifecycle controls) ───────────────────────────── */

function ExecutionRow({
  e,
  busy,
  pending,
  onSimple,
  onOpenInput,
  onCancelInput,
  onConfirmInput,
  onPendingChange,
}: {
  e: ConsoleExecutionRow;
  busy: string | null;
  pending: Pending | null;
  onSimple: (id: string, action: string, label: string) => void;
  onOpenInput: (id: string, kind: PendingKind) => void;
  onCancelInput: () => void;
  onConfirmInput: () => void;
  onPendingChange: (patch: Partial<Pending>) => void;
}): JSX.Element {
  const { simple, needsInput } = actionsFor(e.status);
  const editing = pending && pending.id === e.id ? pending : null;
  return (
    <div className="surface-raised rounded-xl p-3.5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', TINT_TONE[statusTone(e.status)])}>
          <Icon name={statusIcon(e.status)} size={12} />
        </span>
        <span className="text-sm font-medium">{e.executionNumber}</span>
        <StatusBadge tone={statusTone(e.status)} label={e.status} />
        <span className="text-2xs text-faint">{e.operation || '—'} · op {e.sequence} · {e.productionOrder}</span>
        {e.firstOperation && <span className="text-2xs text-faint">· first</span>}
        {e.finalOperation && <span className="text-2xs text-faint">· final</span>}
        <span className="ml-auto text-2xs text-faint">{e.machine || 'no machine'} · {e.operator || 'unassigned'}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-2xs text-faint">
        <span className="inline-flex w-28 items-center gap-1.5"><Bar value={e.progress / 100} tone={e.progress >= 80 ? 'green' : 'blue'} /> {e.progress}%</span>
        <span>{e.goodQuantity}/{e.plannedQuantity} good</span>
        {e.scrapQuantity > 0 && <span className={TEXT_TONE.red}>{e.scrapQuantity} scrap</span>}
        {e.reworkQuantity > 0 && <span className={TEXT_TONE.orange}>{e.reworkQuantity} rework</span>}
        {e.status === 'completed' && <span>OEE {e.oee}% · FPY {e.firstPassYield}%</span>}
        {e.blockedReason && <span className={TEXT_TONE.red}>· {e.blockedReason}</span>}
        {e.live && <span>· {fmtMin(e.elapsedMinutes)} elapsed</span>}
      </div>
      {editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-2xs font-medium text-muted">{INPUT_META[editing.kind].label}:</span>
          {editing.kind === 'assignOperator' && (
            <input autoFocus value={editing.operator} onChange={(ev) => onPendingChange({ operator: ev.target.value })} placeholder="Operator name…" className="flex-1 rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-faint" />
          )}
          {(editing.kind === 'block' || editing.kind === 'qualityHold') && (
            <input autoFocus value={editing.reason} onChange={(ev) => onPendingChange({ reason: ev.target.value })} placeholder={editing.kind === 'qualityHold' ? 'Quality hold reason…' : 'Hold reason…'} className="flex-1 rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-faint" />
          )}
          {editing.kind === 'scrap' && (
            <>
              <input autoFocus type="number" min={0} value={editing.qty} onChange={(ev) => onPendingChange({ qty: ev.target.value })} placeholder="Qty" className="w-20 rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-faint" />
              <input value={editing.reason} onChange={(ev) => onPendingChange({ reason: ev.target.value })} placeholder="Scrap reason…" className="flex-1 rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-faint" />
            </>
          )}
          {editing.kind === 'rework' && (
            <input autoFocus type="number" min={0} value={editing.qty} onChange={(ev) => onPendingChange({ qty: ev.target.value })} placeholder="Rework qty" className="w-28 rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-faint" />
          )}
          <Button variant="primary" size="sm" loading={busy === `${e.id}:${editing.kind}`} onClick={onConfirmInput}>Confirm</Button>
          <Button variant="ghost" size="sm" onClick={onCancelInput}>Cancel</Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {simple.map((a) => (
            <Button key={a.action} variant={a.variant} size="sm" icon={a.icon} loading={busy === `${e.id}:${a.action}`} onClick={() => onSimple(e.id, a.action, a.label)}>
              {a.label}
            </Button>
          ))}
          {needsInput.map((kind) => (
            <Button key={kind} variant="secondary" size="sm" icon={INPUT_META[kind].icon} onClick={() => onOpenInput(e.id, kind)}>
              {INPUT_META[kind].label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── sub-surfaces ──────────────────────────────────────────────────────────────── */

function OperatorRow({ o }: { o: ConsoleOperatorRow }): JSX.Element {
  return (
    <div className="surface-raised flex items-center gap-3 rounded-xl px-3.5 py-2.5 shadow-card">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT_TONE.blue)}><Icon name="user" size={15} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{o.operator}</div>
        <div className="truncate text-2xs text-faint">{o.currentAssignment ? `${o.currentAssignment} · ${o.currentOperation || '—'} · ${o.currentMachine || '—'}` : 'no active assignment'}</div>
      </div>
      <div className="hidden shrink-0 items-center gap-4 text-2xs text-faint sm:flex">
        <span>{o.workload} active</span>
        <span>{o.completedOperations} done</span>
        <span className="inline-flex w-16 items-center gap-1.5"><Bar value={o.utilization / 100} tone={o.utilization >= 60 ? 'green' : 'orange'} /> {o.utilization}%</span>
      </div>
    </div>
  );
}

function MachineRow({ m }: { m: ConsoleMachineRow }): JSX.Element {
  return (
    <div className="surface-raised flex items-center gap-3 rounded-xl px-3.5 py-2.5 shadow-card">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT_TONE[machineStateTone(m.currentState)])}><Icon name="cpu" size={15} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{m.machine}</span>
          <StatusBadge tone={machineStateTone(m.currentState)} label={m.currentState} />
        </div>
        <div className="truncate text-2xs text-faint">{m.workCenter || '—'}{m.runningJob ? ` · running ${m.runningJob}` : ''}{m.currentOperator ? ` · ${m.currentOperator}` : ''}</div>
      </div>
      <div className="hidden shrink-0 items-center gap-4 text-2xs text-faint sm:flex">
        <span>{m.activeExecutions} active</span>
        <span>{m.queueLength} queued</span>
        <span>↑{fmtMin(m.todaysRuntime)} ↓{fmtMin(m.todaysDowntime)}</span>
        <span className="inline-flex w-16 items-center gap-1.5"><Bar value={m.todaysUtilization / 100} tone={m.todaysUtilization >= 60 ? 'green' : 'orange'} /> {m.todaysUtilization}%</span>
      </div>
    </div>
  );
}

function WorkOrderRow({ w }: { w: ConsoleWorkOrderRow }): JSX.Element {
  const tone: OpsTone = w.status === 'completed' ? 'green' : w.status === 'blocked' ? 'red' : w.status === 'running' ? 'blue' : 'gray';
  return (
    <div className="surface-raised flex items-center gap-3 rounded-xl px-3.5 py-2.5 shadow-card">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT_TONE[tone])}><Icon name="checklist" size={15} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{w.productionOrder}</span>
          <StatusBadge tone={tone} label={w.status} />
          <span className="text-2xs text-faint">{w.product}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-2xs text-faint">
          <span className="inline-flex w-24 items-center gap-1.5"><Bar value={w.progress / 100} tone={w.progress >= 80 ? 'green' : 'blue'} /> {w.progress}%</span>
          <span>{w.completedOperations}/{w.totalOperations} ops</span>
          {w.blockedOperations > 0 && <span className={TEXT_TONE.red}>{w.blockedOperations} blocked</span>}
          <span>{w.goodQuantity} good{w.scrapQuantity > 0 ? ` · ${w.scrapQuantity} scrap` : ''}</span>
        </div>
      </div>
      <div className="hidden shrink-0 text-right text-2xs text-faint sm:block">{w.machines.slice(0, 3).join(', ') || 'no machine'}</div>
    </div>
  );
}

function QualityRow({ q }: { q: ConsoleQualityRow }): JSX.Element {
  return (
    <div className="surface-raised flex items-center gap-3 rounded-xl px-3.5 py-2.5 shadow-card">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT_TONE[qualityTone(q.status)])}><Icon name="shield" size={15} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{q.executionNumber}</span>
          <StatusBadge tone={qualityTone(q.status)} label={q.status} />
          <span className="text-2xs text-faint">{q.operation || '—'} · {q.productionOrder}</span>
        </div>
        <div className="truncate text-2xs text-faint">
          {q.machine || '—'} · FPY {q.firstPassYield}%{q.scrapQuantity > 0 ? ` · ${q.scrapQuantity} scrap` : ''}{q.reworkQuantity > 0 ? ` · ${q.reworkQuantity} rework` : ''}
          {q.notes ? ` · ${q.notes}` : q.blockedReason ? ` · ${q.blockedReason}` : ''}
        </div>
      </div>
      {q.inspectionRequired && <span className="hidden shrink-0 text-2xs text-faint sm:block">inspection required</span>}
    </div>
  );
}

/* ── the panel ───────────────────────────────────────────────────────────────────── */

type View = 'console' | 'executions' | 'operators' | 'machines' | 'orders' | 'quality' | 'timeline';
const VIEWS: Array<{ id: View; label: string; icon: IconName }> = [
  { id: 'console', label: 'Console', icon: 'gauge' },
  { id: 'executions', label: 'Executions', icon: 'activity' },
  { id: 'operators', label: 'Operators', icon: 'user' },
  { id: 'machines', label: 'Machine Status', icon: 'cpu' },
  { id: 'orders', label: 'Work Orders', icon: 'checklist' },
  { id: 'quality', label: 'Quality', icon: 'shield' },
  { id: 'timeline', label: 'Timeline', icon: 'clock' },
];

export function OperatorConsolePanel(): JSX.Element {
  const [model, setModel] = useState<ExecutionConsoleModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('console');
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const load = useCallback((silent = false) => {
    let alive = true;
    if (!silent) setLoading(true);
    ipc.enterprise
      .executionExplore()
      .then((m) => { if (alive) { setModel(m); setError(null); } })
      .catch((e) => alive && setError(`Operator Console failed to load: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => load(), [load]);

  // Real-time: poll every few seconds + refresh on any execution / event-ledger change.
  useEffect(() => {
    const timer = setInterval(() => load(true), 3500);
    const off = ipc.enterpriseModules.onEvent((e) => {
      if (e.moduleId === EXEC || e.moduleId === MANUFACTURING_EVENTS_MODULE_ID) load(true);
    });
    return () => { clearInterval(timer); off(); };
  }, [load]);

  const runSimple = useCallback(async (id: string, action: string, label: string) => {
    setBusy(`${id}:${action}`);
    try {
      const res = await ipc.enterpriseModules.action(EXEC, id, action);
      if (!res.ok) setError(res.message ?? res.error ?? `${label} failed.`);
      else setError(null);
    } catch (e) {
      setError(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      load(true);
    }
  }, [load]);

  const confirmInput = useCallback(async () => {
    if (!pending) return;
    const { id, kind, reason, operator, qty } = pending;
    setBusy(`${id}:${kind}`);
    try {
      const n = Math.max(0, Math.round(Number(qty) || 0));
      if (kind === 'assignOperator') {
        if (!operator.trim()) { setError('Enter an operator name.'); setBusy(null); return; }
        await ipc.enterpriseModules.update(EXEC, id, { fields: { operator: operator.trim() } });
        await ipc.enterpriseModules.action(EXEC, id, 'assignOperator');
      } else if (kind === 'block' || kind === 'qualityHold') {
        await ipc.enterpriseModules.update(EXEC, id, { fields: { blockedReason: reason.trim() || (kind === 'qualityHold' ? 'Quality hold' : 'Machine hold') } });
        await ipc.enterpriseModules.action(EXEC, id, kind === 'qualityHold' ? 'qualityHold' : 'block');
      } else if (kind === 'scrap') {
        if (n <= 0) { setError('Enter a scrap quantity greater than zero.'); setBusy(null); return; }
        await ipc.enterpriseModules.update(EXEC, id, { fields: { scrapQuantity: n, scrapReason: reason.trim() } });
        await ipc.enterpriseModules.action(EXEC, id, 'scrap');
      } else if (kind === 'rework') {
        await ipc.enterpriseModules.update(EXEC, id, { fields: { reworkQuantity: n } });
        await ipc.enterpriseModules.action(EXEC, id, 'rework');
      }
      setError(null);
    } catch (e) {
      setError(`Action failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      setPending(null);
      load(true);
    }
  }, [pending, load]);

  const filteredExecutions = useMemo(() => {
    if (!model) return [];
    const query = search.trim().toLowerCase();
    return model.executions.filter((e) => {
      if (statusFilter && e.status !== statusFilter) return false;
      if (query && !`${e.executionNumber} ${e.productionOrder} ${e.operation} ${e.machine} ${e.operator} ${e.product}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [model, search, statusFilter]);

  if (loading && !model) {
    return <OpsPanel title="Operator Console"><div className="flex items-center justify-center py-16"><Spinner size={20} /></div></OpsPanel>;
  }
  if (error && !model) {
    return <OpsPanel title="Operator Console"><EmptyState icon="activity" title="Console unavailable" description={error} /></OpsPanel>;
  }
  if (!model) return <OpsPanel title="Operator Console"><EmptyState icon="activity" title="No executions" description="Nothing to show." /></OpsPanel>;

  const running = model.executions.filter((e) => e.status === 'running');
  const headlineKpis = model.kpis.filter((k) => ['mes-progress', 'mes-oee', 'mes-availability', 'mes-performance', 'mes-quality', 'mes-scrap', 'mes-adherence', 'mes-blocked'].includes(k.key));

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] px-3.5 py-2 text-xs text-muted">
          <Icon name="info" size={14} /> {error}
        </div>
      )}

      {/* Live KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {headlineKpis.map((k) => (
          <Stat key={k.key} icon="gauge" label={k.label} value={<span className="text-lg">{k.display}</span>} tone={bandTone(k.band)} />
        ))}
      </div>

      {/* Sub-navigation */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => setView(v.id)} className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition', view === v.id ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink')}>
              <Icon name={v.icon} size={15} /> {v.label}
              {v.id === 'quality' && model.quality.length > 0 && <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-2xs font-semibold text-black">{model.quality.length}</span>}
            </button>
          ))}
        </nav>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-2xs font-medium text-faint">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sysgreen opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-sysgreen" /></span>
          Live · {model.counts.running} running
        </span>
      </div>

      {/* CONSOLE — real-time progress + counts + narrative */}
      {view === 'console' && (
        <>
          <OpsPanel title="Real-time Progress" subtitle={`${model.counts.total} operation(s) · ${model.counts.running} running · ${model.counts.blocked} blocked · ${model.counts.completed} completed`}>
            {running.length === 0 ? (
              <EmptyState icon="play" compact title="Nothing running" description="Start a dispatched operation from the Executions tab to see live progress." />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {running.map((e) => <ProgressCard key={e.id} e={e} />)}
              </div>
            )}
          </OpsPanel>

          <OpsPanel title="Execution Intelligence" subtitle="Deterministic — explains the shop floor; never dispatches or executes">
            <div className="surface-raised space-y-2 rounded-2xl p-4 shadow-card">
              <p className="text-sm text-muted">{model.narrative.productionSummary}</p>
              <p className="text-xs text-faint"><span className="font-medium text-muted">Delays:</span> {model.narrative.delayAnalysis}</p>
              <p className="text-xs text-faint"><span className="font-medium text-muted">Root cause:</span> {model.narrative.rootCause}</p>
              <p className="text-xs text-faint"><span className="font-medium text-muted">Quality:</span> {model.narrative.qualityExplanation}</p>
              <p className="text-xs text-faint"><span className="font-medium text-muted">Operators:</span> {model.narrative.operatorSuggestions}</p>
              <p className="text-xs text-faint"><span className="font-medium text-muted">Maintenance:</span> {model.narrative.maintenanceSuggestions}</p>
            </div>
          </OpsPanel>
        </>
      )}

      {/* EXECUTIONS — the full lifecycle surface */}
      {view === 'executions' && (
        <OpsPanel title="Executions" subtitle={`${filteredExecutions.length} operation(s) · execute against the committed schedule only`} actions={<Button variant="ghost" size="sm" icon="refresh" onClick={() => load()}>Refresh</Button>}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5">
              <Icon name="search" size={14} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by execution, order, machine, operator…" className="w-full bg-transparent text-sm outline-none placeholder:text-faint" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-xs text-ink outline-none">
              <option value="">All statuses</option>
              {['running', 'paused', 'blocked', 'inspection', 'dispatched', 'waiting', 'released', 'scheduled', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {filteredExecutions.length === 0 ? (
            <EmptyState icon="activity" compact title="No executions" description="Dispatch a committed Production Schedule to create shop-floor executions." />
          ) : (
            <div className="space-y-2">
              {filteredExecutions.map((e) => (
                <ExecutionRow
                  key={e.id}
                  e={e}
                  busy={busy}
                  pending={pending}
                  onSimple={runSimple}
                  onOpenInput={(id, kind) => setPending({ id, kind, reason: '', operator: e.operator, qty: '' })}
                  onCancelInput={() => setPending(null)}
                  onConfirmInput={confirmInput}
                  onPendingChange={(patch) => setPending((p) => (p ? { ...p, ...patch } : p))}
                />
              ))}
            </div>
          )}
        </OpsPanel>
      )}

      {/* OPERATOR CONSOLE */}
      {view === 'operators' && (
        <OpsPanel title="Operator Console" subtitle={`${model.operators.length} operator(s) · assignments, workload, utilization`}>
          {model.operators.length === 0 ? (
            <EmptyState icon="user" compact title="No operators" description="Assign an operator to an execution to see them here." />
          ) : (
            <div className="space-y-2">{model.operators.map((o) => <OperatorRow key={o.operator} o={o} />)}</div>
          )}
        </OpsPanel>
      )}

      {/* MACHINE STATUS */}
      {view === 'machines' && (
        <OpsPanel title="Machine Status" subtitle={`${model.machines.length} machine(s) · live state, runtime/downtime, utilization`}>
          {model.machines.length === 0 ? (
            <EmptyState icon="cpu" compact title="No machines" description="Dispatch operations to machines to see live machine status." />
          ) : (
            <div className="space-y-2">{model.machines.map((m) => <MachineRow key={m.machine} m={m} />)}</div>
          )}
        </OpsPanel>
      )}

      {/* WORK ORDERS */}
      {view === 'orders' && (
        <OpsPanel title="Work Orders" subtitle={`${model.workOrders.length} order(s) · operation progress rollup`}>
          {model.workOrders.length === 0 ? (
            <EmptyState icon="checklist" compact title="No work orders" description="Dispatched executions roll up into their production orders here." />
          ) : (
            <div className="space-y-2">{model.workOrders.map((w) => <WorkOrderRow key={w.productionOrder} w={w} />)}</div>
          )}
        </OpsPanel>
      )}

      {/* QUALITY */}
      {view === 'quality' && (
        <OpsPanel title="Quality" subtitle={`${model.quality.length} item(s) · inspections, holds, scrap, rework`}>
          {model.quality.length === 0 ? (
            <EmptyState icon="shield" compact title="No quality items" description="Inspections, quality holds, scrap and rework surface here." />
          ) : (
            <div className="space-y-2">{model.quality.map((q) => <QualityRow key={q.id} q={q} />)}</div>
          )}
        </OpsPanel>
      )}

      {/* EXECUTION TIMELINE */}
      {view === 'timeline' && (
        <OpsPanel title="Execution Timeline" subtitle={`${model.eventCount} shop-floor event(s) · immutable ledger (most recent first)`}>
          {model.timeline.length === 0 ? (
            <EmptyState icon="clock" compact title="No events" description="Shop-floor events (start, pause, material, inspection, scrap…) appear here as they happen." />
          ) : (
            <VirtualList
              items={model.timeline}
              rowHeight={52}
              gap={6}
              height={Math.min(model.timeline.length, 10) * 58}
              getKey={(ev) => ev.id}
              renderRow={(ev) => (
                <div className="surface-raised flex items-center gap-3 rounded-xl px-3.5 py-2 shadow-card">
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT_TONE.blue)}><Icon name="pulse" size={13} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{ev.label}{ev.quantity > 0 ? ` · ${ev.quantity}` : ''}</div>
                    <div className="truncate text-2xs text-faint">{ev.execution || ev.productionOrder || '—'}{ev.operation ? ` · ${ev.operation}` : ''}{ev.machine ? ` · ${ev.machine}` : ''}{ev.operator ? ` · ${ev.operator}` : ''}{ev.reason ? ` · ${ev.reason}` : ''}</div>
                  </div>
                  <div className="hidden shrink-0 text-2xs text-faint sm:block">{ev.timestamp ? ev.timestamp.replace('T', ' ').slice(0, 16) : ''}</div>
                </div>
              )}
            />
          )}
        </OpsPanel>
      )}
    </div>
  );
}
