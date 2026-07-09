/**
 * Enterprise → Production Schedule. A read-only visual explorer of the routing-aware Finite Capacity
 * Schedule (the existing engine — nothing is re-scheduled here), plus the governance workflow that turns a
 * proposal into real Production Schedule records: propose → approve / reject / recalculate → commit. It
 * renders an interactive Machine Gantt (per-machine lanes, time-scaled operation bars, zoom + pan), the
 * eight scheduling KPIs, a virtualized operations table with filters + search, the routing violations, the
 * governance proposals, and a deterministic AI narrative. All data comes from the read-only
 * `ipc.enterprise.scheduleExplore` channel; the only writes are the RBAC-gated proposal actions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WheelEvent as RWheelEvent, PointerEvent as RPointerEvent } from 'react';
import type { ScheduleBar, ScheduleExploreModel, ScheduleProposalRecord } from '@neuropause/shared';
import { PRODUCTION_ORDERS_MODULE_ID, SCHEDULE_PROPOSALS_MODULE_ID } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Spinner } from '@renderer/components/Spinner';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Button } from '@renderer/components/ui/Button';
import { VirtualList } from '@renderer/components/ui/VirtualList';
import { OpsPanel, Stat, StatusBadge, Bar } from '../operations/primitives';
import { TEXT_TONE, TINT_TONE, type OpsTone } from './lib';

function fmtHours(h: number): string {
  if (h <= 0) return '0h';
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
function bandTone(band?: 'healthy' | 'watch' | 'at-risk' | 'critical'): OpsTone {
  if (band === 'healthy') return 'green';
  if (band === 'watch') return 'orange';
  if (band === 'at-risk' || band === 'critical') return 'red';
  return 'accent';
}
function machineStatusTone(status: string, available: boolean): OpsTone {
  if (!available) return 'red';
  return status === 'running' ? 'green' : status === 'idle' ? 'blue' : 'orange';
}
function proposalTone(status: ScheduleProposalRecord['status']): OpsTone {
  return status === 'committed' ? 'green' : status === 'approved' ? 'blue' : status === 'rejected' ? 'red' : status === 'superseded' ? 'gray' : 'orange';
}

/* ── the interactive Machine Gantt (hand-rolled SVG; zoom + pan) ───────────────── */

const LANE_H = 34;
const LABEL_W = 168;
const BASE_PX_PER_HOUR = 7;
const HOURS_PER_DAY = 8;

