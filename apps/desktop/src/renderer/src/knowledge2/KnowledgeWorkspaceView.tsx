/**
 * Knowledge Workspace v1.0 — the unified, READ-ONLY knowledge lens.
 *
 * A PRESENTATION LAYER over EXISTING IPC: federated Enterprise Search, AI Memory + knowledge topics, the
 * Knowledge Graph (EKG) + Enterprise org graph, the P16 Knowledge Fabric, Executive Decisions + Governance
 * traces, and enterprise Governance / Compliance. It creates no store, index, search engine, or graph,
 * duplicates nothing, and mutates nothing — every action is a deep-link into the EXISTING center (AI Memory,
 * Knowledge Fabric, Enterprise). Knowledge capabilities the platform lacks in-app (a curated document /
 * research / architecture library, playbooks, SOPs) are shown honestly as gaps, never fabricated.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ComplianceFinding,
  EnterpriseSearchResult,
  ExecutiveDecision,
  FabricOverview,
  GovernanceConfig,
  GovernanceTraceList,
  GraphCounts,
  MemoryCounts,
  OrgGraph,
  SearchSourceKind,
} from '@neuropause/shared';
import { SEARCH_SOURCE_KINDS } from '@neuropause/shared';
import type { SectionId } from '@renderer/shell/sections';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { formatRelative } from '@renderer/lib/format';
import { useShell } from '@renderer/state/ShellProvider';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Field, Grid, KpiCard, LoadingBlock, Meter } from '@renderer/operationsCenter/primitives';
import {
  KNOWLEDGE_GAPS,
  bandTone,
  complianceStatusTone,
  keywordTone,
  knowledgeGapMeta,
  severityTone,
  summarizeDecisions,
  summarizeMemory,
  summarizeSearch,
} from './knowledgeModel';

type KnowledgeTopics = Awaited<ReturnType<typeof ipc.knowledge.topics>>;

type Tab = 'overview' | 'search' | 'memory' | 'graph' | 'fabric' | 'decisions' | 'policies';

interface Data {
  memory: MemoryCounts | null;
  topics: KnowledgeTopics;
  graph: GraphCounts | null;
  orgGraph: OrgGraph | null;
  fabric: FabricOverview | null;
  decisions: ExecutiveDecision[];
  traces: GovernanceTraceList;
  governance: GovernanceConfig | null;
  compliance: ComplianceFinding[];
}

const EMPTY: Data = {
  memory: null,
  topics: { topics: [], total: 0 },
  graph: null,
  orgGraph: null,
  fabric: null,
  decisions: [],
  traces: { decisions: [], total: 0 },
  governance: null,
  compliance: [],
};

const SOURCE_META: Record<SearchSourceKind, { label: string; icon: IconName }> = {
  entity: { label: 'Entities', icon: 'grid' },
  graph: { label: 'Knowledge Graph', icon: 'database' },
  memory: { label: 'AI Memory', icon: 'memory' },
  timeline: { label: 'Timeline', icon: 'clock' },
  federation: { label: 'Federation', icon: 'globe' },
};

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export function KnowledgeWorkspaceView(): JSX.Element {
  const { setSection } = useShell();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [d, setD] = useState<Data>(EMPTY);

  const refresh = useCallback(async () => {
    const [memory, topics, graph, orgGraph, fabric, decisions, traces, governance, compliance] = await Promise.all([
      settled(ipc.memory.counts(), null),
      settled(ipc.knowledge.topics(), { topics: [], total: 0 } as KnowledgeTopics),
      settled(ipc.graph.counts(), null),
      settled(ipc.enterprise.graph(), null),
      settled(ipc.knowledgeFabric.overview(), null),
      settled(ipc.decisions.list(), { decisions: [] as ExecutiveDecision[] }),
      settled(ipc.governance.list(), { decisions: [], total: 0 } as GovernanceTraceList),
      settled(ipc.enterprise.governanceConfig(), null),
      settled(ipc.enterprise.compliance(), [] as ComplianceFinding[]),
    ]);
    setD({ memory, topics, graph, orgGraph, fabric, decisions: decisions.decisions, traces, governance, compliance });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    const offMemory = ipc.memory.onChange(() => void refresh());
    const offGraph = ipc.graph.onChange(() => void refresh());
    return () => {
      offMemory();
      offGraph();
    };
  }, [refresh]);

  const go: Go = { setSection };

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Overview', icon: 'gauge' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'memory', label: 'Memory', icon: 'memory' },
    { id: 'graph', label: 'Graph', icon: 'database' },
    { id: 'fabric', label: 'Knowledge Fabric', icon: 'layers' },
    { id: 'decisions', label: 'Decisions', icon: 'sparkles' },
    { id: 'policies', label: 'Policies', icon: 'shield' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--hairline)] px-8 pt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1>
            <p className="mt-0.5 text-sm text-faint">
              One lens over everything the organization knows — federated search, memory, the knowledge graph,
              the knowledge fabric, decisions & governance.
            </p>
          </div>
          <div className="text-right text-xs text-faint">
            <div className="font-medium text-muted">{(d.memory?.total ?? 0).toLocaleString()} memories</div>
            <div>{d.topics.total} topics · {d.graph?.nodes ?? 0} graph nodes</div>
          </div>
        </div>
        <nav className="mt-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium transition-colors',
                tab === t.id ? 'text-ink [border-bottom:2px_solid_var(--accent)]' : 'text-muted hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
        {!ready ? (
          <LoadingBlock label="Loading knowledge…" />
        ) : (
          <div className="mx-auto" style={{ maxWidth: 1120 }}>
            {tab === 'overview' && <OverviewTab d={d} />}
            {tab === 'search' && <SearchTab />}
            {tab === 'memory' && <MemoryTab d={d} go={go} />}
            {tab === 'graph' && <GraphTab d={d} go={go} />}
            {tab === 'fabric' && <FabricTab d={d} go={go} />}
            {tab === 'decisions' && <DecisionsTab d={d} go={go} />}
            {tab === 'policies' && <PoliciesTab d={d} go={go} />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

interface Go {
  setSection: (id: SectionId) => void;
}

function DeepLink({ label, onClick, icon = 'arrow-right' }: { label: string; onClick: () => void; icon?: IconName }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink"
    >
      {label}
      <Icon name={icon} size={13} />
    </button>
  );
}

function GapsPanel(): JSX.Element {
  const meta = knowledgeGapMeta();
  return (
    <OpsPanel title="Knowledge gaps (recorded honestly)" subtitle="Capabilities not present in-app — verified absent, never fabricated">
      <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
        {KNOWLEDGE_GAPS.map((g) => (
          <div key={g.area} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 shrink-0"><Icon name={meta.icon} size={14} className="text-faint" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink">{g.capability}</span>
                <span className="text-2xs text-faint">· {g.area}</span>
              </div>
              <div className="mt-0.5 text-xs text-faint">{g.reason}</div>
            </div>
            <StatusBadge tone={meta.tone} label={g.requirement} />
          </div>
        ))}
      </div>
    </OpsPanel>
  );
}

function ListPanel({ title, subtitle, actions, icon, emptyTitle, emptyHint, count, children }: {
  title: string;
  subtitle?: string;
  actions?: JSX.Element;
  icon: IconName;
  emptyTitle: string;
  emptyHint?: string;
  count: number;
  children: JSX.Element | JSX.Element[];
}): JSX.Element {
  return (
    <OpsPanel title={title} subtitle={subtitle} actions={actions}>
      {count === 0 ? (
        <EmptyState icon={icon} title={emptyTitle} hint={emptyHint} />
      ) : (
        <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">{children}</div>
      )}
    </OpsPanel>
  );
}

/** A compact distribution list from a Record<string, number>, largest first. */
function Distribution({ record, limit = 8 }: { record: Record<string, number>; limit?: number }): JSX.Element {
  const rows = Object.entries(record).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (rows.length === 0) return <EmptyState icon="list" title="Nothing to break down yet" />;
  return (
    <div className="surface-raised rounded-2xl px-4 py-1 shadow-card">
      {rows.map(([key, value]) => (
        <Field key={key} label={key} value={value.toLocaleString()} />
      ))}
    </div>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function OverviewTab({ d }: { d: Data }): JSX.Element {
  const policies = d.governance?.complianceRules.length ?? 0;
  return (
    <>
      <OpsPanel title="Knowledge at a glance">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat icon="memory" label="Memories" value={(d.memory?.total ?? 0).toLocaleString()} hint="AI Memory corpus" />
          <Stat icon="tag" label="Knowledge topics" value={d.topics.total} hint="clustered memories" />
          <Stat icon="database" label="Graph nodes" value={(d.graph?.nodes ?? 0).toLocaleString()} hint={`${(d.graph?.edges ?? 0).toLocaleString()} edges`} />
          <Stat icon="sparkles" label="Decisions" value={d.decisions.length} hint="executive decisions" />
          <Stat icon="shield" label="Policies" value={policies} hint="compliance rules" />
        </div>
      </OpsPanel>
      <GapsPanel />
    </>
  );
}

/* ── Search (the headline — federated enterprise search) ─────────────────── */

function SearchTab(): JSX.Element {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<EnterpriseSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResult(null);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      const res = await ipc.search.enterprise({ text: term, limit: 8 }).catch(() => null);
      if (!alive || id !== seq.current) return;
      setResult(res);
      setSearching(false);
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  const summary = summarizeSearch(result);
  const totalsBySource = new Map(summary.bySource.map((s) => [s.source, s.total]));

  return (
    <>
      <OpsPanel
        title="Enterprise Search"
        subtitle="One federated query across entities, the knowledge graph, AI memory, the timeline & federation — merged and ranked."
      >
        <div className="relative">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search everything the organization knows…"
            aria-label="Search enterprise knowledge"
            className="w-full rounded-xl border border-[var(--hairline)] bg-white/[0.03] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </div>

        {result && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-2xs text-faint">
            <span className="tabular-nums text-muted">{summary.total.toLocaleString()} matches</span>
            {summary.backends.length > 0 && <span>· backends: {summary.backends.join(', ')}</span>}
            {summary.bySource.map((s) => (
              <span key={s.source} className="rounded-full border border-[var(--hairline)] px-2 py-0.5">
                {SOURCE_META[s.source].label} {s.total}
              </span>
            ))}
          </div>
        )}
      </OpsPanel>

      {q.trim() === '' ? (
        <EmptyState icon="search" title="Search across every knowledge source" hint="Entities, knowledge graph, AI memory, timeline and federation — one ranked list." />
      ) : searching && !result ? (
        <LoadingBlock label="Searching…" />
      ) : !result || result.hits.length === 0 ? (
        <EmptyState icon="search" title="No matches" hint={`Nothing found for “${q.trim()}”.`} />
      ) : (
        SEARCH_SOURCE_KINDS.map((source) => {
          const hits = result.hits.filter((h) => h.source === source);
          if (hits.length === 0) return null;
          const meta = SOURCE_META[source];
          return (
            <OpsPanel key={source} title={meta.label} subtitle={`${totalsBySource.get(source) ?? hits.length} match(es) in this source`}>
              <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                {hits.map((h) => (
                  <div key={`${h.source}:${h.id}`} className="flex items-start gap-3 py-2.5">
                    <span className="mt-0.5 shrink-0"><Icon name={meta.icon} size={14} className="text-faint" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink">{h.title}</div>
                      <div className="truncate text-2xs text-faint">
                        {meta.label} · {h.kind}
                        {h.snippet ? ` — ${h.snippet}` : ''}
                      </div>
                    </div>
                    {h.timestamp && <span className="shrink-0 text-2xs text-faint">{formatRelative(h.timestamp)}</span>}
                  </div>
                ))}
              </div>
            </OpsPanel>
          );
        })
      )}
    </>
  );
}

/* ── Memory ──────────────────────────────────────────────────────────────── */

function MemoryTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const m = summarizeMemory(d.memory);
  return (
    <>
      <OpsPanel title="AI Memory" subtitle="The persisted memory corpus" actions={<DeepLink label="Open AI Memory" onClick={() => go.setSection('memory')} />}>
        <Grid cols={4}>
          <Stat icon="memory" label="Memories" value={m.total.toLocaleString()} />
          <Stat icon="tag" label="Kinds" value={m.kinds} hint={m.topKind ? `top: ${m.topKind.kind}` : undefined} />
          <Stat icon="connectors" label="Origins" value={m.origins} />
          <Stat icon="clock" label="Last built" value={m.lastBuiltAt ? formatRelative(m.lastBuiltAt) : '—'} />
        </Grid>
      </OpsPanel>

      {d.memory && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <OpsPanel title="By kind" subtitle="Memory kind distribution">
            <Distribution record={d.memory.byKind} />
          </OpsPanel>
          <OpsPanel title="By origin" subtitle="Where memories came from">
            <Distribution record={d.memory.byOrigin} />
          </OpsPanel>
        </div>
      )}

      <ListPanel
        title={`Knowledge topics (${d.topics.total})`}
        subtitle="Memory clusters derived from the corpus"
        icon="tag"
        emptyTitle="No topics yet"
        emptyHint="Topics appear once memories cluster."
        count={d.topics.topics.length}
      >
        {d.topics.topics.slice(0, 12).map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{t.label}</div>
              <div className="text-2xs text-faint">{t.entities.length} entities</div>
            </div>
            <span className="shrink-0 text-2xs tabular-nums text-faint">{t.size} memories</span>
          </div>
        ))}
      </ListPanel>
    </>
  );
}

