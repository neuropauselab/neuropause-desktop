/**
 * Phase 6 Stage 8 — the Automation Platform tab (inside the EXISTING Automation
 * Center). Presentation over the six read-only `ap:*` reads: the computed
 * catalog, versioned playbooks with compiled plans (Principle C checkpoints +
 * the mandatory Principle D explainability envelope, both rendered), policy
 * resolution where governance chains always win, and the execution monitor.
 * The tab mutates nothing — running a compiled playbook happens through the
 * EXISTING workforce workflow surface, and the tab says so.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  AutomationCatalog,
  AutomationMonitorReport,
  AutomationPlan,
  AutomationPlatformDashboard,
  AutomationPoliciesView,
  PlaybookDefinition,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import {
  apHeaderStats,
  catalogRows,
  chainRows,
  disclosureLines,
  findingRows,
  isPlan,
  kindCountRows,
  planView,
  playbookRows,
  policyDefaultRows,
  unavailableLines,
  type PlanView,
} from './apPlatformModel';

interface ApData {
  dashboard: AutomationPlatformDashboard | null;
  catalog: AutomationCatalog | null;
  playbooks: PlaybookDefinition[];
  monitor: AutomationMonitorReport | null;
  policies: AutomationPoliciesView | null;
}

const EMPTY: ApData = { dashboard: null, catalog: null, playbooks: [], monitor: null, policies: null };

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export function ApPlatformTab(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [d, setD] = useState<ApData>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [planState, setPlanState] = useState<'idle' | 'loading' | 'missing'>('idle');

  const refresh = useCallback(async () => {
    const [dashboard, catalog, playbooks, monitor, policies] = await Promise.all([
      settled(ipc.ap.dashboard(), null as AutomationPlatformDashboard | null),
      settled(ipc.ap.catalog(), null as AutomationCatalog | null),
      settled(
        ipc.ap.playbooks().then((r) => r.playbooks),
        [] as PlaybookDefinition[],
      ),
      settled(ipc.ap.monitor(), null as AutomationMonitorReport | null),
      settled(ipc.ap.policies(), null as AutomationPoliciesView | null),
    ]);
    setD({ dashboard, catalog, playbooks, monitor, policies });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openPlan = useCallback((playbookId: string): void => {
    setSelected(playbookId);
    setPlanState('loading');
    setPlan(null);
    ipc.ap
      .plan(playbookId)
      .then((resp: AutomationPlan | { playbookId: string; found: false }) => {
        if (isPlan(resp)) {
          setPlan(planView(resp));
          setPlanState('idle');
        } else {
          setPlanState('missing');
        }
      })
      .catch(() => setPlanState('missing'));
  }, []);

  if (!ready) return <LoadingBlock label="Loading the automation platform…" />;

  const stats = d.dashboard ? apHeaderStats(d.dashboard) : [];
  const findings = d.monitor ? findingRows(d.monitor) : [];
  const disclosures = disclosureLines(d.catalog, d.dashboard);
  const unavailable = unavailableLines(
    [d.catalog, d.monitor, d.dashboard].filter((x): x is NonNullable<typeof x> => x !== null),
  );

  return (
    <>
      {stats.length > 0 && (
        <OpsPanel
          title="Enterprise Automation Platform"
          subtitle="Computed catalog · versioned playbooks · governed policy · execution monitor — read-only; execution stays on the existing approval-gated spine"
        >
          <div className="flex flex-wrap gap-2">
            {stats.map((s) => (
              <span key={s.label} title={s.hint}>
                <StatusBadge tone={s.tone} label={`${s.label}: ${s.value}`} />
              </span>
            ))}
          </div>
        </OpsPanel>
      )}

      <OpsPanel
        title={`Playbooks (${d.playbooks.length})`}
        subtitle="Code-shipped, versioned workflow templates — compiled to the EXISTING WorkflowSpec; a human checkpoint guards every side-effecting step"
      >
        {d.playbooks.length === 0 ? (
          <EmptyState icon="checklist" title="No playbooks shipped" hint="Playbooks are versioned platform data; none are registered in this build." />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {playbookRows(d.playbooks).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => openPlan(p.id)}
                className={cn(
                  'flex w-full items-center gap-3 py-2.5 text-left',
                  selected === p.id && 'opacity-100',
                )}
              >
                <span className="shrink-0">
                  <Icon name="checklist" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {p.name} <span className="text-2xs text-faint">{p.versionText}</span>
                  </div>
                  <div className="text-2xs text-faint">
                    {p.category} · {p.stepsText} · approval trigger “{p.approvalTrigger}”
                  </div>
                </div>
                <StatusBadge
                  tone={p.sideEffectSteps > 0 ? 'orange' : 'green'}
                  label={p.sideEffectSteps > 0 ? `${p.sideEffectSteps} gated` : 'read-only'}
                />
              </button>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-faint">
          Select a playbook to compile its plan. Running a compiled workflow happens through the
          existing AI Workforce surface — this tab never executes anything.
        </p>
      </OpsPanel>

      {selected !== null && (
        <OpsPanel
          title={plan ? `Plan: ${plan.title}` : 'Plan'}
          subtitle="Compiled workflow + mandatory explainability (Principle D) + policy resolution (chains always win) + honest rollback"
        >
          {planState === 'loading' && <LoadingBlock label="Compiling plan…" />}
          {planState === 'missing' && (
            <EmptyState icon="info" title="Plan unavailable" hint="The playbook id did not resolve, or the platform read failed." />
          )}
          {plan && (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
                  Compiled workflow ({plan.workflowStepRows.length} steps · {plan.insertedGates} inserted checkpoint(s))
                </div>
                <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                  {plan.workflowStepRows.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 py-2">
                      <span className="shrink-0">
                        <Icon name={s.kindLabel === 'Approval checkpoint' ? 'shield' : 'cpu'} size={14} className="text-faint" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-ink">{s.kindLabel}</div>
                        <div className="truncate text-2xs text-faint">{s.detail}</div>
                      </div>
                      {s.isInsertedGate && <StatusBadge tone="orange" label="Principle C gate" />}
                    </div>
                  ))}
                </div>
                {plan.issueLines.length > 0 && (
                  <div className="mt-2 text-xs text-faint">
                    Compile findings: {plan.issueLines.join(' · ')}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
                  Why / evidence / outcome (mandatory)
                </div>
                <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                  {plan.explainabilityLines.map((l) => (
                    <div key={l.label} className="flex items-start gap-3 py-2">
                      <span className="w-32 shrink-0 text-2xs font-medium uppercase tracking-wide text-faint">
                        {l.label}
                      </span>
                      <span className="min-w-0 flex-1 text-xs text-muted">{l.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
                  Policy resolution & approvals
                </div>
                <ul className="space-y-1 text-xs text-muted">
                  {plan.policyLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                  {plan.approvalLines.map((line) => (
                    <li key={`a-${line}`}>Approval: {line}</li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
                  Rollback (honest) · simulation · knowledge
                </div>
                <ul className="space-y-1 text-xs text-muted">
                  {plan.rollbackLines.map((line) => (
                    <li key={`r-${line}`}>{line}</li>
                  ))}
                  <li>{plan.simulationNote}</li>
                  {plan.knowledgeLines.map((line) => (
                    <li key={`k-${line}`}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </OpsPanel>
      )}

      <OpsPanel
        title={`Execution monitor (${findings.length})`}
        subtitle="Stuck executions · failed runs · aging approvals · error rules · schedule honesty — evidence-cited, severity-sorted"
      >
        {findings.length === 0 ? (
          <EmptyState icon="check" title="No findings" hint="Nothing stuck, failing, aging, or unparseable — as computed from the live records." />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {findings.map((f) => (
              <div key={f.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{f.title}</div>
                  <div className="mt-0.5 text-2xs text-faint">
                    {f.detail} · {f.evidenceCount} evidence ref(s)
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">Suggested: {f.suggestedAction}</div>
                </div>
                <StatusBadge tone={f.tone} label={f.severity} />
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      {d.policies && (
        <OpsPanel
          title="Policy defaults & governance chains"
          subtitle="Composition, not replacement — approval chains ALWAYS win; auto-execution only via an explicit global-governance allow (P19 invariant)"
        >
          <Grid cols={2}>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">Defaults</div>
              <ul className="space-y-1.5 text-xs text-muted">
                {policyDefaultRows(d.policies).map((r) => (
                  <li key={r.id}>
                    <span className="font-medium text-ink">{r.label}</span> — {r.windowText} · {r.retryText}
                    {r.overrideText && <span className="text-faint"> · {r.overrideText}</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
                Governed triggers ({chainRows(d.policies).length})
              </div>
              {chainRows(d.policies).length === 0 ? (
                <p className="text-xs text-faint">No enabled approval chains — side-effect proposals still park for a human.</p>
              ) : (
                <ul className="space-y-1.5 text-xs text-muted">
                  {chainRows(d.policies).map((c) => (
                    <li key={c.trigger}>
                      <span className="font-medium text-ink">{c.trigger}</span> — {c.text}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-faint">
                Auto-allowed triggers: {d.policies.autoAllowedTriggers.length === 0 ? 'none (default-deny)' : d.policies.autoAllowedTriggers.join(', ')}
              </p>
            </div>
          </Grid>
          <p className="mt-3 text-xs text-faint">{d.policies.note}</p>
        </OpsPanel>
      )}

      {d.catalog && (
        <OpsPanel
          title={`Automation catalog (${d.catalog.totals.entries})`}
          subtitle="Every automation-capable capability, classified live — computed on read, never stored"
        >
          <div className="mb-3 flex flex-wrap gap-2">
            {kindCountRows(d.catalog).map((k) => (
              <StatusBadge key={k.kind} tone="blue" label={`${k.label}: ${k.count}`} />
            ))}
          </div>
          {d.catalog.entries.length === 0 ? (
            <EmptyState icon="list" title="Catalog empty" hint="No rules, runs, playbooks, or sources were readable." />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {catalogRows(d.catalog).map((e) => (
                <div key={e.id} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 shrink-0">
                    <Icon name={e.icon} size={15} className="text-faint" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {e.name} <span className="text-2xs text-faint">· {e.kindLabel}</span>
                    </div>
                    <div className="mt-0.5 text-2xs text-faint">Execution: {e.executionPath}</div>
                    <div className="mt-0.5 text-2xs text-faint">Approval: {e.approval}</div>
                    {e.scheduleText && (
                      <div className={cn('mt-0.5 text-2xs', e.scheduleTone === 'orange' ? 'text-muted' : 'text-faint')}>
                        Schedule: {e.scheduleText}
                      </div>
                    )}
                  </div>
                  <StatusBadge tone="gray" label={e.status} />
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}

      {(disclosures.length > 0 || unavailable.length > 0) && (
        <OpsPanel title="Disclosures & unavailable reads" subtitle="Structural honesty — stated, never papered over">
          <ul className="space-y-1 text-xs text-faint">
            {disclosures.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {unavailable.map((line) => (
              <li key={`u-${line}`}>Unavailable — {line}</li>
            ))}
          </ul>
        </OpsPanel>
      )}
    </>
  );
}
