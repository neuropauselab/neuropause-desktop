/**
 * Enterprise → Relationship Intelligence. A read-only, interactive view of the ERP entity relationship
 * graph derived from the real records (`ipc.enterprise.relationshipExplore`). It renders the live KPI
 * strip, an interactive zoom/pan ego-graph (click any node to re-centre), a relationship explorer, an
 * entity explorer with a 360° neighbourhood, a dependency tree, an impact analysis, the relationship
 * timeline, and a deterministic AI narrative — all with filters + search. Nothing here writes: every edge
 * is a foreign-key link already on the records, and traversal (neighbours / dependency / impact) reuses the
 * shared pure engine. No mock data.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WheelEvent as RWheelEvent, PointerEvent as RPointerEvent } from 'react';
import type {
  RelationshipGraphModel,
  RelationshipNode,
  RelationshipGraphEdge,
  RelationshipHealth,
  RelationshipEntityKind,
} from '@neuropause/shared';
import { relationshipNeighbors, dependencyTree, impactAnalysis } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Loading } from '@renderer/components/ui/Loading';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Button } from '@renderer/components/ui/Button';
import { VirtualList } from '@renderer/components/ui/VirtualList';
import { OpsPanel, Stat, StatusBadge, Bar } from '../operations/primitives';
import { TEXT_TONE, TINT_TONE, type OpsTone } from './lib';

/* ── tone + label helpers ──────────────────────────────────────────────────────── */

function bandTone(band?: 'healthy' | 'watch' | 'at-risk' | 'critical'): OpsTone {
  if (band === 'healthy') return 'green';
  if (band === 'watch') return 'orange';
  if (band === 'at-risk' || band === 'critical') return 'red';
  return 'accent';
}
function healthTone(h: RelationshipHealth): OpsTone {
  switch (h) {
    case 'strong':
      return 'green';
    case 'healthy':
      return 'blue';
    case 'weak':
      return 'orange';
    case 'critical':
    case 'broken':
      return 'red';
    default:
      return 'gray';
  }
}
function healthHex(h: RelationshipHealth): string {
  switch (h) {
    case 'strong':
      return '#46a758';
    case 'healthy':
      return '#6e8fd6';
    case 'weak':
      return '#f5a623';
    case 'critical':
    case 'broken':
      return '#e5484d';
    default:
      return '#8b8b8b';
  }
}

const KIND_META: Record<RelationshipEntityKind, { icon: IconName; label: string }> = {
  customer: { icon: 'user', label: 'Customer' },
  supplier: { icon: 'package', label: 'Supplier' },
  product: { icon: 'tag', label: 'Product' },
  warehouse: { icon: 'database', label: 'Warehouse' },
  machine: { icon: 'cpu', label: 'Machine' },
  workCenter: { icon: 'grid', label: 'Work Center' },
  technician: { icon: 'user', label: 'Technician' },
  asset: { icon: 'server', label: 'Asset' },
  bom: { icon: 'layers', label: 'BOM' },
  productionOrder: { icon: 'checklist', label: 'Production Order' },
  schedule: { icon: 'clock', label: 'Schedule' },
  execution: { icon: 'activity', label: 'Execution' },
  quality: { icon: 'shield', label: 'Quality' },
  order: { icon: 'doc', label: 'Order' },
  quote: { icon: 'doc', label: 'Quote' },
  invoice: { icon: 'doc', label: 'Invoice' },
  payment: { icon: 'bolt', label: 'Payment' },
  purchaseOrder: { icon: 'doc', label: 'Purchase Order' },
  goodsReceipt: { icon: 'package', label: 'Goods Receipt' },
  workOrder: { icon: 'checklist', label: 'Work Order' },
  downtime: { icon: 'stop', label: 'Downtime' },
  decision: { icon: 'shield', label: 'Decision' },
  proposal: { icon: 'lightbulb', label: 'Proposal' },
};
const kindMeta = (k: RelationshipEntityKind): { icon: IconName; label: string } => KIND_META[k] ?? { icon: 'dot', label: k };
const typeLabel = (t: string): string => t.replace(/_/g, ' ');
function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

