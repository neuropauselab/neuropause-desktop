import { useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  ChangeImpactReport,
  EnterpriseIntelligenceReport,
  RootCauseReport,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Card } from '@renderer/components/ui/Card';
import { Spinner } from '@renderer/components/Spinner';
import { OpsPanel, Stat, StatusBadge, OpsTable } from '@renderer/operations/primitives';
import { SegmentedTabs, type SegmentedTabItem } from '@renderer/components/ui/pillTabs';
import { useOpsCenter } from '../OpsCenterProvider';
import {
  blastRadiusTone,
  buildGraphElements,
  domainLabel,
  filterGraph,
  graphDomains,
  hasRootCause,
  impactDomainRows,
  pct01,
  riskScoreTone,
  shortLabel,
  type GraphNode,
} from '../opsModel';
import { EmptyState, Field, Grid, Meter, Pill } from '../primitives';
import { GraphCanvas } from '../GraphCanvas';

interface PanelProps {
  report: EnterpriseIntelligenceReport;
  nowMs: number;
}

/* ── Dependency Explorer ────────────────────────────────────────────────────── */

type DepTab = 'spofs' | 'cycles' | 'bottlenecks' | 'chains';

export function DependencyPanel({ report }: PanelProps): JSX.Element {
  const dep = report.dependencies;
  const tabs: SegmentedTabItem<DepTab>[] = [
    { id: 'spofs', label: 'Single points of failure', icon: 'shield', count: dep.spofs.length },
    { id: 'cycles', label: 'Cycles', icon: 'refresh', count: dep.cycles.length },
    { id: 'bottlenecks', label: 'Bottlenecks', icon: 'filter', count: dep.bottlenecks.length },
    { id: 'chains', label: 'Failure chains', icon: 'list', count: dep.failureChains.length },
  ];
  const [tab, setTab] = useState<DepTab>('spofs');

  return (
    <div>
      <OpsPanel title="Dependency intelligence" subtitle={`${dep.criticalCount} critical entities · ${dep.cyclic ? 'cyclic' : 'acyclic'} graph`}>
        <Grid cols={4}>
          <Stat icon="shield" label="SPOFs" value={dep.spofs.length} tone={dep.spofs.length ? 'orange' : 'green'} />
          <Stat icon="refresh" label="Cycles" value={dep.cycles.length} tone={dep.cycles.length ? 'red' : 'green'} />
          <Stat icon="filter" label="Bottlenecks" value={dep.bottlenecks.length} tone={dep.bottlenecks.length ? 'orange' : 'green'} />
          <Stat icon="list" label="Failure chains" value={dep.failureChains.length} tone="blue" />
        </Grid>
      </OpsPanel>

      <div className="mb-4"><SegmentedTabs items={tabs} activeId={tab} onChange={setTab} ariaLabel="Dependency view" /></div>

      {tab === 'spofs' && (
        dep.spofs.length ? (
          <OpsTable head={<><Th>Entity</Th><Th>Domain</Th><Th className="text-right">Blast radius</Th><Th className="text-right">Dependents</Th><Th className="text-right">Risk</Th></>}>
            {dep.spofs.map((s) => (
              <tr key={s.id} className="border-t border-[var(--hairline)]">
                <Td className="font-medium">{s.label}</Td>
                <Td className="text-muted">{domainLabel(s.domain)}</Td>
                <Td className="text-right tabular">{s.blastRadius}</Td>
                <Td className="text-right tabular">{s.dependents}</Td>
                <Td className="text-right">{s.risk != null ? <span className={cn('font-semibold tabular', riskScoreTone(s.risk) === 'red' ? 'text-white' : 'text-white/80')}>{Math.round(s.risk)}</span> : <span className="text-faint">—</span>}</Td>
              </tr>
            ))}
          </OpsTable>
        ) : <EmptyState icon="check" title="No single points of failure" hint="Every critical entity has redundancy." />
      )}

      {tab === 'cycles' && (
        dep.cycles.length ? (
          <div className="flex flex-col gap-2">
            {dep.cycles.map((c, i) => (
              <Card key={i} variant="hairline">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-semibold">Cycle {i + 1}</span>
                  <Pill tone="red" label={`${c.size} nodes`} />
                </div>
                <ChainPath ids={c.nodes} loop />
                <div className="mt-2 text-2xs text-faint">Domains: {c.domains.map(domainLabel).join(', ')}</div>
              </Card>
            ))}
          </div>
        ) : <EmptyState icon="check" title="No dependency cycles" hint="The dependency graph is acyclic." />
      )}

      {tab === 'bottlenecks' && (
        dep.bottlenecks.length ? (
          <OpsTable head={<><Th>Entity</Th><Th>Domain</Th><Th className="text-right">Throughput</Th><Th className="text-right">In</Th><Th className="text-right">Out</Th></>}>
            {dep.bottlenecks.map((b) => (
              <tr key={b.id} className="border-t border-[var(--hairline)]">
                <Td className="font-medium">{b.label}</Td>
                <Td className="text-muted">{domainLabel(b.domain)}</Td>
                <Td className="text-right tabular">{b.throughput}</Td>
                <Td className="text-right tabular">{b.inDegree}</Td>
                <Td className="text-right tabular">{b.outDegree}</Td>
              </tr>
            ))}
          </OpsTable>
        ) : <EmptyState icon="filter" title="No bottlenecks" />
      )}

      {tab === 'chains' && (
        dep.failureChains.length ? (
          <div className="flex flex-col gap-2">
            {dep.failureChains.map((c, i) => (
              <Card key={i} variant="hairline">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-semibold">Chain {i + 1}</span>
                  <Pill tone="blue" label={`length ${c.length}`} />
                </div>
                <ChainPath ids={c.path} />
                <div className="mt-2 text-2xs text-faint">Domains: {c.domains.map(domainLabel).join(', ')}</div>
              </Card>
            ))}
          </div>
        ) : <EmptyState icon="list" title="No failure chains" />
      )}
    </div>
  );
}