function MachineGantt({ model }: { model: ScheduleExploreModel }): JSX.Element {
  const [zoom, setZoom] = useState(1);
  const [tx, setTx] = useState(0);
  const drag = useRef<{ x: number; tx: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(720);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = (): void => setWrapW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lanes = model.gantt.lanes;
  const laneIndex = useMemo(() => {
    const m = new Map<string, number>();
    lanes.forEach((l, i) => m.set(l.machine, i));
    return m;
  }, [lanes]);

  const pxPerHour = BASE_PX_PER_HOUR * zoom;
  const canvasW = Math.max(wrapW, model.gantt.maxHour * pxPerHour + 40);
  const height = Math.max(LANE_H, lanes.length * LANE_H);
  const days = Math.ceil(model.gantt.maxHour / HOURS_PER_DAY) + 1;

  const onWheel = (e: RWheelEvent): void => setZoom((z) => Math.max(0.4, Math.min(4, z * (e.deltaY < 0 ? 1.12 : 0.9))));
  const onPointerDown = (e: RPointerEvent): void => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, tx };
  };
  const onPointerMove = (e: RPointerEvent): void => {
    if (!drag.current) return;
    const next = Math.min(0, drag.current.tx + (e.clientX - drag.current.x));
    setTx(next);
  };
  const onPointerUp = (): void => { drag.current = null; };

  if (lanes.length === 0) {
    return <EmptyState icon="clock" compact title="No machines to schedule" description="Add machines and routings, then propose a schedule." />;
  }

  return (
    <div className="surface-raised overflow-hidden rounded-2xl shadow-card">
      <div className="flex items-center justify-between border-b border-[var(--hairline)] px-3 py-1.5">
        <div className="flex items-center gap-3 text-2xs text-faint">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-[var(--fill-2)]" /> On time</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: 'var(--sysred, #e5484d)' }} /> Late</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-[var(--accent)]" /> Bottleneck</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, z * 0.85))} className="flex h-6 w-6 items-center justify-center rounded-md text-muted fill-hover hover:text-ink"><Icon name="dot" size={13} /></button>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => setZoom((z) => Math.min(4, z * 1.18))} className="flex h-6 w-6 items-center justify-center rounded-md text-muted fill-hover hover:text-ink"><Icon name="plus" size={13} /></button>
          <button type="button" aria-label="Reset" title="Reset view" onClick={() => { setZoom(1); setTx(0); }} className="flex h-6 w-6 items-center justify-center rounded-md text-muted fill-hover hover:text-ink"><Icon name="refresh" size={13} /></button>
        </div>
      </div>
      <div className="flex" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {/* Fixed machine-label gutter */}
        <div className="shrink-0 border-r border-[var(--hairline)]" style={{ width: LABEL_W }}>
          {lanes.map((l) => (
            <div key={l.machine} className="flex flex-col justify-center border-b border-[var(--hairline)] px-3" style={{ height: LANE_H }}>
              <div className="flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', TINT_TONE[machineStatusTone(l.status, l.available)])} />
                <span className="truncate text-xs font-medium" title={`${l.machine} · ${l.workCenter} · ${l.status}`}>{l.machine}</span>
                {l.bottleneck && <Icon name="bolt" size={11} />}
              </div>
              <div className="mt-0.5 flex items-center gap-1">
                <div className="w-14"><Bar value={l.utilization / 100} tone={l.utilization >= 85 ? 'red' : l.utilization >= 60 ? 'orange' : 'green'} /></div>
                <span className="text-2xs text-faint">{l.available ? `${l.utilization}%` : l.status}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Time canvas */}
        <div ref={wrapRef} className="relative flex-1 overflow-hidden" style={{ touchAction: 'none', cursor: drag.current ? 'grabbing' : 'grab' }} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
          <svg width="100%" height={height} role="img" aria-label="Machine Gantt schedule">
            {/* day gridlines + labels */}
            {Array.from({ length: days }).map((_, d) => {
              const x = d * HOURS_PER_DAY * pxPerHour + tx;
              if (x < -30 || x > canvasW) return null;
              return (
                <g key={d}>
                  <line x1={x} y1={0} x2={x} y2={height} stroke="var(--hairline)" strokeWidth={1} />
                  <text x={x + 3} y={11} fontSize={9} fill="var(--text-faint, #8b8b8b)">D{d}</text>
                </g>
              );
            })}
            {/* lane separators */}
            {lanes.map((l, i) => (
              <line key={l.machine} x1={0} y1={(i + 1) * LANE_H} x2="100%" y2={(i + 1) * LANE_H} stroke="var(--hairline)" strokeWidth={0.5} />
            ))}
            {/* operation bars */}
            {model.gantt.bars.map((b, idx) => {
              const li = laneIndex.get(b.machine);
              if (li === undefined) return null;
              const x = b.startHour * pxPerHour + tx;
              const w = Math.max(4, b.durationHours * pxPerHour);
              if (x + w < 0 || x > canvasW) return null;
              const fill = b.late ? 'var(--sysred, #e5484d)' : b.onBottleneck ? 'var(--accent)' : 'var(--fill-2)';
              return (
                <g key={idx}>
                  <rect x={x} y={li * LANE_H + 5} width={w} height={LANE_H - 10} rx={4} fill={fill} stroke="var(--hairline)" strokeWidth={0.75}>
                    <title>{`${b.order} · ${b.operation} (op ${b.sequence})\n${b.product} on ${b.machine}\n${b.startDate} → ${b.finishDate} · ${fmtHours(b.durationHours)}${b.late ? ' · LATE' : ''}${b.maintenanceConflict ? ' · after maintenance' : ''}`}</title>
                  </rect>
                  {w > 34 && <text x={x + 4} y={li * LANE_H + LANE_H / 2 + 3} fontSize={9} fill="var(--text-ink, currentColor)" style={{ pointerEvents: 'none' }}>{b.operation}</text>}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ── operation row (virtualized) ───────────────────────────────────────────────── */

function OpRow({ b }: { b: ScheduleBar }): JSX.Element {
  return (
    <div className="surface-raised flex items-center gap-3 rounded-xl px-3.5 py-2 shadow-card">
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT_TONE[b.late ? 'red' : b.onBottleneck ? 'accent' : 'blue'])}><Icon name="cpu" size={14} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{b.operation}</span>
          <span className="text-2xs text-faint">op {b.sequence}</span>
          {b.late && <span className={cn('text-2xs font-medium', TEXT_TONE.red)}>late</span>}
          {b.maintenanceConflict && <span className={cn('text-2xs font-medium', TEXT_TONE.orange)}>post-maint</span>}
        </div>
        <div className="truncate text-2xs text-faint">{b.order} · {b.product} · {b.machine}</div>
      </div>
      <div className="hidden w-24 shrink-0 text-2xs text-faint sm:block">{b.startDate}<br />→ {b.finishDate}</div>
      <div className="w-14 shrink-0 text-right"><div className="text-xs font-semibold tabular">{fmtHours(b.durationHours)}</div></div>
    </div>
  );
}

/* ── the panel ───────────────────────────────────────────────────────────────── */

export function ProductionSchedulePanel(): JSX.Element {
  const [model, setModel] = useState<ScheduleExploreModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [machineFilter, setMachineFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [lateOnly, setLateOnly] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const refresh = useCallback(() => {
    let alive = true;
    setLoading(true);
    ipc.enterprise
      .scheduleExplore()
      .then((m) => { if (alive) { setModel(m); setError(null); } })
      .catch((e) => alive && setError(`Production Schedule failed to load: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => refresh(), [refresh]);

  const runAction = useCallback(async (moduleId: string, id: string, action: string, label: string) => {
    setBusy(`${id}:${action}`);
    try {
      const res = await ipc.enterpriseModules.action(moduleId, id, action);
      if (!res.ok) setError(res.message ?? res.error ?? `${label} failed.`);
      else setError(null);
    } catch (e) {
      setError(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      refresh();
    }
  }, [refresh]);

  const doReject = useCallback(async (id: string) => {
    setBusy(`${id}:reject`);
    try {
      await ipc.enterpriseModules.update(SCHEDULE_PROPOSALS_MODULE_ID, id, { fields: { rejectionReason: rejectReason.trim() || 'Rejected by planner.' } });
      const res = await ipc.enterpriseModules.action(SCHEDULE_PROPOSALS_MODULE_ID, id, 'reject');
      if (!res.ok) setError(res.message ?? res.error ?? 'Reject failed.');
    } catch (e) {
      setError(`Reject failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      setRejecting(null);
      setRejectReason('');
      refresh();
    }
  }, [rejectReason, refresh]);

  const bars = useMemo(() => {
    if (!model) return [];
    const q = search.trim().toLowerCase();
    return model.gantt.bars.filter((b) => {
      if (machineFilter && b.machine !== machineFilter) return false;
      if (lateOnly && !b.late) return false;
      if (q && !`${b.order} ${b.product} ${b.operation} ${b.machine}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [model, machineFilter, search, lateOnly]);

  if (loading && !model) {
    return <OpsPanel title="Production Schedule"><div className="flex items-center justify-center py-16"><Spinner size={20} /></div></OpsPanel>;
  }
  if (error && !model) {
    return <OpsPanel title="Production Schedule"><EmptyState icon="clock" title="Schedule unavailable" description={error} /></OpsPanel>;
  }
  if (!model) return <OpsPanel title="Production Schedule"><EmptyState icon="clock" title="No schedule" description="Nothing to show." /></OpsPanel>;

  const machines = model.gantt.lanes.map((l) => l.machine);
  const activeProposals = model.proposals.filter((p) => p.status !== 'superseded' && p.status !== 'rejected');
  const proposableOrders = model.orders.filter((o) => o.hasRouting && !o.committed);

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] px-3.5 py-2 text-xs text-muted">
          <Icon name="info" size={14} /> {error}
        </div>
      )}

      {/* Eight scheduling KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {model.kpis.map((k) => (
          <Stat key={k.key} icon="gauge" label={k.label} value={<span className="text-lg">{k.display}</span>} tone={bandTone(k.band)} />
        ))}
      </div>

      {/* Machine Gantt */}
      <OpsPanel
        title="Machine Gantt"
        subtitle={`${model.gantt.lanes.length} machine(s) · ${model.gantt.bars.length} scheduled operation(s) · ${model.horizonDays}-day horizon · read-only`}
        actions={<Button variant="ghost" size="sm" icon="refresh" onClick={refresh}>Recalculate view</Button>}
      >
        <MachineGantt model={model} />
      </OpsPanel>

      {/* AI narrative */}
      <OpsPanel title="Schedule Intelligence" subtitle="Deterministic — explains the mined schedule; never schedules">
        <div className="surface-raised space-y-2 rounded-2xl p-4 shadow-card">
          <p className="text-sm text-muted">{model.narrative.summary}</p>
          <p className="text-xs text-faint"><span className="font-medium text-muted">Risk:</span> {model.narrative.riskExplanation}</p>
          <p className="text-xs text-faint"><span className="font-medium text-muted">Machines:</span> {model.narrative.machineRecommendation}</p>
          <p className="text-xs text-faint"><span className="font-medium text-muted">Delays:</span> {model.narrative.delayAnalysis}</p>
          {model.narrative.optimizations.length > 0 && (
            <ul className="mt-1 space-y-1">
              {model.narrative.optimizations.map((o, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-muted"><Icon name="lightbulb" size={13} /> {o}</li>
              ))}
            </ul>
          )}
        </div>
      </OpsPanel>

      {/* Governance: propose → approve/reject/recalculate → commit */}
      <OpsPanel title="Schedule Proposals" subtitle="Read-only until approved · commit creates real Production Schedules">
        {proposableOrders.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-2xs text-faint">Propose a schedule:</span>
            {proposableOrders.slice(0, 12).map((o) => (
              <Button key={o.id} variant="secondary" size="sm" icon="clock" loading={busy === `${o.id}:proposeSchedule`} onClick={() => runAction(PRODUCTION_ORDERS_MODULE_ID, o.id, 'proposeSchedule', 'Propose')}>
                {o.orderNumber}
              </Button>
            ))}
          </div>
        )}
        {activeProposals.length === 0 ? (
          <EmptyState icon="clock" compact title="No active proposals" description={proposableOrders.length > 0 ? 'Propose a schedule for a production order above.' : 'Add a production order with an active routing to propose a schedule.'} />
        ) : (
          <div className="space-y-2">
            {activeProposals.map((p) => (
              <div key={p.id} className="surface-raised rounded-xl p-3.5 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{p.proposalNumber}</span>
                  <span className="text-2xs text-faint">v{p.version}</span>
                  <StatusBadge tone={proposalTone(p.status)} label={p.status} />
                  <span className="text-2xs text-faint">{p.productionOrder} · {p.product} · routing {p.routingNumber}</span>
                  <span className="ml-auto text-2xs text-faint">{p.scheduledOps} scheduled{p.blockedOps > 0 ? ` · ${p.blockedOps} blocked` : ''}{p.late ? ' · late' : ''}</span>
                </div>
                <div className="mt-1 text-2xs text-faint">{p.plannedStart || '—'} → {p.plannedFinish || '—'} · {p.machines.join(', ') || 'no machine'}</div>
                {rejecting === p.id ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input autoFocus value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason for rejection…" className="flex-1 rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-faint" />
                    <Button variant="danger" size="sm" loading={busy === `${p.id}:reject`} onClick={() => doReject(p.id)}>Confirm reject</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setRejecting(null); setRejectReason(''); }}>Cancel</Button>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {p.status === 'proposed' && <Button variant="primary" size="sm" icon="check" loading={busy === `${p.id}:approve`} onClick={() => runAction(SCHEDULE_PROPOSALS_MODULE_ID, p.id, 'approve', 'Approve')}>Approve</Button>}
                    {p.status === 'proposed' && <Button variant="ghost" size="sm" icon="close" onClick={() => { setRejecting(p.id); setRejectReason(''); }}>Reject</Button>}
                    {(p.status === 'proposed' || p.status === 'approved') && <Button variant="secondary" size="sm" icon="refresh" loading={busy === `${p.id}:recalculate`} onClick={() => runAction(SCHEDULE_PROPOSALS_MODULE_ID, p.id, 'recalculate', 'Recalculate')}>Recalculate</Button>}
                    {p.status === 'approved' && <Button variant="primary" size="sm" icon="play" loading={busy === `${p.id}:commit`} onClick={() => runAction(SCHEDULE_PROPOSALS_MODULE_ID, p.id, 'commit', 'Commit')}>Commit Schedule</Button>}
                    {p.status === 'committed' && <span className={cn('text-2xs font-medium', TEXT_TONE.green)}>Committed {p.committedSchedules.length} schedule record(s)</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      {/* Operations table (virtualized) */}
      <OpsPanel title="Scheduled Operations" subtitle={`${bars.length} operation(s)`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5">
            <Icon name="search" size={14} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search operations by order, product, machine…" className="w-full bg-transparent text-sm outline-none placeholder:text-faint" />
          </div>
          <select value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)} className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-xs text-ink outline-none">
            <option value="">All machines</option>
            {machines.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button type="button" onClick={() => setLateOnly((v) => !v)} className={cn('rounded-lg px-2.5 py-1.5 text-xs font-medium transition', lateOnly ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink')}>Late only</button>
        </div>
        {bars.length === 0 ? (
          <EmptyState icon="filter" compact title="No operations" description="No scheduled operations match the filters." />
        ) : (
          <VirtualList items={bars} rowHeight={52} gap={6} height={Math.min(bars.length, 8) * 58} getKey={(b, i) => `${b.machine}-${b.order}-${b.sequence}-${i}`} renderRow={(b) => <OpRow b={b} />} />
        )}
      </OpsPanel>

      {/* Routing violations */}
      {model.violations.length > 0 && (
        <OpsPanel title="Routing Violations" subtitle={`${model.violations.length} blocked / unrouted operation(s)`}>
          <div className="space-y-1.5">
            {model.violations.slice(0, 40).map((v, i) => (
              <div key={i} className="surface-raised flex items-start gap-2 rounded-xl px-3.5 py-2 shadow-card">
                <Icon name="info" size={14} />
                <div className="text-xs">
                  <span className="font-medium">{v.order}</span>{v.operation !== '—' && <span className="text-faint"> · {v.operation} · {v.workCenter}</span>}
                  <div className="text-2xs text-faint">{v.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}
    </div>
  );
}
