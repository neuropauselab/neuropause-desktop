/**
 * P17 — Global Orchestration Center (the Global Orchestration Dashboard). A continuously-updated,
 * read-only view of how the enterprise is coordinated: goals routed to worker capability pools, load
 * distribution, cloud/knowledge/cross-system coordination, the six flows, and the governance posture —
 * all composed from the EXISTING systems (Strategy, Workforce runtime, Cloud Control Plane, Knowledge
 * Fabric, Marketplace, Federation) and visualized over the P15 Digital Twin. It routes and visualizes but
 * EXECUTES nothing; every route respects the existing approval chains.
 * Reads via `ipc.orchestration.*` (+ `ipc.twin.overview()` for the Visualize tab); refreshes on the
 * existing `ecosystem:event` broadcast.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  EnterpriseTwinOverview,
  GoalRoute,
  OrchestrationCloud,
  OrchestrationCoordination,
  OrchestrationGovernance,
  OrchestrationKnowledge,
  OrchestrationOverview,
  OrchestrationGoalRouting,
  OrchestrationWorkforce,
  OrchestratorStatus,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge, StatusDot } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import { bandLabel, bandTone, flowIcon, orchestratorIcon } from './orchestrationCenterModel';

type Tab = 'overview' | 'goals' | 'workforce' | 'cloud' | 'knowledge' | 'coordination' | 'governance' | 'visualize';

export function OrchestrationCenterView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [overview, setOverview] = useState<OrchestrationOverview | null>(null);
  const [goals, setGoals] = useState<OrchestrationGoalRouting | null>(null);
  const [workforce, setWorkforce] = useState<OrchestrationWorkforce | null>(null);
  const [cloud, setCloud] = useState<OrchestrationCloud | null>(null);
  const [knowledge, setKnowledge] = useState<OrchestrationKnowledge | null>(null);
  const [coordination, setCoordination] = useState<OrchestrationCoordination | null>(null);
  const [governance, setGovernance] = useState<OrchestrationGovernance | null>(null);
  const [twin, setTwin] = useState<EnterpriseTwinOverview | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const refresh = useCallback(async () => {
    try {
      const [o, g, w, c, k, co, gv, tw] = await Promise.all([
        ipc.orchestration.overview(),
        ipc.orchestration.goals(),
        ipc.orchestration.workforce(),
        ipc.orchestration.cloud(),
        ipc.orchestration.knowledge(),
        ipc.orchestration.coordination(),
        ipc.orchestration.governance(),
        ipc.twin.overview(),
      ]);
      setOverview(o);
      setGoals(g);
      setWorkforce(w);
      setCloud(c);
      setKnowledge(k);
      setCoordination(co);
      setGovernance(gv);
      setTwin(tw);
    } catch {
      /* keep last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.orchestration.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Orchestrators', icon: 'command' },
    { id: 'goals', label: 'Goal Routing', icon: 'checklist' },
    { id: 'workforce', label: 'Workforce', icon: 'cpu' },
    { id: 'cloud', label: 'Cloud', icon: 'server' },
    { id: 'knowledge', label: 'Knowledge', icon: 'sparkles' },
    { id: 'coordination', label: 'Coordination', icon: 'connectors' },
    { id: 'governance', label: 'Governance', icon: 'lock' },
    { id: 'visualize', label: 'Visualize', icon: 'layers' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Global Orchestration</h1>
            <p className="mt-1 text-md text-muted">
              One coordination layer over every system — enterprise goals routed to worker capability pools, load distribution, cloud/knowledge/cross-system coordination, and the six flows. It routes and visualizes; dispatch, approval, and execution stay with the existing runtimes.
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
          <LoadingBlock label="Composing the global orchestration…" />
        ) : !overview ? (
          <EmptyState icon="command" title="Orchestration unavailable" hint="No orchestration data could be loaded." />
        ) : tab === 'overview' ? (
          <Overview overview={overview} />
        ) : tab === 'goals' ? (
          <Goals goals={goals} />
        ) : tab === 'workforce' ? (
          <Workforce workforce={workforce} />
        ) : tab === 'cloud' ? (
          <Cloud cloud={cloud} />
        ) : tab === 'knowledge' ? (
          <KnowledgeView knowledge={knowledge} />
        ) : tab === 'coordination' ? (
          <Coordination coordination={coordination} />
        ) : tab === 'governance' ? (
          <Governance governance={governance} />
        ) : (
          <Visualize twin={twin} />
        )}
      </div>
    </div>
  );
}

/* ── Overview (orchestrators + flows) ─────────────────────────────────────── */

