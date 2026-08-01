/**
 * P10 — Federation Center. The Operations-Center surface for the federation platform: a
 * governed view over the EXISTING federation runtime (peers, trust, signed exchange, cross-org
 * governance), built from house primitives + the P8.6 VirtualList. Tabs: Overview (analytics +
 * recent activity), Directory (organization health + trust), Graph (the federation graph
 * projection), Timeline (the unified cross-org timeline), Search (federated discovery), and
 * (Phase 6 Stage 11) Enterprise — the Enterprise Federation Platform composition with its own
 * read-only `efed:*` reads. Reads via `ipc.federationPlatform.*`; refreshes on the existing
 * `fed:event` broadcast. No new runtime, graph, search, or governance engine.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FederationGraph,
  FederationOverview,
  FederationSearchHit,
  FederationTimelineEntry,
  OrgDirectoryEntry,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Field, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import { VirtualList } from '@renderer/workforceCenter/VirtualList';
import { EfedPlatformTab } from '@renderer/enterpriseFederation/EfedPlatformTab';
import {
  decisionLabel,
  decisionTone,
  healthLabel,
  healthTone,
  nodeIcon,
  nodeTone,
  roleLabel,
  searchIcon,
  searchLabel,
  statusTone,
  timelineIcon,
  trustLabel,
  trustTone,
} from './federationCenterModel';

type Tab = 'overview' | 'directory' | 'graph' | 'timeline' | 'search' | 'enterprise';

function fmtTime(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString();
}

export function FederationCenterView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [overview, setOverview] = useState<FederationOverview | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const refresh = useCallback(async () => {
    try {
      setOverview(await ipc.federationPlatform.overview());
    } catch {
      /* keep the last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.federationPlatform.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: 'gauge' | 'globe' | 'grid' | 'pulse' | 'search' | 'checklist' }[] = [
    { id: 'overview', label: 'Overview', icon: 'gauge' },
    { id: 'directory', label: 'Directory', icon: 'globe' },
    { id: 'graph', label: 'Graph', icon: 'grid' },
    { id: 'timeline', label: 'Timeline', icon: 'pulse' },
    { id: 'search', label: 'Search', icon: 'search' },
    // Phase 6 Stage 11 — the Enterprise Federation Platform (read-only efed:* composition).
    { id: 'enterprise', label: 'Enterprise', icon: 'checklist' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Federation Center</h1>
            <p className="mt-1 text-md text-muted">
              Secure cross-organization collaboration — trust, shared workers and packages, governance, and audit — over one federated architecture.
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

        {tab === 'enterprise' ? (
          // Phase 6 Stage 11 — its own efed:* reads; independent of the P10 overview fetch.
          <EfedPlatformTab />
        ) : !ready ? (
          <LoadingBlock label="Loading federation…" />
        ) : !overview ? (
          <EmptyState icon="globe" title="Federation unavailable" hint="No federation data could be loaded." />
        ) : tab === 'overview' ? (
          <Overview overview={overview} />
        ) : tab === 'directory' ? (
          <Directory orgs={overview.directory} />
        ) : tab === 'graph' ? (
          <GraphTab />
        ) : tab === 'timeline' ? (
          <TimelineTab />
        ) : (
          <SearchTab />
        )}
      </div>
    </div>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function Overview({ overview }: { overview: FederationOverview }): JSX.Element {
  const { summary, analytics, recentTimeline } = overview;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="globe" label="Organizations" value={summary.orgs} />
        <Stat icon="verified" label="Active peers" value={summary.activePeers} tone="blue" />
        <Stat icon="shield" label="Trusted peers" value={summary.trustedPeers} tone="green" />
        <Stat icon="layers" label="Shared (out / in)" value={`${summary.sharedOut} / ${summary.sharedIn}`} tone="purple" />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Trust distribution" subtitle="Peers by established trust level" className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)] p-4">
            {analytics.trustDistribution.map((d) => {
              const total = analytics.trustDistribution.reduce((n, x) => n + x.count, 0) || 1;
              return (
                <div key={d.level} className="mb-2 last:mb-0">
                  <div className="mb-1 flex items-baseline justify-between text-2xs">
                    <span className="text-faint">{trustLabel(d.level)}</span>
                    <span className="tabular text-muted">{d.count}</span>
                  </div>
                  <Bar value={d.count / total} tone={trustTone(d.level)} />
                </div>
              );
            })}
          </div>
        </OpsPanel>

        <OpsPanel title="Exchange & governance" subtitle="Signed cross-org artifacts and policy posture" className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)] p-4">
            <Field label="Exchange artifacts" value={analytics.exchange.artifacts} />
            <Field label="Verified artifacts" value={analytics.exchange.verified} />
            <Field label="Total installs" value={analytics.exchange.installs.toLocaleString()} />
            <Field label="Active policies" value={`${analytics.governance.activePolicies} / ${analytics.governance.policies}`} />
            <Field label="Pending approvals" value={analytics.governance.pendingApprovals} />
            <div className="mt-2">
              <div className="mb-1 flex items-baseline justify-between text-2xs">
                <span className="text-faint">Compliance score</span>
                <span className="tabular text-muted">{analytics.governance.complianceScore}%</span>
              </div>
              <Bar value={analytics.governance.complianceScore / 100} tone={analytics.governance.complianceScore >= 80 ? 'green' : 'orange'} />
            </div>
          </div>
        </OpsPanel>
      </div>

      <OpsPanel title="Recent federation activity" subtitle="Cross-org events, newest first" className="mt-6 mb-0">
        {recentTimeline.length === 0 ? (
          <EmptyState icon="pulse" title="No activity yet" hint="Invitations, trust changes, shares, and publishes appear here." />
        ) : (
          <div className="rounded-2xl border border-[var(--hairline)]">
            {recentTimeline.slice(0, 8).map((e) => (
              <TimelineRow key={e.id} entry={e} />
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Directory ───────────────────────────────────────────────────────────── */

