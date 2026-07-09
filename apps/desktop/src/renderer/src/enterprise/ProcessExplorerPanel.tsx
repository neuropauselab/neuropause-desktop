/**
 * Enterprise → Process Explorer. A read-only visual explorer over the mined processes: it renders the
 * discovered directly-follows graph (interactive: zoom / pan, bottleneck + critical-path highlight, edge
 * frequencies, node counts), a filterable + virtualized case list, and a per-case detail with every stage
 * and a deterministic AI read. It fabricates nothing — every value comes from the Enterprise Process
 * Mining engine via the read-only `ipc.enterprise.processExplore` / `processCase` channels. No writes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WheelEvent as RWheelEvent, PointerEvent as RPointerEvent } from 'react';
import type {
  ProcessCaseDetail,
  ProcessCaseSummary,
  ProcessExplorerFilter,
  ProcessExplorerModel,
  ProcessGraph,
  ProcessRiskBand,
  ProcessType,
} from '@neuropause/shared';
import { PROCESS_TYPE_LABEL } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Spinner } from '@renderer/components/Spinner';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Button } from '@renderer/components/ui/Button';
import { VirtualList } from '@renderer/components/ui/VirtualList';
import { OpsPanel, Stat, StatusBadge, Bar } from '../operations/primitives';
import { DOT_BG, TEXT_TONE, TINT_TONE, type OpsTone, type EnterpriseTab } from './lib';

/* ── small presentational helpers ────────────────────────────────────────────── */

