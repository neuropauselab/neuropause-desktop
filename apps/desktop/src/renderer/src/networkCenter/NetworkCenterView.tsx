/**
 * P18 — Intelligence Network Center (the Enterprise Intelligence Network dashboard). A continuously-
 * updated, read-only view of the governed intelligence exchange: sanitized recommendations + patterns,
 * benchmark position vs industry, the insight registry (federation exchange + marketplace templates),
 * federation trust/consent, per-org posture, collective trends, and the privacy governance posture. It
 * shares only sanitized aggregate intelligence — never raw enterprise records — and reuses the existing
 * Knowledge Fabric, Industry reference, Federation trust, and Marketplace.
 * Reads via `ipc.network.*`; refreshes on the existing `ecosystem:event` broadcast.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  BenchmarkRow,
  IntelNetworkBenchmarks,
  IntelNetworkCollective,
  IntelNetworkExchange,
  IntelNetworkGovernance,
  IntelNetworkInsights,
  IntelNetworkOrganizations,
  IntelNetworkOverview,
  IntelNetworkTrust,
  NetworkModuleStatus,
  SharedRecommendation,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge, StatusDot } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import { bandLabel, bandTone, moduleIcon, positionIcon, positionLabel, positionTone, sourceIcon } from './networkCenterModel';

type Tab = 'overview' | 'exchange' | 'benchmarks' | 'insights' | 'trust' | 'organizations' | 'collective' | 'governance';

export function NetworkCenterView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [overview, setOverview] = useState<IntelNetworkOverview | null>(null);
  const [exchange, setExchange] = useState<IntelNetworkExchange | null>(null);
  const [benchmarks, setBenchmarks] = useState<IntelNetworkBenchmarks | null>(null);
  const [insights, setInsights] = useState<IntelNetworkInsights | null>(null);
  const [trust, setTrust] = useState<IntelNetworkTrust | null>(null);
  const [organizations, setOrganizations] = useState<IntelNetworkOrganizations | null>(null);
  const [collective, setCollective] = useState<IntelNetworkCollective | null>(null);
  const [governance, setGovernance] = useState<IntelNetworkGovernance | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const refresh = useCallback(async () => {
    try {
      const [o, e, b, i, t, org, c, g] = await Promise.all([
        ipc.network.overview(),
        ipc.network.exchange(),
        ipc.network.benchmarks(),
        ipc.network.insights(),
        ipc.network.trust(),
        ipc.network.organizations(),
        ipc.network.collective(),
        ipc.network.governance(),
      ]);
      setOverview(o);
      setExchange(e);
      setBenchmarks(b);
      setInsights(i);
      setTrust(t);
      setOrganizations(org);
      setCollective(c);
      setGovernance(g);
    } catch {
      /* keep last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.network.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Network', icon: 'globe' },
    { id: 'exchange', label: 'Exchange', icon: 'sparkles' },
    { id: 'benchmarks', label: 'Benchmarks', icon: 'analytics' },
    { id: 'insights', label: 'Insight Registry', icon: 'package' },
    { id: 'trust', label: 'Trust', icon: 'shield' },
    { id: 'organizations', label: 'Organizations', icon: 'grid' },
    { id: 'collective', label: 'Collective', icon: 'pulse' },
    { id: 'governance', label: 'Governance', icon: 'lock' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Intelligence Network</h1>
            <p className="mt-1 text-md text-muted">
              A trusted, governed intelligence exchange — organizations share sanitized recommendations, patterns, benchmarks, and templates through federation trust, never raw enterprise data. Knowledge stays local; only governed intelligence is exchanged.
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
          <LoadingBlock label="Composing the intelligence network…" />
        ) : !overview ? (
          <EmptyState icon="globe" title="Network unavailable" hint="No network data could be loaded." />
        ) : tab === 'overview' ? (
          <Overview overview={overview} benchmarks={benchmarks} />
        ) : tab === 'exchange' ? (
          <Exchange exchange={exchange} />
        ) : tab === 'benchmarks' ? (
          <Benchmarks benchmarks={benchmarks} />
        ) : tab === 'insights' ? (
          <Insights insights={insights} />
        ) : tab === 'trust' ? (
          <Trust trust={trust} />
        ) : tab === 'organizations' ? (
          <Organizations organizations={organizations} />
        ) : tab === 'collective' ? (
          <Collective collective={collective} />
        ) : (
          <Governance governance={governance} />
        )}
      </div>
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function ModuleCard({ m }: { m: NetworkModuleStatus }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name={moduleIcon(m.id)} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{m.name}</span>
            <StatusBadge tone={bandTone(m.band)} label={bandLabel(m.band)} />
            {!m.live && <Pill tone="gray">idle</Pill>}
          </div>
          <div className="text-2xs text-faint">{m.coordinates}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular">{m.entityCount.toLocaleString()}</div>
        </div>
      </div>
      <div className="mt-2 text-2xs text-faint">source: {m.source}</div>
    </div>
  );
}

function Overview({ overview, benchmarks }: { overview: IntelNetworkOverview; benchmarks: IntelNetworkBenchmarks | null }): JSX.Element {
  const s = overview.summary;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="globe" label="Exchange modules" value={s.modules} hint={`${s.liveModules} live`} />
        <Stat icon="sparkles" label="Shareable intelligence" value={s.shareableIntelligence} tone="blue" />
        <Stat icon="package" label="Published insights" value={s.publishedInsights} tone="purple" />
        <Stat icon="shield" label="Trusted peers" value={s.trustedPeers} hint={`${s.dataSharingPeers} data-sharing`} />
      </Grid>
      {benchmarks && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
          <Icon name={positionIcon(s.benchmarkPosition)} size={15} />
          <span className="text-2xs text-muted">Benchmark position: <span className="font-medium text-ink">{positionLabel(s.benchmarkPosition)}</span> — {benchmarks.aboveCount} above, {benchmarks.belowCount} below the industry reference.</span>
        </div>
      )}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {overview.modules.map((m) => (
          <ModuleCard key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}

/* ── Exchange ─────────────────────────────────────────────────────────────── */