function ChainPath({ ids, loop = false }: { ids: string[]; loop?: boolean }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ids.map((id, i) => (
        <span key={`${id}-${i}`} className="flex items-center gap-1.5">
          <span className="rounded-md bg-white/[0.06] px-2 py-1 text-2xs font-medium">{shortLabel(id)}</span>
          {i < ids.length - 1 && <Icon name="arrow-right" size={13} className="text-faint" />}
          {loop && i === ids.length - 1 && <Icon name="refresh" size={13} className="text-syspurple" />}
        </span>
      ))}
    </div>
  );
}

/* ── Change Impact Explorer ─────────────────────────────────────────────────── */

interface Candidate {
  id: string;
  label: string;
  domain: string;
}

export function ChangeImpactPanel({ report }: PanelProps): JSX.Element {
  const { loadChangeImpact } = useOpsCenter();
  const candidates = useMemo<Candidate[]>(() => {
    const seen = new Map<string, Candidate>();
    for (const s of report.dependencies.spofs) if (!seen.has(s.id)) seen.set(s.id, { id: s.id, label: s.label, domain: s.domain });
    for (const b of report.dependencies.bottlenecks) if (!seen.has(b.id)) seen.set(b.id, { id: b.id, label: b.label, domain: b.domain });
    for (const r of report.risk.topRisks) if (!seen.has(r.id)) seen.set(r.id, { id: r.id, label: r.label, domain: r.domain });
    return [...seen.values()];
  }, [report]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [impact, setImpact] = useState<ChangeImpactReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [errored, setErrored] = useState(false);
  const reqRef = useRef(0);

  const run = async (c: Candidate): Promise<void> => {
    const my = ++reqRef.current;
    setActiveId(c.id);
    setBusy(true);
    setImpact(null);
    setErrored(false);
    const res = await loadChangeImpact(c.id);
    if (reqRef.current !== my) return; // a newer selection superseded this response
    if (res) setImpact(res);
    else setErrored(true);
    setBusy(false);
  };

  if (!candidates.length) {
    return (
      <OpsPanel title="Change Impact Explorer" subtitle="Predict the blast radius of a change">
        <EmptyState icon="grid" title="No analyzable entities yet" hint="Change impact runs against structurally significant entities (SPOFs, bottlenecks, top risks). None are present in the current graph." />
      </OpsPanel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
      <OpsPanel title="Choose an entity" subtitle="Structurally significant nodes" className="mb-0">
        <div className="flex flex-col gap-1.5">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => void run(c)}
              className={cn('rounded-xl border p-2.5 text-left transition', c.id === activeId ? 'border-white/30 bg-white/[0.05]' : 'border-white/5 hover:border-white/15')}
            >
              <div className="truncate text-sm font-medium">{c.label}</div>
              <div className="text-2xs text-faint">{domainLabel(c.domain)}</div>
            </button>
          ))}
        </div>
      </OpsPanel>

      <div>
        {busy && <div className="flex items-center justify-center py-20"><Spinner /></div>}
        {!busy && errored && <EmptyState icon="info" title="Couldn’t compute change impact" hint="The analysis didn’t return. Select the entity again to retry." />}
        {!busy && !errored && impact && <ImpactResult impact={impact} />}
        {!busy && !errored && !impact && <EmptyState icon="arrow-right" title="Select an entity" hint="Pick an entity to model what a change or failure would touch — everything that transitively depends on it, grouped by domain." />}
      </div>
    </div>
  );
}