/* ── interactive ego-graph (zoom + pan; click a node to re-centre) ─────────────────── */

const GW = 760;
const GH = 460;
const R = 168;

function RelationshipEgo({ model, selectedId, onSelect }: { model: RelationshipGraphModel; selectedId: string; onSelect: (id: string) => void }): JSX.Element {
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const ego = useMemo(() => relationshipNeighbors(model, selectedId), [model, selectedId]);

  const onWheel = (e: RWheelEvent): void => setView((v) => ({ ...v, scale: Math.max(0.4, Math.min(2.4, v.scale * (e.deltaY < 0 ? 1.12 : 0.9))) }));
  const onPointerDown = (e: RPointerEvent): void => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  };
  const onPointerMove = (e: RPointerEvent): void => {
    if (!drag.current) return;
    setView((v) => ({ ...v, tx: drag.current!.tx + (e.clientX - drag.current!.x), ty: drag.current!.ty + (e.clientY - drag.current!.y) }));
  };
  const onPointerUp = (): void => { drag.current = null; };

  if (!ego) return <EmptyState icon="grid" compact title="No entity selected" description="Pick an entity to explore its relationships." />;

  const neighbors = ego.neighbors.slice(0, 18);
  const cx = GW / 2;
  const cy = GH / 2;
  const center = ego.node;

  return (
    <div className="surface-raised overflow-hidden rounded-2xl shadow-card">
      <div className="flex items-center justify-between border-b border-[var(--hairline)] px-3 py-1.5">
        <div className="flex items-center gap-2 text-2xs text-faint">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: '#46a758' }} /> healthy</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: '#f5a623' }} /> weak</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: '#e5484d' }} /> critical/broken</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => setView((v) => ({ ...v, scale: Math.max(0.4, v.scale * 0.85) }))} className="flex h-6 w-6 items-center justify-center rounded-md text-muted fill-hover hover:text-ink"><Icon name="dot" size={13} /></button>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => setView((v) => ({ ...v, scale: Math.min(2.4, v.scale * 1.18) }))} className="flex h-6 w-6 items-center justify-center rounded-md text-muted fill-hover hover:text-ink"><Icon name="plus" size={13} /></button>
          <button type="button" aria-label="Reset" title="Reset view" onClick={() => setView({ scale: 1, tx: 0, ty: 0 })} className="flex h-6 w-6 items-center justify-center rounded-md text-muted fill-hover hover:text-ink"><Icon name="refresh" size={13} /></button>
        </div>
      </div>
      <div style={{ touchAction: 'none', cursor: drag.current ? 'grabbing' : 'grab' }} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
        <svg viewBox={`0 0 ${GW} ${GH}`} width="100%" height={GH} role="img" aria-label="Relationship graph">
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
            {neighbors.map((nb, i) => {
              const a = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2;
              const nx = cx + R * Math.cos(a);
              const ny = cy + R * Math.sin(a);
              return <line key={`e${i}`} x1={cx} y1={cy} x2={nx} y2={ny} stroke={healthHex(nb.edge.health)} strokeWidth={1 + nb.edge.strength / 60} strokeOpacity={0.5} />;
            })}
            {neighbors.map((nb, i) => {
              const a = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2;
              const nx = cx + R * Math.cos(a);
              const ny = cy + R * Math.sin(a);
              return (
                <g key={`n${i}`} onClick={() => onSelect(nb.node.id)} style={{ cursor: 'pointer' }}>
                  <circle cx={nx} cy={ny} r={16} fill="var(--fill-2)" stroke={healthHex(nb.node.health)} strokeWidth={2}>
                    <title>{`${kindMeta(nb.node.kind).label}: ${nb.node.label}\n${typeLabel(nb.edge.type)} · ${nb.edge.health} · risk ${nb.edge.risk} · strength ${nb.edge.strength}`}</title>
                  </circle>
                  <text x={nx} y={ny + 30} fontSize={9} textAnchor="middle" fill="var(--text-faint, #8b8b8b)">{nb.node.label.length > 14 ? `${nb.node.label.slice(0, 13)}…` : nb.node.label}</text>
                </g>
              );
            })}
            <circle cx={cx} cy={cy} r={26} fill="var(--fill-3, var(--fill-2))" stroke="var(--accent)" strokeWidth={2.5}>
              <title>{`${kindMeta(center.kind).label}: ${center.label}\n${center.degree} relationship(s) · ${center.health} · risk ${center.risk}`}</title>
            </circle>
            <text x={cx} y={cy + 44} fontSize={11} fontWeight={600} textAnchor="middle" fill="var(--text-ink, currentColor)">{center.label.length > 20 ? `${center.label.slice(0, 19)}…` : center.label}</text>
          </g>
        </svg>
      </div>
    </div>
  );
}

