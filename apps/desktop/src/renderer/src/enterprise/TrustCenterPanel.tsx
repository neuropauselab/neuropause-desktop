/**
 * Enterprise → Trust Center. A read-only view of the deterministic per-entity Trust Engine
 * (`ipc.enterprise.trustExplore`). It renders the nine trust KPIs, an enterprise trust dashboard
 * (score ring + level distribution + trend), an entity explorer with search + filtering, a per-entity
 * trust breakdown (every weighted factor + its evidence + trend sparkline), risk indicators, the trust
 * timeline/history (deterministic sparklines from real records), the relationship between trust and the
 * KPIs, and a deterministic AI narrative (executive explanation / root cause / improvement / compliance).
 * Trust is never calculated here and never mocked — the engine composes it from existing records; the AI
 * only explains.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  EnterpriseTrustModel,
  TrustProfile,
  TrustEntityKind,
  EntityTrustLevel,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Spinner } from '@renderer/components/Spinner';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Button } from '@renderer/components/ui/Button';
import { VirtualList } from '@renderer/components/ui/VirtualList';
import { OpsPanel, Stat, StatusBadge, Bar } from '../operations/primitives';
import { ScoreRing, MiniBars } from './primitives';
import { TEXT_TONE, TINT_TONE, type OpsTone } from './lib';

/* ── tone + label helpers ──────────────────────────────────────────────────────── */

function bandTone(band?: 'healthy' | 'watch' | 'at-risk' | 'critical'): OpsTone {
  if (band === 'healthy') return 'green';
  if (band === 'watch') return 'orange';
  if (band === 'at-risk' || band === 'critical') return 'red';
  return 'accent';
}
function levelTone(l: EntityTrustLevel): OpsTone {
  switch (l) {
    case 'excellent':
      return 'green';
    case 'good':
      return 'accent';
    case 'moderate':
      return 'blue';
    case 'low':
      return 'orange';
    case 'critical':
      return 'red';
    default:
      return 'gray';
  }
}
function trendIcon(d: 'up' | 'down' | 'flat'): IconName {
  return d === 'up' ? 'arrow-up' : d === 'down' ? 'arrow-right' : 'dot';
}
function trendTone(d: 'up' | 'down' | 'flat'): OpsTone {
  return d === 'up' ? 'green' : d === 'down' ? 'red' : 'gray';
}

const KIND_META: Record<TrustEntityKind, { icon: IconName; label: string }> = {
  customer: { icon: 'user', label: 'Customer' },
  supplier: { icon: 'package', label: 'Supplier' },
  employee: { icon: 'user', label: 'Employee' },
  machine: { icon: 'cpu', label: 'Machine' },
  product: { icon: 'tag', label: 'Product' },
  warehouse: { icon: 'database', label: 'Warehouse' },
  workCenter: { icon: 'grid', label: 'Work Center' },
  asset: { icon: 'server', label: 'Asset' },
  process: { icon: 'activity', label: 'Process' },
  decision: { icon: 'shield', label: 'Decision' },
  proposal: { icon: 'lightbulb', label: 'Proposal' },
  knowledge: { icon: 'memory', label: 'Knowledge' },
  document: { icon: 'doc', label: 'Document' },
  productionOrder: { icon: 'checklist', label: 'Production Order' },
  schedule: { icon: 'clock', label: 'Schedule' },
  execution: { icon: 'activity', label: 'Execution' },
  quality: { icon: 'shield', label: 'Quality' },
  workOrder: { icon: 'checklist', label: 'Work Order' },
  downtime: { icon: 'stop', label: 'Downtime' },
  payment: { icon: 'bolt', label: 'Payment' },
  invoice: { icon: 'doc', label: 'Invoice' },
  purchaseOrder: { icon: 'doc', label: 'Purchase Order' },
  goodsReceipt: { icon: 'package', label: 'Goods Receipt' },
  order: { icon: 'doc', label: 'Order' },
  quote: { icon: 'doc', label: 'Quote' },
  bom: { icon: 'layers', label: 'BOM' },
};
const kindMeta = (k: TrustEntityKind): { icon: IconName; label: string } => KIND_META[k] ?? { icon: 'dot', label: k };

/* ── rows ──────────────────────────────────────────────────────────────────────── */

