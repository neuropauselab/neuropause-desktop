/**
 * P8.6 — Workforce Center panels: Overview, Execution History, and Health. Thin JSX
 * over the tested view-model; every visual is a house primitive. Large collections
 * (health rows) use the dependency-free VirtualList.
 */
import { useMemo, useState } from 'react';
import type { Job, JobStatus } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Bar, IconAction, OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Grid } from '@renderer/operationsCenter/primitives';
import { MetaDot, Pill, TrustMeter, WorkerGlyph } from '@renderer/workforce/primitives';
import { formatMs, formatPct, healthMeta, jobStatusMeta, relativeTime } from '@renderer/workforce/lib';
import { useWorkforce } from '@renderer/workforce/WorkforceProvider';
import { VirtualList } from './VirtualList';
import {
  approvalQueue,
  executionHistory,
  healthRows,
  jobStatusCounts,
  JOB_STATUSES,
  type CenterTab,
  type HealthRow,
} from './workforceCenterModel';

/* ── Overview ────────────────────────────────────────────────────────────── */

export function OverviewPanel({ onOpen }: { onOpen: (t: CenterTab) => void }): JSX.Element {
  const { workers, installs, jobs, intelligence } = useWorkforce();
  const counts = jobStatusCounts(jobs);
  const pending = approvalQueue(jobs).length;
  const success = intelligence?.overallSuccessRate ?? 0;
  const healthy = workers.filter((w) => w.healthState === 'healthy').length;
  const orgHealth = workers.length ? healthy / workers.length : 0;
  const recent = executionHistory(jobs).slice(0, 8);

  return (
    <div>
      <Grid cols={4}>
        <Stat icon="cpu" label="Workers" value={workers.length} hint={`${installs.length} installed`} />
        <Stat icon="play" label="Running" value={counts.running} tone="blue" hint={`${counts.queued} queued`} />
        <Stat icon="shield" label="Awaiting approval" value={pending} tone={pending ? 'orange' : 'gray'} />
        <Stat icon="activity" label="Success rate" value={formatPct(success)} tone="green" />
      </Grid>
      <div className="h-3" />
      <Grid cols={3}>
        <Stat icon="heart" label="Roster health" value={formatPct(orgHealth)} tone={orgHealth >= 0.8 ? 'green' : 'orange'} />
        <Stat icon="package" label="Installed packages" value={installs.length} tone="blue" />
        <Stat icon="clock" label="In flight" value={intelligence?.inFlight ?? counts.running} />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel
          title="Recent activity"
          className="mb-0"
          actions={<IconAction icon="arrow-right" label="Open execution history" onClick={() => onOpen('execution')} />}
        >
          {recent.length === 0 ? (
            <EmptyState icon="clock" title="No activity yet" hint="Run a worker skill to see execution here." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {recent.map((j) => (
                <JobRow key={j.id} job={j} nameOf={(id) => workers.find((w) => w.id === id)?.name ?? id} />
              ))}
            </div>
          )}
        </OpsPanel>

        <OpsPanel
          title="Installed workers"
          className="mb-0"
          actions={<IconAction icon="arrow-right" label="Open install manager" onClick={() => onOpen('installs')} />}
        >
          {installs.length === 0 ? (
            <EmptyState icon="package" title="No installed packages" hint="Built-in workers are always available; installed packages appear here." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {installs.slice(0, 8).map((i) => (
                <div key={i.id} className="flex items-center gap-3 rounded-xl border border-white/5 p-2.5">
                  <WorkerGlyph role={i.role} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{i.name}</div>
                    <div className="text-2xs text-faint">v{i.version} · {i.author}</div>
                  </div>
                  <Pill tone={i.state === 'enabled' ? 'green' : 'gray'}>{i.state}</Pill>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>
    </div>
  );
}

function JobRow({ job, nameOf }: { job: Job; nameOf: (id: string) => string }): JSX.Element {
  const meta = jobStatusMeta(job.status);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 p-2.5">
      <WorkerGlyph role={job.workerRole} size={28} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{nameOf(job.workerId)}</div>
        <div className="truncate text-2xs text-faint">{job.skillId} · {relativeTime(job.createdAt)}</div>
      </div>
      <span className="shrink-0 text-2xs text-faint tabular">{formatMs(job.durationMs)}</span>
      <MetaDot meta={meta} pulse={job.status === 'running'} />
    </div>
  );
}

/* ── Execution History ───────────────────────────────────────────────────── */

export function ExecutionPanel(): JSX.Element {
  const { workers, jobs } = useWorkforce();
  const [status, setStatus] = useState<JobStatus | 'all'>('all');
  const counts = jobStatusCounts(jobs);
  const rows = useMemo(
    () => executionHistory(jobs, { status: status === 'all' ? undefined : status }),
    [jobs, status],
  );
  // O(1) name lookup instead of a per-row linear scan over the roster.
  const nameById = useMemo(() => new Map(workers.map((w) => [w.id, w.name])), [workers]);

  return (
    <OpsPanel title="Execution history" subtitle={`${jobs.length} recent job(s) across the workforce`}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip label="All" count={jobs.length} active={status === 'all'} onClick={() => setStatus('all')} />
        {JOB_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={jobStatusMeta(s).label}
            count={counts[s]}
            active={status === s}
            onClick={() => setStatus(s)}
          />
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="clock" title="No matching jobs" hint="Adjust the status filter or run a worker skill." />
      ) : (
        <VirtualList
          items={rows}
          rowHeight={62}
          height={Math.min(600, Math.max(124, rows.length * 62))}
          rowKey={(j) => j.id}
          renderRow={(j) => <ExecRow job={j} name={nameById.get(j.workerId) ?? j.workerId} />}
        />
      )}
    </OpsPanel>
  );
}

function ExecRow({ job, name }: { job: Job; name: string }): JSX.Element {
  return (
    <div className="flex h-[58px] items-center gap-3 rounded-xl border border-white/5 px-3">
      <WorkerGlyph role={job.workerRole} size={30} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="truncate text-2xs text-faint">
          {job.skillId}
          {job.executor ? ` · via ${job.executor}` : ''} · {relativeTime(job.createdAt)}
        </div>
      </div>
      {job.proposals.length > 0 && <Pill tone="gray" icon="shield">{job.proposals.length}</Pill>}
      <span className="shrink-0 text-2xs text-faint tabular">{formatMs(job.durationMs)}</span>
      <div className="w-32 shrink-0 text-right">
        <StatusBadge tone={jobStatusMeta(job.status).tone} label={jobStatusMeta(job.status).label} pulse={job.status === 'running'} />
      </div>
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium transition',
        active ? 'border-white/30 bg-white/[0.06] text-ink' : 'border-white/5 text-muted hover:border-white/15',
      )}
    >
      {label}
      <span className="tabular text-faint">{count}</span>
    </button>
  );
}

/* ── Health ──────────────────────────────────────────────────────────────── */

export function HealthPanel(): JSX.Element {
  const { workers, intelligence } = useWorkforce();
  const rows = useMemo(
    () => healthRows(workers, intelligence).sort((a, b) => b.failureRate - a.failureRate || a.trust - b.trust),
    [workers, intelligence],
  );

  return (
    <OpsPanel title="Worker health" subtitle="Trust, success/failure, latency, and live utilization across the roster">
      {rows.length === 0 ? (
        <EmptyState icon="heart" title="No workers" hint="Workers appear here once the workforce is loaded." />
      ) : (
        <div className="rounded-2xl border border-[var(--hairline)]">
          <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto] gap-3 border-b border-[var(--hairline)] [background:var(--fill-1)] px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-faint">
            <span>Worker</span>
            <span>Trust</span>
            <span>Success</span>
            <span>Failure</span>
            <span>Latency</span>
            <span className="text-right">Utilization</span>
          </div>
          <VirtualList
            items={rows}
            rowHeight={56}
            height={Math.min(560, Math.max(112, rows.length * 56))}
            rowKey={(r) => r.id}
            renderRow={(r) => <HealthRowView row={r} />}
          />
        </div>
      )}
    </OpsPanel>
  );
}

function HealthRowView({ row }: { row: HealthRow }): JSX.Element {
  const hm = healthMeta(row.healthState);
  return (
    <div className="grid h-full grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto] items-center gap-3 border-b border-white/5 px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <WorkerGlyph role={row.role} size={28} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{row.name}</div>
          <div className="flex items-center gap-1.5 text-2xs text-faint">
            <MetaDot meta={hm} />
            <span>{row.total} run(s)</span>
          </div>
        </div>
      </div>
      <TrustMeter score={row.trust} />
      <span className="text-sm tabular">{formatPct(row.successRate)}</span>
      <span className={cn('text-sm tabular', row.failureRate > 0.3 ? 'text-white' : 'text-muted')}>{formatPct(row.failureRate)}</span>
      <span className="text-sm tabular text-muted">{formatMs(row.avgLatencyMs)}</span>
      <div className="flex w-24 items-center justify-end gap-2">
        <div className="w-14">
          <Bar value={row.utilization} tone={row.inFlight > 0 ? 'blue' : 'gray'} />
        </div>
        <Icon name={row.inFlight > 0 ? 'pulse' : 'dot'} size={13} className={row.inFlight > 0 ? 'text-white/70' : 'text-faint'} />
      </div>
    </div>
  );
}
