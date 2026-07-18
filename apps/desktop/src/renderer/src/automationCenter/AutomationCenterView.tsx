/**
 * Automation Center v1.0 — the reuse-only Automation workspace.
 *
 * A PRESENTATION LAYER over the EXISTING but UI-less automation rule engine (`ipc.automations.*`): it surfaces
 * the live monitor, run history and the trigger → condition → action rule list, alongside the Enterprise
 * governance "business rules" and the AI Workforce job runner. It is READ-ONLY — it builds no rules and runs
 * no engine; every authoring action deep-links to the EXISTING AI Workforce "Automation Studio" (the real
 * workflow builder). Capabilities the platform lacks (visual builder, scheduler, AI-action execution, templates,
 * run-trend analytics) are shown honestly as gap rows and never fabricated. Section id: `automation-center`.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  AutomationMonitor,
  AutomationRule,
  AutomationRunRecord,
  GovernanceConfig,
} from '@neuropause/shared';
import type { WorkforceIntelligence } from '@renderer/workforce/intelligenceTypes';
import type { SectionId } from '@renderer/shell/sections';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { useShell } from '@renderer/state/ShellProvider';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock, Meter } from '@renderer/operationsCenter/primitives';
import {
  AUTOMATION_GAPS,
  AUTOMATION_GAP_STATUS,
  AUTOMATION_GAP_TONE,
  runLabel,
  runTone,
  statusLabel,
  statusTone,
  summarizeBusinessRules,
  summarizeMonitor,
  summarizeRules,
  summarizeRuns,
  triggerIcon,
  triggerLabel,
  triggerSourceLabel,
} from './automationModel';

type Tab = 'monitor' | 'rules' | 'business' | 'jobs';

interface Data {
  monitor: AutomationMonitor | null;
  runs: AutomationRunRecord[];
  rules: AutomationRule[];
  governance: GovernanceConfig | null;
  intelligence: WorkforceIntelligence | null;
}

const EMPTY: Data = { monitor: null, runs: [], rules: [], governance: null, intelligence: null };

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

function formatRuntime(ms: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return `${s.toFixed(s >= 10 ? 0 : 1)}s`;
}

function formatWhen(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function pctText(ratio: number): string {
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}

export function AutomationCenterView(): JSX.Element {
  const { setSection } = useShell();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('monitor');
  const [d, setD] = useState<Data>(EMPTY);

  const refresh = useCallback(async () => {
    const [monitor, runs, rules, governance, intelligence] = await Promise.all([
      settled(
        ipc.automations.monitor().then((r) => r.monitor),
        null as AutomationMonitor | null,
      ),
      settled(
        ipc.automations.history().then((r) => r.records),
        [] as AutomationRunRecord[],
      ),
      settled(
        ipc.automations.list().then((r) => r.rules),
        [] as AutomationRule[],
      ),
      settled(ipc.enterprise.governanceConfig(), null as GovernanceConfig | null),
      settled(ipc.workforce.intelligence(), null as WorkforceIntelligence | null),
    ]);
    setD({ monitor, runs, rules, governance, intelligence });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const go: Go = { setSection };
  const rules = summarizeRules(d.rules);
  const monitor = summarizeMonitor(d.monitor);

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'monitor', label: 'Monitor', icon: 'gauge' },
    { id: 'rules', label: 'Rules', icon: 'automations' },
    { id: 'business', label: 'Business Rules', icon: 'shield' },
    { id: 'jobs', label: 'AI Jobs', icon: 'cpu' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--hairline)] px-8 pt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
            <p className="mt-0.5 text-sm text-faint">
              The reuse-only lens over the automation rule engine — monitor, rules, business rules &
              AI jobs.
            </p>
          </div>
          {ready && (
            <div className="text-right text-xs text-faint">
              <div className="font-medium text-muted">{rules.total} rules</div>
              <div>
                {rules.active} active · {monitor.running} running
              </div>
            </div>
          )}
        </div>
        <nav className="mt-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'text-ink [border-bottom:2px_solid_var(--accent)]'
                  : 'text-muted hover:text-ink',
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
          <LoadingBlock label="Loading automation…" />
        ) : (
          <div className="mx-auto" style={{ maxWidth: 1120 }}>
            {tab === 'monitor' && <MonitorTab d={d} />}
            {tab === 'rules' && <RulesTab d={d} go={go} />}
            {tab === 'business' && <BusinessTab d={d} go={go} />}
            {tab === 'jobs' && <JobsTab d={d} go={go} />}
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

function DeepLink({
  label,
  onClick,
  icon = 'arrow-right',
}: {
  label: string;
  onClick: () => void;
  icon?: IconName;
}): JSX.Element {
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

function GapsPanel({ areas }: { areas?: string[] }): JSX.Element {
  const gaps = areas ? AUTOMATION_GAPS.filter((g) => areas.includes(g.area)) : AUTOMATION_GAPS;
  if (gaps.length === 0) return <></>;
  return (
    <OpsPanel
      title="Automation gaps (recorded honestly)"
      subtitle="Capabilities the engine does not have yet — verified from source, never fabricated"
    >
      <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
        {gaps.map((g) => (
          <div key={`${g.area}-${g.capability}`} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 shrink-0">
              <Icon name="info" size={14} className="text-faint" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink">{g.capability}</span>
                <span className="text-2xs text-faint">· {g.area}</span>
              </div>
              <div className="mt-0.5 text-xs text-faint">{g.reason}</div>
            </div>
            <StatusBadge tone={AUTOMATION_GAP_TONE} label={AUTOMATION_GAP_STATUS} />
          </div>
        ))}
      </div>
    </OpsPanel>
  );
}

/* ── Monitor (overview) ──────────────────────────────────────────────────── */

