/**
 * P19 — Autonomous Operations Center (the Autonomous Enterprise Operations dashboard). A continuously-
 * updated, READ-ONLY view of the closed-loop operations layer: generated operational plans, execution
 * coordination, recovery, optimization, incidents, approval coordination, monitoring, analytics, and the
 * security/governance posture. Nothing here executes — every operation is advisory and approval-gated, and
 * an operation is auto-executable only when an existing policy explicitly permits it. Execution flows
 * through the EXISTING ExecuteEngine + Workforce Runtime under the EXISTING approval engine.
 * Reads via `ipc.autoOps.*`; refreshes on the existing `ecosystem:event` broadcast.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  AutoOpsAnalytics,
  AutoOpsApprovals,
  AutoOpsExecution,
  AutoOpsGovernance,
  AutoOpsIncidents,
  AutoOpsMonitoring,
  AutoOpsOptimization,
  AutoOpsOverview,
  AutoOpsPlans,
  AutoOpsRecovery,
  OperationalPlan,
  OpsApprovalRequirement,
  OpsModuleStatus,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import {
  autoExecLabel,
  autoExecTone,
  bandLabel,
  bandTone,
  categoryIcon,
  dimensionIcon,
  moduleIcon,
  recoveryIcon,
  riskLabel,
  riskTone,
} from './autoOpsCenterModel';

type Tab = 'overview' | 'plans' | 'execution' | 'recovery' | 'optimization' | 'incidents' | 'approvals' | 'monitoring' | 'analytics' | 'governance';

export function AutoOpsCenterView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<AutoOpsOverview | null>(null);
  const [plans, setPlans] = useState<AutoOpsPlans | null>(null);
  const [execution, setExecution] = useState<AutoOpsExecution | null>(null);
  const [recovery, setRecovery] = useState<AutoOpsRecovery | null>(null);
  const [optimization, setOptimization] = useState<AutoOpsOptimization | null>(null);
  const [incidents, setIncidents] = useState<AutoOpsIncidents | null>(null);
  const [approvals, setApprovals] = useState<AutoOpsApprovals | null>(null);
  const [monitoring, setMonitoring] = useState<AutoOpsMonitoring | null>(null);
  const [analytics, setAnalytics] = useState<AutoOpsAnalytics | null>(null);
  const [governance, setGovernance] = useState<AutoOpsGovernance | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [o, p, e, r, opt, inc, appr, mon, an, gov] = await Promise.all([
        ipc.autoOps.overview(),
        ipc.autoOps.plans(),
        ipc.autoOps.execution(),
        ipc.autoOps.recovery(),
        ipc.autoOps.optimization(),
        ipc.autoOps.incidents(),
        ipc.autoOps.approvals(),
        ipc.autoOps.monitoring(),
        ipc.autoOps.analytics(),
        ipc.autoOps.governance(),
      ]);
      setOverview(o);
      setPlans(p);
      setExecution(e);
      setRecovery(r);
      setOptimization(opt);
      setIncidents(inc);
      setApprovals(appr);
      setMonitoring(mon);
      setAnalytics(an);
      setGovernance(gov);
    } catch {
      /* keep last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.autoOps.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Operations', icon: 'command' },
    { id: 'plans', label: 'Plans', icon: 'sparkles' },
    { id: 'execution', label: 'Execution', icon: 'pulse' },
    { id: 'recovery', label: 'Recovery', icon: 'refresh' },
    { id: 'optimization', label: 'Optimization', icon: 'lightbulb' },
    { id: 'incidents', label: 'Incidents', icon: 'shield' },
    { id: 'approvals', label: 'Approvals', icon: 'lock' },
    { id: 'monitoring', label: 'Monitoring', icon: 'analytics' },
    { id: 'analytics', label: 'Analytics', icon: 'grid' },
    { id: 'governance', label: 'Governance', icon: 'shield' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Autonomous Operations</h1>
            <p className="mt-1 text-md text-muted">
              A closed-loop operations layer that observes, recommends, plans, and coordinates enterprise operations — while execution flows only through the existing ExecuteEngine and Workforce Runtime under the existing approval engine. Every operation exposes its reason, evidence, risk, expected outcome, rollback plan, and required approvals; nothing executes autonomously unless a policy explicitly permits it.
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
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                tab === t.id ? 'bg-white/[0.08] text-ink' : 'text-muted hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </nav>

        {!ready ? (
          <LoadingBlock label="Composing autonomous operations…" />
        ) : !overview ? (
          <EmptyState icon="command" title="Operations unavailable" hint="No operations data could be loaded." />
        ) : tab === 'overview' ? (
          <Overview overview={overview} monitoring={monitoring} />
        ) : tab === 'plans' ? (
          <Plans plans={plans} />
        ) : tab === 'execution' ? (
          <Execution execution={execution} />
        ) : tab === 'recovery' ? (
          <Recovery recovery={recovery} />
        ) : tab === 'optimization' ? (
          <Optimization optimization={optimization} />
        ) : tab === 'incidents' ? (
          <Incidents incidents={incidents} />
        ) : tab === 'approvals' ? (
          <Approvals approvals={approvals} />
        ) : tab === 'monitoring' ? (
          <Monitoring monitoring={monitoring} />
        ) : tab === 'analytics' ? (
          <Analytics analytics={analytics} />
        ) : (
          <Governance governance={governance} />
        )}
      </div>
    </div>
  );
}

/* ── shared bits ──────────────────────────────────────────────────────────── */

