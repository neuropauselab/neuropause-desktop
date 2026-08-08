/**
 * P16 — Knowledge Fabric Center (the Knowledge Explorer). A continuously-updated, read-only view of the
 * enterprise knowledge fabric, composed from the EXISTING systems (Relationship graph, Enterprise
 * Intelligence, Strategy, Digital Twin, Timeline, AI-Memory corpus, Marketplace, Federation, Connectors).
 * Tabs: Fabric (sources + summary), Relationships, Classification, Lineage, Evidence (the unified
 * Evidence/Sources/Reasoning/Confidence explanation model), Governance, Analytics, and Explore (which
 * REUSES the existing Enterprise Search — no duplicate search). It relates, classifies, traces, and
 * explains but executes nothing and adds no new graph, memory, timeline, or search.
 * Reads via `ipc.knowledgeFabric.*`; refreshes on the existing `ecosystem:event` broadcast.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  EnterpriseSearchResult,
  FabricAnalytics,
  FabricClassification,
  FabricEvidenceReport,
  FabricExplanation,
  FabricGovernance,
  FabricKindCount,
  FabricLineage,
  FabricOverview,
  FabricRelationshipMap,
  FabricSource,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge, StatusDot } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import { bandLabel, bandTone, explanationIcon, lineageIcon, refIcon, sourceIcon } from './knowledgeCenterModel';

type Tab = 'fabric' | 'relationships' | 'classification' | 'lineage' | 'evidence' | 'governance' | 'analytics' | 'explore';

export function KnowledgeCenterView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [overview, setOverview] = useState<FabricOverview | null>(null);
  const [lineage, setLineage] = useState<FabricLineage | null>(null);
  const [evidence, setEvidence] = useState<FabricEvidenceReport | null>(null);
  const [governance, setGovernance] = useState<FabricGovernance | null>(null);
  const [tab, setTab] = useState<Tab>('fabric');

  const refresh = useCallback(async () => {
    try {
      const [o, l, e, g] = await Promise.all([
        ipc.knowledgeFabric.overview(),
        ipc.knowledgeFabric.lineage(),
        ipc.knowledgeFabric.evidence(),
        ipc.knowledgeFabric.governance(),
      ]);
      setOverview(o);
      setLineage(l);
      setEvidence(e);
      setGovernance(g);
    } catch {
      /* keep last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.knowledgeFabric.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'fabric', label: 'Fabric', icon: 'grid' },
    { id: 'relationships', label: 'Relationships', icon: 'connectors' },
    { id: 'classification', label: 'Classification', icon: 'tag' },
    { id: 'lineage', label: 'Lineage', icon: 'refresh' },
    { id: 'evidence', label: 'Evidence', icon: 'checklist' },
    { id: 'governance', label: 'Governance', icon: 'lock' },
    { id: 'analytics', label: 'Analytics', icon: 'analytics' },
    { id: 'explore', label: 'Explore', icon: 'search' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Enterprise Knowledge</h1>
            <p className="mt-1 text-md text-muted">
              A living, read-only knowledge fabric — every enterprise object related, classified, traced, and explained by composing the existing graph, timeline, strategy, twin, and memory. It enriches and explains; it never executes and adds no new graph, memory, or search.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink"
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>

        <nav className="mb-6 flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition',
                tab === t.id ? 'bg-white/10 text-ink' : 'text-muted hover:bg-white/5 hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </nav>

        {!ready ? (
          <LoadingBlock label="Composing the knowledge fabric…" />
        ) : tab === 'explore' ? (
          <Explore />
        ) : !overview ? (
          <EmptyState icon="grid" title="Knowledge fabric unavailable" hint="No fabric data could be loaded." />
        ) : tab === 'fabric' ? (
          <Fabric overview={overview} />
        ) : tab === 'relationships' ? (
          <Relationships map={overview.relationships} />
        ) : tab === 'classification' ? (
          <Classification data={overview.classification} />
        ) : tab === 'lineage' ? (
          <Lineage lineage={lineage} />
        ) : tab === 'evidence' ? (
          <Evidence report={evidence} />
        ) : tab === 'governance' ? (
          <Governance governance={governance} />
        ) : (
          <Analytics analytics={overview.analytics} />
        )}
      </div>
    </div>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

function Distribution({ title, subtitle, rows }: { title: string; subtitle: string; rows: FabricKindCount[] }): JSX.Element {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <OpsPanel title={title} subtitle={subtitle} className="mb-0">
      {rows.length === 0 ? (
        <p className="py-2 text-2xs text-faint">No data yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.slice(0, 12).map((r) => (
            <div key={r.key} className="rounded-xl border border-white/5 px-3 py-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="truncate text-sm font-medium">{r.label}</span>
                <span className="tabular text-2xs text-faint">{r.count.toLocaleString()}</span>
              </div>
              <Bar value={r.count / max} tone="blue" />
            </div>
          ))}
        </div>
      )}
    </OpsPanel>
  );
}

/* ── Fabric (overview) ───────────────────────────────────────────────────── */

