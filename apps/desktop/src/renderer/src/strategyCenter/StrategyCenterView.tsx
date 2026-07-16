/**
 * P14 — Strategy Center. The Autonomous Enterprise Intelligence surface over the EXISTING platform
 * (Enterprise Intelligence, Cloud Control Plane, AI Workforce, Connectors, Marketplace, Industry,
 * Federation, Governance). It reasons, plans, optimizes, simulates, and recommends — but never
 * executes: every output is advisory, evidence-backed, and approval-aware. Tabs: Overview, Goals,
 * Planning, Reasoning, Optimization, Simulation, and Decisions. Reads via `ipc.strategyPlatform.*`;
 * refreshes on the existing `ecosystem:event` broadcast.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  OptimizationEngine,
  PlanningEngine,
  ReasoningReport,
  SimulationReport,
  StrategicGoal,
  StrategyApprovalRequirement,
  StrategyOverview,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge, StatusDot } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import {
  approvalTone,
  areaLabel,
  bandTone,
  categoryIcon,
  categoryLabel,
  dimensionLabel,
  horizonLabel,
  pct,
  priorityLabel,
  priorityTone,
  statusLabel,
  statusTone,
} from './strategyCenterModel';

type Tab = 'overview' | 'goals' | 'planning' | 'reasoning' | 'optimization' | 'simulation' | 'decisions';

export function StrategyCenterView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<StrategyOverview | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const refresh = useCallback(async () => {
    try {
      setData(await ipc.strategyPlatform.overview());
    } catch {
      /* keep last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.strategyPlatform.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Overview', icon: 'grid' },
    { id: 'goals', label: 'Goals', icon: 'checklist' },
    { id: 'planning', label: 'Planning', icon: 'clock' },
    { id: 'reasoning', label: 'Reasoning', icon: 'lightbulb' },
    { id: 'optimization', label: 'Optimization', icon: 'bolt' },
    { id: 'simulation', label: 'Simulation', icon: 'beaker' },
    { id: 'decisions', label: 'Decisions', icon: 'clipboard' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Strategy Center</h1>
            <p className="mt-1 text-md text-muted">
              Autonomous enterprise intelligence — plans, reasons, optimizes, and simulates over the live platform. Every recommendation is advisory, evidence-backed, approval-aware, and never auto-executed.
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
          <LoadingBlock label="Loading strategic intelligence…" />
        ) : !data ? (
          <EmptyState icon="lightbulb" title="Strategic intelligence unavailable" hint="No strategy data could be loaded." />
        ) : tab === 'overview' ? (
          <Overview data={data} />
        ) : tab === 'goals' ? (
          <Goals goals={data.goals.goals} />
        ) : tab === 'planning' ? (
          <Planning planning={data.planning} />
        ) : tab === 'reasoning' ? (
          <Reasoning reasoning={data.reasoning} />
        ) : tab === 'optimization' ? (
          <Optimization optimization={data.optimization} />
        ) : tab === 'simulation' ? (
          <Simulation simulation={data.simulation} />
        ) : (
          <Decisions data={data} />
        )}
      </div>
    </div>
  );
}

function SafetyNote({ text }: { text: string }): JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
      <Icon name="shield" size={15} />
      <span className="text-2xs text-muted">{text}</span>
    </div>
  );
}

function ApprovalChip({ a }: { a: StrategyApprovalRequirement }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/5 px-1.5 py-0.5 text-2xs text-faint">
      <StatusDot tone={approvalTone(a.governed)} />
      {a.governed ? `Approval: ${a.chainName}` : 'Ungoverned — configure chain'}
    </span>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function Overview({ data }: { data: StrategyOverview }): JSX.Element {
  const s = data.summary;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="checklist" label="Goals on track" value={`${s.goalsOnTrack}/${s.goalsTotal}`} tone="green" hint={`${pct(s.overallProgress)} overall progress`} />
        <Stat icon="pulse" label="Enterprise health" value={`${s.overallHealth}/100`} tone={bandTone(s.healthBand) === 'green' ? 'green' : 'orange'} />
        <Stat icon="shield" label="Enterprise risk" value={`${s.overallRisk}/100`} tone={s.overallRisk >= 50 ? 'red' : 'green'} />
        <Stat icon="clipboard" label="Open decisions" value={s.openDecisions} tone={s.openDecisions ? 'orange' : 'gray'} hint={`${s.decisionsRequiringApproval} need approval`} />
      </Grid>

      <div className="mt-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {data.kpis.map((k) => (
            <div key={k.key} className="rounded-2xl border border-[var(--hairline)] p-3">
              <div className="flex items-center gap-1.5">
                <StatusDot tone={k.band ? bandTone(k.band) : 'gray'} />
                <span className="truncate text-2xs text-faint">{k.label}</span>
              </div>
              <div className="mt-1 text-lg font-semibold tabular">{k.display}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Strategic goals" subtitle="Progress against enterprise goals" className="mb-0">
          <div className="flex flex-col gap-2">
            {data.goals.goals.map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-xl border border-white/5 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
                  <Icon name={categoryIcon(g.category)} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{g.name}</div>
                  <Bar value={g.progress} tone={statusTone(g.status)} />
                </div>
                <Pill tone={statusTone(g.status)}>{pct(g.progress)}</Pill>
              </div>
            ))}
          </div>
        </OpsPanel>

        <OpsPanel title="Cross-org collaboration" subtitle="Gated by federation trust policy" className="mb-0">
          {data.collaboration.length === 0 ? (
            <EmptyState icon="globe" title="No federated peers" hint="Trusted peers appear here when federation is configured." />
          ) : (
            <div className="rounded-2xl border border-[var(--hairline)]">
              {data.collaboration.map((c) => (
                <div key={c.peerOrg} className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0">
                  <Icon name="globe" size={15} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.peerOrgName}</div>
                    <div className="truncate text-2xs text-faint">trust: {c.trustLevel} · {c.reason}</div>
                  </div>
                  <Pill tone={c.allowed ? 'green' : c.decision === 'require_approval' ? 'orange' : 'red'}>{c.decision.replace('_', ' ')}</Pill>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>
    </div>
  );
}

/* ── Goals ───────────────────────────────────────────────────────────────── */

