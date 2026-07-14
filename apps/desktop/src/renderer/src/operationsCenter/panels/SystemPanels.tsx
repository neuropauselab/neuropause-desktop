import { useEffect, useRef, useState } from 'react';
import type {
  EnterpriseIntelligenceReport,
  EnterpriseSearchResult,
  EnterpriseTimelineEntry,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Card } from '@renderer/components/ui/Card';
import { Spinner } from '@renderer/components/Spinner';
import { ipc } from '@renderer/lib/ipc';
import { OpsPanel, Stat, StatusDot } from '@renderer/operations/primitives';
import { domainLabel, pct01, relativeTime, riskScoreTone, score100 } from '../opsModel';
import { EmptyState, Field, Grid, Meter } from '../primitives';

interface PanelProps {
  report: EnterpriseIntelligenceReport;
  nowMs: number;
}

/* ── Enterprise Timeline ────────────────────────────────────────────────────── */

export function TimelinePanel({ nowMs }: PanelProps): JSX.Element {
  const [entries, setEntries] = useState<EnterpriseTimelineEntry[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(true);
  const reqRef = useRef(0);

  const load = async (query: string): Promise<void> => {
    const my = ++reqRef.current;
    setBusy(true);
    try {
      const page = await ipc.enterpriseTimeline.query(query.trim() ? { text: query.trim(), limit: 80 } : { limit: 80 });
      if (reqRef.current !== my) return; // a newer filter superseded this response
      setEntries(page.entries);
    } catch {
      if (reqRef.current !== my) return;
      setEntries([]);
    } finally {
      if (reqRef.current === my) setBusy(false);
    }
  };

  useEffect(() => {
    void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OpsPanel
      title="Enterprise Timeline"
      subtitle="The unified event + activity stream"
      actions={
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(text);
          }}
          className="flex items-center gap-2"
        >
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
            <Icon name="search" size={14} className="text-faint" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Filter events…"
              className="w-40 bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </div>
        </form>
      }
    >
      {busy && !entries && <div className="flex items-center justify-center py-16"><Spinner /></div>}
      {entries && entries.length === 0 && <EmptyState icon="clock" title="No events" hint="Nothing matches the current filter." />}
      {entries && entries.length > 0 && (
        <div className="relative flex flex-col">
          {entries.map((e, i) => (
            <div key={`${e.id}-${i}`} className="flex gap-3 pb-4">
              <div className="flex flex-col items-center">
                <StatusDot tone="blue" />
                {i < entries.length - 1 && <span className="mt-1 w-px flex-1 bg-white/10" />}
              </div>
              <div className="min-w-0 flex-1 -mt-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{e.title}</span>
                  <span className="shrink-0 text-2xs text-faint">{relativeTime(e.at, nowMs)}</span>
                </div>
                {e.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{e.summary}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-faint">
                  <span className="rounded bg-white/[0.05] px-1.5 py-0.5">{e.category}</span>
                  <span>{e.kind}</span>
                  {e.sourceModule && <span>· {domainLabel(e.sourceModule)}</span>}
                  {e.actorLabel && <span>· {e.actorLabel}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </OpsPanel>
  );
}

/* ── Enterprise Search Results ──────────────────────────────────────────────── */

const SOURCE_ICON = { entity: 'database', graph: 'connectors', memory: 'memory', timeline: 'clock' } as const;

export function SearchPanel(): JSX.Element {
  const [text, setText] = useState('');
  const [result, setResult] = useState<EnterpriseSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [ran, setRan] = useState(false);
  const reqRef = useRef(0);

  const run = async (): Promise<void> => {
    if (!text.trim()) return;
    const my = ++reqRef.current;
    setBusy(true);
    setRan(true);
    try {
      const res = await ipc.search.enterprise({ text: text.trim(), limit: 12 });
      if (reqRef.current !== my) return; // a newer query superseded this response
      setResult(res);
    } catch {
      if (reqRef.current !== my) return;
      setResult(null);
    } finally {
      if (reqRef.current === my) setBusy(false);
    }
  };

  return (
    <div>
      <OpsPanel title="Enterprise Search" subtitle="One query across entities · graph · memory · timeline">
        <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <Icon name="search" size={16} className="text-faint" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search everything…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
              autoFocus
            />
          </div>
          <button type="submit" disabled={!text.trim() || busy} className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-white/15 disabled:opacity-40">
            Search
          </button>
        </form>
      </OpsPanel>

      {busy && <div className="flex items-center justify-center py-16"><Spinner /></div>}

      {!busy && result && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-2xs text-faint">
            <span>{result.total} results for “{result.query}”</span>
            {result.backends.length > 0 && <span>· via {result.backends.join(', ')}</span>}
            {result.groups.map((g) => (
              <span key={g.source} className="rounded bg-white/[0.05] px-1.5 py-0.5">{g.source} {g.total}</span>
            ))}
          </div>
          {result.hits.length ? (
            <div className="flex flex-col gap-2">
              {result.hits.map((hit) => (
                <Card key={`${hit.source}-${hit.id}`} variant="hairline">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
                      <Icon name={SOURCE_ICON[hit.source] ?? 'doc'} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{hit.title}</span>
                        <span className="shrink-0 text-2xs text-faint">{pct01(hit.score)}</span>
                      </div>
                      {hit.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{hit.snippet}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-faint">
                        <span className="rounded bg-white/[0.05] px-1.5 py-0.5">{hit.source}</span>
                        <span>{hit.kind}</span>
                        {hit.connectorId && <span>· {hit.connectorId}</span>}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState icon="search" title="No matches" hint="Try a broader query." />
          )}
        </>
      )}

      {!busy && !result && ran && <EmptyState icon="search" title="No results" />}
      {!busy && !ran && <EmptyState icon="search" title="Search the enterprise" hint="Federated retrieval across the Unified Data Model, Knowledge Graph, AI Memory, and the Enterprise Timeline — merged and ranked into one list." />}
    </div>
  );
}

/* ── Enterprise Diagnostics ─────────────────────────────────────────────────── */

export function DiagnosticsPanel({ report, nowMs }: PanelProps): JSX.Element {
  const g = report.graph;
  const domains = Object.entries(g.byDomain).sort((a, b) => b[1] - a[1]);
  const maxDomain = Math.max(1, ...domains.map(([, n]) => n));
  const ageMs = nowMs - Date.parse(report.generatedAt);
  const engines: Array<{ name: string; ok: boolean; detail: string; confidence?: number }> = [
    { name: 'Enterprise Graph', ok: g.nodes >= 0, detail: `${g.nodes} nodes · ${g.edges} edges · ${g.crossDomainEdges} cross-domain`, },
    { name: 'Health Engine', ok: true, detail: `${report.health.scores.length} scores · overall ${score100(report.health.overall)}` },
    { name: 'Risk Engine', ok: true, detail: `${report.risk.categories.length} categories · overall ${score100(report.risk.overall)}`, confidence: report.risk.confidence },
    { name: 'Dependency Engine', ok: true, detail: `${report.dependencies.spofs.length} SPOFs · ${report.dependencies.cycles.length} cycles · ${report.dependencies.failureChains.length} chains` },
    { name: 'Drift Engine', ok: true, detail: `${report.drift.totalItems} items · ${score100(report.drift.driftScore)}% in-sync` },
    { name: 'Capacity Engine', ok: true, detail: `${report.capacity.signals.length} signals · pressure ${score100(report.capacity.pressureScore)}` },
    { name: 'Incident Engine', ok: true, detail: `${report.incidents.total} incidents · ${report.incidents.open} open` },
    { name: 'Recommendation Engine', ok: true, detail: `${report.recommendations.length} recommendations` },
  ];

  return (
    <div>
      <OpsPanel title="Intelligence pipeline" subtitle="Health of every engine feeding the Operations Center">
        <Grid cols={4}>
          <Stat icon="grid" label="Graph entities" value={g.nodes.toLocaleString()} tone="blue" />
          <Stat icon="connectors" label="Relationships" value={g.edges.toLocaleString()} tone="blue" />
          <Stat icon="clock" label="Report age" value={relativeTime(report.generatedAt, nowMs)} tone={ageMs > 60_000 ? 'orange' : 'green'} />
          <Stat icon="layers" label="Truncated" value={g.truncated ? 'Yes' : 'No'} tone={g.truncated ? 'orange' : 'green'} hint={g.truncated ? 'graph capped for performance' : 'complete graph'} />
        </Grid>
      </OpsPanel>

      <OpsPanel title="Engines">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {engines.map((e) => (
            <Card key={e.name} variant="hairline">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot tone={e.ok ? 'green' : 'red'} />
                  <span className="text-sm font-semibold">{e.name}</span>
                </div>
                {e.confidence != null && <span className={cn('text-2xs tabular', riskScoreTone(100 - e.confidence * 100) === 'red' ? 'text-white' : 'text-faint')}>conf {pct01(e.confidence)}</span>}
              </div>
              <p className="mt-1 text-2xs text-faint">{e.detail}</p>
            </Card>
          ))}
        </div>
      </OpsPanel>

      <OpsPanel title="Graph composition by domain">
        {domains.length ? (
          <div className="flex flex-col gap-2.5">
            {domains.map(([dom, n]) => (
              <Meter key={dom} value={n / maxDomain} tone="blue" label={domainLabel(dom)} trailing={`${n}`} />
            ))}
          </div>
        ) : (
          <EmptyState icon="grid" title="No entities discovered" hint="Connect a platform and run discovery to populate the Enterprise Graph." />
        )}
      </OpsPanel>

      <OpsPanel title="Report metadata" className="mb-0">
        <Card variant="hairline">
          <Field label="Generated at" value={new Date(report.generatedAt).toLocaleString()} />
          <Field label="Cross-domain edges" value={g.crossDomainEdges} />
          <Field label="Recommendations" value={report.recommendations.length} />
          <Field label="Overall health" value={`${score100(report.health.overall)} / 100`} />
          <Field label="Overall risk" value={`${score100(report.risk.overall)} / 100`} />
        </Card>
      </OpsPanel>
    </div>
  );
}