/* ── Graph ───────────────────────────────────────────────────────────────── */

function GraphTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  return (
    <>
      <OpsPanel
        title="Knowledge Graph (EKG)"
        subtitle="The typed graph projected from the Unified Data Model"
        actions={<DeepLink label="Open Knowledge Fabric" onClick={() => go.setSection('knowledge-center')} />}
      >
        <Grid cols={4}>
          <Stat icon="database" label="Nodes" value={(d.graph?.nodes ?? 0).toLocaleString()} />
          <Stat icon="connectors" label="Edges" value={(d.graph?.edges ?? 0).toLocaleString()} />
          <Stat icon="grid" label="Node types" value={d.graph ? Object.keys(d.graph.byNodeType).length : 0} />
          <Stat icon="clock" label="Last built" value={d.graph?.lastBuiltAt ? formatRelative(d.graph.lastBuiltAt) : '—'} />
        </Grid>
      </OpsPanel>

      {d.graph && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <OpsPanel title="By node type" subtitle="Entity-derived graph nodes">
            <Distribution record={d.graph.byNodeType} />
          </OpsPanel>
          <OpsPanel title="By edge type" subtitle="Typed relationships">
            <Distribution record={d.graph.byEdgeType} />
          </OpsPanel>
        </div>
      )}

      <OpsPanel title="Enterprise org graph" subtitle="The org-structure graph (people, units, roles)">
        <Grid cols={3}>
          <Stat icon="user" label="Org nodes" value={(d.orgGraph?.counts.nodes ?? 0).toLocaleString()} />
          <Stat icon="connectors" label="Org edges" value={(d.orgGraph?.counts.edges ?? 0).toLocaleString()} />
          <Stat icon="clock" label="Built" value={d.orgGraph ? formatRelative(d.orgGraph.builtAt) : '—'} />
        </Grid>
      </OpsPanel>
    </>
  );
}