function RecommendationCard({ r }: { r: SharedRecommendation }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{r.title}</span>
            <Pill tone="gray">{r.category}</Pill>
            {r.shareable ? <Pill tone="green">shareable</Pill> : <Pill tone="orange">held back</Pill>}
          </div>
          <div className="mt-0.5 text-2xs text-muted">{r.detail}</div>
        </div>
        <StatusBadge tone={bandTone(r.band)} label={`${Math.round(r.confidence * 100)}%`} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-2xs text-faint">Sources:</span>
        {r.sources.map((src) => (
          <span key={src} className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-2xs text-muted">{src}</span>
        ))}
        {r.evidenceKinds.length > 0 && <span className="ml-1 text-2xs text-faint">Evidence:</span>}
        {r.evidenceKinds.map((k) => (
          <span key={k} className="rounded-full border border-white/10 px-2 py-0.5 text-2xs">{k}</span>
        ))}
      </div>
    </div>
  );
}

function Exchange({ exchange }: { exchange: IntelNetworkExchange | null }): JSX.Element {
  if (!exchange) return <LoadingBlock label="Loading exchange…" />;
  const maxP = exchange.patterns.reduce((m, p) => Math.max(m, p.count), 0) || 1;
  return (
    <div>
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
        <Icon name="lock" size={15} />
        <span className="text-2xs text-muted">No raw enterprise data is exchanged. Recommendations carry only authored text + evidence ref KINDS (never entity ids); {exchange.restrictedCount} restricted-sensitivity item{exchange.restrictedCount === 1 ? '' : 's'} held back.</span>
      </div>
      <Grid cols={3}>
        <Stat icon="sparkles" label="Recommendations" value={exchange.recommendations.length} />
        <Stat icon="check" label="Shareable" value={exchange.shareableCount} tone="green" />
        <Stat icon="lock" label="Held back (restricted)" value={exchange.restrictedCount} tone={exchange.restrictedCount ? 'orange' : 'gray'} />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          {exchange.recommendations.length === 0 ? (
            <EmptyState icon="sparkles" title="No shareable recommendations" hint="No governed intelligence to exchange yet." />
          ) : (
            <div className="flex flex-col gap-4">
              {exchange.recommendations.map((r) => (
                <RecommendationCard key={r.id} r={r} />
              ))}
            </div>
          )}
        </div>
        <OpsPanel title="Shareable patterns" subtitle="Aggregate counts from the Knowledge Fabric" className="mb-0">
          <div className="flex flex-col gap-2">
            {exchange.patterns.map((p) => (
              <div key={p.key} className="rounded-xl border border-white/5 px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="truncate text-sm font-medium">{p.label}</span>
                  <span className="tabular text-2xs text-faint">{p.count}</span>
                </div>
                <Bar value={p.count / maxP} tone="blue" />
              </div>
            ))}
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}

/* ── Benchmarks ───────────────────────────────────────────────────────────── */

function BenchmarkBar({ r }: { r: BenchmarkRow }): JSX.Element {
  return (
    <div className="rounded-xl border border-white/5 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-sm font-medium">{r.label}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-2xs" style={{ color: 'var(--muted)' }}>
          <Icon name={positionIcon(r.position)} size={12} />
          {positionLabel(r.position)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Bar value={r.orgValue / 100} tone={bandTone(r.orgBand)} />
        </div>
        <span className="w-24 shrink-0 text-right tabular text-2xs text-muted">
          {r.orgValue}{r.industryValue != null ? ` vs ${r.industryValue}` : ''}
          {r.delta != null && <span className={cn('ml-1', r.delta >= 0 ? 'text-green-1' : 'text-orange-1')}>{r.delta >= 0 ? '+' : ''}{r.delta}</span>}
        </span>
      </div>
    </div>
  );
}

function Benchmarks({ benchmarks }: { benchmarks: IntelNetworkBenchmarks | null }): JSX.Element {
  if (!benchmarks) return <LoadingBlock label="Loading benchmarks…" />;
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="arrow-up" label="Above industry" value={benchmarks.aboveCount} tone="green" />
        <Stat icon="chevron-down" label="Below industry" value={benchmarks.belowCount} tone={benchmarks.belowCount ? 'orange' : 'gray'} />
        <Stat icon="analytics" label="Overall position" value={positionLabel(benchmarks.overallPosition)} tone={positionTone(benchmarks.overallPosition) === 'green' ? 'green' : 'orange'} />
      </Grid>
      <OpsPanel title="Benchmark position" subtitle="Org aggregate metrics vs the industry reference (aggregate only — no raw records)" className="mt-6 mb-0">
        {benchmarks.rows.length === 0 ? (
          <EmptyState icon="analytics" title="No benchmarks" hint="No aggregate metrics available to benchmark yet." />
        ) : (
          <div className="flex flex-col gap-2">
            {benchmarks.rows.map((r) => (
              <BenchmarkBar key={r.metric} r={r} />
            ))}
          </div>
        )}
        <p className="mt-3 text-2xs text-faint">{benchmarks.note}</p>
      </OpsPanel>
    </div>
  );
}

/* ── Insights ─────────────────────────────────────────────────────────────── */

function Insights({ insights }: { insights: IntelNetworkInsights | null }): JSX.Element {
  if (!insights) return <LoadingBlock label="Loading registry…" />;
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="package" label="Registry entries" value={insights.total} />
        <Stat icon="upload" label="Published (local)" value={insights.published} tone="blue" />
        <Stat icon="grid" label="Kinds" value={insights.byKind.length} tone="purple" />
      </Grid>
      <OpsPanel title="Insight registry" subtitle="Published artifacts / packs / templates — catalog descriptors only, no records" className="mt-6 mb-0">
        {insights.entries.length === 0 ? (
          <EmptyState icon="package" title="Empty registry" hint="No insights published or imported yet." />
        ) : (
          <div className="rounded-2xl border border-[var(--hairline)]">
            {insights.entries.map((e) => (
              <div key={e.id} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
                  <Icon name={sourceIcon(e.source)} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{e.name}</span>
                    {e.local && <Pill tone="green">local</Pill>}
                  </div>
                  <div className="truncate text-2xs text-faint">{e.summary}</div>
                </div>
                <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-2xs text-faint">{e.scope}</span>
                <span className="tabular text-2xs text-muted">{e.installs} installs</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-2xs text-faint">{insights.note}</p>
      </OpsPanel>
    </div>
  );
}

/* ── Trust ────────────────────────────────────────────────────────────────── */

function Trust({ trust }: { trust: IntelNetworkTrust | null }): JSX.Element {
  if (!trust) return <LoadingBlock label="Loading trust…" />;
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="shield" label="Trusted peers" value={trust.trustedPeers} />
        <Stat icon="connectors" label="Data-sharing peers" value={trust.dataSharingPeers} tone="blue" />
        <Stat icon="clock" label="Open approvals" value={trust.openApprovals} tone={trust.openApprovals ? 'orange' : 'gray'} />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Trust relationships" subtitle="The federation consent model — who may exchange what" className="mb-0">
          {trust.peers.length === 0 ? (
            <EmptyState icon="shield" title="No peers" hint="No federated trust relationships yet." />
          ) : (
            <div className="rounded-2xl border border-[var(--hairline)]">
              {trust.peers.map((p) => (
                <div key={p.peer} className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5 last:border-0">
                  <StatusDot tone={bandTone(p.band)} />
                  <span className="flex-1 truncate text-sm font-medium">{p.peer}</span>
                  <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-2xs text-faint">{p.trustLevel}</span>
                  {p.canShareData && <Pill tone="green">data</Pill>}
                  {p.canShareWorkers && <Pill tone="blue">workers</Pill>}
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
        <OpsPanel title="Exchange policies" subtitle="Allow / deny / require-approval — the sharing gate" className="mb-0">
          {trust.policies.length === 0 ? (
            <p className="py-2 text-2xs text-faint">No federation policies configured.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {trust.policies.map((p) => (
                <div key={p.name} className="rounded-xl border border-white/5 px-3 py-2 text-2xs">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 font-medium">{p.name}</span>
                    <Pill tone={p.effect === 'deny' ? 'red' : p.effect === 'require_approval' ? 'orange' : 'green'}>{p.effect}</Pill>
                    {!p.enabled && <Pill tone="gray">off</Pill>}
                  </div>
                  <div className="mt-0.5 text-faint">scope: {p.scope} · action: {p.action}</div>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>
      <p className="mt-4 text-2xs text-faint">{trust.note}</p>
    </div>
  );
}

/* ── Organizations ────────────────────────────────────────────────────────── */

function Organizations({ organizations }: { organizations: IntelNetworkOrganizations | null }): JSX.Element {
  if (!organizations) return <LoadingBlock label="Loading organizations…" />;
  return (
    <div>
      <Grid cols={2}>
        <Stat icon="grid" label="Federated peers" value={organizations.totalPeers} hint={`${organizations.activePeers} active`} />
        <Stat icon="connectors" label="Can exchange" value={organizations.organizations.filter((o) => o.canExchange).length} tone="green" />
      </Grid>
      <OpsPanel title="Organization intelligence" subtitle="Per-peer aggregate exchange posture (no raw peer data)" className="mt-6 mb-0">
        {organizations.organizations.length === 0 ? (
          <EmptyState icon="grid" title="No peers" hint="No federated organizations yet." />
        ) : (
          <div className="rounded-2xl border border-[var(--hairline)]">
            {organizations.organizations.map((o) => (
              <div key={o.peer} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
                <StatusDot tone={bandTone(o.band)} />
                <span className="flex-1 truncate text-sm font-medium">{o.peer}</span>
                <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-2xs text-faint">{o.trustLevel}</span>
                {o.canExchange ? <Pill tone="green">can exchange</Pill> : <Pill tone="gray">read-only</Pill>}
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Collective ───────────────────────────────────────────────────────────── */

function Collective({ collective }: { collective: IntelNetworkCollective | null }): JSX.Element {
  if (!collective) return <LoadingBlock label="Loading collective…" />;
  const maxT = collective.trends.reduce((m, t) => Math.max(m, t.value), 0) || 1;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="package" label="Network artifacts" value={collective.totalArtifacts} />
        <Stat icon="download" label="Total installs" value={collective.totalInstalls.toLocaleString()} tone="blue" />
        <Stat icon="analytics" label="Benchmark position" value={positionLabel(collective.benchmarkPosition)} tone={positionTone(collective.benchmarkPosition) === 'green' ? 'green' : 'orange'} />
        <Stat icon="pulse" label="Network health" value={`${collective.networkHealth}/100`} tone={bandTone(collective.healthBand) === 'green' ? 'green' : 'orange'} />
      </Grid>
      <OpsPanel title="Collective trends" subtitle="Network-wide aggregate intelligence (no per-org raw data combined)" className="mt-6 mb-0">
        <div className="flex flex-col gap-2">
          {collective.trends.map((t) => (
            <div key={t.key} className="rounded-xl border border-white/5 px-3 py-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium">{t.label}</span>
                <StatusBadge tone={bandTone(t.band)} label={`${t.value}`} />
              </div>
              <Bar value={t.value / maxT} tone={bandTone(t.band)} />
            </div>
          ))}
        </div>
      </OpsPanel>
      <p className="mt-4 text-2xs text-faint">{collective.note}</p>
    </div>
  );
}

/* ── Governance ───────────────────────────────────────────────────────────── */

function Governance({ governance }: { governance: IntelNetworkGovernance | null }): JSX.Element {
  if (!governance) return <LoadingBlock label="Loading governance…" />;
  return (
    <div>
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name="lock" size={24} />
        </span>
        <div>
          <div className="text-sm font-semibold">No raw enterprise data leaves the tenant</div>
          <div className="mt-0.5 text-2xs text-muted">{governance.neverShareRaw}</div>
          <div className="mt-1 text-2xs text-faint">{governance.sanitizedSources} redaction guarantee{governance.sanitizedSources === 1 ? '' : 's'} · all channels require <span className="font-mono">{governance.networkScope}</span></div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Sanitization guarantees" subtitle="Reused from the Knowledge Fabric redaction posture" className="mb-0">
          <div className="flex flex-col gap-2">
            {governance.redactions.map((r) => (
              <div key={r} className="flex items-start gap-2 rounded-xl border border-white/5 px-3 py-2 text-2xs text-muted">
                <Icon name="shield" size={13} />
                <span>{r}</span>
              </div>
            ))}
          </div>
        </OpsPanel>
        <div className="flex flex-col gap-6">
          <OpsPanel title="Source scopes" subtitle="Each source keeps its own production scope" className="mb-0">
            <div className="rounded-2xl border border-[var(--hairline)]">
              {governance.scopes.map((s) => (
                <div key={s.system} className="flex items-center gap-3 border-b border-white/5 px-3 py-2 text-2xs last:border-0">
                  <span className="flex-1">{s.system}</span>
                  <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-muted">{s.permission}</span>
                </div>
              ))}
            </div>
          </OpsPanel>
          <OpsPanel title="Federation policies" subtitle="The exchange gate" className="mb-0">
            {governance.policies.length === 0 ? (
              <p className="py-2 text-2xs text-faint">No federation policies configured.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {governance.policies.map((p) => (
                  <div key={p.name} className="flex items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5 text-2xs">
                    <span className="flex-1 truncate">{p.name}</span>
                    <Pill tone={p.effect === 'deny' ? 'red' : p.effect === 'require_approval' ? 'orange' : 'green'}>{p.effect}</Pill>
                  </div>
                ))}
              </div>
            )}
          </OpsPanel>
        </div>
      </div>
      <p className="mt-4 text-2xs text-faint">{governance.note}</p>
    </div>
  );
}