function GoalCard({ goal }: { goal: StrategicGoal }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="flex items-start gap-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name={categoryIcon(goal.category)} size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{goal.name}</span>
            <StatusBadge tone={statusTone(goal.status)} label={statusLabel(goal.status)} />
          </div>
          <div className="text-2xs text-faint">{categoryLabel(goal.category)} · {horizonLabel(goal.horizon)}</div>
        </div>
      </div>

      <p className="mt-2 text-2xs text-muted">{goal.description}</p>

      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between text-2xs">
          <span className="text-faint">{goal.successMetric}</span>
          <span className="tabular text-muted">{goal.current} / {goal.target} {goal.unit}</span>
        </div>
        <Bar value={goal.progress} tone={statusTone(goal.status)} />
      </div>

      {goal.objectives.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {goal.objectives.map((o) => (
            <div key={o.id} className="flex items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5">
              <StatusDot tone={statusTone(o.status)} />
              <span className="flex-1 truncate text-2xs text-muted">{o.label}</span>
              <span className="tabular text-2xs text-faint">{o.current}/{o.target} {o.unit}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1">
        {goal.milestones.map((m) => (
          <span key={m.id} className="inline-flex items-center gap-1 rounded-full border border-white/5 px-1.5 py-0.5 text-2xs text-faint">
            <StatusDot tone={statusTone(m.status)} />
            {m.label}
          </span>
        ))}
      </div>

      {goal.dependencies.length > 0 && <div className="mt-2 text-2xs text-faint">depends on: {goal.dependencies.join(', ')}</div>}
    </div>
  );
}

function Goals({ goals }: { goals: StrategicGoal[] }): JSX.Element {
  if (goals.length === 0) return <EmptyState icon="checklist" title="No strategic goals" hint="Strategic goals appear here." />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {goals.map((g) => (
        <GoalCard key={g.id} goal={g} />
      ))}
    </div>
  );
}

/* ── Planning ────────────────────────────────────────────────────────────── */

function Planning({ planning }: { planning: PlanningEngine }): JSX.Element {
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="checklist" label="Goals planned" value={planning.totalGoals} />
        <Stat icon="pin" label="Milestones" value={planning.totalMilestones} tone="blue" />
        <Stat icon="bolt" label="Execution steps" value={planning.totalSteps} tone="orange" hint="all approval-gated" />
      </Grid>

      {planning.horizons.map((h) => (
        <OpsPanel key={h.horizon} title={horizonLabel(h.horizon)} subtitle={h.summary} className="mt-6 mb-0">
          {h.steps.length === 0 ? (
            <p className="py-1 text-2xs text-faint">{h.goalIds.length} goal(s) on track — no execution steps required.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {h.steps.map((step) => (
                <div key={step.id} className="rounded-xl border border-white/5 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Icon name="bolt" size={14} />
                    <span className="flex-1 text-sm font-medium">{step.label}</span>
                    <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-2xs text-muted">{step.action}</span>
                  </div>
                  <div className="mt-1.5">
                    <ApprovalChip a={step.requiredApproval} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      ))}
    </div>
  );
}

/* ── Reasoning ───────────────────────────────────────────────────────────── */

function Reasoning({ reasoning }: { reasoning: ReasoningReport }): JSX.Element {
  return (
    <OpsPanel title={`Enterprise reasoning · confidence ${pct(reasoning.confidence)}`} subtitle="Constraint reasoning over dependencies, risk, resources, cost, compliance and performance" className="mb-0">
      {reasoning.findings.length === 0 ? (
        <EmptyState icon="lightbulb" title="No findings" hint="The estate is within thresholds across every reasoning dimension." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {reasoning.priorityOrder.map((d, i) => (
              <span key={d} className="rounded-full border border-white/5 px-2 py-0.5 text-2xs text-faint">
                {i + 1}. {dimensionLabel(d)}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {reasoning.findings.map((f, i) => (
              <div key={`${f.dimension}-${i}`} className="rounded-2xl border border-[var(--hairline)] p-4">
                <div className="flex items-center gap-2">
                  <StatusBadge tone={bandTone(f.severity)} label={dimensionLabel(f.dimension)} />
                  <span className="ml-auto text-2xs text-faint">confidence {pct(f.confidence)}</span>
                </div>
                <div className="mt-1.5 text-sm font-medium">{f.title}</div>
                <p className="mt-1 text-2xs text-muted">{f.detail}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {f.evidence.map((e) => (
                    <span key={e} className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-2xs text-faint">{e}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </OpsPanel>
  );
}

/* ── Optimization ────────────────────────────────────────────────────────── */

function Optimization({ optimization }: { optimization: OptimizationEngine }): JSX.Element {
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="bolt" label="Opportunities" value={optimization.count} tone="orange" />
        <Stat icon="gauge" label="Potential monthly savings" value={`$${optimization.totalPotentialSavingUsd}`} tone="green" />
        <Stat icon="grid" label="Areas" value={optimization.byArea.length} tone="blue" />
      </Grid>

      <OpsPanel title="Optimization opportunities" subtitle="Ranked; each carries evidence and a required approval" className="mt-6 mb-0">
        {optimization.opportunities.length === 0 ? (
          <EmptyState icon="bolt" title="No opportunities" hint="Resource, budget, cloud, workforce and connector usage are all within targets." />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {optimization.opportunities.map((o) => (
              <div key={o.id} className="rounded-2xl border border-[var(--hairline)] p-4">
                <div className="flex items-center gap-2">
                  <Pill tone={priorityTone(o.priority)}>{priorityLabel(o.priority)}</Pill>
                  <span className="text-2xs text-faint">{areaLabel(o.area)}</span>
                  {o.potentialSavingUsd > 0 && <span className="ml-auto text-2xs text-green-1">~${o.potentialSavingUsd}/mo</span>}
                </div>
                <div className="mt-1.5 text-sm font-medium">{o.title}</div>
                <p className="mt-1 text-2xs text-muted">{o.detail}</p>
                <div className="mt-2 flex items-center justify-between text-2xs">
                  <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-faint">{o.recommendedAction}</span>
                  <span className="text-faint">confidence {pct(o.confidence)}</span>
                </div>
                <div className="mt-2">
                  <ApprovalChip a={o.requiredApproval} />
                </div>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Simulation ──────────────────────────────────────────────────────────── */

function Simulation({ simulation }: { simulation: SimulationReport }): JSX.Element {
  const all = [simulation.baseline, ...simulation.scenarios];
  const rows: { key: keyof SimulationReport['baseline']['projected']; label: string; fmt: (n: number) => string }[] = [
    { key: 'costUsd', label: 'Cost (USD/mo)', fmt: (n) => `$${n}` },
    { key: 'riskScore', label: 'Risk score', fmt: (n) => `${n}` },
    { key: 'timeDays', label: 'Time (days)', fmt: (n) => `${n}` },
    { key: 'resourceUtilizationPct', label: 'Utilization', fmt: (n) => `${n}%` },
    { key: 'complianceScore', label: 'Compliance', fmt: (n) => `${n}` },
    { key: 'probabilityPct', label: 'Confidence', fmt: (n) => `${n}%` },
  ];
  return (
    <div>
      <SafetyNote text={simulation.note} />
      <OpsPanel title="Scenario comparison" subtitle="Deterministic what-if projections — compare and choose; nothing is applied" className="mb-6">
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
                const best = simulation.comparison.find((c) => c.metric === row.key);
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
      </OpsPanel>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {all.map((sc) => (
          <div key={sc.id} className="rounded-2xl border border-[var(--hairline)] p-4">
            <div className="text-sm font-semibold">{sc.name}</div>
            <p className="mt-1 text-2xs text-muted">{sc.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {sc.evidence.map((e) => (
                <span key={e} className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-2xs text-faint">{e}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Decisions ───────────────────────────────────────────────────────────── */

function Decisions({ data }: { data: StrategyOverview }): JSX.Element {
  const q = data.decisions;
  return (
    <div>
      <SafetyNote text={q.note} />
      <Grid cols={3}>
        <Stat icon="clipboard" label="Decision candidates" value={q.count} tone="orange" />
        <Stat icon="lock" label="Require approval" value={q.requiresApprovalCount} tone="blue" />
        <Stat icon="check" label="Auto-executed" value={0} tone="green" hint="never" />
      </Grid>

      <OpsPanel title="Enterprise decision queue" subtitle="Advisory candidates — disposition flows through the existing approval + decision-execution systems" className="mt-6 mb-0">
        {q.decisions.length === 0 ? (
          <EmptyState icon="clipboard" title="No decision candidates" hint="Strategic decisions appear here as the platform surfaces them." />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {q.decisions.map((d) => (
              <div key={d.id} className="rounded-2xl border border-[var(--hairline)] p-4">
                <div className="flex items-center gap-2">
                  <Pill tone={priorityTone(d.priority)}>{priorityLabel(d.priority)}</Pill>
                  <span className="text-2xs text-faint">{categoryLabel(d.category)}</span>
                  <span className="ml-auto text-2xs text-faint">confidence {pct(d.confidence)}</span>
                </div>
                <div className="mt-1.5 text-sm font-semibold">{d.title}</div>
                <p className="mt-1 text-2xs text-muted">{d.recommendation}</p>
                <div className="mt-2 rounded-lg border border-white/5 px-2.5 py-1.5 text-2xs text-faint">
                  Expected: {d.expectedImpact.direction} {d.expectedImpact.metric} by {d.expectedImpact.magnitude} {d.expectedImpact.unit}
                </div>
                {d.tradeOffs.length > 0 && (
                  <ul className="mt-2 list-disc pl-4 text-2xs text-faint">
                    {d.tradeOffs.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {d.requiredApprovals.map((a, i) => (
                    <ApprovalChip key={i} a={a} />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {d.evidence.map((e) => (
                    <span key={e} className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-2xs text-faint">{e}</span>
                  ))}
                </div>
                <div className="mt-2 text-2xs text-faint">sources: {d.sourceSystems.join(' · ')}</div>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}
