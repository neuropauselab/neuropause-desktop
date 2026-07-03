import { useEffect, useMemo, useState } from 'react';
import type { Job, Worker, WorkerSkill, WorkerSummary } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { Spinner } from '@renderer/components/Spinner';
import { OpsPanel } from '@renderer/operations/primitives';
import { useWorkforce } from './WorkforceProvider';
import { EvidencePills, MetaDot, Pill, TrustMeter, WorkerGlyph } from './primitives';
import {
  healthMeta,
  jobStatusMeta,
  lifecycleMeta,
  relativeTime,
  TEXT_TONE,
  titleCase,
  type WorkforceTab,
} from './lib';

function workerStats(jobs: Job[]) {
  const succeeded = jobs.filter((j) => j.status === 'succeeded').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued' || j.status === 'awaiting_approval');
  const durations = jobs.map((j) => j.durationMs).filter((d): d is number => typeof d === 'number');
  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const terminal = succeeded + failed;
  return { succeeded, failed, active, terminal, successRate: terminal > 0 ? succeeded / terminal : null, avgMs };
}

function SkillRow({
  skill,
  workerId,
  onResult,
}: {
  skill: WorkerSkill;
  workerId: string;
  onResult: (job: Job) => void;
}): JSX.Element {
  const { runSkill } = useWorkforce();
  const [running, setRunning] = useState(false);

  const run = async (): Promise<void> => {
    setRunning(true);
    try {
      const job = await runSkill(workerId, skill.id);
      if (job) onResult(job);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--hairline)] p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{skill.title}</span>
          {skill.sideEffects ? (
            <Pill tone="orange" icon="shield">
              proposes
            </Pill>
          ) : (
            <Pill tone="green" icon="eye">
              read-only
            </Pill>
          )}
        </div>
        <p className="mt-0.5 text-2xs text-faint">{skill.description}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {skill.requires.map((r) => (
            <span key={r} className="rounded-md border border-[var(--hairline)] px-1.5 py-0.5 font-mono text-2xs text-muted">
              {r}
            </span>
          ))}
        </div>
      </div>
      <Button variant="secondary" icon="play" onClick={() => void run()} disabled={running}>
        {running ? 'Running…' : 'Run'}
      </Button>
    </div>
  );
}

function ResultCard({ job, onNavigate }: { job: Job; onNavigate: (tab: WorkforceTab) => void }): JSX.Element {
  const st = jobStatusMeta(job.status);
  return (
    <div className="mt-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-2xs uppercase tracking-wide text-faint">Run result · {titleCase(job.skillId)}</span>
        <MetaDot meta={st} />
      </div>
      <p className="text-sm text-ink">{job.summary ?? job.error ?? 'No result.'}</p>
      {job.evidence.length > 0 && (
        <div className="mt-2">
          <EvidencePills evidence={job.evidence} />
        </div>
      )}
      {job.proposals.length > 0 && (
        <button
          type="button"
          onClick={() => onNavigate('approvals')}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
        >
          <Icon name="shield" size={13} />
          {job.proposals.length} proposal(s) parked for approval — review in the Approval Center
          <Icon name="arrow-right" size={13} />
        </button>
      )}
    </div>
  );
}

function WorkerCard({
  summary,
  jobs,
  onNavigate,
}: {
  summary: WorkerSummary;
  jobs: Job[];
  onNavigate: (tab: WorkforceTab) => void;
}): JSX.Element {
  const { loadWorker } = useWorkforce();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Job | null>(null);

  const stats = useMemo(() => workerStats(jobs), [jobs]);
  const life = lifecycleMeta(summary.lifecycle);
  const health = healthMeta(summary.healthState);

  useEffect(() => {
    if (open && !detail) {
      setLoading(true);
      void loadWorker(summary.id)
        .then((w) => setDetail(w))
        .finally(() => setLoading(false));
    }
  }, [open, detail, loadWorker, summary.id]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-4 text-left transition fill-hover"
      >
        <WorkerGlyph role={summary.role} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-ink">{summary.name}</span>
            <span className="text-2xs text-faint">v{summary.version}</span>
            {summary.builtIn && <Pill tone="accent">built-in</Pill>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <MetaDot meta={life} pulse={summary.lifecycle === 'running'} />
            <span className={cn('text-2xs', TEXT_TONE[health.tone])}>{health.label}</span>
            <span className="text-2xs text-faint">{summary.skillCount} skills</span>
            {stats.active.length > 0 && <span className="text-2xs text-faint">· {stats.active.length} in queue</span>}
            {stats.successRate !== null && (
              <span className="text-2xs text-faint">· {Math.round(stats.successRate * 100)}% success</span>
            )}
          </div>
        </div>
        <TrustMeter score={summary.trustScore} className="hidden sm:flex" />
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} className="text-faint" />
      </button>

      {open && (
        <div className="border-t border-[var(--hairline)] p-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-faint">
              <Spinner size={14} /> Loading worker…
            </div>
          )}
          {detail && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <TrustMeter score={detail.trustScore} className="sm:hidden" />
                <Pill tone="gray">{detail.health.jobsRun} jobs run</Pill>
                <Pill tone="gray">{detail.health.jobsFailed} failed</Pill>
                {stats.avgMs !== null && <Pill tone="gray">avg {Math.round(stats.avgMs)} ms</Pill>}
                <Pill tone="gray">memory: {detail.memoryScope}</Pill>
              </div>

              {detail.goals.length > 0 && (
                <div>
                  <h4 className="mb-1 text-2xs uppercase tracking-wide text-faint">Goals</h4>
                  <ul className="space-y-1">
                    {detail.goals.map((g, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-faint" />
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h4 className="mb-2 text-2xs uppercase tracking-wide text-faint">Skills</h4>
                <div className="space-y-2">
                  {detail.skills.map((s) => (
                    <SkillRow key={s.id} skill={s} workerId={detail.identity.id} onResult={setResult} />
                  ))}
                </div>
              </div>

              {result && <ResultCard job={result} onNavigate={onNavigate} />}

              {stats.active.length + stats.terminal > 0 && (
                <div>
                  <h4 className="mb-2 text-2xs uppercase tracking-wide text-faint">Recent tasks</h4>
                  <ul className="divide-y divide-[var(--hairline)] overflow-hidden rounded-xl border border-[var(--hairline)]">
                    {jobs.slice(0, 5).map((j) => (
                      <li key={j.id} className="flex items-center justify-between gap-2 p-2.5">
                        <span className="truncate text-xs text-ink">
                          {titleCase(j.skillId)} <span className="text-faint">· {j.summary ?? j.error ?? '—'}</span>
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          <MetaDot meta={jobStatusMeta(j.status)} />
                          <span className="text-2xs text-faint">{relativeTime(j.finishedAt ?? j.createdAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DashboardPanel({ onNavigate }: { onNavigate: (tab: WorkforceTab) => void }): JSX.Element {
  const { workers, jobs } = useWorkforce();
  const jobsByWorker = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of jobs) {
      const arr = map.get(j.workerId) ?? [];
      arr.push(j);
      map.set(j.workerId, arr);
    }
    return map;
  }, [jobs]);

  return (
    <OpsPanel
      title="AI Workforce"
      subtitle="Every worker — status, health, trust, skills, and queue. Expand a worker to run a skill."
    >
      <div className="space-y-2.5">
        {workers.map((w) => (
          <WorkerCard key={w.id} summary={w} jobs={jobsByWorker.get(w.id) ?? []} onNavigate={onNavigate} />
        ))}
      </div>
    </OpsPanel>
  );
}