function SourceRow({ s }: { s: FabricSource }): JSX.Element {
  return (
    <div className="rounded-xl border border-white/5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
          <Icon name={sourceIcon(s.category)} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{s.name}</span>
            <StatusBadge tone={bandTone(s.band)} label={bandLabel(s.band)} />
            {!s.live && <Pill tone="gray">projected</Pill>}
          </div>
          <div className="truncate text-2xs text-faint">{s.provenance}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular">{s.entityCount.toLocaleString()}</div>
          <div className="text-2xs text-faint">{s.contributionPercent}%</div>
        </div>
      </div>
    </div>
  );
}

function Fabric({ overview }: { overview: FabricOverview }): JSX.Element {
  const s = overview.summary;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="database" label="Known entities" value={s.totalEntities.toLocaleString()} hint={`${s.sourceCount} sources`} />
        <Stat icon="connectors" label="Relationships" value={s.relationships.toLocaleString()} tone="blue" />
        <Stat icon="checklist" label="Explanations" value={s.explanations} hint={`${s.evidenceCoverage}% evidenced`} tone="purple" />
        <Stat icon="pulse" label="Enterprise health" value={`${s.overallHealth}/100`} tone={bandTone(s.healthBand) === 'green' ? 'green' : 'orange'} />
      </Grid>
      <OpsPanel title="Knowledge sources" subtitle="Every source is a projection of an existing system — no new store or index" className="mt-6 mb-0">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {overview.sources.sources.map((src) => (
            <SourceRow key={src.id} s={src} />
          ))}
        </div>
        <p className="mt-3 text-2xs text-faint">{overview.sources.note}</p>
      </OpsPanel>
    </div>
  );
}

/* ── Relationships ───────────────────────────────────────────────────────── */