function EntityRow({ p, onSelect, active }: { p: TrustProfile; onSelect: (id: string) => void; active: boolean }): JSX.Element {
  const meta = kindMeta(p.kind);
  return (
    <button type="button" onClick={() => onSelect(p.id)} className={cn('surface-raised flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-left shadow-card transition', active ? 'ring-1 ring-[var(--accent)]' : 'hover:text-ink')}>
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT_TONE[levelTone(p.level)])}><Icon name={meta.icon} size={14} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{p.label}</span>
          <span className="text-2xs text-faint">{meta.label}</span>
        </div>
        <div className="truncate text-2xs text-faint">{p.factors.length} factor(s) · {p.coverage}% coverage · risk {p.risk}</div>
      </div>
      <div className="hidden w-16 shrink-0 sm:block"><MiniBars values={p.trend.sparkline} tone={levelTone(p.level)} height={22} /></div>
      <div className="flex shrink-0 items-center gap-2">
        <Icon name={trendIcon(p.trend.direction)} size={12} />
        <span className="w-8 text-right text-sm font-semibold tabular">{p.score}</span>
        <StatusBadge tone={levelTone(p.level)} label={p.level} />
      </div>
    </button>
  );
}

function FactorRow({ f }: { f: TrustProfile['factors'][number] }): JSX.Element {
  const tone: OpsTone = f.value >= 80 ? 'green' : f.value >= 55 ? 'blue' : f.value >= 35 ? 'orange' : 'red';
  return (
    <div className="surface-raised rounded-xl px-3.5 py-2.5 shadow-card">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{f.label}</span>
        <span className="ml-auto text-sm font-semibold tabular">{f.value}</span>
        <span className="text-2xs text-faint">×{f.weight}</span>
      </div>
      <div className="mt-1.5"><Bar value={f.value / 100} tone={tone} /></div>
      <div className="mt-1 flex items-center justify-between text-2xs text-faint">
        <span className="truncate">{f.detail}</span>
        <span className="shrink-0">contributes {f.contribution}</span>
      </div>
    </div>
  );
}

/* ── the panel ───────────────────────────────────────────────────────────────────── */

type View = 'dashboard' | 'entities' | 'breakdown' | 'risk' | 'trends';
const VIEWS: Array<{ id: View; label: string; icon: IconName }> = [
  { id: 'dashboard', label: 'Dashboard', icon: 'gauge' },
  { id: 'entities', label: 'Entities', icon: 'list' },
  { id: 'breakdown', label: 'Breakdown', icon: 'layers' },
  { id: 'risk', label: 'Risk', icon: 'shield' },
  { id: 'trends', label: 'Trust History', icon: 'pulse' },
];
const LEVELS: EntityTrustLevel[] = ['excellent', 'good', 'moderate', 'low', 'critical'];