function OrchestratorCard({ o }: { o: OrchestratorStatus }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name={orchestratorIcon(o.id)} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{o.name}</span>
            <StatusBadge tone={bandTone(o.band)} label={bandLabel(o.band)} />
            {!o.live && <Pill tone="gray">idle</Pill>}
          </div>
          <div className="text-2xs text-faint">{o.coordinates}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular">{o.entityCount.toLocaleString()}</div>
          <div className="text-2xs text-faint">entities</div>
        </div>
      </div>
      <div className="mt-2 text-2xs text-faint">source: {o.source}</div>
    </div>
  );
}

function Overview({ overview }: { overview: OrchestrationOverview }): JSX.Element {
  const s = overview.summary;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="command" label="Orchestrators" value={s.orchestrators} hint={`${s.liveOrchestrators} live`} />
        <Stat icon="checklist" label="Routable goals" value={s.routableGoals} hint={`${s.governedRoutes} governed`} tone="blue" />
        <Stat icon="cpu" label="Workers" value={s.totalWorkers.toLocaleString()} tone="purple" />
        <Stat icon="pulse" label="Enterprise health" value={`${s.overallHealth}/100`} tone={bandTone(s.healthBand) === 'green' ? 'green' : 'orange'} />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {overview.orchestrators.map((o) => (
          <OrchestratorCard key={o.id} o={o} />
        ))}
      </div>

      <OpsPanel title="Orchestration flows" subtitle="Six coordination lanes — each projects volume + health from an existing system" className="mt-6 mb-0">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {overview.flows.map((f) => (
            <div key={f.id} className="rounded-xl border border-white/5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Icon name={flowIcon(f.id)} size={15} />
                <span className="text-sm font-medium">{f.name}</span>
                <span className="ml-auto tabular text-sm font-semibold">{f.volume.toLocaleString()}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-2xs text-faint">
                <span>{f.from}</span>
                <Icon name="arrow-right" size={11} />
                <span>{f.to}</span>
                <StatusDot tone={bandTone(f.band)} />
              </div>
            </div>
          ))}
        </div>
      </OpsPanel>
    </div>
  );
}

/* ── Goals (routing) ──────────────────────────────────────────────────────── */

function RouteCard({ r }: { r: GoalRoute }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{r.goal}</span>
            <Pill tone="gray">{r.capability}</Pill>
            {r.approvalGoverned ? <Pill tone="green">governed</Pill> : <Pill tone="orange">ungoverned</Pill>}
          </div>
          <div className="mt-0.5 text-2xs text-muted">
            routes to the <span className="font-medium text-ink">{r.targetRole}</span> pool · {r.eligibleCount}/{r.poolSize} eligible
            {r.approvalGoverned && r.approvalChain ? ` · approval: ${r.approvalChain} (${r.approvalSteps})` : ''}
          </div>
        </div>
        <div className="text-right">
          <StatusBadge tone={bandTone(r.band)} label={`${Math.round(r.topMatchScore * 100)}%`} />
          <div className="mt-0.5 text-2xs text-faint">best match</div>
        </div>
      </div>
      <div className="mt-2">
        <Bar value={r.topMatchScore} tone={r.routable ? 'blue' : 'gray'} />
      </div>
      <p className="mt-2 text-2xs text-faint">{r.note}</p>
    </div>
  );
}

function Goals({ goals }: { goals: OrchestrationGoalRouting | null }): JSX.Element {
  if (!goals) return <LoadingBlock label="Loading goal routing…" />;
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
        <Icon name="shield" size={15} />
        <span className="text-2xs text-muted">Routes are advisory plans — the orchestration layer never dispatches, approves, or executes. Dispatch and approval stay with the existing Workforce Runtime.</span>
      </div>
      <Grid cols={4}>
        <Stat icon="checklist" label="Goals" value={goals.total} />
        <Stat icon="check" label="Routable" value={goals.routable} tone="green" />
        <Stat icon="lock" label="Governed" value={goals.governed} tone="blue" />
        <Stat icon="bolt" label="Ungoverned" value={goals.ungoverned} tone={goals.ungoverned ? 'orange' : 'gray'} />
      </Grid>
      {goals.routes.length === 0 ? (
        <EmptyState icon="checklist" title="No goals to route" hint="The strategy planning engine has no off-track goals needing routing." />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {goals.routes.map((r) => (
            <RouteCard key={r.id} r={r} />
          ))}
        </div>
      )}
      <p className="mt-4 text-2xs text-faint">{goals.note}</p>
    </div>
  );
}