function ImpactResult({ impact }: { impact: ChangeImpactReport }): JSX.Element {
  const rows = impactDomainRows(impact);
  return (
    <div>
      <OpsPanel title={impact.label} subtitle={`${domainLabel(impact.domain)} · confidence ${pct01(impact.confidence)}`} className="mb-4">
        <Grid cols={3}>
          <Stat icon="pulse" label="Blast radius" value={impact.blastRadius} tone={blastRadiusTone(impact.blastRadius)} hint="entities affected" />
          <Stat icon="connectors" label="Direct dependents" value={impact.directDependents} tone={impact.directDependents ? 'orange' : 'green'} />
          <Stat icon="globe" label="Domains touched" value={rows.length} tone="blue" />
        </Grid>
      </OpsPanel>

      <OpsPanel title="Affected by domain" className="mb-0">
        {rows.length ? (
          <div className="flex flex-col gap-2.5">
            {rows.map((r) => (
              <Meter key={r.domain} value={r.share} tone="orange" label={r.label} trailing={`${r.count} · ${pct01(r.share)}`} />
            ))}
          </div>
        ) : (
          <EmptyState icon="check" title="No downstream impact" hint="Nothing depends on this entity — changing it is low-risk." />
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Root Cause Explorer ────────────────────────────────────────────────────── */

export function RootCausePanel({ report }: PanelProps): JSX.Element {
  const { loadRootCause } = useOpsCenter();
  const targets = useMemo<Candidate[]>(() => {
    const seen = new Map<string, Candidate>();
    for (const inc of report.incidents.incidents) {
      for (const rid of inc.resourceIds) if (!seen.has(rid)) seen.set(rid, { id: rid, label: shortLabel(rid), domain: 'infrastructure' });
    }
    for (const r of report.risk.topRisks) if (!seen.has(r.id)) seen.set(r.id, { id: r.id, label: r.label, domain: r.domain });
    return [...seen.values()].slice(0, 40);
  }, [report]);

  const [rc, setRc] = useState<RootCauseReport | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errored, setErrored] = useState(false);
  const reqRef = useRef(0);

  const run = async (targetResourceId?: string): Promise<void> => {
    const my = ++reqRef.current;
    setActiveId(targetResourceId ?? '__latest__');
    setBusy(true);
    setRc(null);
    setErrored(false);
    const res = await loadRootCause(targetResourceId ? { targetResourceId } : undefined);
    if (reqRef.current !== my) return; // a newer symptom superseded this response
    if (res) setRc(res);
    else setErrored(true);
    setBusy(false);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
      <OpsPanel title="Symptom" subtitle="Trace upstream to the cause" className="mb-0">
        <button
          type="button"
          onClick={() => void run(undefined)}
          className={cn('mb-3 w-full rounded-xl border p-3 text-left transition', activeId === '__latest__' ? 'border-white/30 bg-white/[0.05]' : 'border-white/5 hover:border-white/15')}
        >
          <div className="flex items-center gap-2 text-sm font-medium"><Icon name="bolt" size={15} className="text-muted" /> Analyze latest symptom</div>
          <div className="mt-0.5 text-2xs text-faint">Use the most recent observed event</div>
        </button>
        {targets.length > 0 && (
          <>
            <div className="mb-1.5 text-2xs uppercase tracking-wide text-faint">Or target a resource</div>
            <div className="flex flex-col gap-1.5">
              {targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void run(t.id)}
                  className={cn('rounded-xl border p-2.5 text-left transition', t.id === activeId ? 'border-white/30 bg-white/[0.05]' : 'border-white/5 hover:border-white/15')}
                >
                  <div className="truncate text-sm font-medium">{t.label}</div>
                  <div className="text-2xs text-faint">{domainLabel(t.domain)}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </OpsPanel>

      <div>
        {busy && <div className="flex items-center justify-center py-20"><Spinner /></div>}
        {!busy && errored && <EmptyState icon="info" title="Couldn’t analyze the symptom" hint="The root-cause search didn’t return. Choose the symptom again to retry." />}
        {!busy && !errored && !rc && activeId == null && <EmptyState icon="sparkles" title="Investigate a symptom" hint="Root-cause search walks UPSTREAM dependency edges from a symptom to earlier events on the resources it depends on, ranking candidates by proximity × precedence × severity." />}
        {!busy && !errored && rc && !hasRootCause(rc) && <EmptyState icon="check" title="No upstream cause found" hint="No earlier upstream event explains this symptom — it is likely the origin, or there are no correlated events for the target." />}
        {!busy && !errored && rc && hasRootCause(rc) && <RootCauseResult rc={rc} />}
      </div>
    </div>
  );
}

function RootCauseResult({ rc }: { rc: RootCauseReport }): JSX.Element {
  return (
    <div>
      <OpsPanel title="Symptom" subtitle={`Overall confidence ${pct01(rc.confidence)}`} className="mb-4">
        <Card variant="flat">
          <div className="flex items-center gap-2">
            <StatusBadge tone="orange" label="Symptom" />
            <span className="text-sm font-medium">{rc.symptom?.label}</span>
          </div>
          {rc.symptom?.resourceId && <div className="mt-1 text-2xs text-faint">{shortLabel(rc.symptom.resourceId)}</div>}
        </Card>
      </OpsPanel>

      <OpsPanel title="Ranked candidates" subtitle="Most probable upstream cause first" className="mb-0">
        <div className="flex flex-col gap-2">
          {rc.candidates.map((c, i) => (
            <Card key={c.eventId} variant="hairline">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-2xs font-semibold">{i + 1}</span>
                    <span className="truncate text-sm font-medium">{c.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{c.reason}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular">{pct01(c.confidence)}</div>
                  <div className="text-2xs text-faint">{c.hopDistance} hop{c.hopDistance === 1 ? '' : 's'}</div>
                </div>
              </div>
              <div className="mt-2"><Meter value={Math.max(0, Math.min(1, c.score))} tone={i === 0 ? 'red' : 'orange'} /></div>
            </Card>
          ))}
        </div>
      </OpsPanel>
    </div>
  );
}

/* ── Enterprise Graph Explorer ──────────────────────────────────────────────── */

export function GraphPanel({ report }: PanelProps): JSX.Element {
  const elements = useMemo(() => buildGraphElements(report.dependencies), [report.dependencies]);
  const domains = useMemo(() => graphDomains(elements), [elements]);
  const [domain, setDomain] = useState<string>('all');
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const filtered = useMemo(() => filterGraph(elements, domain), [elements, domain]);

  const domainTabs: SegmentedTabItem<string>[] = [
    { id: 'all', label: 'All domains', count: elements.nodes.length },
    ...domains.map((d) => ({ id: d, label: domainLabel(d), count: elements.nodes.filter((n) => n.domain === d).length })),
  ];

  if (!elements.nodes.length) {
    return (
      <OpsPanel title="Enterprise Graph Explorer" subtitle="Interactive dependency topology">
        <EmptyState icon="grid" title="No dependency structure to map" hint="The graph visualizes single points of failure, bottlenecks, failure chains and cycles found by the dependency engine. None are present — the enterprise graph is flat or fully redundant." />
      </OpsPanel>
    );
  }

  return (
    <div>
      <OpsPanel
        title="Enterprise Graph Explorer"
        subtitle="Drag to pan · scroll to zoom · click a node"
        actions={<span className="text-2xs text-faint">{filtered.nodes.length} nodes · {filtered.edges.length} edges</span>}
      >
        <div className="mb-3"><SegmentedTabs items={domainTabs} activeId={domain} onChange={setDomain} ariaLabel="Filter by domain" /></div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(0,300px)]">
          <GraphCanvas elements={filtered} selectedId={selected?.id ?? null} onSelectNode={setSelected} height={540} />
          <div>
            {selected ? (
              <Card variant="hairline">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">{selected.label}</span>
                  <Pill tone={selected.role === 'spof' ? 'red' : selected.role === 'bottleneck' ? 'orange' : selected.role === 'cycle' ? 'purple' : 'blue'} label={selected.role} />
                </div>
                <Field label="Domain" value={domainLabel(selected.domain)} />
                <Field label="Structural weight" value={selected.weight} />
                {selected.risk != null && <Field label="Risk" value={Math.round(selected.risk)} />}
                <Field label="Node id" value={<span className="text-2xs text-faint">{shortLabel(selected.id)}</span>} />
              </Card>
            ) : (
              <Card variant="hairline" className="text-center">
                <p className="py-6 text-xs text-faint">Select a node to inspect its role, domain, and structural weight.</p>
              </Card>
            )}
          </div>
        </div>
      </OpsPanel>
    </div>
  );
}

/* ── tiny table cells ───────────────────────────────────────────────────────── */

function Th({ children, className }: { children?: ReactNode; className?: string }): JSX.Element {
  return <th className={cn('px-3 py-2 font-semibold', className)}>{children}</th>;
}
function Td({ children, className }: { children?: ReactNode; className?: string }): JSX.Element {
  return <td className={cn('px-3 py-2.5', className)}>{children}</td>;
}