function MonitorTab({ d }: { d: Data }): JSX.Element {
  const m = summarizeMonitor(d.monitor);
  const runs = summarizeRuns(d.runs);
  return (
    <>
      <OpsPanel title="Automation monitor" subtitle="Live snapshot of the rule engine">
        <Grid cols={4}>
          <Stat
            icon="play"
            label="Running"
            tone={m.running > 0 ? 'green' : 'gray'}
            value={m.running}
          />
          <Stat
            icon="check"
            label="Completed"
            tone={m.completed > 0 ? 'green' : 'gray'}
            value={m.completed}
          />
          <Stat icon="info" label="Failed" tone={m.failed > 0 ? 'red' : 'gray'} value={m.failed} />
          <Stat
            icon="pause"
            label="Paused"
            tone={m.paused > 0 ? 'orange' : 'gray'}
            value={m.paused}
          />
        </Grid>
        <div className="mt-3">
          <Grid cols={2}>
            <Stat
              icon="gauge"
              label="Run success rate"
              tone={m.tone}
              value={m.finished > 0 ? pctText(m.successRate) : '—'}
              hint={`${m.finished} finished`}
            />
            <Stat icon="clock" label="Avg runtime" value={formatRuntime(m.avgRuntimeMs)} />
          </Grid>
        </div>
        {m.finished > 0 && (
          <div className="mt-3">
            <Meter
              value={m.successRate}
              tone="accent"
              label="Success rate"
              trailing={pctText(m.successRate)}
            />
          </div>
        )}
      </OpsPanel>

      <OpsPanel
        title={`Recent runs (${runs.total})`}
        subtitle={
          runs.total > 0
            ? `${runs.ok} succeeded · ${runs.failed} failed · newest first`
            : 'Execution history (newest first)'
        }
      >
        {d.runs.length === 0 ? (
          <EmptyState
            icon="automations"
            title="No runs yet"
            hint="The automation engine starts empty. Rules you build in the AI Workforce Automation Studio appear here once they run."
          />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.runs.slice(0, 12).map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{r.ruleName}</div>
                  <div className="text-2xs text-faint">
                    {triggerSourceLabel(r.triggeredBy)} · {formatWhen(r.startedAt)} ·{' '}
                    {formatRuntime(r.durationMs)}
                  </div>
                </div>
                <StatusBadge tone={runTone(r.ok)} label={runLabel(r.ok)} />
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <GapsPanel />
    </>
  );
}

/* ── Rules ───────────────────────────────────────────────────────────────── */

function RulesTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const s = summarizeRules(d.rules);
  return (
    <>
      <OpsPanel
        title="Automation rules"
        subtitle="Event-driven trigger → condition → action rules (read-only)"
        actions={
          <DeepLink
            label="Build in Automation Studio"
            onClick={() => go.setSection('workforce')}
            icon="launch"
          />
        }
      >
        <Grid cols={4}>
          <Stat icon="automations" label="Total rules" value={s.total || '—'} />
          <Stat
            icon="check"
            label="Active"
            tone={s.active > 0 ? 'green' : 'gray'}
            value={s.active}
          />
          <Stat
            icon="pause"
            label="Paused"
            tone={s.paused > 0 ? 'orange' : 'gray'}
            value={s.paused}
            hint={s.error > 0 ? `${s.error} error · ${s.draft} draft` : `${s.draft} draft`}
          />
          <Stat icon="list" label="Action steps" value={s.totalActions} hint="across all rules" />
        </Grid>
        {d.rules.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon="automations"
              title="No automation rules yet"
              hint="The rule engine starts empty. Create trigger → condition → action rules in the AI Workforce Automation Studio — they appear here once saved."
            />
          </div>
        ) : (
          <div className="mt-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.rules.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="shrink-0">
                  <Icon name={triggerIcon(r.trigger.type)} size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{r.name}</div>
                  <div className="text-2xs text-faint">
                    {triggerLabel(r.trigger.type)} · {r.actions.length}{' '}
                    {r.actions.length === 1 ? 'action' : 'actions'}
                    {r.conditions.length > 0 &&
                      ` · ${r.conditions.length} ${r.conditions.length === 1 ? 'condition' : 'conditions'}`}
                    {r.lastRun && ` · last run ${r.lastRun.ok ? 'ok' : 'failed'}`}
                  </div>
                </div>
                <StatusBadge tone={statusTone(r.status)} label={statusLabel(r.status)} />
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-faint">
          Rules are authored in the AI Workforce Automation Studio; this workspace is a read-only
          lens over the engine.
        </p>
      </OpsPanel>

      <GapsPanel areas={['Builder', 'Triggers', 'Actions', 'Rules']} />
    </>
  );
}

/* ── Business Rules ──────────────────────────────────────────────────────── */

function BusinessTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const b = summarizeBusinessRules(d.governance);
  return (
    <OpsPanel
      title="Business rules & governance"
      subtitle="Org-level compliance rules + approval chains from Enterprise governance"
      actions={<DeepLink label="Edit in Enterprise" onClick={() => go.setSection('enterprise')} />}
    >
      {d.governance ? (
        <Grid cols={2}>
          <Stat
            icon="clipboard"
            label="Compliance rules"
            tone={b.rulesEnabled > 0 ? 'green' : 'gray'}
            value={`${b.rulesEnabled}/${b.rules}`}
            hint="enabled"
          />
          <Stat
            icon="checklist"
            label="Approval chains"
            tone={b.chainsEnabled > 0 ? 'green' : 'gray'}
            value={`${b.chainsEnabled}/${b.chains}`}
            hint="enabled"
          />
        </Grid>
      ) : (
        <EmptyState
          icon="shield"
          title="Governance configuration unavailable"
          hint="Business rules are governed centrally in Enterprise."
        />
      )}
      <p className="mt-3 text-xs text-faint">
        Business rules are the org-level governance policies (approval chains + compliance rules),
        managed in Enterprise. This view is read-only.
      </p>
    </OpsPanel>
  );
}

/* ── AI Jobs ─────────────────────────────────────────────────────────────── */

function JobsTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const intel = d.intelligence;
  return (
    <>
      <OpsPanel
        title="AI jobs"
        subtitle="AI Workforce job execution — the workflow studio & job runner"
        actions={
          <DeepLink
            label="Open AI Workforce"
            onClick={() => go.setSection('workforce')}
            icon="launch"
          />
        }
      >
        {intel ? (
          <>
            <Grid cols={4}>
              <Stat icon="cpu" label="Total jobs" value={intel.totalJobs || '—'} />
              <Stat
                icon="pulse"
                label="Active workers"
                tone={intel.activeWorkers > 0 ? 'green' : 'gray'}
                value={intel.activeWorkers}
              />
              <Stat
                icon="play"
                label="In flight"
                tone={intel.inFlight > 0 ? 'green' : 'gray'}
                value={intel.inFlight}
              />
              <Stat
                icon="gauge"
                label="Success rate"
                value={intel.totalJobs > 0 ? pctText(intel.overallSuccessRate) : '—'}
              />
            </Grid>
            {intel.totalJobs > 0 && (
              <div className="mt-3">
                <Meter
                  value={intel.overallSuccessRate}
                  tone="accent"
                  label="Overall job success rate"
                  trailing={pctText(intel.overallSuccessRate)}
                />
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon="cpu"
            title="AI workforce data unavailable"
            hint="The AI Workforce runs AI jobs and builds workflows."
          />
        )}
        <p className="mt-3 text-xs text-faint">
          The AI Workforce runs AI jobs and hosts the Automation Studio (the visual workflow
          builder). Automations deep-link here rather than duplicating the runner.
        </p>
      </OpsPanel>

      <GapsPanel areas={['Actions']} />
    </>
  );
}