function fmtHours(h: number): string {
  if (h <= 0) return '0h';
  if (h < 1) return '<1h';
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
function bandTone(band?: 'healthy' | 'watch' | 'at-risk' | 'critical'): OpsTone {
  if (band === 'healthy') return 'green';
  if (band === 'watch') return 'orange';
  if (band === 'at-risk' || band === 'critical') return 'red';
  return 'accent';
}
function riskTone(r: ProcessRiskBand): OpsTone {
  return r === 'low' ? 'green' : r === 'medium' ? 'orange' : 'red';
}
function processTone(p: ProcessType): OpsTone {
  return p === 'order_to_cash' ? 'blue' : p === 'procure_to_pay' ? 'purple' : 'accent';
}
function statusTone(status: string, completed: boolean): OpsTone {
  if (completed || status === 'completed' || status === 'paid' || status === 'cleared' || status === 'done') return 'green';
  if (status === 'rejected' || status === 'cancelled' || status === 'void') return 'gray';
  return 'orange';
}

/* ── the interactive discovered process graph (hand-rolled SVG, no chart lib) ──── */

interface LayoutNode {
  activity: string;
  count: number;
  x: number;
  y: number;
}
interface LayoutEdge {
  from: string;
  to: string;
  count: number;
  hours: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bottleneck: boolean;
  critical: boolean;
}
interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

const NODE_W = 158;
const NODE_H = 54;
const COL_GAP = 210;
const ROW_GAP = 96;
const MARGIN = 44;

function computeLayout(graph: ProcessGraph, processType: ProcessType): GraphLayout {
  const nodes = graph.nodes.filter((n) => n.processType === processType);
  const edges = graph.edges.filter((e) => e.processType === processType);
  if (nodes.length === 0) return { nodes: [], edges: [], width: 320, height: 160 };

  // Longest-path layering (the DFG for a process is near-linear; ≤ a handful of nodes).
  const layer = new Map<string, number>();
  for (const n of nodes) layer.set(n.activity, 0);
  for (let i = 0; i < nodes.length; i += 1) {
    for (const e of edges) {
      const next = (layer.get(e.from) ?? 0) + 1;
      if (next > (layer.get(e.to) ?? 0)) layer.set(e.to, next);
    }
  }
  const byLayer = new Map<number, string[]>();
  for (const n of nodes) {
    const l = layer.get(n.activity) ?? 0;
    const arr = byLayer.get(l) ?? [];
    arr.push(n.activity);
    byLayer.set(l, arr);
  }
  const maxLayer = Math.max(...[...layer.values()]);
  const maxRows = Math.max(...[...byLayer.values()].map((a) => a.length));

  const pos = new Map<string, { x: number; y: number }>();
  for (const [l, acts] of byLayer) {
    acts.forEach((act, row) => {
      const rowsHere = acts.length;
      const yOffset = (maxRows - rowsHere) * (ROW_GAP / 2);
      pos.set(act, { x: MARGIN + l * COL_GAP, y: MARGIN + yOffset + row * ROW_GAP });
    });
  }

  // Bottleneck = slowest transition; critical path = longest total-duration path (by mean duration).
  const bottleneck = edges.reduce<typeof edges[number] | null>((m, e) => (m === null || e.meanDurationMs > m.meanDurationMs ? e : m), null);
  const ordered = [...nodes].sort((a, b) => (layer.get(a.activity) ?? 0) - (layer.get(b.activity) ?? 0));
  const best = new Map<string, { dist: number; prev: string | null }>();
  for (const n of nodes) best.set(n.activity, { dist: 0, prev: null });
  for (const n of ordered) {
    for (const e of edges) {
      if (e.from !== n.activity) continue;
      if ((layer.get(e.from) ?? 0) >= (layer.get(e.to) ?? 0)) continue; // forward edges only
      const nd = (best.get(e.from)?.dist ?? 0) + e.meanDurationMs;
      if (nd > (best.get(e.to)?.dist ?? 0)) best.set(e.to, { dist: nd, prev: e.from });
    }
  }
  let endAct = ordered[0]?.activity ?? '';
  let endDist = 0;
  for (const [act, b] of best) if (b.dist > endDist) { endDist = b.dist; endAct = act; }
  const criticalEdges = new Set<string>();
  let cur: string | null = endDist > 0 ? endAct : null;
  while (cur) {
    const prev = best.get(cur)?.prev ?? null;
    if (prev) criticalEdges.add(`${prev}→${cur}`);
    cur = prev;
  }

  const layoutEdges: LayoutEdge[] = edges.map((e) => {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    return {
      from: e.from,
      to: e.to,
      count: e.count,
      hours: e.meanDurationMs / (60 * 60 * 1000),
      x1: (a?.x ?? 0) + NODE_W,
      y1: (a?.y ?? 0) + NODE_H / 2,
      x2: b?.x ?? 0,
      y2: (b?.y ?? 0) + NODE_H / 2,
      bottleneck: bottleneck !== null && e.from === bottleneck.from && e.to === bottleneck.to,
      critical: criticalEdges.has(`${e.from}→${e.to}`),
    };
  });

  return {
    nodes: nodes.map((n) => ({ activity: n.activity, count: n.count, x: pos.get(n.activity)?.x ?? 0, y: pos.get(n.activity)?.y ?? 0 })),
    edges: layoutEdges,
    width: MARGIN * 2 + maxLayer * COL_GAP + NODE_W,
    height: MARGIN * 2 + (maxRows - 1) * ROW_GAP + NODE_H,
  };
}

function ProcessGraphView({ graph, processType }: { graph: ProcessGraph; processType: ProcessType }): JSX.Element {
  const layout = useMemo(() => computeLayout(graph, processType), [graph, processType]);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  // Reset the transform when the process changes.
  useEffect(() => setView({ scale: 1, tx: 0, ty: 0 }), [processType]);

  const onWheel = (e: RWheelEvent): void => {
    setView((v) => ({ ...v, scale: Math.max(0.4, Math.min(2.4, v.scale * (e.deltaY < 0 ? 1.1 : 0.9))) }));
  };
  const onPointerDown = (e: RPointerEvent): void => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  };
  const onPointerMove = (e: RPointerEvent): void => {
    if (!drag.current) return;
    setView((v) => ({ ...v, tx: drag.current!.tx + (e.clientX - drag.current!.x), ty: drag.current!.ty + (e.clientY - drag.current!.y) }));
  };
  const onPointerUp = (): void => { drag.current = null; };
  const zoom = (f: number): void => setView((v) => ({ ...v, scale: Math.max(0.4, Math.min(2.4, v.scale * f)) }));

  if (layout.nodes.length === 0) {
    return <EmptyState icon="activity" compact title="No graph for this process yet" description="No cases of this process type were reconstructed." />;
  }

  return (
    <div className="surface-raised relative overflow-hidden rounded-2xl shadow-card" style={{ height: 340 }}>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1.15)} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink">
          <Icon name="plus" size={14} />
        </button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(0.87)} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink">
          <Icon name="dot" size={14} />
        </button>
        <button type="button" aria-label="Reset view" title="Reset view" onClick={() => setView({ scale: 1, tx: 0, ty: 0 })} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink">
          <Icon name="refresh" size={14} />
        </button>
      </div>
      <div className="absolute left-3 top-3 z-10 flex items-center gap-3 text-2xs text-faint">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: 'var(--sysred, #e5484d)' }} /> Bottleneck</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-[var(--accent)]" /> Critical path</span>
      </div>
      <svg
        role="img"
        aria-label={`${PROCESS_TYPE_LABEL[processType]} process graph`}
        width="100%"
        height="100%"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {layout.edges.map((e) => {
            const midX = (e.x1 + e.x2) / 2;
            const stroke = e.bottleneck ? 'var(--sysred, #e5484d)' : e.critical ? 'var(--accent)' : 'var(--hairline)';
            const width = e.bottleneck ? 2.5 : e.critical ? 2 : 1.25;
            return (
              <g key={`${e.from}->${e.to}`}>
                <path d={`M ${e.x1} ${e.y1} C ${midX} ${e.y1}, ${midX} ${e.y2}, ${e.x2} ${e.y2}`} fill="none" stroke={stroke} strokeWidth={width} />
                <rect x={midX - 34} y={(e.y1 + e.y2) / 2 - 9} width={68} height={18} rx={9} fill="var(--fill-1)" stroke="var(--hairline)" />
                <text x={midX} y={(e.y1 + e.y2) / 2 + 3} textAnchor="middle" fontSize={9} fill="var(--text-faint, #8b8b8b)">{e.count}× · {fmtHours(e.hours)}</text>
              </g>
            );
          })}
          {layout.nodes.map((n) => (
            <g key={n.activity}>
              <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={12} fill="var(--fill-1)" stroke="var(--hairline)" strokeWidth={1.25} />
              <text x={n.x + 14} y={n.y + 22} fontSize={12} fontWeight={600} fill="var(--text-ink, currentColor)">{n.activity}</text>
              <text x={n.x + 14} y={n.y + 40} fontSize={10} fill="var(--text-faint, #8b8b8b)">{n.count} occurrence{n.count === 1 ? '' : 's'}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

/* ── one case row (virtualized) ──────────────────────────────────────────────── */

function CaseRow({ c, onOpen }: { c: ProcessCaseSummary; onOpen: (id: string) => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onOpen(c.caseId)}
      className="surface-raised flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left shadow-card transition hover:shadow-md"
    >
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT_TONE[processTone(c.processType)])}>
        <Icon name="activity" size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{c.label}</span>
          <StatusBadge tone={statusTone(c.status, c.completed)} label={c.completed ? 'Completed' : c.status} />
          {c.reworkCount > 0 && <span className={cn('text-2xs font-medium', TEXT_TONE.orange)}>{c.reworkCount} rework</span>}
        </div>
        <div className="mt-0.5 truncate text-2xs text-faint">
          {c.processLabel} · {c.stageCount} stages · {c.firstActivity} → {c.lastActivity}
        </div>
      </div>
      <div className="hidden w-20 shrink-0 sm:block">
        <div className="text-xs font-semibold tabular">{fmtHours(c.cycleHours)}</div>
        <div className="text-2xs text-faint">cycle</div>
      </div>
      <div className="hidden w-24 shrink-0 md:block">
        <Bar value={c.automationPct / 100} tone="blue" />
        <div className="mt-0.5 text-2xs text-faint">{c.automationPct}% auto</div>
      </div>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT_BG[riskTone(c.riskBand)])} title={`${c.riskBand} risk`} />
      <Icon name="chevron-right" size={15} />
    </button>
  );
}