/* ── Knowledge Fabric ────────────────────────────────────────────────────── */

function FabricTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const f = d.fabric;
  if (!f) {
    return <EmptyState icon="layers" title="Knowledge Fabric unavailable" hint="The fabric overview could not be loaded." />;
  }
  const s = f.summary;
  return (
    <>
      <OpsPanel
        title="Knowledge Fabric"
        subtitle="A unified, explainable projection over the platform's knowledge systems"
        actions={<DeepLink label="Open Knowledge Fabric" onClick={() => go.setSection('knowledge-center')} />}
      >
        <Grid cols={4}>
          <Stat icon="database" label="Entities" value={s.totalEntities.toLocaleString()} />
          <Stat icon="connectors" label="Sources" value={`${s.liveSources}/${s.sourceCount}`} hint="live / total" />
          <Stat icon="layers" label="Relationships" value={s.relationships.toLocaleString()} />
          <Stat icon="tag" label="Semantic tags" value={s.semanticTags.toLocaleString()} />
        </Grid>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Meter value={Math.max(0, Math.min(100, s.overallHealth)) / 100} tone={bandTone(s.healthBand)} label="Overall health" trailing={`${Math.round(s.overallHealth)}%`} />
          <Meter value={Math.max(0, Math.min(100, s.evidenceCoverage)) / 100} tone="accent" label="Evidence coverage" trailing={`${Math.round(s.evidenceCoverage)}%`} />
          <Meter value={Math.max(0, Math.min(100, s.knowledgeCoverage)) / 100} tone="accent" label="Knowledge coverage" trailing={`${Math.round(s.knowledgeCoverage)}%`} />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <StatusBadge tone={bandTone(s.healthBand)} label={s.healthBand} />
          <span className="text-2xs text-faint">· {s.explanations.toLocaleString()} explainable subjects</span>
        </div>
      </OpsPanel>

      <OpsPanel title="Strategic KPIs" subtitle="Reused from the platform executive KPI set — never recomputed">
        {f.kpis.length === 0 ? (
          <EmptyState icon="analytics" title="No KPIs yet" />
        ) : (
          <Grid cols={4}>
            {f.kpis.map((kpi) => (
              <KpiCard key={kpi.key} kpi={kpi} tone={kpi.band ? bandTone(kpi.band) : 'accent'} />
            ))}
          </Grid>
        )}
      </OpsPanel>
    </>
  );
}

