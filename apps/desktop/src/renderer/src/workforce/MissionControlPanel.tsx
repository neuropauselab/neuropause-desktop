import { useMemo } from 'react';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat } from '@renderer/operations/primitives';
import { cn } from '@renderer/lib/cn';
import { useWorkforce } from './WorkforceProvider';
import { WorkerGlyph, MetaDot } from './primitives';
import {
  healthMeta,
  jobStatusMeta,
  lifecycleMeta,
  pendingApprovalCount,
  relativeTime,
  TEXT_TONE,
  TINT_TONE,
  titleCase,
  trustTone,
  formatTrust,
  type WorkforceTab,
  type OpsTone,
} from './lib';

interface Alert {
  tone: OpsTone;
  icon: 'shield' | 'activity' | 'info' | 'close';
  text: string;
  tab: WorkforceTab;
}

export function MissionControlPanel({ onNavigate }: { onNavigate: (tab: WorkforceTab) => void }): JSX.Element {
  const { workers, jobs } = useWorkforce();

  const m = useMemo(() => {
    const idle = workers.filter((w) => w.lifecycle === 'idle').length;
    const running = jobs.filter((j) => j.status === 'running').length;
    const queued = jobs.filter((j) => j.status === 'queued').length;
    const awaiting = jobs.filter((j) => j.status === 'awaiting_approval');
    const waitingApprovals = awaiting.reduce((n, j) => n + pendingApprovalCount(j.proposals), 0);
    const succeeded = jobs.filter((j) => j.status === 'succeeded').length;
    const failed = jobs.filter((j) => j.status === 'failed').length;
    const terminal = succeeded + failed;
    const successRate = terminal > 0 ? succeeded / terminal : 1;
    const healthy = workers.filter((w) => w.healthState === 'healthy').length;
    const unknown = workers.filter((w) => w.healthState === 'unknown').length;
    const ailing = workers.filter((w) => w.healthState === 'degraded' || w.healthState === 'unhealthy').length;
    // Org health rolls up "not in a bad state". A freshly-registered worker
    // reports 'unknown' until it runs a job — that is not the same as unhealthy,
    // so only degraded/unhealthy workers pull this down. Keeps it consistent
    // with the Alerts panel, which flags exactly those two states.
    const orgHealthPct = workers.length > 0 ? (workers.length - ailing) / workers.length : 1;
    return {
      idle,
      running,
      queued,
      awaiting,
      waitingApprovals,
      succeeded,
      failed,
      successRate,
      orgHealthPct,
      healthy,
      unknown,
      ailing,
      pendingJobs: queued + awaiting.length,
    };
  }, [workers, jobs]);

  const alerts = useMemo<Alert[]>(() => {
    const out: Alert[] = [];
    for (const w of workers) {
      if (w.healthState === 'unhealthy') out.push({ tone: 'red', icon: 'activity', text: `${w.name} is unhealthy`, tab: 'workers' });
      else if (w.healthState === 'degraded') out.push({ tone: 'orange', icon: 'activity', text: `${w.name} is degraded`, tab: 'workers' });
    }
    if (m.waitingApprovals > 0)
      out.push({ tone: 'orange', icon: 'shield', text: `${m.waitingApprovals} proposal(s) awaiting your approval`, tab: 'approvals' });
    for (const j of jobs.filter((x) => x.status === 'failed').slice(0, 3))
      out.push({ tone: 'red', icon: 'close', text: `Job failed: ${j.error ?? j.skillId}`, tab: 'workers' });
    return out.slice(0, 6);
  }, [workers, jobs, m.waitingApprovals]);

  const recent = useMemo(() => jobs.slice(0, 7), [jobs]);

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat icon="cpu" label="AI Workers" value={workers.length} tone="accent" hint={`${m.idle} idle`} />
        <Stat icon="play" label="Running Jobs" value={m.running} tone="blue" />
        <Stat icon="clock" label="Pending Jobs" value={m.pendingJobs} tone="orange" hint={`${m.queued} queued`} />
        <Stat icon="shield" label="Waiting Approvals" value={m.waitingApprovals} tone={m.waitingApprovals > 0 ? 'orange' : 'green'} />
        <Stat
          icon="activity"
          label="Org Health"
          value={formatTrust(m.orgHealthPct)}
          tone={m.ailing === 0 ? 'green' : m.orgHealthPct >= 0.7 ? 'orange' : 'red'}
          hint={m.ailing > 0 ? `${m.ailing} need attention` : m.unknown > 0 ? `${m.healthy} healthy · ${m.unknown} new` : 'all healthy'}
        />
        <Stat icon="gauge" label="Job Success" value={formatTrust(m.successRate)} tone="green" hint={`${m.succeeded} done`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <OpsPanel title="Workforce status" subtitle="Every worker, live" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {workers.map((w) => {
              const life = lifecycleMeta(w.lifecycle);
              const queue = jobs.filter((j) => j.workerId === w.id && (j.status === 'queued' || j.status === 'running')).length;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => onNavigate('workers')}
                  className="flex items-center gap-3 rounded-xl border border-[var(--hairline)] p-3 text-left transition fill-hover"
                >
                  <WorkerGlyph role={w.role} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{w.name}</span>
                      <span className={cn('tabular text-2xs font-semibold', TEXT_TONE[trustTone(w.trustScore)])}>
                        {formatTrust(w.trustScore)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <MetaDot meta={life} pulse={w.lifecycle === 'running'} />
                      <span className="text-2xs text-faint">·</span>
                      <span className={cn('text-2xs', TEXT_TONE[healthMeta(w.healthState).tone])}>
                        {healthMeta(w.healthState).label}
                      </span>
                      {queue > 0 && <span className="text-2xs text-faint">· {queue} in queue</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </OpsPanel>

        <OpsPanel title="Alerts" subtitle={alerts.length === 0 ? 'All clear' : `${alerts.length} active`}>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--hairline)] p-4 text-sm text-muted">
              <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TINT_TONE.green)}>
                <Icon name="check" size={14} />
              </span>
              Nothing needs attention.
            </div>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onNavigate(a.tab)}
                    className="flex w-full items-start gap-2 rounded-xl border border-[var(--hairline)] p-3 text-left transition fill-hover"
                  >
                    <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md', TINT_TONE[a.tone])}>
                      <Icon name={a.icon} size={12} />
                    </span>
                    <span className="text-sm text-ink">{a.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </OpsPanel>
      </div>

      <OpsPanel title="Recent activity" subtitle="Latest jobs across the workforce" className="mt-1">
        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--hairline)] p-6 text-center text-sm text-faint">
            No jobs yet. Run a worker from the Workforce tab to see activity here.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl border border-[var(--hairline)]">
            {recent.map((j) => {
              const st = jobStatusMeta(j.status);
              const worker = workers.find((w) => w.id === j.workerId);
              return (
                <li key={j.id} className="flex items-center gap-3 p-3">
                  {worker && <WorkerGlyph role={worker.role} size={28} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">
                      <span className="font-medium">{worker?.name ?? j.workerId}</span>
                      <span className="text-faint"> · {titleCase(j.skillId)}</span>
                    </div>
                    <div className="truncate text-2xs text-faint">{j.summary ?? j.error ?? '—'}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <MetaDot meta={st} />
                    <span className="text-2xs text-faint">{relativeTime(j.finishedAt ?? j.createdAt)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </OpsPanel>
    </div>
  );
}