function Relationships({ map }: { map: FabricRelationshipMap }): JSX.Element {
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="connectors" label="Entities" value={map.nodes.toLocaleString()} />
        <Stat icon="grid" label="Relationships" value={map.edges.toLocaleString()} tone="blue" />
        <Stat icon="pulse" label="Relationship health" value={`${map.relationshipHealth}/100`} tone={map.relationshipHealth >= 60 ? 'green' : 'orange'} />
        <Stat icon="bolt" label="Critical / high-risk" value={`${map.criticalEdges} / ${map.highRiskEdges}`} tone={map.criticalEdges ? 'red' : 'gray'} />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Distribution title="By entity kind" subtitle="ERP master + transactional kinds" rows={map.byKind} />
        <Distribution title="By relationship type" subtitle="Typed business relations" rows={map.byType} />
        <Distribution title="By health" subtitle="Relationship edge health" rows={map.byHealth} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Top connected entities" subtitle="By degree — identities co-scoped with operations:read; numeric internals redacted" className="mb-0">
          {map.topEntities.length === 0 ? (
            <EmptyState icon="connectors" title="No entities" hint="The relationship graph is empty until records exist." />
          ) : (
            <div className="rounded-2xl border border-[var(--hairline)]">
              {map.topEntities.map((e) => (
                <div key={`${e.kind}:${e.label}`} className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5 last:border-0">
                  <StatusDot tone={bandTone(e.band)} />
                  <span className="truncate text-sm font-medium">{e.label}</span>
                  <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-2xs text-faint">{e.kind}</span>
                  <span className="ml-auto tabular text-2xs text-muted">{e.degree} links</span>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>

        <OpsPanel title="Relationship narrative" subtitle="Aggregate summary derived from the relationship graph" className="mb-0">
          <div className="flex flex-col gap-2 text-2xs text-muted">
            <p><span className="font-semibold text-ink">Summary. </span>{map.narrative.summary}</p>
          </div>
        </OpsPanel>
      </div>
      <p className="mt-4 text-2xs text-faint">{map.note}</p>
    </div>
  );
}

/* ── Classification ──────────────────────────────────────────────────────── */

function Classification({ data }: { data: FabricClassification }): JSX.Element {
  return (
    <div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Distribution title="By knowledge kind" subtitle="From the AI-Memory corpus" rows={data.byKind} />
        <Distribution title="By domain" subtitle="From the enterprise graph" rows={data.byDomain} />
        <Distribution title="By source" subtitle="Origin connector / manual" rows={data.bySource} />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Distribution title="Retention" subtitle="By recency (fresh / active / aging / stale)" rows={data.retention} />
        <Distribution title="Sensitivity" subtitle="Derived from kind (restricted / internal / general)" rows={data.sensitivity} />
      </div>
      <OpsPanel title="Semantic tags" subtitle="Top tags across the corpus" className="mt-6 mb-0">
        {data.topTags.length === 0 ? (
          <p className="py-2 text-2xs text-faint">No tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.topTags.map((t) => (
              <span key={t.tag} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-2xs">
                <Icon name="tag" size={11} />
                {t.tag}
                <span className="text-faint">{t.count}</span>
              </span>
            ))}
          </div>
        )}
      </OpsPanel>
      <p className="mt-4 text-2xs text-faint">{data.note}</p>
    </div>
  );
}

/* ── Lineage ─────────────────────────────────────────────────────────────── */

function Lineage({ lineage }: { lineage: FabricLineage | null }): JSX.Element {
  if (!lineage) return <LoadingBlock label="Loading lineage…" />;
  const max = lineage.stages.reduce((m, s) => Math.max(m, s.count), 0) || 1;
  return (
    <div>
      <Grid cols={2}>
        <Stat icon="refresh" label="Timeline events" value={lineage.totalEvents.toLocaleString()} hint={`last ${lineage.windowDays} days`} />
        <Stat icon="connectors" label="Causal chains" value={lineage.chains.length} tone="blue" />
      </Grid>
      <OpsPanel title="Knowledge lineage" subtitle="Origin → Transformation → Usage → Consumers, filtered from the platform timeline" className="mt-6 mb-0">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {lineage.stages.map((s) => (
            <div key={s.stage} className="rounded-xl border border-white/5 px-3 py-3">
              <div className="mb-1.5 flex items-center gap-2">
                <Icon name={lineageIcon(s.stage)} size={15} />
                <span className="text-sm font-medium">{s.label}</span>
                <span className="ml-auto tabular text-sm font-semibold">{s.count.toLocaleString()}</span>
              </div>
              <Bar value={s.count / max} tone="purple" />
              <p className="mt-1.5 text-2xs text-faint">{s.note}</p>
            </div>
          ))}
        </div>
      </OpsPanel>
      <OpsPanel title="Causal chains" subtitle="Correlation-keyed event chains (redacted to metadata — no identities)" className="mt-6 mb-0">
        {lineage.chains.length === 0 ? (
          <EmptyState icon="refresh" title="No chains" hint="No multi-event correlation chains in the window." />
        ) : (
          <div className="rounded-2xl border border-[var(--hairline)]">
            {lineage.chains.map((c) => (
              <div key={c.correlationRef} className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-2xs last:border-0">
                <span className="font-mono text-muted">{c.correlationRef}</span>
                <span className="text-faint">{c.categories.join(', ')}</span>
                <span className="ml-auto tabular text-muted">{c.events} events</span>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
      <p className="mt-4 text-2xs text-faint">{lineage.note}</p>
    </div>
  );
}

/* ── Evidence (the unified explanation model) ────────────────────────────── */

function ExplanationCard({ x }: { x: FabricExplanation }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="flex items-start gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name={explanationIcon(x.kind)} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{x.subject}</span>
            <Pill tone="gray">{x.kind}</Pill>
            {x.approvalAware && <Pill tone="orange">approval-aware</Pill>}
          </div>
          <div className="mt-0.5 text-2xs text-muted">{x.reasoning}</div>
        </div>
        <div className="text-right">
          <StatusBadge tone={bandTone(x.confidenceBand)} label={`${Math.round(x.confidence * 100)}%`} />
          <div className="mt-0.5 text-2xs text-faint">confidence</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-2xs text-faint">Sources:</span>
        {x.sources.map((src) => (
          <span key={src} className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-2xs text-muted">{src}</span>
        ))}
      </div>
      {x.evidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {x.evidence.map((e, i) => (
            <span key={`${x.id}:${i}`} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-2xs" title={e.sourceSystem}>
              <Icon name={refIcon(e.kind)} size={11} />
              {e.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Evidence({ report }: { report: FabricEvidenceReport | null }): JSX.Element {
  const [kind, setKind] = useState<string>('all');
  if (!report) return <LoadingBlock label="Loading evidence…" />;
  const kinds = ['all', ...report.byKind.map((k) => k.key)];
  const shown = kind === 'all' ? report.explanations : report.explanations.filter((x) => x.kind === kind);
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="checklist" label="Explanations" value={report.total} />
        <Stat icon="verified" label="Evidence coverage" value={`${report.evidenceCoverage}%`} tone={report.evidenceCoverage >= 75 ? 'green' : 'orange'} />
        <Stat icon="pulse" label="Avg confidence" value={`${Math.round(report.avgConfidence * 100)}%`} tone="blue" />
      </Grid>
      <nav className="mb-4 mt-6 flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-2xs font-medium transition', kind === k ? 'bg-white/10 text-ink' : 'text-muted hover:bg-white/5')}
          >
            {k}
          </button>
        ))}
      </nav>
      {shown.length === 0 ? (
        <EmptyState icon="checklist" title="No explanations" hint="No explainable subjects for this filter." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {shown.map((x) => (
            <ExplanationCard key={x.id} x={x} />
          ))}
        </div>
      )}
      <p className="mt-4 text-2xs text-faint">{report.note}</p>
    </div>
  );
}

/* ── Governance ──────────────────────────────────────────────────────────── */

function Governance({ governance }: { governance: FabricGovernance | null }): JSX.Element {
  if (!governance) return <LoadingBlock label="Loading governance…" />;
  return (
    <div>
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name="lock" size={24} />
        </span>
        <div>
          <div className="text-sm font-semibold">All fabric reads require <span className="font-mono">{governance.fabricScope}</span></div>
          <div className="text-2xs text-faint">{governance.auditableSources}/{governance.totalSources} sources auditable via the existing timeline · reuses RBAC / Governance / Audit</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Source scopes" subtitle="Each source keeps its own production RBAC scope" className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)]">
            {governance.scopes.map((s) => (
              <div key={s.source} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
                <span className="flex-1 text-sm font-medium">{s.source}</span>
                <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-2xs text-muted">{s.permission}</span>
                {s.auditable && <Icon name="check" size={13} />}
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Redaction posture" subtitle="Inherited from the projected layers" className="mb-0">
          <div className="flex flex-col gap-2">
            {governance.redactions.map((r) => (
              <div key={r} className="flex items-start gap-2 rounded-xl border border-white/5 px-3 py-2 text-2xs text-muted">
                <Icon name="shield" size={13} />
                <span>{r}</span>
              </div>
            ))}
          </div>
        </OpsPanel>
      </div>
      <p className="mt-4 text-2xs text-faint">{governance.note}</p>
    </div>
  );
}

/* ── Analytics ───────────────────────────────────────────────────────────── */

function Analytics({ analytics }: { analytics: FabricAnalytics }): JSX.Element {
  const maxContrib = analytics.sourceContribution.reduce((m, s) => Math.max(m, s.entityCount), 0) || 1;
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="memory" label="Knowledge coverage" value={`${analytics.knowledgeCoverage}%`} tone={analytics.knowledgeCoverage >= 60 ? 'green' : 'orange'} />
        <Stat icon="verified" label="Explanation coverage" value={`${analytics.explanationCoverage}%`} tone="blue" />
        <Stat icon="pulse" label="Fabric health" value={`${analytics.overallHealth}/100`} tone={bandTone(analytics.healthBand) === 'green' ? 'green' : 'orange'} />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Confidence distribution" subtitle="Explanations by confidence band" className="mb-0">
          <div className="flex flex-col gap-2">
            {analytics.confidenceDistribution.map((b) => (
              <div key={b.band} className="flex items-center gap-3">
                <StatusDot tone={bandTone(b.band)} />
                <span className="flex-1 text-sm">{bandLabel(b.band)}</span>
                <span className="tabular text-2xs text-muted">{b.count}</span>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Source contribution" subtitle="Entities contributed per source" className="mb-0">
          <div className="flex flex-col gap-2">
            {analytics.sourceContribution.map((s) => (
              <div key={s.source} className="rounded-xl border border-white/5 px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="truncate text-sm font-medium">{s.source}</span>
                  <span className="tabular text-2xs text-faint">{s.percent}%</span>
                </div>
                <Bar value={s.entityCount / maxContrib} tone="blue" />
              </div>
            ))}
          </div>
        </OpsPanel>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Distribution title="Top domains" subtitle="Enterprise-graph domains by node count" rows={analytics.topDomains} />
        <OpsPanel title="Top semantic tags" subtitle="Most-used corpus tags" className="mb-0">
          {analytics.topTags.length === 0 ? (
            <p className="py-2 text-2xs text-faint">No tags yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {analytics.topTags.map((t) => (
                <span key={t.tag} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-2xs">
                  <Icon name="tag" size={11} />{t.tag}<span className="text-faint">{t.count}</span>
                </span>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>
      <p className="mt-4 text-2xs text-faint">{analytics.note}</p>
    </div>
  );
}

/* ── Explore (REUSES the existing Enterprise Search — no duplicate search) ── */

function Explore(): JSX.Element {
  const [text, setText] = useState('');
  const [result, setResult] = useState<EnterpriseSearchResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResult(await ipc.search.enterprise({ text: q.trim(), limit: 30 }));
    } catch {
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(text);
        }}
        className="mb-4 flex items-center gap-2"
      >
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--hairline)] px-3 py-2">
          <Icon name="search" size={16} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search across the whole enterprise — records, graph, memory, timeline…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>
        <button type="submit" className="rounded-xl border border-[var(--hairline)] px-4 py-2 text-sm font-medium fill-hover">
          Search
        </button>
      </form>
      <p className="mb-4 text-2xs text-faint">Reuses the existing Enterprise Search (records, graph, memory, timeline) — the fabric adds context, not a new index.</p>

      {busy ? (
        <LoadingBlock label="Searching…" />
      ) : !result ? (
        <EmptyState icon="search" title="Explore the knowledge fabric" hint="Search to see federated results across every source." />
      ) : result.hits.length === 0 ? (
        <EmptyState icon="search" title="No results" hint={`Nothing matched “${result.query}”.`} />
      ) : (
        <div className="flex flex-col gap-4">
          {result.groups.map((g) => (
            <OpsPanel key={g.source} title={g.source} subtitle={`${g.total} result${g.total === 1 ? '' : 's'}`} className="mb-0">
              <div className="rounded-2xl border border-[var(--hairline)]">
                {g.hits.slice(0, 10).map((h) => (
                  <div key={`${h.source}:${h.id}`} className="border-b border-white/5 px-3 py-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{h.title}</span>
                      <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-2xs text-faint">{h.kind}</span>
                    </div>
                    {h.snippet && <div className="mt-0.5 truncate text-2xs text-muted">{h.snippet}</div>}
                  </div>
                ))}
              </div>
            </OpsPanel>
          ))}
        </div>
      )}
    </div>
  );
}