/* ── Decisions ───────────────────────────────────────────────────────────── */

function DecisionsTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const summary = summarizeDecisions(d.decisions);
  return (
    <>
      <OpsPanel title="Executive decisions" subtitle="Knowledge that drives action" actions={<DeepLink label="Open Enterprise" onClick={() => go.setSection('enterprise')} />}>
        <Grid cols={3}>
          <Stat icon="sparkles" label="Decisions" value={summary.total} />
          <Stat icon="bolt" label="High priority" tone={summary.highPriority > 0 ? 'orange' : 'gray'} value={summary.highPriority} hint="critical + high" />
          <Stat icon="gauge" label="Avg confidence" value={`${Math.round(summary.avgConfidence * 100)}%`} />
        </Grid>
      </OpsPanel>

      <ListPanel
        title="Recent decisions"
        icon="sparkles"
        emptyTitle="No decisions yet"
        emptyHint="Executive decisions appear here once recorded."
        count={d.decisions.length}
      >
        {d.decisions.slice(0, 10).map((dec) => (
          <div key={dec.id} className="flex items-start gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{dec.title}</div>
              <div className="truncate text-2xs text-faint">{dec.category} · {dec.priority} · {dec.businessImpact}</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-2xs tabular-nums text-faint">{Math.round(dec.confidence * 100)}%</span>
              <StatusBadge tone={keywordTone(dec.status)} label={dec.status} />
            </div>
          </div>
        ))}
      </ListPanel>

      <ListPanel
        title={`Governance traces (${d.traces.total})`}
        subtitle="Recent decision traces — how a decision connects to evidence"
        icon="checklist"
        emptyTitle="No decision traces yet"
        count={d.traces.decisions.length}
      >
        {d.traces.decisions.slice(0, 10).map((t) => (
          <div key={t.id} className="flex items-start gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{t.title}</div>
              <div className="truncate text-2xs text-faint">
                {t.actor.label ? `${t.actor.label} · ` : ''}{t.origin} · {formatRelative(t.at)}
              </div>
            </div>
          </div>
        ))}
      </ListPanel>
    </>
  );
}