/* ── case detail (every stage + the deterministic AI read + mined recommendations) ─ */

function CaseDetailView({
  detail,
  onBack,
  onNavigate,
}: {
  detail: ProcessCaseDetail;
  onBack: () => void;
  onNavigate?: (tab: EnterpriseTab, query?: string) => void;
}): JSX.Element {
  const s = detail.summary;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon="chevron-left" onClick={onBack}>Back to cases</Button>
        <span className="text-2xs text-faint">Case {s.caseId}</span>
      </div>

      <div className="surface-raised rounded-2xl p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', TINT_TONE[processTone(s.processType)])}>
            <Icon name="activity" size={16} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{s.label}</div>
            <div className="text-2xs text-faint">{s.processLabel}</div>
          </div>
          <span className="ml-auto"><StatusBadge tone={statusTone(s.status, s.completed)} label={s.completed ? 'Completed' : s.status} /></span>
          <span className={cn('rounded-full px-2 py-0.5 text-2xs font-medium', TINT_TONE[riskTone(s.riskBand)], TEXT_TONE[riskTone(s.riskBand)])}>{s.riskBand} risk</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Cycle" value={fmtHours(s.cycleHours)} />
          <MiniStat label="Waiting" value={fmtHours(s.waitingHours)} />
          <MiniStat label="Processing" value={fmtHours(s.processingHours)} />
          <MiniStat label="Automation" value={`${s.automationPct}%`} />
        </div>
      </div>

      {/* AI read — deterministic, from mined data only */}
      <div className="surface-raised rounded-2xl p-4 shadow-card">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><Icon name="sparkles" size={14} /> Executive explanation</div>
        <p className="text-sm text-muted">{detail.explanation}</p>
        <p className="mt-2 text-xs text-faint"><span className="font-medium text-muted">Root cause:</span> {detail.rootCause}</p>
        {detail.optimizations.length > 0 && (
          <div className="mt-3">
            <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Optimizations</div>
            <ul className="mt-1 space-y-1">
              {detail.optimizations.map((o, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-muted"><Icon name="lightbulb" size={13} /> {o}</li>
              ))}
            </ul>
          </div>
        )}
        {detail.nextActions.length > 0 && (
          <div className="mt-3">
            <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Next actions</div>
            <ul className="mt-1 space-y-1">
              {detail.nextActions.map((a, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-muted"><Icon name="arrow-right" size={13} /> {a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* The timeline of every stage — module, record, timestamp, actor, status */}
      <div className="surface-raised rounded-2xl p-4 shadow-card">
        <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold"><Icon name="clock" size={14} /> Process timeline · {detail.stages.length} events</div>
        <ol className="space-y-0">
          {detail.stages.map((st) => (
            <li key={st.index} className="relative flex gap-3 pb-4 last:pb-0">
              <div className="flex flex-col items-center">
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-full', TINT_TONE[st.terminal ? 'green' : st.approvalGate ? 'orange' : 'accent'])}>
                  <Icon name={st.automated ? 'cpu' : st.terminal ? 'check' : 'dot'} size={12} />
                </span>
                {st.index < detail.stages.length - 1 && <span className="mt-0.5 w-px flex-1 bg-[var(--hairline)]" />}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{st.activity}</span>
                  {st.automated && <span className={cn('text-2xs font-medium', TEXT_TONE.blue)}>automated</span>}
                  {st.approvalGate && <span className={cn('text-2xs font-medium', TEXT_TONE.orange)}>approval</span>}
                  {st.waitFromPrevHours > 0 && <span className="text-2xs text-faint">waited {fmtHours(st.waitFromPrevHours)}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-faint">
                  <span>{st.moduleId}</span>
                  <button
                    type="button"
                    className={cn('inline-flex items-center gap-1 hover:underline', TEXT_TONE.accent)}
                    title="Find this record in Enterprise Search"
                    onClick={() => onNavigate?.('search', st.recordKey)}
                  >
                    <Icon name="search" size={11} /> {st.recordKey}
                  </button>
                  <span>{new Date(st.timestampMs).toLocaleString()}</span>
                  {st.resource && <span>· {st.resource}</span>}
                  <span>· status {st.status}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {detail.recommendations.length > 0 && (
        <div className="surface-raised rounded-2xl p-4 shadow-card">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><Icon name="lightbulb" size={14} /> Recommendations for this process</div>
          <ul className="space-y-2">
            {detail.recommendations.map((r) => (
              <li key={r.id} className="text-xs">
                <div className="font-medium">{r.problem}</div>
                <div className="text-faint">{r.recommendedAction} · {r.eta}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-lg font-semibold tabular">{value}</div>
      <div className="text-2xs text-faint">{label}</div>
    </div>
  );
}

/* ── the panel ───────────────────────────────────────────────────────────────── */

const PAGE = 200;

export function ProcessExplorerPanel({ onNavigate }: { onNavigate?: (tab: EnterpriseTab, query?: string) => void }): JSX.Element {
  const [model, setModel] = useState<ProcessExplorerModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProcessExplorerFilter>({ limit: PAGE, offset: 0 });
  const [search, setSearch] = useState('');
  const [graphType, setGraphType] = useState<ProcessType | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProcessCaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Debounce the free-text search into the filter.
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => ({ ...f, search: search.trim() || undefined, offset: 0 })), 220);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    ipc.enterprise
      .processExplore(filter)
      .then((m) => {
        if (!alive) return;
        setModel(m);
        setGraphType((prev) => prev ?? (m.graph.nodes[0]?.processType ?? null));
        setError(null);
      })
      .catch((e) => alive && setError(`Process Explorer failed to load: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [filter]);

  const openCase = useCallback((id: string) => {
    setSelected(id);
    setDetail(null);
    setDetailLoading(true);
    ipc.enterprise
      .processCase(id)
      .then((d) => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, []);

  const graphTypes = useMemo(() => {
    if (!model) return [] as ProcessType[];
    return [...new Set(model.graph.nodes.map((n) => n.processType))];
  }, [model]);

  if (loading && !model) {
    return (
      <OpsPanel title="Process Explorer">
        <div className="flex items-center justify-center py-16"><Spinner size={20} /></div>
      </OpsPanel>
    );
  }
  if (error || !model) {
    return (
      <OpsPanel title="Process Explorer">
        <EmptyState icon="activity" title="Nothing to explore yet" description={error ?? 'No processes have been reconstructed. Create linked records (quotes, orders, purchase orders, production orders) and they will appear here.'} />
      </OpsPanel>
    );
  }
  if (model.insights.totalCases === 0) {
    return (
      <OpsPanel title="Process Explorer">
        <EmptyState icon="activity" title="No processes reconstructed yet" description="The Process Mining engine found no linked cases. As Sales, Procurement, and Manufacturing records accumulate, end-to-end processes appear here — reconstructed from real data only." />
      </OpsPanel>
    );
  }

  const activeType = graphType ?? graphTypes[0] ?? null;
  const totalPages = Math.max(1, Math.ceil(model.totalCases / PAGE));
  const page = Math.floor((filter.offset ?? 0) / PAGE) + 1;

  return (
    <div>
      {/* Explorer KPIs (the six additions) */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {model.explorerKpis.map((k) => (
          <Stat key={k.key} icon="pulse" label={k.label} value={<span className="text-base">{k.display}</span>} tone={bandTone(k.band)} />
        ))}
      </div>

      {/* Discovered, interactive process graph */}
      <OpsPanel
        title="Process Graph"
        subtitle={`${model.insights.totalCases} cases · avg cycle ${fmtHours(model.insights.avgProcessCycleHours)} · completion ${model.metrics.overall.completionRate}% · automation ${model.metrics.overall.automationCoverage}%`}
        actions={
          <div className="flex items-center gap-1">
            {graphTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setGraphType(t)}
                className={cn('rounded-lg px-2.5 py-1 text-xs font-medium transition', activeType === t ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink')}
              >
                {PROCESS_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        }
      >
        {activeType ? <ProcessGraphView graph={model.graph} processType={activeType} /> : <EmptyState icon="activity" compact title="No graph" description="No process graph is available." />}
      </OpsPanel>

      {/* Cases — filter + virtualized list, or the selected case's detail */}
      <OpsPanel title="Cases" subtitle={selected ? undefined : `${model.totalCases} matching`}>
        {selected ? (
          detailLoading ? (
            <div className="flex items-center justify-center py-16"><Spinner size={20} /></div>
          ) : detail ? (
            <CaseDetailView detail={detail} onBack={() => { setSelected(null); setDetail(null); }} onNavigate={onNavigate} />
          ) : (
            <EmptyState icon="activity" title="Case not found" description="This case is no longer available." action={<Button variant="secondary" size="sm" onClick={() => setSelected(null)}>Back</Button>} />
          )
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5">
                <Icon name="search" size={14} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search cases by customer, product, machine, activity…"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
                />
              </div>
              <FilterChips
                label="Process"
                active={filter.processType}
                options={graphTypes.map((t) => ({ value: t, label: PROCESS_TYPE_LABEL[t] }))}
                onPick={(v) => setFilter((f) => ({ ...f, processType: v as ProcessType | undefined, offset: 0 }))}
              />
              <FilterChips
                label="Risk"
                active={filter.riskBand}
                options={[{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]}
                onPick={(v) => setFilter((f) => ({ ...f, riskBand: v as ProcessRiskBand | undefined, offset: 0 }))}
              />
              <DimensionSelect label="Customer" values={model.facets.customers.map((f) => f.value)} value={filter.customer} onChange={(v) => setFilter((f) => ({ ...f, customer: v, offset: 0 }))} />
              <DimensionSelect label="Product" values={model.facets.products.map((f) => f.value)} value={filter.product} onChange={(v) => setFilter((f) => ({ ...f, product: v, offset: 0 }))} />
              <DimensionSelect label="Supplier" values={model.facets.suppliers.map((f) => f.value)} value={filter.supplier} onChange={(v) => setFilter((f) => ({ ...f, supplier: v, offset: 0 }))} />
              <DimensionSelect label="Machine" values={model.facets.machines.map((f) => f.value)} value={filter.machine} onChange={(v) => setFilter((f) => ({ ...f, machine: v, offset: 0 }))} />
            </div>

            {model.cases.length === 0 ? (
              <EmptyState icon="filter" compact title="No cases match" description="Adjust the filters to see reconstructed cases." />
            ) : (
              <VirtualList
                items={model.cases}
                rowHeight={64}
                gap={6}
                height={Math.min(model.cases.length, 8) * 70}
                getKey={(c) => c.caseId}
                renderRow={(c) => <CaseRow c={c} onOpen={openCase} />}
              />
            )}

            {model.totalCases > PAGE && (
              <div className="mt-3 flex items-center justify-between text-xs text-faint">
                <span>Showing {(filter.offset ?? 0) + 1}–{Math.min((filter.offset ?? 0) + PAGE, model.totalCases)} of {model.totalCases}</span>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setFilter((f) => ({ ...f, offset: Math.max(0, (f.offset ?? 0) - PAGE) }))}>Prev</Button>
                  <span>Page {page} / {totalPages}</span>
                  <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setFilter((f) => ({ ...f, offset: (f.offset ?? 0) + PAGE }))}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </OpsPanel>
    </div>
  );
}

/* ── filter controls ─────────────────────────────────────────────────────────── */

function FilterChips({ label, active, options, onPick }: { label: string; active?: string; options: { value: string; label: string }[]; onPick: (v: string | undefined) => void }): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <span className="text-2xs text-faint">{label}:</span>
      <button type="button" onClick={() => onPick(undefined)} className={cn('rounded-md px-2 py-1 text-2xs font-medium transition', active === undefined ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink')}>All</button>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onPick(active === o.value ? undefined : o.value)} className={cn('rounded-md px-2 py-1 text-2xs font-medium transition', active === o.value ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink')}>{o.label}</button>
      ))}
    </div>
  );
}

function DimensionSelect({ label, values, value, onChange }: { label: string; values: string[]; value?: string; onChange: (v: string | undefined) => void }): JSX.Element | null {
  if (values.length === 0) return null;
  return (
    <label className="flex items-center gap-1 text-2xs text-faint">
      {label}:
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="rounded-md border border-[var(--hairline)] bg-transparent px-1.5 py-1 text-2xs text-ink outline-none"
      >
        <option value="">All</option>
        {values.slice(0, 200).map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    </label>
  );
}
