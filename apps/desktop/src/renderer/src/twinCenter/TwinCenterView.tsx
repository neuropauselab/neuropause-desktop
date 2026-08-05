/**
 * P15 — Digital Twin Center. A continuously-updated, read-only visualization of the enterprise,
 * composed from the EXISTING systems (Enterprise Graph, Cloud Control Plane, AI Workforce, Connectors,
 * Marketplace, Federation, P14 Strategy) + the platform timeline. Tabs: Twins (domain twins),
 * Topology (domain-level graph projection), Health (health map), Impact (blast radius), Replay
 * (timeline windows), Scenario (P14 simulation, never executed), and Executive (command center). It
 * renders and models the enterprise but executes nothing and adds no new graph, timeline, or engine.
 * Reads via `ipc.twin.*`; refreshes on the existing `ecosystem:event` broadcast.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  EnterpriseTwinDomain,
  EnterpriseTwinOverview,
  ExecutiveTwin,
  TwinCommandCenter,
  TwinHealthMap,
  TwinImpact,
  TwinReplay,
  TwinReplayKind,
  TwinReplayWindow,
  TwinScenarioCenter,
  TwinTopology,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge, StatusDot } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import { EtwinPlatformTab } from '@renderer/digitalTwinPlatform/EtwinPlatformTab';
import { bandLabel, bandTone, domainIcon, execTwinIcon, priorityTone, replayIcon } from './twinCenterModel';

type Tab = 'twins' | 'topology' | 'health' | 'impact' | 'replay' | 'scenario' | 'executive' | 'platform';

export function TwinCenterView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [overview, setOverview] = useState<EnterpriseTwinOverview | null>(null);
  const [replay, setReplay] = useState<TwinReplay | null>(null);
  const [scenario, setScenario] = useState<TwinScenarioCenter | null>(null);
  const [tab, setTab] = useState<Tab>('twins');

  const refresh = useCallback(async () => {
    try {
      const [o, r, s] = await Promise.all([ipc.twin.overview(), ipc.twin.replay(), ipc.twin.scenario()]);
      setOverview(o);
      setReplay(r);
      setScenario(s);
    } catch {
      /* keep last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.twin.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'twins', label: 'Twins', icon: 'grid' },
    { id: 'topology', label: 'Topology', icon: 'globe' },
    { id: 'health', label: 'Health Map', icon: 'pulse' },
    { id: 'impact', label: 'Change Impact', icon: 'bolt' },
    { id: 'replay', label: 'Replay', icon: 'clock' },
    { id: 'scenario', label: 'Scenarios', icon: 'beaker' },
    { id: 'executive', label: 'Command Center', icon: 'star' },
    // Phase 6 Stage 13 — the Enterprise Digital Twin Platform (read-only etwin:* composition).
    // `server`, not `grid`: Twins above already holds `grid`, and both sibling stages that
    // appended a platform tab picked an icon unused in that strip (S10 `globe` into
    // strategyCenter, S11 `checklist` into federationCenter). Two tabs sharing a glyph is a
    // strip a reader has to disambiguate by label alone.
    { id: 'platform', label: 'Platform', icon: 'server' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Digital Twin Center</h1>
            <p className="mt-1 text-md text-muted">
              A living, read-only twin of the enterprise — every organization, worker, connector, cloud resource, package, and federation relationship, composed from the existing platform. It visualizes and models; it never executes.
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

        {tab === 'platform' ? (
          // Phase 6 Stage 13 — its own etwin:* reads; deliberately checked BEFORE
          // the `!ready` / `!overview` guards, so an unreadable P15 overview does
          // not blank a composition that reads seven other channels. Same shape as
          // the Stage 10/11/12 platform tabs in their Centers.
          <EtwinPlatformTab />
        ) : !ready ? (
          <LoadingBlock label="Composing the enterprise twin…" />
        ) : !overview ? (
          <EmptyState icon="grid" title="Digital twin unavailable" hint="No twin data could be loaded." />
        ) : tab === 'twins' ? (
          <Twins data={overview} />
        ) : tab === 'topology' ? (
          <Topology topology={overview.topology} />
        ) : tab === 'health' ? (
          <Health health={overview.health} />
        ) : tab === 'impact' ? (
          <Impact impact={overview.impact} />
        ) : tab === 'replay' ? (
          <Replay replay={replay} />
        ) : tab === 'scenario' ? (
          <Scenario scenario={scenario} />
        ) : (
          <Executive command={overview.commandCenter} />
        )}
      </div>
    </div>
  );
}

/* ── Twins ───────────────────────────────────────────────────────────────── */

