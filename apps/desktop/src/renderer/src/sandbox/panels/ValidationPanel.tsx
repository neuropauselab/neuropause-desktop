/** Sandbox › Validation — the Validation Center (pipeline catalog + run) and Live Execution Viewer. */
import { useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { TEXT_TONE } from '@renderer/operations/lib';
import { useSandbox } from '@renderer/sandbox/SandboxProvider';
import {
  certMeta,
  formatDuration,
  pipelineLabel,
  relativeTime,
  runHeadline,
  runStatusMeta,
} from '@renderer/sandbox/sandboxModel';
import { KpiGrid, Metric, Pill, RunDetailDrawer, SectionCard } from './shared';

export function ValidationPanel(): JSX.Element {
  const { summary, validation, runDetail, runningPipeline, runValidation, loadRunDetail, searchQuery } = useSandbox();
  const [drawer, setDrawer] = useState(false);
  const nowMs = Date.now();

  const pipelines = (summary?.pipelines ?? []).filter(
    (p) => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.kind.includes(searchQuery.toLowerCase()),
  );
  const history = validation?.history ?? [];

  const openRun = async (runId: string): Promise<void> => {
    await loadRunDetail(runId);
    setDrawer(true);
  };

  const headline = runDetail ? runHeadline(runDetail.run) : null;

  return (
    <div>
      {/* Live Execution Viewer */}
      <SectionCard title="Live execution" subtitle="current run" icon="play" tint={runningPipeline ? 'blue' : 'accent'}>
        {runningPipeline ? (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-4 py-3.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Running · {pipelineLabel(runningPipeline)}</div>
              <div className="text-2xs text-faint">Executing the pipeline against the live stack — scenarios, AI QA, and the performance &amp; security lab.</div>
            </div>
          </div>
        ) : runDetail && headline ? (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{pipelineLabel(headline.pipeline)}</span>
              <Pill tone={headline.statusMeta.tone} label={headline.statusMeta.label} />
              {headline.certificationLevel && <Pill tone={certMeta(headline.certificationLevel).tone} label={certMeta(headline.certificationLevel).label} subtle />}
              <span className="text-2xs text-faint">{formatDuration(runDetail.run.durationMs)} · {relativeTime(runDetail.run.finishedAt ?? runDetail.run.startedAt, nowMs)}</span>
              <Button size="sm" variant="ghost" icon="eye" className="ml-auto" onClick={() => setDrawer(true)}>
                Detail
              </Button>
            </div>
            <KpiGrid>
              <Metric label="Scenarios" value={`${headline.scenarioPassed}/${headline.scenarioTotal}`} tone={headline.scenarioTotal && headline.scenarioPassed < headline.scenarioTotal ? 'orange' : 'green'} />
              <Metric label="AI QA bugs" value={headline.aiQaBugs} tone={headline.aiQaBugs ? 'orange' : 'green'} />
              <Metric label="Latency p95" value={headline.latencyLabel} />
              <Metric label="Security" value={headline.securityFailures ? `${headline.securityFailures} failing` : 'Clean'} tone={headline.securityFailures ? 'red' : 'green'} />
            </KpiGrid>
          </div>
        ) : (
          <EmptyState icon="play" title="No run in progress" description="Start a validation pipeline below to watch it execute live." compact />
        )}
      </SectionCard>

      {/* Pipeline catalog */}
      <SectionCard title="Validation pipelines" subtitle={`${pipelines.length} available`} icon="layers" tint="accent">
        {pipelines.length === 0 ? (
          <EmptyState icon="search" title="No pipelines match" compact />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {pipelines.map((p) => {
              const busy = runningPipeline === p.kind;
              const anyBusy = runningPipeline !== null;
              return (
                <Card key={p.kind} variant="hairline" className="flex flex-col gap-2 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{p.name}</div>
                      <div className="text-2xs text-faint">{p.stages} stages</div>
                    </div>
                    {p.certifies && (
                      <span className={cn('inline-flex items-center gap-1 text-2xs font-medium', TEXT_TONE.green)}>
                        <Icon name="verified" size={12} /> Certifies
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={busy ? 'secondary' : 'primary'}
                    icon={busy ? undefined : 'play'}
                    loading={busy}
                    disabled={anyBusy && !busy}
                    onClick={() => void runValidation(p.kind)}
                  >
                    {busy ? 'Running…' : 'Run'}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Recent runs */}
      <SectionCard title="Recent runs" subtitle={`${history.length}`} icon="clock" tint="blue">
        {history.length === 0 ? (
          <EmptyState icon="beaker" title="No runs recorded yet" compact />
        ) : (
          <div className="space-y-1">
            {history.map((h) => {
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

      <RunDetailDrawer detail={runDetail} open={drawer} onClose={() => setDrawer(false)} nowMs={nowMs} />
    </div>
  );
}
