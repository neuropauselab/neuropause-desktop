import { useMemo, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, Bar } from '@renderer/operations/primitives';
import { useWorkforce } from './WorkforceProvider';
import { WorkerGlyph } from './primitives';
import { formatMs, formatPct, formatTrust, TEXT_TONE, trustTone } from './lib';

export function AnalyticsPanel(): JSX.Element {
  const { workers, jobs, audit } = useWorkforce();
  const [rate, setRate] = useState(2.5); // $/worker-hour — configurable, transparent

  const a = useMemo(() => {
    const succeeded = jobs.filter((j) => j.status === 'succeeded').length;
    const failed = jobs.filter((j) => j.status === 'failed').length;
    const terminal = succeeded + failed;
    const durations = jobs.map((j) => j.durationMs).filter((d): d is number => typeof d === 'number');
    const totalMs = durations.reduce((x, y) => x + y, 0);
    const avgMs = durations.length ? totalMs / durations.length : null;

    let proposals = 0;
    let approved = 0;
    let rejected = 0;
    let pending = 0;
    for (const j of jobs)
      for (const p of j.proposals) {
        proposals += 1;
        if (p.approval?.decision === 'approved') approved += 1;
        else if (p.approval?.decision === 'rejected') rejected += 1;
        else if (p.verdict.decision === 'require_approval') pending += 1;
      }

    const perWorker = workers
      .map((w) => ({ worker: w, count: jobs.filter((j) => j.workerId === w.id).length }))
      .sort((x, y) => y.count - x.count);
    const maxCount = Math.max(1, ...perWorker.map((p) => p.count));

    const intervened = jobs.filter((j) => j.proposals.some((p) => p.verdict.decision === 'require_approval')).length;
    const estCost = (totalMs / 3_600_000) * rate;

    return {
      total: jobs.length,
      succeeded,
      failed,
      terminal,
      successRate: terminal > 0 ? succeeded / terminal : 1,
      totalMs,
      avgMs,
      proposals,
      approved,
      rejected,
      pending,
      perWorker,
      maxCount,
      intervened,
      estCost,
    };
  }, [workers, jobs, rate]);

  return (
    <div>
      <OpsPanel title="Workforce Analytics" subtitle="Measured from completed jobs and the governance audit trail — nothing estimated unless labelled.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat icon="checklist" label="Jobs run" value={a.total} tone="accent" />
          <Stat icon="gauge" label="Success rate" value={formatPct(a.successRate)} tone="green" hint={`${a.succeeded}/${a.terminal} terminal`} />
          <Stat icon="clock" label="Avg execution" value={formatMs(a.avgMs)} tone="blue" />
          <Stat icon="layers" label="Total compute" value={formatMs(a.totalMs)} tone="purple" />
          <Stat icon="shield" label="Proposals" value={a.proposals} tone="orange" hint={`${a.pending} pending`} />
          <Stat icon="user" label="Human reviews" value={a.approved + a.rejected} tone="accent" hint={`${a.approved}✓ ${a.rejected}✕`} />
        </div>
      </OpsPanel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <OpsPanel title="Worker utilization" subtitle="Jobs handled per worker">
          {a.perWorker.every((p) => p.count === 0) ? (
            <div className="rounded-xl border border-dashed border-[var(--hairline)] p-6 text-center text-sm text-faint">
              No jobs yet — run workers to populate utilization.
            </div>
          ) : (
            <div className="space-y-2.5">
              {a.perWorker.map(({ worker, count }) => (
                <div key={worker.id} className="flex items-center gap-3">
                  <WorkerGlyph role={worker.role} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="truncate text-sm text-ink">{worker.name}</span>
                      <span className="tabular text-2xs text-faint">{count}</span>
                    </div>
                    <Bar value={count / a.maxCount} tone="accent" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>

        <OpsPanel
          title="Trust distribution"
          subtitle="Current trust per worker — trend history accrues as workers run over time"
        >
          <div className="space-y-2.5">
            {workers.map((w) => (
              <div key={w.id} className="flex items-center gap-3">
                <WorkerGlyph role={w.role} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="truncate text-sm text-ink">{w.name}</span>
                    <span className={cn('tabular text-2xs font-medium', TEXT_TONE[trustTone(w.trustScore)])}>
                      {formatTrust(w.trustScore)}
                    </span>
                  </div>
                  <Bar value={w.trustScore} tone={trustTone(w.trustScore)} />
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <OpsPanel title="Human intervention" subtitle="How often a person was in the loop">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-[var(--hairline)] p-4 text-center">
              <div className="text-2xl font-semibold text-ink">{a.approved}</div>
              <div className="text-2xs text-faint">approved</div>
            </div>
            <div className="rounded-2xl border border-[var(--hairline)] p-4 text-center">
              <div className="text-2xl font-semibold text-ink">{a.rejected}</div>
              <div className="text-2xs text-faint">rejected</div>
            </div>
            <div className="rounded-2xl border border-[var(--hairline)] p-4 text-center">
              <div className="text-2xl font-semibold text-ink">{a.pending}</div>
              <div className="text-2xs text-faint">pending</div>
            </div>
          </div>
          <p className="mt-3 text-2xs text-faint">
            {a.intervened} of {a.total} jobs proposed a side-effecting action that required human approval. Audit trail holds{' '}
            {audit.length} governance decision(s).
          </p>
        </OpsPanel>

        <OpsPanel title="Estimated cost" subtitle="Transparent formula — not a billed figure">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Icon name="gauge" size={18} />
            </span>
            <div>
              <div className="text-2xl font-semibold text-ink">
                ${a.estCost < 0.01 ? a.estCost.toFixed(6) : a.estCost.toFixed(2)}
              </div>
              <div className="text-2xs text-faint">total compute cost at the rate below</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs text-muted" htmlFor="rate">
              Rate ($/worker-hour)
            </label>
            <input
              id="rate"
              type="number"
              min={0}
              step={0.5}
              value={rate}
              onChange={(e) => setRate(Math.max(0, Number(e.target.value) || 0))}
              className="w-24 rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-sm text-ink outline-none focus:shadow-focus"
            />
          </div>
          <p className="mt-3 text-2xs text-faint">
            Cost = total compute ({formatMs(a.totalMs)}) × rate. These deterministic workers run in milliseconds, so cost is
            negligible — this becomes meaningful once model-backed skills add token and inference costs.
          </p>
        </OpsPanel>
      </div>
    </div>
  );
}