export function TrustCenterPanel(): JSX.Element {
  const [model, setModel] = useState<EnterpriseTrustModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<string>('');

  const load = useCallback((silent = false) => {
    let alive = true;
    if (!silent) setLoading(true);
    ipc.enterprise
      .trustExplore()
      .then((m) => { if (alive) { setModel(m); setError(null); } })
      .catch((e) => alive && setError(`Trust Center failed to load: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => load(), [load]);

  const byId = useMemo(() => new Map((model?.profiles ?? []).map((p) => [p.id, p])), [model]);
  const selected = useMemo(() => {
    if (!model) return null;
    if (selectedId && byId.has(selectedId)) return byId.get(selectedId)!;
    return model.atRisk[0] ?? model.topTrusted[0] ?? model.profiles[0] ?? null;
  }, [model, selectedId, byId]);
  const select = useCallback((id: string) => { setSelectedId(id); setView('breakdown'); }, []);

  const filtered = useMemo(() => {
    if (!model) return [];
    const q = search.trim().toLowerCase();
    return model.profiles.filter((p) => {
      if (kindFilter && p.kind !== kindFilter) return false;
      if (levelFilter && p.level !== levelFilter) return false;
      if (q && !`${p.label} ${p.kind}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => a.score - b.score);
  }, [model, search, kindFilter, levelFilter]);

  const movers = useMemo(() => {
    if (!model) return [];
    return [...model.profiles].filter((p) => p.trend.direction !== 'flat').sort((a, b) => Math.abs(b.trend.delta) - Math.abs(a.trend.delta)).slice(0, 40);
  }, [model]);

  if (loading && !model) {
    return <OpsPanel title="Trust Center"><div className="flex items-center justify-center py-16"><Spinner size={20} /></div></OpsPanel>;
  }
  if (error && !model) {
    return <OpsPanel title="Trust Center"><EmptyState icon="shield" title="Unavailable" description={error} /></OpsPanel>;
  }
  if (!model) return <OpsPanel title="Trust Center"><EmptyState icon="shield" title="No trust data" description="Nothing to show." /></OpsPanel>;

  const KIND_OPTIONS = [...new Set(model.profiles.map((p) => p.kind))].sort();
  const ins = model.insights;
  const maxLevel = Math.max(1, ...LEVELS.map((l) => ins.byLevel[l]));

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] px-3.5 py-2 text-xs text-muted">
          <Icon name="info" size={14} /> {error}
        </div>
      )}

      {/* KPI strip (9 trust KPIs) */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {model.kpis.map((k) => (
          <Stat key={k.key} icon="shield" label={k.label} value={<span className="text-lg">{k.display}</span>} tone={bandTone(k.band)} />
        ))}
      </div>

      {/* Sub-nav + refresh */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => setView(v.id)} className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition', view === v.id ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink')}>
              <Icon name={v.icon} size={15} /> {v.label}
              {v.id === 'risk' && ins.lowTrustCount > 0 && <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-2xs font-semibold text-black">{ins.lowTrustCount}</span>}
            </button>
          ))}
        </nav>
        <span className="inline-flex shrink-0 items-center gap-2 text-2xs text-faint">
          {model.counts.profiles} entities scored
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => load()}>Refresh</Button>
        </span>
      </div>

      {/* DASHBOARD */}
      {view === 'dashboard' && (
        <>
          <OpsPanel title="Enterprise Trust" subtitle="Deterministic — a weighted average of evidence-backed factors; never AI-generated">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
              <div className="surface-raised flex flex-col items-center justify-center gap-2 rounded-2xl p-4 shadow-card">
                <ScoreRing value={ins.enterpriseTrust / 100} label="Enterprise Trust" tone={levelTone(model.profiles.length ? (ins.enterpriseTrust >= 90 ? 'excellent' : ins.enterpriseTrust >= 75 ? 'good' : ins.enterpriseTrust >= 55 ? 'moderate' : ins.enterpriseTrust >= 35 ? 'low' : 'critical') : 'moderate')} />
                <div className="flex items-center gap-1.5 text-2xs text-faint"><Icon name={trendIcon(model.trend.direction)} size={12} /> {model.trend.direction} {model.trend.delta !== 0 ? `${model.trend.delta > 0 ? '+' : ''}${model.trend.delta}` : ''}</div>
                <div className="w-24"><MiniBars values={model.trend.sparkline} tone="accent" height={26} /></div>
              </div>
              <div className="space-y-3">
                <div className="surface-raised rounded-2xl p-4 shadow-card">
                  <div className="mb-2 text-2xs font-medium text-faint">Trust level distribution</div>
                  <div className="space-y-1.5">
                    {LEVELS.map((l) => (
                      <div key={l} className="flex items-center gap-2">
                        <span className="w-16 text-2xs capitalize text-muted">{l}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full [background:var(--fill-2)]">
                          <div className={cn('h-full rounded-full', TINT_TONE[levelTone(l)])} style={{ width: `${(ins.byLevel[l] / maxLevel) * 100}%` }} />
                        </div>
                        <span className="w-8 text-right text-2xs tabular text-faint">{ins.byLevel[l]}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat icon="user" label="Customer" value={`${ins.customerTrust}`} tone={ins.customerTrust >= 75 ? 'green' : ins.customerTrust >= 55 ? 'blue' : 'orange'} />
                  <Stat icon="package" label="Supplier" value={`${ins.supplierTrust}`} tone={ins.supplierTrust >= 75 ? 'green' : ins.supplierTrust >= 55 ? 'blue' : 'orange'} />
                  <Stat icon="cpu" label="Machine" value={`${ins.machineTrust}`} tone={ins.machineTrust >= 75 ? 'green' : ins.machineTrust >= 55 ? 'blue' : 'orange'} />
                  <Stat icon="activity" label="Operational" value={`${ins.operationalTrust}`} tone={ins.operationalTrust >= 75 ? 'green' : ins.operationalTrust >= 55 ? 'blue' : 'orange'} />
                </div>
              </div>
            </div>
          </OpsPanel>

          <OpsPanel title="Trust Intelligence" subtitle="Deterministic — the AI explains trust; it never calculates it">
            <div className="surface-raised space-y-2 rounded-2xl p-4 shadow-card">
              <p className="text-sm text-muted">{model.narrative.summary}</p>
              <p className="text-xs text-faint"><span className="font-medium text-muted">Executive:</span> {model.narrative.executiveExplanation}</p>
              <p className="text-xs text-faint"><span className="font-medium text-muted">Root cause:</span> {model.narrative.rootCauseExplanation}</p>
              <p className="text-xs text-faint"><span className="font-medium text-muted">Compliance:</span> {model.narrative.complianceSummary}</p>
              {model.narrative.improvementRecommendations.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {model.narrative.improvementRecommendations.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted"><Icon name="lightbulb" size={13} /> {r}</li>
                  ))}
                </ul>
              )}
            </div>
          </OpsPanel>
        </>
      )}

      {/* ENTITIES */}
      {view === 'entities' && (
        <OpsPanel title="Entity Explorer" subtitle={`${filtered.length} entity trust profile(s) · lowest first`}>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5">
              <Icon name="search" size={14} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entities…" className="w-full bg-transparent text-sm outline-none placeholder:text-faint" />
            </div>
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-xs text-ink outline-none">
              <option value="">All kinds</option>
              {KIND_OPTIONS.map((k) => <option key={k} value={k}>{kindMeta(k).label}</option>)}
            </select>
            <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-xs text-ink outline-none">
              <option value="">All levels</option>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon="list" compact title="No entities" description="No entities match the filters." />
          ) : (
            <VirtualList items={filtered} rowHeight={52} gap={6} height={Math.min(filtered.length, 11) * 58} getKey={(p) => p.id} renderRow={(p) => <EntityRow p={p} onSelect={select} active={selected?.id === p.id} />} />
          )}
        </OpsPanel>
      )}

      {/* BREAKDOWN */}
      {view === 'breakdown' && selected && (
        <OpsPanel
          title="Trust Breakdown"
          subtitle={`${selected.label} · ${kindMeta(selected.kind).label} · ${selected.factors.length} weighted factor(s)`}
          actions={<StatusBadge tone={levelTone(selected.level)} label={selected.level} />}
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
            <div className="surface-raised flex flex-col items-center justify-center gap-2 rounded-2xl p-4 shadow-card">
              <ScoreRing value={selected.score / 100} label="Trust Score" tone={levelTone(selected.level)} />
              <div className="flex items-center gap-1.5 text-2xs text-faint"><Icon name={trendIcon(selected.trend.direction)} size={12} /> {selected.trend.direction} · risk {selected.risk} · {selected.coverage}% coverage</div>
              <div className="w-28"><MiniBars values={selected.trend.sparkline} tone={levelTone(selected.level)} height={28} /></div>
            </div>
            <div className="space-y-2">
              {selected.factors.length === 0 ? (
                <EmptyState icon="layers" compact title="No factors" description="This entity has no evidenced trust factors." />
              ) : (
                [...selected.factors].sort((a, b) => a.value - b.value).map((f) => <FactorRow key={f.key} f={f} />)
              )}
            </div>
          </div>
        </OpsPanel>
      )}

      {/* RISK */}
      {view === 'risk' && (
        <OpsPanel title="Risk Indicators" subtitle={`${model.atRisk.length} low / critical trust entity(ies) · ${ins.highRiskCount} high-risk`}>
          {model.atRisk.length === 0 ? (
            <EmptyState icon="shield" compact title="No trust risks" description="No entity is at low or critical trust." />
          ) : (
            <VirtualList items={model.atRisk} rowHeight={52} gap={6} height={Math.min(model.atRisk.length, 11) * 58} getKey={(p) => p.id} renderRow={(p) => <EntityRow p={p} onSelect={select} active={selected?.id === p.id} />} />
          )}
        </OpsPanel>
      )}

      {/* TRUST HISTORY / TRENDS */}
      {view === 'trends' && (
        <OpsPanel title="Trust History" subtitle={`${movers.length} entity(ies) with a measured trend · deterministic from record history`}>
          {movers.length === 0 ? (
            <EmptyState icon="pulse" compact title="No measured trends" description="Trends appear once entities accrue dated records across periods." />
          ) : (
            <div className="space-y-2">
              {movers.map((p) => (
                <div key={p.id} className="surface-raised flex items-center gap-3 rounded-xl px-3.5 py-2.5 shadow-card">
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT_TONE[levelTone(p.level)])}><Icon name={kindMeta(p.kind).icon} size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <button type="button" className="truncate text-sm font-medium hover:underline" onClick={() => select(p.id)}>{p.label}</button>
                    <div className="truncate text-2xs text-faint">{kindMeta(p.kind).label} · score {p.score} · {p.level}</div>
                  </div>
                  <div className="w-24 shrink-0"><MiniBars values={p.trend.sparkline} tone={trendTone(p.trend.direction)} height={24} /></div>
                  <span className={cn('flex shrink-0 items-center gap-1 text-xs font-medium', p.trend.direction === 'up' ? TEXT_TONE.green : p.trend.direction === 'down' ? TEXT_TONE.red : TEXT_TONE.gray)}>
                    <Icon name={trendIcon(p.trend.direction)} size={12} /> {p.trend.delta > 0 ? '+' : ''}{p.trend.delta}
                  </span>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}
    </div>
  );
}