function TwinCard({ twin }: { twin: EnterpriseTwinDomain }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="flex items-start gap-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name={domainIcon(twin.id)} size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{twin.name}</span>
            <StatusBadge tone={bandTone(twin.band)} label={bandLabel(twin.band)} />
            {!twin.live && <Pill tone="gray">projected</Pill>}
          </div>
          <div className="text-2xs text-faint">{twin.status}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular">{twin.entityCount}</div>
          <div className="text-2xs text-faint">entities</div>
        </div>
      </div>
      <p className="mt-2 text-2xs text-muted">{twin.description}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {twin.metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-white/5 px-2.5 py-1.5">
            <div className="text-2xs text-faint">{m.label}</div>
            <div className="truncate text-xs font-medium">{m.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-2xs text-faint">source: {twin.source}</div>
    </div>
  );
}

function Twins({ data }: { data: EnterpriseTwinOverview }): JSX.Element {
  const s = data.summary;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="grid" label="Domain twins" value={s.domainCount} hint={`${s.liveDomains} live`} />
        <Stat icon="cpu" label="Entities" value={s.totalEntities.toLocaleString()} tone="blue" />
        <Stat icon="pulse" label="Enterprise health" value={`${s.overallHealth}/100`} tone={bandTone(s.healthBand) === 'green' ? 'green' : 'orange'} />
        <Stat icon="bolt" label="Critical impact nodes" value={s.criticalImpactNodes} tone={s.criticalImpactNodes ? 'orange' : 'gray'} />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.domains.domains.map((t) => (
          <TwinCard key={t.id} twin={t} />
        ))}
      </div>
    </div>
  );
}

/* ── Topology ────────────────────────────────────────────────────────────── */

