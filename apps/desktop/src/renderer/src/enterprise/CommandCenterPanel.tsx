import { useMemo, useState } from 'react';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { cn } from '@renderer/lib/cn';
import { useEnterprise } from './EnterpriseProvider';
import { ScoreRing } from './primitives';
import { ExecutePanel } from './ExecutePanel';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import {
  healthLabelTone,
  riskLevelMeta,
  severityMeta,
  formatPct,
  formatAge,
  relativeTime,
  TEXT_TONE,
  TINT_TONE,
  loadWidgetPrefs,
  saveWidgetPrefs,
  type EnterpriseTab,
} from './lib';

const WIDGETS = [
  { id: 'health', label: 'Organization Health' },
  { id: 'intelligence', label: 'Executive Intelligence' },
  { id: 'workforce', label: 'AI Workforce Status' },
  { id: 'kpis', label: 'Business KPIs' },
  { id: 'projects', label: 'Active Projects' },
  { id: 'alerts', label: 'Critical Alerts' },
  { id: 'approvals', label: 'Pending Approvals' },
  { id: 'recommendations', label: 'Recommendations' },
] as const;

export function CommandCenterPanel({
  onNavigate,
}: {
  onNavigate: (tab: EnterpriseTab, query?: string) => void;
}): JSX.Element {
  const { snapshot, graph, compliance, jobs, recommendations, activeWorkspace } = useEnterprise();
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(() =>
    loadWidgetPrefs(
      'command',
      WIDGETS.map((w) => w.id),
    ),
  );
  const [query, setQuery] = useState('');

  const toggle = (id: string): void => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveWidgetPrefs('command', next);
      return next;
    });
  };

  const pendingApprovals = useMemo(
    () =>
      jobs.reduce(
        (n, j) =>
          n +
          (j.status === 'awaiting_approval'
            ? j.proposals.filter((p) => p.verdict.decision === 'require_approval' && !p.approval)
                .length
            : 0),
        0,
      ),
    [jobs],
  );

  const projectNodes = useMemo(
    () => (graph ? graph.nodes.filter((n) => n.kind === 'project').slice(0, 6) : []),
    [graph],
  );
  const failing = useMemo(() => compliance.filter((f) => f.status !== 'pass'), [compliance]);

  if (!snapshot) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-10 text-center text-sm text-faint">
        Loading the command center…
      </div>
    );
  }

  const o = snapshot.organization;
  const wf = snapshot.workforce;
  const has = (id: string): boolean => visible.has(id);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-muted">
          {activeWorkspace?.name ?? 'Workspace'} · {o.organizationName} — the organization at a
          glance, live.
        </p>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
            editing ? 'surface-raised text-ink shadow-sm' : 'text-muted fill-hover hover:text-ink',
          )}
        >
          <Icon name="grid" size={14} /> {editing ? 'Done' : 'Customize'}
        </button>
      </div>

      {/* Execute — the always-visible "do it" surface. Isolated so it can never
          take down the command center. */}
      <ErrorBoundary inline name="execute">
        <ExecutePanel />
      </ErrorBoundary>

      {editing && (
        <div className="mb-5 flex flex-wrap gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3">
          {WIDGETS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => toggle(w.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                visible.has(w.id)
                  ? 'border-transparent bg-accent/15 text-accent'
                  : 'border-[var(--hairline)] text-faint',
              )}
            >
              <Icon name={visible.has(w.id) ? 'check' : 'plus'} size={12} /> {w.label}
            </button>
          ))}
        </div>
      )}

      {/* Enterprise search bar — always available */}
      <div className="mb-5 flex items-center gap-2 rounded-2xl border border-[var(--hairline)] surface-raised px-3.5 py-2.5 shadow-card">
        <Icon name="search" size={16} className="text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) onNavigate('search', query.trim());
          }}
          placeholder="Search the entire organization — projects, documents, people, conversations…"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none focus-visible:shadow-focus placeholder:text-faint"
        />
        <button
          type="button"
          onClick={() => query.trim() && onNavigate('search', query.trim())}
          className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg"
        >
          Search
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {has('health') && (
          <OpsPanel title="Organization Health" subtitle={o.healthLabel}>
            <div className="flex items-center gap-5">
              <ScoreRing
                value={o.healthScore}
                label={o.healthLabel}
                tone={healthLabelTone(o.healthLabel)}
              />
              <div className="flex-1 space-y-2 text-sm">
                <Row
                  label="Members"
                  value={`${o.userCount}`}
                  hint={`${o.humanCount} people · ${o.workerCount} AI`}
                />
                <Row label="Org units" value={`${o.unitCount}`} />
                <Row
                  label="Leadership"
                  value={formatPct(o.leadershipCoverage)}
                  hint="units with a lead"
                />
                <Row
                  label="Risk"
                  value={
                    <StatusBadge
                      tone={riskLevelMeta(snapshot.risk.level).tone}
                      label={riskLevelMeta(snapshot.risk.level).label}
                    />
                  }
                />
              </div>
            </div>
          </OpsPanel>
        )}

        {has('intelligence') && (
          <OpsPanel
            title="Executive Intelligence"
            subtitle="Daily briefing"
            actions={
              <button
                type="button"
                onClick={() => onNavigate('briefings')}
                className="text-2xs font-medium text-accent"
              >
                Open
              </button>
            }
          >
            <div className="rounded-xl border border-[var(--hairline)] p-3.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-lg',
                    TINT_TONE.accent,
                  )}
                >
                  <Icon name="sparkles" size={14} />
                </span>
                <span className="text-2xs font-medium uppercase tracking-wider text-faint">
                  {snapshot.intelligence.grounded
                    ? 'Grounded in your data'
                    : 'Awaiting connected data'}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink">{snapshot.intelligence.headline}</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <Mini label="Recommendations" value={snapshot.intelligence.recommendationCount} />
              <Mini
                label="Open risks"
                value={snapshot.risk.openFindings}
                tone={snapshot.risk.openFindings > 0 ? 'orange' : 'green'}
              />
            </div>
          </OpsPanel>
        )}

        {has('workforce') && (
          <OpsPanel
            title="AI Workforce"
            subtitle={`${wf.total} workers`}
            actions={
              <button
                type="button"
                onClick={() => onNavigate('workspace')}
                className="text-2xs font-medium text-accent"
              >
                Delegate
              </button>
            }
          >
            <div className="grid grid-cols-2 gap-2">
              <Mini label="Running" value={wf.running} tone="blue" />
              <Mini label="Idle" value={wf.idle} tone="green" />
              <Mini label="Avg trust" value={formatPct(wf.averageTrust)} tone="accent" />
              <Mini label="Success" value={formatPct(wf.successRate)} tone="green" />
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--hairline)] px-3 py-2 text-sm">
              <span className="text-muted">Health</span>
              <span
                className={cn(
                  'font-medium',
                  wf.unhealthy + wf.degraded === 0 ? 'text-sysgreen' : 'text-sysorange',
                )}
              >
                {wf.healthy} healthy{wf.degraded > 0 ? ` · ${wf.degraded} degraded` : ''}
                {wf.unhealthy > 0 ? ` · ${wf.unhealthy} unhealthy` : ''}
              </span>
            </div>
          </OpsPanel>
        )}
      </div>

      {has('kpis') && (
        <div className="mt-1 mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat
            icon="checklist"
            label="Projects"
            value={snapshot.activity.projects}
            tone="orange"
          />
          <Stat icon="list" label="Tasks" value={snapshot.activity.tasks} tone="blue" />
          <Stat icon="doc" label="Documents" value={snapshot.activity.documents} tone="gray" />
          <Stat icon="heart" label="Customers" value={snapshot.activity.customers} tone="accent" />
          <Stat
            icon="connectors"
            label="Connectors"
            value={snapshot.operations.connectors}
            tone="blue"
            hint={`${snapshot.operations.connectedAccounts} connected`}
          />
          <Stat
            icon="activity"
            label="Recent activity"
            value={snapshot.activity.recentEvents}
            tone="purple"
            hint="last 24h"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {has('alerts') && (
          <OpsPanel
            title="Critical Alerts"
            subtitle={failing.length === 0 ? 'All clear' : `${failing.length} active`}
          >
            {failing.length === 0 ? (
              <Clear text="No compliance issues. The organization is operating within policy." />
            ) : (
              <ul className="space-y-2">
                {failing.slice(0, 6).map((f) => {
                  const sm = severityMeta(f.severity);
                  return (
                    <li key={f.ruleId}>
                      <button
                        type="button"
                        onClick={() => onNavigate('decision')}
                        className="flex w-full items-start gap-2 rounded-xl border border-[var(--hairline)] p-3 text-left transition fill-hover"
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
                            TINT_TONE[sm.tone],
                          )}
                        >
                          <Icon name="shield" size={12} />
                        </span>
                        <span className="min-w-0">
                          <span className="text-sm text-ink">{f.ruleName}</span>
                          <span className="block truncate text-2xs text-faint">{f.detail}</span>
                        </span>
                        <span
                          className={cn(
                            'ml-auto shrink-0 text-2xs font-semibold',
                            TEXT_TONE[sm.tone],
                          )}
                        >
                          {sm.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </OpsPanel>
        )}

        {has('approvals') && (
          <OpsPanel
            title="Pending Approvals"
            subtitle={
              pendingApprovals === 0 ? 'Nothing waiting' : `${pendingApprovals} awaiting you`
            }
            actions={
              <button
                type="button"
                onClick={() => onNavigate('decision')}
                className="text-2xs font-medium text-accent"
              >
                Decision Center
              </button>
            }
          >
            {pendingApprovals === 0 ? (
              <Clear text="No governed actions are waiting for a decision." />
            ) : (
              <ul className="space-y-2">
                {jobs
                  .filter((j) => j.status === 'awaiting_approval')
                  .slice(0, 5)
                  .map((j) => (
                    <li key={j.id}>
                      <button
                        type="button"
                        onClick={() => onNavigate('decision')}
                        className="flex w-full items-center gap-2 rounded-xl border border-[var(--hairline)] p-3 text-left transition fill-hover"
                      >
                        <span
                          className={cn(
                            'flex h-7 w-7 items-center justify-center rounded-lg',
                            TINT_TONE.orange,
                          )}
                        >
                          <Icon name="shield" size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">
                            {j.proposals[0]?.title ?? j.skillId}
                          </span>
                          <span className="block text-2xs text-faint">
                            {relativeTime(j.createdAt)}
                          </span>
                        </span>
                        <Icon name="chevron-right" size={14} className="text-faint" />
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </OpsPanel>
        )}
      </div>

      <div className="mt-1 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {has('projects') && (
          <OpsPanel
            title="Active Projects"
            subtitle={`${snapshot.activity.projects} in the graph`}
            actions={
              <button
                type="button"
                onClick={() => onNavigate('organization')}
                className="text-2xs font-medium text-accent"
              >
                Explore
              </button>
            }
          >
            {projectNodes.length === 0 ? (
              <Clear
                text="No projects yet. Connect a tool like Linear, Jira, or Notion to populate projects."
                muted
              />
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {projectNodes.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-center gap-2 rounded-xl border border-[var(--hairline)] p-3"
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-lg',
                        TINT_TONE.orange,
                      )}
                    >
                      <Icon name="checklist" size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">{n.label}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </OpsPanel>
        )}

        {has('recommendations') && (
          <OpsPanel
            title="Recommendations"
            subtitle="Next best actions"
            actions={
              <button
                type="button"
                onClick={() => onNavigate('workspace')}
                className="text-2xs font-medium text-accent"
              >
                Review
              </button>
            }
          >
            {recommendations.length === 0 ? (
              <Clear
                text="No recommendations right now — they appear as the organization accrues activity."
                muted
              />
            ) : (
              <ul className="space-y-2">
                {recommendations.slice(0, 5).map((r) => (
                  <li
                    key={r.id}
                    className="flex items-start gap-2 rounded-xl border border-[var(--hairline)] p-3"
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
                        TINT_TONE.accent,
                      )}
                    >
                      <Icon name="lightbulb" size={12} />
                    </span>
                    <span className="min-w-0">
                      <span className="text-sm text-ink">{r.title}</span>
                      <span className="block truncate text-2xs text-faint">{r.rationale}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </OpsPanel>
        )}
      </div>

      <p className="mt-4 text-center text-2xs text-faint">
        Live · synced to the Platform Event Bus
        {snapshot.approvals.oldestPendingAgeMs !== null
          ? ` · oldest approval waiting ${formatAge(snapshot.approvals.oldestPendingAgeMs)}`
          : ''}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2 text-right font-medium text-ink">
        {hint && <span className="text-2xs font-normal text-faint">{hint}</span>}
        {value}
      </span>
    </div>
  );
}

function Mini({
  label,
  value,
  tone = 'gray',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'green' | 'orange' | 'red' | 'blue' | 'purple' | 'accent' | 'gray';
}): JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--hairline)] p-2.5 text-center">
      <div className={cn('text-lg font-semibold tabular', TEXT_TONE[tone])}>{value}</div>
      <div className="text-2xs text-faint">{label}</div>
    </div>
  );
}

function Clear({ text, muted = false }: { text: string; muted?: boolean }): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border p-4 text-sm',
        muted
          ? 'border-dashed border-[var(--hairline)] text-faint'
          : 'border-[var(--hairline)] text-muted',
      )}
    >
      {!muted && (
        <span
          className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TINT_TONE.green)}
        >
          <Icon name="check" size={14} />
        </span>
      )}
      {text}
    </div>
  );
}