function Directory({ orgs }: { orgs: OrgDirectoryEntry[] }): JSX.Element {
  return (
    <OpsPanel title={`Organization directory · ${orgs.length}`} subtitle="Federated organizations, trust, and health">
      {orgs.length === 0 ? (
        <EmptyState icon="globe" title="No organizations" hint="Invite a partner organization to begin federating." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((o) => (
            <div key={o.id} className="rounded-2xl border border-[var(--hairline)] p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
                  <Icon name="globe" size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{o.name}</div>
                  <div className="text-2xs text-faint">{roleLabel(o.role)} · {o.regionId}</div>
                </div>
                <StatusBadge tone={healthTone(o.health)} label={healthLabel(o.health)} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Pill tone={trustTone(o.trustLevel)} icon="shield">
                  {trustLabel(o.trustLevel)}
                </Pill>
                <Pill tone={statusTone(o.status)}>{o.status}</Pill>
                {o.canShareWorkers && <Pill tone="blue" icon="cpu">workers</Pill>}
                {o.canShareData && <Pill tone="purple" icon="database">data</Pill>}
                {o.delegatedApproval && <Pill tone="green" icon="check">delegated</Pill>}
              </div>
              <div className="mt-3 flex items-center justify-between text-2xs text-faint">
                <span>shared out {o.sharedOut}</span>
                <span>shared in {o.sharedIn}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </OpsPanel>
  );
}

/* ── Graph ───────────────────────────────────────────────────────────────── */

function GraphTab(): JSX.Element {
  const [graph, setGraph] = useState<FederationGraph | null>(null);
  useEffect(() => {
    let live = true;
    void ipc.federationPlatform.graph().then((g) => {
      if (live) setGraph(g);
    });
    return () => {
      live = false;
    };
  }, []);

  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph?.nodes ?? []) m.set(n.id, n.label);
    return m;
  }, [graph]);

  if (!graph) return <LoadingBlock label="Projecting federation graph…" />;

  return (
    <div>
      <Grid cols={4}>
        <Stat icon="globe" label="Organizations" value={graph.counts.organizations} />
        <Stat icon="package" label="Artifacts" value={graph.counts.artifacts} tone="green" />
        <Stat icon="layers" label="Shared resources" value={graph.counts.sharedResources} tone="purple" />
        <Stat icon="grid" label="Relationships" value={graph.counts.edges} tone="blue" />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <OpsPanel title="Nodes" subtitle="Organizations, artifacts, and shared resources" className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)] p-2">
            {graph.nodes.map((n) => (
              <div key={n.id} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
                  <Icon name={nodeIcon(n.kind)} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {n.label}
                    {n.home && <span className="ml-1.5 text-2xs text-faint">(home)</span>}
                  </div>
                  <div className="truncate text-2xs text-faint">{n.sublabel}</div>
                </div>
                {n.trustLevel && <Pill tone={trustTone(n.trustLevel)}>{trustLabel(n.trustLevel)}</Pill>}
                {!n.trustLevel && <Pill tone={nodeTone(n.kind)}>{n.kind.replace('_', ' ')}</Pill>}
              </div>
            ))}
          </div>
        </OpsPanel>

        <OpsPanel title="Relationships" subtitle="Trust, shares, and publications between nodes" className="mb-0">
          {graph.edges.length === 0 ? (
            <EmptyState icon="grid" title="No relationships" hint="Establish trust or share a resource to build the graph." />
          ) : (
            <div className="rounded-2xl border border-[var(--hairline)]">
              {graph.edges.map((e) => (
                <div key={e.id} className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-sm last:border-0">
                  <span className="truncate font-medium">{labelById.get(e.from) ?? e.from}</span>
                  <Icon name="arrow-right" size={13} className="shrink-0 text-faint" />
                  <span className="truncate font-medium">{labelById.get(e.to) ?? e.to}</span>
                  <span className="ml-auto shrink-0">
                    <Pill tone={e.kind === 'trust' ? 'blue' : e.kind === 'publishes' ? 'green' : 'accent'}>{e.kind} · {e.label}</Pill>
                  </span>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>
    </div>
  );
}

/* ── Timeline ────────────────────────────────────────────────────────────── */

function TimelineRow({ entry }: { entry: FederationTimelineEntry }): JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]')}>
        <Icon name={timelineIcon(entry.kind)} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{entry.title}</div>
        <div className="truncate text-2xs text-faint">{entry.detail}</div>
      </div>
      <div className="shrink-0 text-right">
        {entry.decision && <Pill tone={decisionTone(entry.decision)}>{decisionLabel(entry.decision)}</Pill>}
        <div className="mt-0.5 text-2xs text-faint">{fmtTime(entry.at)}</div>
      </div>
    </div>
  );
}

function TimelineTab(): JSX.Element {
  const [entries, setEntries] = useState<FederationTimelineEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    void ipc.federationPlatform.timeline().then((t) => {
      if (live) setEntries(t);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!entries) return <LoadingBlock label="Loading federation timeline…" />;

  return (
    <OpsPanel title={`Federation timeline · ${entries.length}`} subtitle="Cross-org events, shared executions, trust changes, and audits">
      {entries.length === 0 ? (
        <EmptyState icon="pulse" title="No events" hint="Federation activity will appear here as it happens." />
      ) : (
        <VirtualList
          items={entries}
          rowHeight={60}
          height={Math.min(640, Math.max(120, entries.length * 60))}
          rowKey={(e) => e.id}
          renderRow={(e) => <TimelineRow entry={e} />}
        />
      )}
    </OpsPanel>
  );
}

/* ── Search ──────────────────────────────────────────────────────────────── */

function SearchTab(): JSX.Element {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<FederationSearchHit[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let live = true;
    const run = async (): Promise<void> => {
      const r = await ipc.federationPlatform.search(q, undefined, 40);
      if (live) {
        setHits(r);
        setSearched(true);
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, [q]);

  return (
    <OpsPanel title="Federated search" subtitle="Organizations, packages, shared workers, and policies — one search, policy-aware">
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <Icon name="search" size={15} className="text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search organizations, packages, policies…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </div>
      {searched && hits.length === 0 ? (
        <EmptyState icon="search" title="No matches" hint="Try another term across organizations, packages, or policies." />
      ) : (
        <div className="rounded-2xl border border-[var(--hairline)]">
          {hits.map((h) => (
            <div key={`${h.kind}:${h.id}`} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
                <Icon name={searchIcon(h.kind)} size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{h.title}</div>
                <div className="truncate text-2xs text-faint">{searchLabel(h.kind)} · {h.subtitle}</div>
              </div>
              {h.badge && <Pill tone="gray">{h.badge}</Pill>}
            </div>
          ))}
        </div>
      )}
    </OpsPanel>
  );
}
