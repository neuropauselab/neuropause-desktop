/** Sandbox › Overview — the command surface: KPIs, trends, health bands, recent runs + signals. */
import { useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Stat } from '@renderer/operations/primitives';
import { TEXT_TONE } from '@renderer/operations/lib';
import { useSandbox } from '@renderer/sandbox/SandboxProvider';
import {
  bandTone,
  certMeta,
  passRatePct,
  pipelineLabel,
  relativeTime,
  runStatusMeta,
  trendMeta,
} from '@renderer/sandbox/sandboxModel';
import { KpiGrid, Metric, Pill, RunDetailDrawer, SectionCard } from './shared';

export function OverviewPanel(): JSX.Element {
  const { dashboard, validation, summary, executiveMode, loadRunDetail, runDetail } = useSandbox();
  const [drawer, setDrawer] = useState(false);
  const nowMs = Date.now();

  const openRun = async (runId: string): Promise<void> => {
    await loadRunDetail(runId);
    setDrawer(true);
  };

  if (!dashboard) {
    return <EmptyState icon="beaker" title="Loading the Sandbox…" description="Reading validation state and recent runs." />;
  }

  const passTone = dashboard.passRate === null ? 'gray' : dashboard.passRate >= 0.9 ? 'green' : dashboard.passRate >= 0.6 ? 'orange' : 'red';
  const cert = certMeta(validation?.certificationStatus ?? summary?.latestCertification ?? null);
  const trends = validation?.trends;
  const history = validation?.history ?? [];
  const signals = history.filter((h) => h.status === 'failed' || h.status === 'error' || h.level === 'fail');

  const kpis = (
    <KpiGrid className={cn(executiveMode && 'lg:grid-cols-4')}>
      <Stat icon="activity" label="Executions" value={dashboard.executions.total} tone="accent" hint={`${dashboard.queue.running} running now`} />
      <Stat icon="check" label="Pass rate" value={passRatePct(dashboard.passRate)} tone={passTone} />
      <Stat icon="verified" label="Certification" value={cert.label} tone={cert.tone} />
      <Stat icon="beaker" label="Validation runs" value={summary?.totalRuns ?? 0} tone="accent" hint={`${summary?.pipelines.length ?? 0} pipelines`} />
      {!executiveMode && <Stat icon="checklist" label="Scenarios" value={dashboard.scenarios} tone="blue" />}
      {!executiveMode && <Stat icon="clock" label="Queue depth" value={dashboard.queue.depth} tone={dashboard.queue.depth ? 'orange' : 'gray'} />}
      {!executiveMode && <Stat icon="folder" label="Artifacts" value={dashboard.artifacts.total} tone="purple" />}
      {!executiveMode && <Stat icon="grid" label="Workspaces" value={dashboard.workspaces} tone="gray" />}
    </KpiGrid>
  );

  return (
    <div>
      <div className="mb-5">{kpis}</div>

      {trends && (
        <SectionCard title="Signal trends" subtitle="vs recent history" icon="pulse" tint="blue">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {([
              ['Regression', trends.regression],
              ['Performance', trends.performance],
              ['Security', trends.security],
              ['AI QA', trends.aiQa],
              ['Benchmark', trends.benchmark],
            ] as const).map(([label, dir]) => {
              const t = trendMeta(dir);
              return (
                <div key={label} className="rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3">
                  <div className="text-2xs font-medium uppercase tracking-wider text-faint">{label}</div>
                  <div className={cn('mt-1 flex items-center gap-1.5 text-sm font-semibold', TEXT_TONE[t.tone])}>
                    <span aria-hidden>{t.glyph}</span>
                    {t.label}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {validation?.panels && validation.panels.length > 0 && (
        <SectionCard title="Health" subtitle="live bands" icon="gauge" tint="green">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {validation.panels.map((p) => (
              <Metric key={p.key} label={p.label} value={p.value} tone={bandTone(p.band)} />
            ))}
          </div>
        </SectionCard>
      )}

      <div className={cn('grid gap-5', !executiveMode && 'lg:grid-cols-2')}>
        <SectionCard title="Recent runs" icon="clock" tint="accent">
          {history.length === 0 ? (
            <EmptyState icon="beaker" title="No validation runs yet" description="Run a pipeline from the Validation tab to see results here." compact />
          ) : (
            <div className="space-y-1">
              {history.slice(0, executiveMode ? 5 : 8).map((h) => {
                const s = runStatusMeta(h.status);
                return (
                  <button
                    key={h.runId}
                    type="button"
                    onClick={() => void openRun(h.runId)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition fill-hover"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon name="beaker" size={14} className="shrink-0 text-faint" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{pipelineLabel(h.pipeline)}</div>
                        <div className="text-2xs text-faint">{relativeTime(h.at, nowMs)} · {h.passed}/{h.passed + h.failed} passed</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {h.level && <Pill tone={certMeta(h.level).tone} label={certMeta(h.level).label} subtle />}
                      <Pill tone={s.tone} label={s.label} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>

        {!executiveMode && (
          <SectionCard title="Signals" subtitle="failures & regressions" icon="bell" tint="orange">
            {signals.length === 0 ? (
              <EmptyState icon="shield" title="All clear" description="No failing or regressed runs in recent history." compact />
            ) : (
              <div className="space-y-1.5">
                {signals.slice(0, 8).map((h) => (
                  <button
                    key={h.runId}
                    type="button"
                    onClick={() => void openRun(h.runId)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--hairline)] px-3 py-2 text-left transition fill-hover"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{pipelineLabel(h.pipeline)}</div>
                      <div className="text-2xs text-faint">{relativeTime(h.at, nowMs)}</div>
                    </div>
                    <Pill tone={runStatusMeta(h.status).tone} label={runStatusMeta(h.status).label} />
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        )}
      </div>

      <RunDetailDrawer detail={runDetail} open={drawer} onClose={() => setDrawer(false)} nowMs={nowMs} />
    </div>
  );
}