/* ── rows ──────────────────────────────────────────────────────────────────────── */

function EdgeRow({ e, byId, onSelect }: { e: RelationshipGraphEdge; byId: Map<string, RelationshipNode>; onSelect: (id: string) => void }): JSX.Element {
  const from = byId.get(e.from);
  const to = byId.get(e.to);
  return (
    <div className="surface-raised flex items-center gap-3 rounded-xl px-3.5 py-2 shadow-card">
      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', TINT_TONE[healthTone(e.health)])}><Icon name="connectors" size={12} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          <button type="button" className="truncate font-medium hover:underline" onClick={() => from && onSelect(from.id)}>{from?.label ?? e.from}</button>
          <Icon name="arrow-right" size={12} />
          <button type="button" className="truncate font-medium hover:underline" onClick={() => to && onSelect(to.id)}>{to?.label ?? e.to}</button>
          <StatusBadge tone={healthTone(e.health)} label={e.health} />
        </div>
        <div className="truncate text-2xs text-faint">{typeLabel(e.type)} · risk {e.risk} · strength {e.strength} · conf {e.confidence}%{e.weight > 0 ? ` · ${fmtNum(e.weight)}` : ''}{e.lastUpdated ? ` · ${e.lastUpdated.slice(0, 10)}` : ''}</div>
      </div>
      <div className="hidden w-16 shrink-0 sm:block"><Bar value={e.strength / 100} tone={healthTone(e.health)} /></div>
    </div>
  );
}

function EntityRow({ n, onSelect, active }: { n: RelationshipNode; onSelect: (id: string) => void; active: boolean }): JSX.Element {
  const meta = kindMeta(n.kind);
  return (
    <button type="button" onClick={() => onSelect(n.id)} className={cn('surface-raised flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-left shadow-card transition', active ? 'ring-1 ring-[var(--accent)]' : 'hover:text-ink')}>
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT_TONE[healthTone(n.health)])}><Icon name={meta.icon} size={14} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{n.label}</span>
          {!n.resolved && <span className={cn('text-2xs', TEXT_TONE.red)}>unresolved</span>}
        </div>
        <div className="truncate text-2xs text-faint">{meta.label} · {n.degree} link(s){n.value > 0 ? ` · ${fmtNum(n.value)}` : ''}</div>
      </div>
      <StatusBadge tone={healthTone(n.health)} label={n.health} />
    </button>
  );
}

/* ── the panel ───────────────────────────────────────────────────────────────────── */

type View = 'graph' | 'relationships' | 'entities' | 'dependency' | 'impact' | 'timeline';
const VIEWS: Array<{ id: View; label: string; icon: IconName }> = [
  { id: 'graph', label: 'Graph', icon: 'grid' },
  { id: 'relationships', label: 'Relationships', icon: 'connectors' },
  { id: 'entities', label: 'Entities', icon: 'list' },
  { id: 'dependency', label: 'Dependency Tree', icon: 'layers' },
  { id: 'impact', label: 'Impact', icon: 'pulse' },
  { id: 'timeline', label: 'Timeline', icon: 'clock' },
];