/* ── Policies ────────────────────────────────────────────────────────────── */

function PoliciesTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const rules = d.governance?.complianceRules ?? [];
  const chains = d.governance?.approvalChains ?? [];
  const pass = d.compliance.filter((c) => c.status === 'pass').length;
  const warn = d.compliance.filter((c) => c.status === 'warn').length;
  const fail = d.compliance.filter((c) => c.status === 'fail').length;
  return (
    <>
      <OpsPanel title="Governance & compliance" subtitle="The policies knowledge is governed by" actions={<DeepLink label="Open Enterprise" onClick={() => go.setSection('enterprise')} />}>
        <Grid cols={4}>
          <Stat icon="clipboard" label="Compliance rules" value={rules.length} hint={`${rules.filter((r) => r.enabled).length} enabled`} />
          <Stat icon="checklist" label="Approval chains" value={chains.length} hint={`${chains.filter((c) => c.enabled).length} enabled`} />
          <Stat icon="check" label="Checks passing" tone={fail > 0 ? 'red' : warn > 0 ? 'orange' : 'green'} value={d.compliance.length ? `${pass}/${d.compliance.length}` : '—'} />
          <Stat icon="info" label="Findings" value={d.compliance.length} hint={`${warn} warn · ${fail} fail`} />
        </Grid>
      </OpsPanel>

      <ListPanel
        title="Compliance rules"
        subtitle="Enable/disable in Enterprise"
        icon="clipboard"
        emptyTitle="No compliance rules"
        count={rules.length}
      >
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{r.name}</div>
              <div className="text-2xs text-faint">{r.category}</div>
            </div>
            <StatusBadge tone={severityTone(r.severity)} label={r.severity} />
            <span className={cn('rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[10px] font-medium', r.enabled ? 'text-muted' : 'text-faint')}>
              {r.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        ))}
      </ListPanel>

      {chains.length > 0 && (
        <ListPanel title="Approval chains" icon="checklist" emptyTitle="No approval chains" count={chains.length}>
          {chains.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{c.name}</div>
                <div className="text-2xs text-faint">{c.steps.length} step(s)</div>
              </div>
              <StatusBadge tone={c.enabled ? 'green' : 'gray'} label={c.enabled ? 'Enabled' : 'Disabled'} />
            </div>
          ))}
        </ListPanel>
      )}

      <ListPanel
        title="Compliance findings"
        subtitle="Deterministic checks over live org state"
        icon="clipboard"
        emptyTitle="No findings"
        count={d.compliance.length}
      >
        {d.compliance.slice(0, 12).map((c) => (
          <div key={c.ruleId} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{c.ruleName}</div>
              <div className="truncate text-2xs text-faint">{c.category} · {c.detail}</div>
            </div>
            <StatusBadge tone={complianceStatusTone(c.status)} label={c.status} />
          </div>
        ))}
      </ListPanel>
    </>
  );
}