/* ── Workforce ────────────────────────────────────────────────────────────── */

function Workforce({ workforce }: { workforce: OrchestrationWorkforce | null }): JSX.Element {
  if (!workforce) return <LoadingBlock label="Loading workforce…" />;
  const maxPool = workforce.pools.reduce((m, p) => Math.max(m, p.workers), 0) || 1;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="cpu" label="Workers" value={workforce.load.totalWorkers.toLocaleString()} hint={`${workforce.load.activeWorkers} active`} />
        <Stat icon="pulse" label="In flight" value={workforce.load.inFlight} tone="blue" />
        <Stat icon="analytics" label="Success rate" value={`${Math.round(workforce.load.overallSuccessRate * 100)}%`} tone="green" />
        <Stat icon="bolt" label="Bottlenecks" value={workforce.load.bottleneckCount} tone={workforce.load.bottleneckCount ? 'orange' : 'gray'} />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Capability pools" subtitle="Workers by role — the pools goals route to (identities redacted)" className="mb-0">
          <div className="flex flex-col gap-2">
            {workforce.pools.map((p) => (
              <div key={p.role} className="rounded-xl border border-white/5 px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{p.role}</span>
                  <span className="tabular text-2xs text-faint">{p.eligible}/{p.workers} eligible · trust {Math.round(p.avgTrust * 100)}%</span>
                </div>
                <Bar value={p.workers / maxPool} tone={bandTone(p.band)} />
              </div>
            ))}
          </div>
        </OpsPanel>
        <div className="flex flex-col gap-6">
          <OpsPanel title="Organizations" subtitle="Cross-organization / department coordination" className="mb-0">
            {workforce.orgs.length === 0 ? (
              <p className="py-2 text-2xs text-faint">No organizations.</p>
            ) : (
              <div className="rounded-2xl border border-[var(--hairline)]">
                {workforce.orgs.map((o) => (
                  <div key={o.orgId} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
                    <span className="flex-1 text-sm font-medium">{o.orgName}</span>
                    <span className="text-2xs text-faint">{o.units} units · {o.workers} workers</span>
                  </div>
                ))}
              </div>
            )}
          </OpsPanel>
          <OpsPanel title="Bottlenecks" subtitle="From the shipped workforceIntelligence deriver (keys redacted)" className="mb-0">
            {workforce.bottlenecks.length === 0 ? (
              <p className="py-2 text-2xs text-faint">No bottlenecks detected.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {workforce.bottlenecks.map((b, i) => (
                  <div key={`${b.scope}-${b.kind}-${i}`} className="flex items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5 text-2xs">
                    <Pill tone="orange">{b.kind}</Pill>
                    <span className="flex-1 truncate text-muted">{b.reason}</span>
                    <span className="tabular text-faint">×{b.value}</span>
                  </div>
                ))}
              </div>
            )}
          </OpsPanel>
        </div>
      </div>
      <p className="mt-4 text-2xs text-faint">{workforce.note}</p>
    </div>
  );
}

/* ── Cloud ────────────────────────────────────────────────────────────────── */

