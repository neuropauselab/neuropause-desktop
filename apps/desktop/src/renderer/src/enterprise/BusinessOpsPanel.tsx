import { useMemo, useState } from 'react';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, Bar, StatusBadge } from '@renderer/operations/primitives';
import { cn } from '@renderer/lib/cn';
import { useEnterprise } from './EnterpriseProvider';
import { MiniBars } from './primitives';
import {
  formatPct,
  relativeTime,
  titleCase,
  TEXT_TONE,
  TINT_TONE,
  loadWidgetPrefs,
  saveWidgetPrefs,
} from './lib';

const WIDGETS = [
  { id: 'ai', label: 'AI Utilization' },
  { id: 'workforce', label: 'Workforce Utilization' },
  { id: 'projects', label: 'Project Progress' },
  { id: 'connectors', label: 'Connector Health' },
  { id: 'workflows', label: 'Active Workflows' },
  { id: 'governance', label: 'Governance Metrics' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'trends', label: 'Trend Analysis' },
] as const;

export function BusinessOpsPanel(): JSX.Element {
  const { snapshot, governance, compliance, connectorStats, jobs, workers } = useEnterprise();
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(() => loadWidgetPrefs('operations', WIDGETS.map((w) => w.id)));

  const toggle = (id: string): void => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveWidgetPrefs('operations', next);
      return next;
    });
  };

  const trend = useMemo(() => {
    const days = 7;
    const buckets = new Array(days).fill(0);
    const now = Date.now();
    for (const j of jobs) {
      const age = now - new Date(j.createdAt).getTime();
      const day = Math.floor(age / 86_400_000);
      if (day >= 0 && day < days) buckets[days - 1 - day] += 1;
    }
    return buckets;
  }, [jobs]);

  const byRole = useMemo(() => {
    const map = new Map<string, { total: number; running: number }>();
    for (const w of workers) {
      const e = map.get(w.role) ?? { total: 0, running: 0 };
      e.total += 1;
      if (w.lifecycle === 'running') e.running += 1;
      map.set(w.role, e);
    }
    return [...map.entries()];
  }, [workers]);

  const activeJobs = useMemo(() => jobs.filter((j) => j.status === 'running' || j.status === 'queued' || j.status === 'awaiting_approval'), [jobs]);

  if (!snapshot) {
    return <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-10 text-center text-sm text-faint">Loading operations…</div>;
  }

  const wf = snapshot.workforce;
  const utilization = wf.total > 0 ? wf.running / wf.total : 0;
  const has = (id: string): boolean => visible.has(id);

  const passRate = compliance.length > 0 ? compliance.filter((f) => f.status === 'pass').length / compliance.length : 1;
  const chainsOn = governance ? governance.approvalChains.filter((c) => c.enabled).length : 0;
  const rulesOn = governance ? governance.complianceRules.filter((r) => r.enabled).length : 0;
  const cstats = connectorStats;
  const connectorHealthPct = cstats && cstats.total > 0 ? (cstats.total - cstats.down) / cstats.total : 1;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-muted">Organization-wide operational visibility — utilization, health, governance, and trends.</p>
        <button type="button" onClick={() => setEditing((e) => !e)} className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition', editing ? 'surface-raised text-ink shadow-sm' : 'text-muted fill-hover hover:text-ink')}>
          <Icon name="grid" size={14} /> {editing ? 'Done' : 'Configure'}
        </button>
      </div>

      {editing && (
        <div className="mb-5 flex flex-wrap gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3">
          {WIDGETS.map((w) => (
            <button key={w.id} type="button" onClick={() => toggle(w.id)} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition', visible.has(w.id) ? 'border-transparent bg-accent/15 text-accent' : 'border-[var(--hairline)] text-faint')}>
              <Icon name={visible.has(w.id) ? 'check' : 'plus'} size={12} /> {w.label}
            </button>
          ))}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {has('ai') && <Stat icon="cpu" label="Jobs run" value={wf.jobsRun} tone="accent" hint={`${formatPct(wf.successRate)} success`} />}
        {has('workforce') && <Stat icon="gauge" label="Workforce utilization" value={formatPct(utilization)} tone="blue" hint={`${wf.running}/${wf.total} active`} />}
        {has('governance') && <Stat icon="shield" label="Compliance" value={formatPct(passRate)} tone={passRate >= 1 ? 'green' : 'orange'} hint={`${rulesOn} rules on`} />}
        {has('connectors') && cstats && <Stat icon="connectors" label="Connector health" value={formatPct(connectorHealthPct)} tone={cstats.down > 0 ? 'orange' : 'green'} hint={`${cstats.accounts} accounts`} />}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {has('workforce') && (
          <OpsPanel title="Workforce Utilization" subtitle="By role">
            <ul className="space-y-2.5">
              {byRole.map(([role, e]) => (
                <li key={role} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm text-ink">{titleCase(role)}</span>
                  <div className="flex-1"><Bar value={e.total > 0 ? e.running / e.total : 0} tone="blue" /></div>
                  <span className="w-16 shrink-0 text-right text-2xs text-faint">{e.running}/{e.total} active</span>
                </li>
              ))}
            </ul>
          </OpsPanel>
        )}

        {has('trends') && (
          <OpsPanel title="Trend Analysis" subtitle="AI jobs · last 7 days">
            <div className="flex items-end justify-between gap-4 rounded-xl border border-[var(--hairline)] p-4">
              <div>
                <div className="text-3xl font-semibold tabular">{trend.reduce((a, b) => a + b, 0)}</div>
                <div className="text-2xs text-faint">jobs this week</div>
              </div>
              <MiniBars values={trend} tone="accent" height={52} />
            </div>
            <p className="mt-2 text-2xs text-faint">Bars are daily job counts, oldest → newest. Trend reflects real job timestamps.</p>
          </OpsPanel>
        )}

        {has('connectors') && cstats && (
          <OpsPanel title="Connector Health" subtitle={`${cstats.total} connectors · ${cstats.accounts} accounts`}>
            <div className="grid grid-cols-3 gap-2">
              <Chip label="Healthy" value={cstats.healthy} tone="green" />
              <Chip label="Degraded" value={cstats.degraded} tone="orange" />
              <Chip label="Down" value={cstats.down} tone="red" />
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <Line label="Configured" value={`${cstats.configured}/${cstats.total}`} />
              <Line label="Connected" value={`${cstats.connected} connector(s)`} />
            </div>
          </OpsPanel>
        )}

        {has('governance') && (
          <OpsPanel title="Governance Metrics" subtitle="Policy posture">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between"><span className="text-muted">Compliance pass rate</span><StatusBadge tone={passRate >= 1 ? 'green' : 'orange'} label={formatPct(passRate)} /></div>
              <div><div className="mb-1 flex justify-between text-2xs text-faint"><span>Rules passing</span><span>{compliance.filter((f) => f.status === 'pass').length}/{compliance.length}</span></div><Bar value={passRate} tone={passRate >= 1 ? 'green' : 'orange'} /></div>
              <Line label="Approval chains enabled" value={`${chainsOn}/${governance?.approvalChains.length ?? 0}`} />
              <Line label="Compliance rules enabled" value={`${rulesOn}/${governance?.complianceRules.length ?? 0}`} />
              <Line label="Audit entries" value={`${snapshot.operations.auditEntries}`} />
            </div>
          </OpsPanel>
        )}

        {has('projects') && (
          <OpsPanel title="Project Progress" subtitle="Work in the organization">
            <div className="grid grid-cols-3 gap-2">
              <Chip label="Projects" value={snapshot.activity.projects} tone="orange" />
              <Chip label="Tasks" value={snapshot.activity.tasks} tone="blue" />
              <Chip label="Documents" value={snapshot.activity.documents} tone="gray" />
            </div>
            <p className="mt-3 text-2xs text-faint">
              {snapshot.activity.projects === 0
                ? 'Connect a project tool (Linear, Jira, Notion) to track project progress here.'
                : `${snapshot.activity.recentEvents} activity event(s) in the last 24 hours across these projects.`}
            </p>
          </OpsPanel>
        )}

        {has('productivity') && (
          <OpsPanel title="Productivity" subtitle="Output signals">
            <div className="grid grid-cols-2 gap-2">
              <Chip label="Recent activity (24h)" value={snapshot.activity.recentEvents} tone="purple" />
              <Chip label="AI jobs run" value={wf.jobsRun} tone="accent" />
              <Chip label="Members" value={snapshot.organization.userCount} tone="green" />
              <Chip label="Events" value={snapshot.activity.events} tone="blue" />
            </div>
          </OpsPanel>
        )}
      </div>

      {has('workflows') && (
        <OpsPanel title="Active Workflows & Jobs" subtitle={activeJobs.length === 0 ? 'Nothing running' : `${activeJobs.length} active`} className="mt-1">
          {activeJobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--hairline)] p-6 text-center text-sm text-faint">No jobs are running, queued, or awaiting approval right now.</div>
          ) : (
            <ul className="divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl border border-[var(--hairline)]">
              {activeJobs.slice(0, 8).map((j) => {
                const worker = workers.find((w) => w.id === j.workerId);
                const tone = j.status === 'running' ? 'blue' : j.status === 'awaiting_approval' ? 'orange' : 'gray';
                return (
                  <li key={j.id} className="flex items-center gap-3 p-3">
                    <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TINT_TONE[tone])}><Icon name={j.status === 'awaiting_approval' ? 'shield' : 'play'} size={13} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink"><span className="font-medium">{worker?.name ?? j.workerId}</span> <span className="text-faint">· {titleCase(j.skillId)}</span></div>
                      <div className="text-2xs text-faint">{relativeTime(j.createdAt)}</div>
                    </div>
                    <span className={cn('text-2xs font-semibold capitalize', TEXT_TONE[tone])}>{j.status.replace('_', ' ')}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </OpsPanel>
      )}
    </div>
  );
}

function Chip({ label, value, tone }: { label: string; value: number; tone: 'green' | 'orange' | 'red' | 'blue' | 'purple' | 'accent' | 'gray' }): JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--hairline)] p-2.5 text-center">
      <div className={cn('text-lg font-semibold tabular', TEXT_TONE[tone])}>{value}</div>
      <div className="text-2xs text-faint">{label}</div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}