function ApprovalReq({ reqs }: { reqs: OpsApprovalRequirement[] }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {reqs.map((r, i) => (
        <Pill key={i} tone={r.governed ? 'orange' : 'gray'}>
          {r.governed ? `${r.chainName} · ${r.steps} step${r.steps === 1 ? '' : 's'}` : `${r.trigger} · ungoverned`}
        </Pill>
      ))}
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function ModuleCard({ m }: { m: OpsModuleStatus }): JSX.Element {
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

function Overview({ overview, monitoring }: { overview: AutoOpsOverview; monitoring: AutoOpsMonitoring | null }): JSX.Element {
  const s = overview.summary;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="command" label="Operational plans" value={s.operationalPlans} hint={`${s.approvalRequiredPlans} need approval`} />
        <Stat icon="shield" label="Open incidents" value={s.openIncidents} tone={s.openIncidents > 0 ? 'orange' : 'green'} />
        <Stat icon="lightbulb" label="Optimizations" value={s.optimizationOpportunities} tone="blue" />
        <Stat icon="lock" label="Pending approvals" value={s.pendingApprovals} tone="purple" />
      </Grid>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
        <Icon name="lock" size={15} />
        <span className="text-2xs text-muted">
          <span className="font-medium text-ink">{s.autoExecutablePlans}</span> of {s.operationalPlans} plans are policy-permitted for autonomous execution; the remaining <span className="font-medium text-ink">{s.approvalRequiredPlans}</span> require approval. Nothing executes automatically otherwise.
        </span>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {overview.modules.map((m) => (
          <ModuleCard key={m.id} m={m} />
        ))}
      </div>
      {monitoring && (
        <OpsPanel title="Live monitoring" subtitle={`Overall operational index ${monitoring.overall}/100`} className="mt-6">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {monitoring.signals.map((sig) => (
              <div key={sig.dimension} className="rounded-xl border border-[var(--hairline)] p-3">
                <div className="flex items-center gap-2">
                  <Icon name={dimensionIcon(sig.dimension)} size={14} />
                  <span className="text-2xs font-medium">{sig.label}</span>
                  <span className="ml-auto"><StatusBadge tone={bandTone(sig.band)} label={sig.display} /></span>
                </div>
                <div className="mt-2"><Bar value={sig.value / 100} tone={bandTone(sig.band)} /></div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}
    </div>
  );
}

/* ── Plans ────────────────────────────────────────────────────────────────── */

function PlanCard({ p }: { p: OperationalPlan }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name={categoryIcon(p.category)} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{p.title}</span>
            <Pill tone="gray">{p.category}</Pill>
            <StatusBadge tone={riskTone(p.risk)} label={`${riskLabel(p.risk)} risk`} />
            <StatusBadge tone={autoExecTone(p.autoExecutable)} label={autoExecLabel(p.autoExecutable)} />
          </div>
          <p className="mt-1.5 text-2xs text-muted"><span className="text-faint">Reason:</span> {p.reason}</p>
          <p className="mt-1 text-2xs text-muted"><span className="text-faint">Expected outcome:</span> {p.expectedOutcome}</p>
          <p className="mt-1 text-2xs text-muted"><span className="text-faint">Rollback:</span> {p.rollbackPlan}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-2xs text-faint">Required approvals:</span>
            <ApprovalReq reqs={p.requiredApprovals} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-2xs text-faint">Evidence:</span>
            {p.evidenceKinds.map((k) => (
              <Pill key={k} tone="blue">{k}</Pill>
            ))}
            <span className="text-2xs text-faint">· {p.evidenceCount} ref(s) · confidence {Math.round(p.confidence * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Plans({ plans }: { plans: AutoOpsPlans | null }): JSX.Element {
  if (!plans) return <EmptyState icon="sparkles" title="No plans" hint="No operational plans were generated." />;
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[color:var(--accent-soft-border,var(--hairline))] [background:var(--fill-1)] px-3 py-2">
        <Icon name="lock" size={15} />
        <span className="text-2xs text-muted">Every plan is advisory and approval-gated — nothing executes automatically unless an existing policy explicitly permits it. Execution flows through the existing ExecuteEngine + Workforce Runtime.</span>
      </div>
      <Grid cols={4}>
        <Stat icon="sparkles" label="Plans" value={plans.plans.length} />
        <Stat icon="lock" label="Approval required" value={plans.approvalRequiredCount} tone="orange" />
        <Stat icon="command" label="Policy-permitted" value={plans.autoExecutableCount} tone="green" />
        <Stat icon="grid" label="Categories" value={plans.byCategory.length} tone="blue" />
      </Grid>
      {plans.plans.length === 0 ? (
        <div className="mt-6"><EmptyState icon="sparkles" title="No plans" hint="Operations are nominal — no plans to propose." /></div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {plans.plans.map((p) => (
            <PlanCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Execution ────────────────────────────────────────────────────────────── */

function ExecTable({ rows, empty }: { rows: AutoOpsExecution['active']; empty: string }): JSX.Element {
  if (rows.length === 0) return <p className="px-1 py-3 text-2xs text-faint">{empty}</p>;
  return (
    <div className="divide-y divide-[var(--hairline)]">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 py-2">
          <StatusBadge tone={bandTone(r.band)} label={r.state} />
          <span className="min-w-0 flex-1 truncate text-2xs">{r.label}</span>
          {r.worker && <Pill tone="gray">{r.worker}</Pill>}
          <span className="text-2xs text-faint">{r.kind}</span>
        </div>
      ))}
    </div>
  );
}

function Execution({ execution }: { execution: AutoOpsExecution | null }): JSX.Element {
  if (!execution) return <EmptyState icon="pulse" title="No execution data" hint="No executions are being coordinated." />;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="pulse" label="Active" value={execution.activeCount} tone="blue" />
        <Stat icon="lock" label="Awaiting approval" value={execution.awaitingCount} tone="orange" />
        <Stat icon="command" label="Throughput" value={execution.throughput} />
        <Stat icon="analytics" label="Success rate" value={execution.successRate == null ? 'n/a' : `${Math.round(execution.successRate * 100)}%`} tone={bandTone(execution.band)} />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OpsPanel title="Active executions" subtitle="Observed via the existing ExecuteEngine">
          <ExecTable rows={execution.active} empty="No active executions." />
        </OpsPanel>
        <OpsPanel title="Awaiting approval" subtitle="Gated by the existing approval engine">
          <ExecTable rows={execution.awaitingApproval} empty="Nothing awaiting approval." />
        </OpsPanel>
      </div>
      <OpsPanel title="Recent history" className="mt-4">
        <ExecTable rows={execution.recentHistory} empty="No recent executions." />
      </OpsPanel>
    </div>
  );
}

/* ── Recovery ─────────────────────────────────────────────────────────────── */

function Recovery({ recovery }: { recovery: AutoOpsRecovery | null }): JSX.Element {
  if (!recovery) return <EmptyState icon="refresh" title="No recovery data" hint="No recovery signals are available." />;
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="refresh" label="Recovery actions" value={recovery.recoveryCount} />
        <Stat icon="shield" label="Recent failures" value={recovery.recentFailures} tone={recovery.recentFailures >= 3 ? 'orange' : 'green'} />
        <Stat icon="command" label="Escalations" value={recovery.escalations.length} tone={recovery.escalations.length > 0 ? 'orange' : 'green'} />
      </Grid>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
        <Icon name="refresh" size={15} />
        <span className="text-2xs text-muted">Recovery is recommended over the existing RuntimeSupervisor, Workforce retry planner, and Recovery Center — the layer never invokes recover(), retry, or failover itself.</span>
      </div>
      {recovery.recommendations.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {recovery.recommendations.map((r) => (
            <div key={r.id} className="rounded-2xl border border-[var(--hairline)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Icon name={recoveryIcon(r.kind)} size={15} />
                <span className="text-sm font-semibold">{r.kind}</span>
                <Pill tone="gray">{r.target}</Pill>
                <StatusBadge tone={riskTone(r.risk)} label={`${riskLabel(r.risk)} risk`} />
                <StatusBadge tone={autoExecTone(r.autoExecutable)} label={autoExecLabel(r.autoExecutable)} />
              </div>
              <p className="mt-1.5 text-2xs text-muted">{r.reason}</p>
              <p className="mt-1 text-2xs text-muted"><span className="text-faint">Rollback:</span> {r.rollbackPlan}</p>
              <div className="mt-2"><ApprovalReq reqs={r.requiredApprovals} /></div>
            </div>
          ))}
        </div>
      )}
      <OpsPanel title="Supervisor recovery history" className="mt-4">
        {recovery.supervisorRecoveries.length === 0 ? (
          <p className="px-1 py-3 text-2xs text-faint">No recovery attempts recorded.</p>
        ) : (
          <div className="divide-y divide-[var(--hairline)]">
            {recovery.supervisorRecoveries.map((r, i) => (
              <div key={i} className="flex items-center gap-2 py-2">
                <StatusBadge tone={r.ok ? 'green' : 'red'} label={r.ok ? 'recovered' : 'failed'} />
                <span className="min-w-0 flex-1 truncate text-2xs">{r.subsystem} — {r.reason}</span>
                <span className="text-2xs text-faint">{r.durationMs}ms</span>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Optimization ─────────────────────────────────────────────────────────── */

function Optimization({ optimization }: { optimization: AutoOpsOptimization | null }): JSX.Element {
  if (!optimization) return <EmptyState icon="lightbulb" title="No optimizations" hint="No optimization opportunities available." />;
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="lightbulb" label="Opportunities" value={optimization.count} />
        <Stat icon="store" label="Potential saving" value={`$${optimization.totalPotentialSavingUsd.toLocaleString()}`} tone="green" />
        <Stat icon="grid" label="Areas" value={optimization.byArea.length} tone="blue" />
      </Grid>
      {optimization.opportunities.length === 0 ? (
        <div className="mt-6"><EmptyState icon="lightbulb" title="No opportunities" hint="No optimization opportunities were found." /></div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {optimization.opportunities.map((o) => (
            <div key={o.id} className="rounded-2xl border border-[var(--hairline)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{o.title}</span>
                <Pill tone="gray">{o.area}</Pill>
                <StatusBadge tone={riskTone(o.risk)} label={`${riskLabel(o.risk)} risk`} />
                {o.potentialSavingUsd > 0 && <StatusBadge tone="green" label={`$${o.potentialSavingUsd.toLocaleString()}`} />}
              </div>
              <p className="mt-1.5 text-2xs text-muted">{o.detail}</p>
              <p className="mt-1 text-2xs text-muted"><span className="text-faint">Action:</span> {o.recommendedAction}</p>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge tone={autoExecTone(o.autoExecutable)} label={autoExecLabel(o.autoExecutable)} />
                <ApprovalReq reqs={o.requiredApprovals} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Incidents ────────────────────────────────────────────────────────────── */

function Incidents({ incidents }: { incidents: AutoOpsIncidents | null }): JSX.Element {
  if (!incidents) return <EmptyState icon="shield" title="No incidents" hint="No incidents are being tracked." />;
  return (
    <div>
      <Grid cols={3}>
        <Stat icon="shield" label="Open" value={incidents.open} tone={incidents.open > 0 ? 'orange' : 'green'} />
        <Stat icon="command" label="Critical" value={incidents.critical} tone={incidents.critical > 0 ? 'red' : 'green'} />
        <Stat icon="grid" label="Total" value={incidents.total} />
      </Grid>
      {incidents.incidents.length === 0 ? (
        <div className="mt-6"><EmptyState icon="shield" title="No incidents" hint="No incidents are open." /></div>
      ) : (
        <div className="mt-6 space-y-3">
          {incidents.incidents.map((i) => (
            <div key={i.id} className="rounded-2xl border border-[var(--hairline)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={bandTone(i.band)} label={i.severity} />
                <span className="text-sm font-semibold">{i.title}</span>
                {i.open && <Pill tone="orange">open</Pill>}
                <span className="ml-auto text-2xs text-faint">blast radius {i.blastRadius} · {Math.round(i.confidence * 100)}%</span>
              </div>
              {i.rootCause && <p className="mt-1.5 text-2xs text-muted"><span className="text-faint">Root cause:</span> {i.rootCause}</p>}
              {i.recommendedActions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-2xs text-faint">Recommended:</span>
                  {i.recommendedActions.map((a, idx) => (
                    <Pill key={idx} tone="blue">{a}</Pill>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Approvals ────────────────────────────────────────────────────────────── */

function Approvals({ approvals }: { approvals: AutoOpsApprovals | null }): JSX.Element {
  if (!approvals) return <EmptyState icon="lock" title="No approvals" hint="No approval data available." />;
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
        <Icon name="lock" size={15} />
        <span className="text-2xs text-muted">The coordinator surfaces pending approvals and the governing chains — it never approves or rejects. The existing approval engine remains the sole decision point.</span>
      </div>
      <Grid cols={4}>
        <Stat icon="lock" label="Pending" value={approvals.pendingCount} tone={approvals.pendingCount > 0 ? 'orange' : 'green'} />
        <Stat icon="shield" label="Chains" value={approvals.chains.length} />
        <Stat icon="command" label="Approval-required plans" value={approvals.approvalRequiredPlans} />
        <Stat icon="sparkles" label="Policy-permitted plans" value={approvals.autoExecutablePlans} tone="green" />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OpsPanel title="Pending approvals">
          {approvals.pending.length === 0 ? (
            <p className="px-1 py-3 text-2xs text-faint">Nothing pending approval.</p>
          ) : (
            <div className="divide-y divide-[var(--hairline)]">
              {approvals.pending.map((p) => (
                <div key={p.id} className="py-2">
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={bandTone(p.band)} label={p.risk} />
                    <span className="min-w-0 flex-1 truncate text-2xs">{p.title}</span>
                    <Pill tone="gray">{p.source}</Pill>
                  </div>
                  {p.requestedBy && <div className="mt-1 text-2xs text-faint">requested by {p.requestedBy}</div>}
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
        <OpsPanel title="Approval chains" subtitle="The existing enterprise governance chains">
          {approvals.chains.length === 0 ? (
            <p className="px-1 py-3 text-2xs text-faint">No approval chains configured.</p>
          ) : (
            <div className="divide-y divide-[var(--hairline)]">
              {approvals.chains.map((c) => (
                <div key={c.name} className="flex items-center gap-2 py-2">
                  <StatusBadge tone={c.enabled ? 'green' : 'gray'} label={c.enabled ? 'enabled' : 'off'} />
                  <span className="min-w-0 flex-1 truncate text-2xs">{c.name}</span>
                  <Pill tone="gray">{c.appliesTo}</Pill>
                  <span className="text-2xs text-faint">{c.steps} step{c.steps === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>
    </div>
  );
}

/* ── Monitoring ───────────────────────────────────────────────────────────── */

function Monitoring({ monitoring }: { monitoring: AutoOpsMonitoring | null }): JSX.Element {
  if (!monitoring) return <EmptyState icon="analytics" title="No monitoring" hint="No monitoring signals available." />;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="analytics" label="Overall index" value={`${monitoring.overall}/100`} tone={bandTone(monitoring.overallBand)} />
        <Stat icon="shield" label="At risk" value={monitoring.atRiskCount} tone={monitoring.atRiskCount > 0 ? 'orange' : 'green'} />
        <Stat icon="command" label="Critical" value={monitoring.criticalCount} tone={monitoring.criticalCount > 0 ? 'red' : 'green'} />
        <Stat icon="pulse" label="Healthy" value={monitoring.healthyCount} tone="green" />
      </Grid>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {monitoring.signals.map((sig) => (
          <div key={sig.dimension} className="rounded-2xl border border-[var(--hairline)] p-4">
            <div className="flex items-center gap-2">
              <Icon name={dimensionIcon(sig.dimension)} size={15} />
              <span className="text-sm font-semibold">{sig.label}</span>
              <span className="ml-auto"><StatusBadge tone={bandTone(sig.band)} label={sig.display} /></span>
            </div>
            <div className="mt-2"><Bar value={sig.value / 100} tone={bandTone(sig.band)} /></div>
            <div className="mt-2 text-2xs text-faint">{sig.detail}</div>
            <div className="mt-1 text-2xs text-faint">source: {sig.source}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Analytics ────────────────────────────────────────────────────────────── */

function Analytics({ analytics }: { analytics: AutoOpsAnalytics | null }): JSX.Element {
  if (!analytics) return <EmptyState icon="grid" title="No analytics" hint="No operational analytics available." />;
  return (
    <div>
      <Grid cols={4}>
        {analytics.metrics.map((m) => (
          <Stat key={m.key} icon="analytics" label={m.label} value={m.display} tone={bandTone(m.band)} />
        ))}
      </Grid>
      <OpsPanel title="Operational volume" className="mt-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat icon="sparkles" label="Plans" value={analytics.planCount} />
          <Stat icon="refresh" label="Recovery" value={analytics.recoveryCount} />
          <Stat icon="lightbulb" label="Optimization" value={analytics.optimizationCount} />
          <Stat icon="shield" label="Incidents" value={analytics.incidentCount} />
          <Stat icon="lock" label="Approval req." value={analytics.approvalRequired} />
          <Stat icon="command" label="Auto-exec" value={analytics.autoExecutable} />
        </div>
      </OpsPanel>
    </div>
  );
}

/* ── Governance ───────────────────────────────────────────────────────────── */

function Governance({ governance }: { governance: AutoOpsGovernance | null }): JSX.Element {
  if (!governance) return <EmptyState icon="shield" title="No governance" hint="No governance posture available." />;
  return (
    <div>
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-[color:var(--danger-soft-border,var(--hairline))] [background:var(--fill-1)] px-3 py-2.5">
        <Icon name="shield" size={16} />
        <div>
          <div className="text-2xs font-semibold text-ink">No autonomous bypass</div>
          <div className="text-2xs text-muted">{governance.neverBypass}</div>
        </div>
      </div>
      <OpsPanel title="Auto-execution policy">
        <p className="text-2xs text-muted">{governance.autoExecutionPolicy}</p>
      </OpsPanel>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OpsPanel title="Underlying scopes" subtitle="Each source keeps its own production RBAC scope">
          <div className="divide-y divide-[var(--hairline)]">
            {governance.scopes.map((s) => (
              <div key={s.system} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-2xs">{s.system}</span>
                <Pill tone="gray">{s.permission}</Pill>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Audit + sanitization posture">
          <div className="space-y-1.5">
            {governance.auditSources.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-2xs text-muted">
                <Icon name="grid" size={12} /> {a}
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 border-t border-[var(--hairline)] pt-3">
            {governance.redactions.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-2xs text-faint">
                <Icon name="lock" size={12} /> <span>{r}</span>
              </div>
            ))}
          </div>
        </OpsPanel>
      </div>
      <OpsPanel title="Approval integration" className="mt-4">
        <p className="text-2xs text-muted">{governance.approvalIntegration}</p>
      </OpsPanel>
    </div>
  );
}