function Topology({ topology }: { topology: TwinTopology }): JSX.Element {
  const maxCount = topology.nodes.reduce((m, n) => Math.max(m, n.nodeCount), 0) || 1;
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="globe" label="Graph nodes" value={topology.totalNodes.toLocaleString()} />
        <Stat icon="connectors" label="Graph edges" value={topology.totalEdges.toLocaleString()} tone="blue" />
        <Stat icon="layers" label="Cross-domain edges" value={topology.crossDomainEdges.toLocaleString()} tone="purple" />
      </Grid>

      <OpsPanel title="Domain topology" subtitle="One node per enterprise-graph domain, sized by node count" className="mt-6 mb-0">
        {topology.nodes.length === 0 ? (
          <EmptyState icon="globe" title="No graph nodes" hint="The enterprise graph is empty until resources/records exist." />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {topology.nodes.map((n) => (
              <div key={n.id} className="rounded-xl border border-white/5 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{n.label}</span>
                  <span className="tabular text-2xs text-faint">{n.nodeCount.toLocaleString()}</span>
                </div>
                <div className="mt-1.5">
                  <Bar value={n.nodeCount / maxCount} tone="blue" />
                </div>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Topology layers" subtitle="Business · Infrastructure · Knowledge · Workforce · Connectors · Federation" className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)]">
            {topology.layers.map((l) => (
              <div key={l.id} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
                <Icon name="layers" size={15} />
                <span className="flex-1 text-sm font-medium">{l.label}</span>
                <span className="tabular text-2xs text-muted">{l.nodeCount.toLocaleString()} nodes</span>
              </div>
            ))}
          </div>
        </OpsPanel>

        <OpsPanel title="Cross-domain links" subtitle="Derived from dependency findings (failure chains + cycles)" className="mb-0">
          {topology.links.length === 0 ? (
            <p className="py-2 text-2xs text-faint">No cross-domain dependency findings.</p>
          ) : (
            <div className="rounded-2xl border border-[var(--hairline)]">
              {topology.links.map((l) => (
                <div key={`${l.from}-${l.to}`} className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-2xs last:border-0">
                  <span className="font-mono text-muted">{l.from.replace('domain:', '')}</span>
                  <Icon name="arrow-right" size={12} />
                  <span className="font-mono text-muted">{l.to.replace('domain:', '')}</span>
                  <span className="ml-auto text-faint">×{l.weight}</span>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>
      <p className="mt-4 text-2xs text-faint">{topology.note}</p>
    </div>
  );
}

/* ── Health ──────────────────────────────────────────────────────────────── */

function Health({ health }: { health: TwinHealthMap }): JSX.Element {
  return (
    <div>
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name="pulse" size={24} />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold tabular">{health.overall}/100</span>
            <StatusBadge tone={bandTone(health.band)} label={bandLabel(health.band)} />
          </div>
          <div className="text-2xs text-faint">Enterprise health</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Mission health scores" subtitle="Reused from Enterprise Intelligence" className="mb-0">
          <div className="flex flex-col gap-2">
            {health.entries.map((e) => (
              <div key={e.key} className="rounded-xl border border-white/5 px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{e.label}</span>
                  <StatusBadge tone={bandTone(e.band)} label={`${e.score}`} />
                </div>
                <Bar value={e.score / 100} tone={bandTone(e.band)} />
              </div>
            ))}
          </div>
        </OpsPanel>

        <OpsPanel title="Domain twin health" subtitle="Per-twin health across the enterprise" className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)]">
            {health.domains.map((d) => (
              <div key={d.domain} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
                <StatusDot tone={bandTone(d.band)} />
                <span className="flex-1 text-sm font-medium">{d.label}</span>
                <span className="text-2xs text-faint">{d.entityCount} entities</span>
                <Pill tone={bandTone(d.band)}>{bandLabel(d.band)}</Pill>
              </div>
            ))}
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}

/* ── Impact ──────────────────────────────────────────────────────────────── */

function Impact({ impact }: { impact: TwinImpact }): JSX.Element {
  const maxBlast = impact.nodes.reduce((m, n) => Math.max(m, n.blastRadius), 0) || 1;
  return (
    <div>
      <Grid cols={2}>
        <Stat icon="bolt" label="Critical dependency nodes" value={impact.criticalCount} tone="orange" />
        <Stat icon="refresh" label="Dependency cycles" value={impact.cyclic ? 'present' : 'none'} tone={impact.cyclic ? 'red' : 'green'} />
      </Grid>
      <OpsPanel title="Blast radius" subtitle="Top single points of failure ranked by blast radius" className="mt-6 mb-0">
        {impact.nodes.length === 0 ? (
          <EmptyState icon="bolt" title="No single points of failure" hint="No node concentrates dependency risk." />
        ) : (
          <div className="rounded-2xl border border-[var(--hairline)]">
            {impact.nodes.map((n) => (
              <div key={n.id} className="border-b border-white/5 px-3 py-2.5 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{n.label}</span>
                  <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-2xs text-faint">{n.domain}</span>
                  <span className="ml-auto tabular text-2xs text-muted">{n.blastRadius} affected · {n.dependents} direct</span>
                </div>
                <div className="mt-1.5">
                  <Bar value={n.blastRadius / maxBlast} tone="orange" />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-2xs text-faint">{impact.note}</p>
      </OpsPanel>
    </div>
  );
}

/* ── Replay ──────────────────────────────────────────────────────────────── */

function Replay({ replay }: { replay: TwinReplay | null }): JSX.Element {
  const [kind, setKind] = useState<TwinReplayKind>('historical');
  if (!replay) return <LoadingBlock label="Loading replay…" />;
  const win = replay.windows.find((w) => w.kind === kind) ?? replay.windows[0];
  if (!win) return <EmptyState icon="clock" title="No replay windows" hint="Timeline replay is unavailable." />;
  const maxDay = win.byDay.reduce((m, d) => Math.max(m, d.count), 0) || 1;
  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-1.5">
        {replay.windows.map((w) => (
          <button
            key={w.kind}
            type="button"
            onClick={() => setKind(w.kind)}
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-2xs font-medium transition', kind === w.kind ? 'bg-white/10 text-ink' : 'text-muted hover:bg-white/5')}
          >
            <Icon name={replayIcon(w.kind)} size={13} />
            {w.label} <span className="text-faint">({w.total})</span>
          </button>
        ))}
      </nav>

      <ReplayWindow win={win} maxDay={maxDay} />
    </div>
  );
}

function ReplayWindow({ win, maxDay }: { win: TwinReplayWindow; maxDay: number }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_2fr]">
      <OpsPanel title="Activity by day" subtitle={win.label} className="mb-0">
        <div className="rounded-2xl border border-[var(--hairline)] p-4">
          {win.byDay.length === 0 ? (
            <p className="py-2 text-2xs text-faint">No events in the window.</p>
          ) : (
            win.byDay.map((d) => (
              <div key={d.day} className="mb-2 last:mb-0">
                <div className="mb-1 flex items-baseline justify-between text-2xs">
                  <span className="text-faint">{d.day.slice(5)}</span>
                  <span className="tabular text-muted">{d.count}</span>
                </div>
                <Bar value={d.count / maxDay} tone="blue" />
              </div>
            ))
          )}
          <p className="mt-3 text-2xs text-faint">{win.note}</p>
        </div>
      </OpsPanel>

      <OpsPanel title={`Events · ${win.total}`} subtitle="Replayed from the existing platform timeline" className="mb-0">
        {win.frames.length === 0 ? (
          <EmptyState icon="clock" title="No events" hint="Nothing matched this replay window." />
        ) : (
          <div className="rounded-2xl border border-[var(--hairline)]">
            {win.frames.slice(0, 60).map((f) => (
              <div key={f.id} className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-2xs last:border-0">
                <StatusDot tone={priorityTone(f.priority)} />
                <span className="w-28 shrink-0 truncate font-medium">{f.label}</span>
                <span className="flex-1 truncate text-faint">{f.resource ?? f.source}</span>
                <span className="tabular text-faint">{f.at.slice(5, 16).replace('T', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Scenario ────────────────────────────────────────────────────────────── */

function Scenario({ scenario }: { scenario: TwinScenarioCenter | null }): JSX.Element {
  if (!scenario) return <LoadingBlock label="Loading scenarios…" />;
  const sim = scenario.simulation;
  const all = [sim.baseline, ...sim.scenarios];
  const rows: { key: keyof typeof sim.baseline.projected; label: string; fmt: (n: number) => string }[] = [
    { key: 'costUsd', label: 'Cost (USD/mo)', fmt: (n) => `$${n}` },
    { key: 'riskScore', label: 'Risk score', fmt: (n) => `${n}` },
    { key: 'timeDays', label: 'Time (days)', fmt: (n) => `${n}` },
    { key: 'resourceUtilizationPct', label: 'Utilization', fmt: (n) => `${n}%` },
    { key: 'complianceScore', label: 'Compliance', fmt: (n) => `${n}` },
    { key: 'probabilityPct', label: 'Confidence', fmt: (n) => `${n}%` },
  ];
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
        <Icon name="shield" size={15} />
        <span className="text-2xs text-muted">{scenario.note}</span>
      </div>
      <OpsPanel title="Scenario comparison" subtitle="Current state vs A/B/C — reused from the P14 strategy simulation, never applied" className="mb-0">
        {sim.scenarios.length === 0 ? (
          <EmptyState icon="beaker" title="No scenarios" hint="Strategy simulation is unavailable." />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[var(--hairline)]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
                  <th className="px-3 py-2">Metric</th>
                  {all.map((sc) => (
                    <th key={sc.id} className="px-3 py-2">{sc.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const best = sim.comparison.find((c) => c.metric === row.key);
                  return (
                    <tr key={row.key} className="border-t border-white/5">
                      <td className="px-3 py-2 text-2xs text-faint">{row.label}</td>
                      {all.map((sc) => (
                        <td key={sc.id} className={cn('px-3 py-2 tabular', best?.bestScenarioId === sc.id ? 'font-semibold text-green-1' : 'text-muted')}>
                          {row.fmt(sc.projected[row.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Executive command center ────────────────────────────────────────────── */

function ExecTwinCard({ twin }: { twin: ExecutiveTwin }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name={execTwinIcon(twin.id)} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{twin.name}</div>
          <div className="text-2xs text-faint">{twin.headline}</div>
        </div>
        <StatusBadge tone={bandTone(twin.band)} label={bandLabel(twin.band)} />
      </div>
      <div className="mt-3 flex flex-col gap-1">
        {twin.kpis.length === 0 ? (
          <p className="text-2xs text-faint">No KPIs in this view.</p>
        ) : (
          twin.kpis.slice(0, 6).map((k) => (
            <div key={k.key} className="flex items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5">
              <StatusDot tone={k.band ? bandTone(k.band) : 'gray'} />
              <span className="flex-1 truncate text-2xs text-muted">{k.label}</span>
              <span className="tabular text-2xs font-medium">{k.display}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Executive({ command }: { command: TwinCommandCenter }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {command.twins.map((t) => (
        <ExecTwinCard key={t.id} twin={t} />
      ))}
    </div>
  );
}