function Cloud({ cloud }: { cloud: OrchestrationCloud | null }): JSX.Element {
  if (!cloud) return <LoadingBlock label="Loading cloud…" />;
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="server" label="Fleet" value={`${cloud.fleetStatus} · ${cloud.fleetScore}/100`} tone={bandTone(cloud.band) === 'green' ? 'green' : 'orange'} />
        <Stat icon="globe" label="Regions" value={cloud.regions.length} tone="blue" />
        <Stat icon="database" label="Monthly spend" value={`${cloud.currency} ${cloud.monthlySpend.toLocaleString()}`} tone="purple" />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Regions" subtitle="Cross-region coordination (from the Cloud Control Plane)" className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)]">
            {cloud.regions.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
                <StatusDot tone={bandTone(r.band)} />
                <span className="flex-1 text-sm font-medium">{r.name}</span>
                <span className="text-2xs text-faint">{r.healthyDeployments}/{r.deployments} healthy · {r.replication}</span>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Capacity" subtitle="Quota utilization" className="mb-0">
          <div className="flex flex-col gap-2">
            {cloud.capacity.map((q) => (
              <div key={q.resource} className="rounded-xl border border-white/5 px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{q.resource}</span>
                  <span className="tabular text-2xs text-faint">{q.utilizationPct}%</span>
                </div>
                <Bar value={q.utilizationPct / 100} tone={bandTone(q.band)} />
              </div>
            ))}
          </div>
        </OpsPanel>
      </div>
      <OpsPanel title="Deployments" subtitle="Lowest uptime first — advisory gates (execution stays with the control plane)" className="mt-6 mb-0">
        {cloud.deployments.length === 0 ? (
          <EmptyState icon="server" title="No deployments" hint="No services are deployed yet." />
        ) : (
          <div className="rounded-2xl border border-[var(--hairline)]">
            {cloud.deployments.map((d) => (
              <div key={`${d.service}-${d.region}`} className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-2xs last:border-0">
                <StatusDot tone={bandTone(d.band)} />
                <span className="w-32 shrink-0 truncate font-medium">{d.service}</span>
                <span className="flex-1 truncate text-faint">{d.region} · {d.status}</span>
                <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-faint">{d.gate}</span>
                <span className="tabular text-muted">{d.uptimePct}%</span>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
      <p className="mt-4 text-2xs text-faint">{cloud.note}</p>
    </div>
  );
}

/* ── Knowledge ────────────────────────────────────────────────────────────── */

function KnowledgeView({ knowledge }: { knowledge: OrchestrationKnowledge | null }): JSX.Element {
  if (!knowledge) return <LoadingBlock label="Loading knowledge…" />;
  const maxK = knowledge.delivered.reduce((m, d) => Math.max(m, d.count), 0) || 1;
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="sparkles" label="Explanations" value={knowledge.explanations} />
        <Stat icon="verified" label="Evidence coverage" value={`${knowledge.evidenceCoverage}%`} tone={knowledge.evidenceCoverage >= 75 ? 'green' : 'orange'} />
        <Stat icon="pulse" label="Avg confidence" value={`${Math.round(knowledge.avgConfidence * 100)}%`} tone={bandTone(knowledge.confidenceBand) === 'green' ? 'green' : 'blue'} />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Knowledge delivered to decisions" subtitle="Context / evidence / confidence per decision kind (from the Knowledge Fabric)" className="mb-0">
          <div className="flex flex-col gap-2">
            {knowledge.delivered.map((d) => (
              <div key={d.decisionKind} className="rounded-xl border border-white/5 px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{d.decisionKind}</span>
                  <span className="tabular text-2xs text-faint">{d.count} · {Math.round(d.avgConfidence * 100)}% conf</span>
                </div>
                <Bar value={d.count / maxK} tone={bandTone(d.band)} />
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Knowledge lineage" subtitle="Origin → transformation → usage → consumers" className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)]">
            {knowledge.lineageStages.map((l) => (
              <div key={l.stage} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
                <Icon name="refresh" size={14} />
                <span className="flex-1 text-sm font-medium">{l.stage}</span>
                <span className="tabular text-2xs text-muted">{l.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </OpsPanel>
      </div>
      <p className="mt-4 text-2xs text-faint">{knowledge.note}</p>
    </div>
  );
}

/* ── Coordination ─────────────────────────────────────────────────────────── */

function Coordination({ coordination }: { coordination: OrchestrationCoordination | null }): JSX.Element {
  if (!coordination) return <LoadingBlock label="Loading coordination…" />;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="store" label="Marketplace" value={`${coordination.marketplace.certified}/${coordination.marketplace.published}`} hint={`${coordination.marketplace.installs} installs`} />
        <Stat icon="globe" label="Federated peers" value={coordination.federation.peers} hint={`${coordination.federation.activePeers} active`} tone="blue" />
        <Stat icon="connectors" label="Shareable workers" value={coordination.federation.canShareWorkers} tone="purple" />
        <Stat icon="layers" label="Shared out/in" value={`${coordination.federation.sharedOut}/${coordination.federation.sharedIn}`} tone="gray" />
      </Grid>
      <OpsPanel title="Coordinated systems" subtitle="Every system coordinated through the one orchestration layer" className="mt-6 mb-0">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {coordination.systems.map((s) => (
            <div key={s.id} className="rounded-xl border border-white/5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{s.name}</span>
                <StatusBadge tone={bandTone(s.band)} label={bandLabel(s.band)} />
                {!s.live && <Pill tone="gray">not populated</Pill>}
                <span className="ml-auto tabular text-2xs text-faint">{s.status}</span>
              </div>
            </div>
          ))}
        </div>
      </OpsPanel>
      <p className="mt-4 text-2xs text-faint">{coordination.note}</p>
    </div>
  );
}

/* ── Governance ───────────────────────────────────────────────────────────── */

function Governance({ governance }: { governance: OrchestrationGovernance | null }): JSX.Element {
  if (!governance) return <LoadingBlock label="Loading governance…" />;
  return (
    <div>
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name="shield" size={24} />
        </span>
        <div>
          <div className="text-sm font-semibold">Never bypass governance</div>
          <div className="mt-0.5 text-2xs text-muted">{governance.neverBypass}</div>
          <div className="mt-1 text-2xs text-faint">{governance.governedRoutes} governed · {governance.ungovernedRoutes} ungoverned routes · all channels require <span className="font-mono">{governance.orchestrationScope}</span></div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Approval gates" subtitle="Each routed capability + its approval requirement" className="mb-0">
          {governance.approvalGates.length === 0 ? (
            <p className="py-2 text-2xs text-faint">No routed capabilities.</p>
          ) : (
            <div className="rounded-2xl border border-[var(--hairline)]">
              {governance.approvalGates.map((g) => (
                <div key={g.capability} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
                  <span className="flex-1 font-mono text-2xs">{g.capability}</span>
                  {g.governed ? <Pill tone="green">{g.chain} ({g.steps})</Pill> : <Pill tone="orange">ungoverned</Pill>}
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
        <div className="flex flex-col gap-6">
          <OpsPanel title="Source scopes" subtitle="Each coordinated system keeps its own production scope" className="mb-0">
            <div className="rounded-2xl border border-[var(--hairline)]">
              {governance.scopes.map((s) => (
                <div key={s.system} className="flex items-center gap-3 border-b border-white/5 px-3 py-2 text-2xs last:border-0">
                  <span className="flex-1">{s.system}</span>
                  <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-muted">{s.permission}</span>
                </div>
              ))}
            </div>
          </OpsPanel>
          <OpsPanel title="Redaction posture" className="mb-0">
            <div className="flex flex-col gap-2">
              {governance.redactions.map((r) => (
                <div key={r} className="flex items-start gap-2 rounded-xl border border-white/5 px-3 py-2 text-2xs text-muted">
                  <Icon name="lock" size={13} />
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </OpsPanel>
        </div>
      </div>
      <p className="mt-4 text-2xs text-faint">{governance.note}</p>
    </div>
  );
}

/* ── Visualize (REUSES the P15 Digital Twin — no new topology) ────────────── */

function Visualize({ twin }: { twin: EnterpriseTwinOverview | null }): JSX.Element {
  if (!twin) return <EmptyState icon="layers" title="Twin unavailable" hint="The Digital Twin could not be loaded." />;
  const maxCount = twin.domains.domains.reduce((m, d) => Math.max(m, d.entityCount), 0) || 1;
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
        <Icon name="layers" size={15} />
        <span className="text-2xs text-muted">Orchestration visualized over the P15 Digital Twin — resource allocation across the existing twin domains. No new topology; open the Digital Twin Center for the full graph.</span>
      </div>
      <Grid cols={3}>
        <Stat icon="grid" label="Twin domains" value={twin.summary.domainCount} />
        <Stat icon="cpu" label="Entities" value={twin.summary.totalEntities.toLocaleString()} tone="blue" />
        <Stat icon="pulse" label="Twin health" value={`${twin.summary.overallHealth}/100`} tone="purple" />
      </Grid>
      <OpsPanel title="Resource allocation across twin domains" subtitle="The worker/cloud/knowledge domains orchestration coordinates" className="mt-6 mb-0">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {twin.domains.domains.map((d) => (
            <div key={d.id} className="rounded-xl border border-white/5 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{d.name}</span>
                <span className="tabular text-2xs text-faint">{d.entityCount.toLocaleString()}</span>
              </div>
              <div className="mt-1.5">
                <Bar value={d.entityCount / maxCount} tone="blue" />
              </div>
            </div>
          ))}
        </div>
      </OpsPanel>
    </div>
  );
}