export function RelationshipIntelligencePanel(): JSX.Element {
  const [model, setModel] = useState<RelationshipGraphModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('graph');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [healthFilter, setHealthFilter] = useState<string>('');

  const load = useCallback((silent = false) => {
    let alive = true;
    if (!silent) setLoading(true);
    ipc.enterprise
      .relationshipExplore()
      .then((m) => { if (alive) { setModel(m); setError(null); } })
      .catch((e) => alive && setError(`Relationship Intelligence failed to load: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => load(), [load]);

  const byId = useMemo(() => new Map((model?.nodes ?? []).map((n) => [n.id, n])), [model]);
  const selected = useMemo(() => {
    if (!model) return null;
    if (selectedId && byId.has(selectedId)) return byId.get(selectedId)!;
    return model.topEntities[0] ?? model.nodes[0] ?? null;
  }, [model, selectedId, byId]);

  const select = useCallback((id: string) => setSelectedId(id), []);

  const filteredNodes = useMemo(() => {
    if (!model) return [];
    const q = search.trim().toLowerCase();
    return model.nodes.filter((n) => {
      if (kindFilter && n.kind !== kindFilter) return false;
      if (healthFilter && n.health !== healthFilter) return false;
      if (q && !`${n.label} ${n.kind}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
  }, [model, search, kindFilter, healthFilter]);

  const filteredEdges = useMemo(() => {
    if (!model) return [];
    const q = search.trim().toLowerCase();
    return model.edges.filter((e) => {
      if (healthFilter && e.health !== healthFilter) return false;
      if (q) {
        const f = byId.get(e.from)?.label ?? '';
        const t = byId.get(e.to)?.label ?? '';
        if (!`${f} ${t} ${e.type}`.toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.risk - a.risk || b.strength - a.strength);
  }, [model, search, healthFilter, byId]);

  const timeline = useMemo(() => {
    if (!model) return [];
    return [...model.edges].filter((e) => e.lastUpdated).sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated)).slice(0, 200);
  }, [model]);

  const dep = useMemo(() => (model && selected ? dependencyTree(model, selected.id, 3) : null), [model, selected]);
  const impact = useMemo(() => (model && selected ? impactAnalysis(model, selected.id, 3) : null), [model, selected]);
  const ego = useMemo(() => (model && selected ? relationshipNeighbors(model, selected.id) : null), [model, selected]);

  if (loading && !model) {
    return <OpsPanel title="Relationship Intelligence"><Loading kind="panel" label="Loading relationship intelligence…" /></OpsPanel>;
  }
  if (error && !model) {
    return <OpsPanel title="Relationship Intelligence"><EmptyState icon="connectors" title="Unavailable" description={error} /></OpsPanel>;
  }
  if (!model) return <OpsPanel title="Relationship Intelligence"><EmptyState icon="connectors" title="No graph" description="Nothing to show." /></OpsPanel>;

  const KIND_OPTIONS = [...new Set(model.nodes.map((n) => n.kind))].sort();

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] px-3.5 py-2 text-xs text-muted">
          <Icon name="info" size={14} /> {error}
        </div>
      )}

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {model.kpis.map((k) => (
          <Stat key={k.key} icon="connectors" label={k.label} value={<span className="text-lg">{k.display}</span>} tone={bandTone(k.band)} />
        ))}
      </div>

      {/* Sub-nav + refresh */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => setView(v.id)} className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition', view === v.id ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink')}>
              <Icon name={v.icon} size={15} /> {v.label}
              {v.id === 'relationships' && model.insights.criticalCount > 0 && <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-2xs font-semibold text-black">{model.insights.criticalCount}</span>}
            </button>
          ))}
        </nav>
        <span className="inline-flex shrink-0 items-center gap-2 text-2xs text-faint">
          {model.counts.nodes} entities · {model.counts.edges} links
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => load()}>Refresh</Button>
        </span>
      </div>

      {/* Shared filter bar (search + kind + health) */}
      {(view === 'graph' || view === 'relationships' || view === 'entities') && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5">
            <Icon name="search" size={14} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entities and relationships…" className="w-full bg-transparent text-sm outline-none focus-visible:shadow-focus placeholder:text-faint" />
          </div>
          {view !== 'relationships' && (
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-xs text-ink outline-none focus-visible:shadow-focus">
              <option value="">All kinds</option>
              {KIND_OPTIONS.map((k) => <option key={k} value={k}>{kindMeta(k).label}</option>)}
            </select>
          )}
          <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-xs text-ink outline-none focus-visible:shadow-focus">
            <option value="">All health</option>
            {['strong', 'healthy', 'weak', 'dormant', 'broken', 'critical'].map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
      )}

      {/* GRAPH */}
      {view === 'graph' && selected && (
        <>
          <OpsPanel
            title="Relationship Graph"
            subtitle={`${selected.label} · ${kindMeta(selected.kind).label} · ${selected.degree} relationship(s) · click a node to re-centre`}
            actions={<StatusBadge tone={healthTone(selected.health)} label={selected.health} />}
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
              <RelationshipEgo model={model} selectedId={selected.id} onSelect={select} />
              <div className="space-y-2">
                <div className="surface-raised rounded-xl p-3 shadow-card">
                  <div className="text-2xs text-faint">Selected entity</div>
                  <div className="mt-0.5 flex items-center gap-2"><Icon name={kindMeta(selected.kind).icon} size={15} /><span className="truncate text-sm font-medium">{selected.label}</span></div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-2xs text-faint">
                    <div>Degree<div className="text-sm font-semibold text-ink">{selected.degree}</div></div>
                    <div>Risk<div className="text-sm font-semibold text-ink">{selected.risk}</div></div>
                    <div>Activity<div className="text-sm font-semibold text-ink">{selected.activity}</div></div>
                    <div>Value<div className="text-sm font-semibold text-ink">{fmtNum(selected.value)}</div></div>
                  </div>
                </div>
                <div className="surface-raised max-h-[280px] overflow-y-auto rounded-xl p-2 shadow-card">
                  <div className="px-1.5 pb-1 text-2xs text-faint">Neighbours ({ego?.neighbors.length ?? 0})</div>
                  <div className="space-y-1">
                    {(ego?.neighbors ?? []).slice(0, 40).map((nb) => (
                      <button key={nb.edge.id} type="button" onClick={() => select(nb.node.id)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:text-ink">
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TINT_TONE[healthTone(nb.edge.health)])} />
                        <span className="truncate text-xs">{nb.direction === 'out' ? '→ ' : '← '}{nb.node.label}</span>
                        <span className="ml-auto shrink-0 text-2xs text-faint">{typeLabel(nb.edge.type)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </OpsPanel>

          <OpsPanel title="Relationship Intelligence" subtitle="Deterministic — explains the graph; never adds edges">
            <div className="surface-raised space-y-2 rounded-2xl p-4 shadow-card">
              <p className="text-sm text-muted">{model.narrative.summary}</p>
              <p className="text-xs text-faint"><span className="font-medium text-muted">Risk:</span> {model.narrative.riskExplanation}</p>
              <p className="text-xs text-faint"><span className="font-medium text-muted">Dependency:</span> {model.narrative.dependencyExplanation}</p>
              <p className="text-xs text-faint"><span className="font-medium text-muted">Business impact:</span> {model.narrative.businessImpact}</p>
              {model.narrative.recommendedActions.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {model.narrative.recommendedActions.map((a, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted"><Icon name="lightbulb" size={13} /> {a}</li>
                  ))}
                </ul>
              )}
            </div>
          </OpsPanel>
        </>
      )}

      {/* RELATIONSHIPS */}
      {view === 'relationships' && (
        <OpsPanel title="Relationship Explorer" subtitle={`${filteredEdges.length} relationship(s) · ranked by risk`}>
          {filteredEdges.length === 0 ? (
            <EmptyState icon="connectors" compact title="No relationships" description="No relationships match the filters." />
          ) : (
            <VirtualList items={filteredEdges} rowHeight={52} gap={6} height={Math.min(filteredEdges.length, 10) * 58} getKey={(e) => e.id} renderRow={(e) => <EdgeRow e={e} byId={byId} onSelect={select} />} />
          )}
        </OpsPanel>
      )}

      {/* ENTITIES */}
      {view === 'entities' && (
        <OpsPanel title="Entity Explorer" subtitle={`${filteredNodes.length} entity(ies) · click to explore its 360° neighbourhood`}>
          {filteredNodes.length === 0 ? (
            <EmptyState icon="list" compact title="No entities" description="No entities match the filters." />
          ) : (
            <VirtualList items={filteredNodes} rowHeight={52} gap={6} height={Math.min(filteredNodes.length, 10) * 58} getKey={(n) => n.id} renderRow={(n) => <EntityRow n={n} onSelect={(id) => { select(id); }} active={selected?.id === n.id} />} />
          )}
          {selected && ego && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-medium text-muted">{selected.label} · {ego.neighbors.length} relationship(s)</div>
              <div className="space-y-1.5">
                {ego.neighbors.slice(0, 30).map((nb) => (
                  <div key={nb.edge.id} className="surface-raised flex items-center gap-2 rounded-lg px-3 py-1.5 shadow-card">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TINT_TONE[healthTone(nb.edge.health)])} />
                    <span className="text-xs text-faint">{nb.direction === 'out' ? 'depends on' : 'referenced by'}</span>
                    <button type="button" className="truncate text-sm font-medium hover:underline" onClick={() => select(nb.node.id)}>{nb.node.label}</button>
                    <span className="ml-auto shrink-0 text-2xs text-faint">{typeLabel(nb.edge.type)} · {nb.edge.health}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </OpsPanel>
      )}

      {/* DEPENDENCY TREE */}
      {view === 'dependency' && selected && (
        <OpsPanel title="Dependency Tree" subtitle={`${selected.label} · ${dep?.totalDependencies ?? 0} downstream dependency(ies)`}>
          {!dep || dep.levels.length === 0 ? (
            <EmptyState icon="layers" compact title="No dependencies" description={`${selected.label} has no outward dependencies.`} />
          ) : (
            <div className="space-y-3">
              {dep.levels.map((lvl) => (
                <div key={lvl.depth}>
                  <div className="mb-1.5 text-2xs font-medium text-faint">Level {lvl.depth} · {lvl.nodes.length} entity(ies)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {lvl.nodes.slice(0, 60).map((n) => (
                      <button key={n.id} type="button" onClick={() => select(n.id)} className="surface-raised inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs shadow-card hover:text-ink">
                        <span className={cn('h-1.5 w-1.5 rounded-full', TINT_TONE[healthTone(n.health)])} />
                        <Icon name={kindMeta(n.kind).icon} size={12} /> {n.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}

      {/* IMPACT */}
      {view === 'impact' && selected && (
        <OpsPanel title="Impact Analysis" subtitle={`If ${selected.label} fails: ${impact?.reach ?? 0} entity(ies) reachable · ${impact?.atRisk ?? 0} already at-risk`}>
          {!impact || impact.affected.length === 0 ? (
            <EmptyState icon="pulse" compact title="No impact" description={`${selected.label} is isolated — nothing depends on it.`} />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {Object.entries(impact.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                  <span key={k} className="surface-raised inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs shadow-card">
                    <Icon name={kindMeta(k as RelationshipEntityKind).icon} size={12} /> {kindMeta(k as RelationshipEntityKind).label}: <span className="font-semibold">{n}</span>
                  </span>
                ))}
              </div>
              <VirtualList items={impact.affected} rowHeight={52} gap={6} height={Math.min(impact.affected.length, 9) * 58} getKey={(n) => n.id} renderRow={(n) => <EntityRow n={n} onSelect={select} active={false} />} />
            </>
          )}
        </OpsPanel>
      )}

      {/* TIMELINE */}
      {view === 'timeline' && (
        <OpsPanel title="Relationship Timeline" subtitle={`${timeline.length} relationship(s) · most recently active first`}>
          {timeline.length === 0 ? (
            <EmptyState icon="clock" compact title="No dated relationships" description="Relationships gain a timestamp from their underlying records." />
          ) : (
            <VirtualList items={timeline} rowHeight={52} gap={6} height={Math.min(timeline.length, 10) * 58} getKey={(e) => e.id} renderRow={(e) => <EdgeRow e={e} byId={byId} onSelect={select} />} />
          )}
        </OpsPanel>
      )}
    </div>
  );
}
