/** Sandbox › Performance & Security — projections of the Performance & Security Lab (S5) for a run. */
import type { RegressionKind } from '@neuropause/shared';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { TEXT_TONE } from '@renderer/operations/lib';
import { useSandbox } from '@renderer/sandbox/SandboxProvider';
import { formatMs, metricOf, pipelineLabel, severityMeta, stageStatusMeta, trendMeta } from '@renderer/sandbox/sandboxModel';
import { KpiGrid, Metric, Pill, SectionCard } from './shared';

function LabStages(): JSX.Element | null {
  const { runDetail } = useSandbox();
  const stages = (runDetail?.run.stages ?? []).filter((s) => s.kind === 'lab');
  if (stages.length === 0) return null;
  return (
    <SectionCard title="Lab stages" icon="beaker" tint="blue">
      <div className="space-y-2">
        {stages.map((s) => {
          const m = stageStatusMeta(s.status);
          return (
            <div key={s.id} className="rounded-lg border border-[var(--hairline)] px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{s.name}</span>
                <Pill tone={m.tone} label={m.label} />
              </div>
              {s.summary && <p className="mt-1 text-2xs leading-relaxed text-muted">{s.summary}</p>}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function RegressionFindings({ kinds, title }: { kinds: RegressionKind[]; title: string }): JSX.Element | null {
  const { runDetail } = useSandbox();
  const findings = (runDetail?.regression?.findings ?? []).filter((f) => kinds.includes(f.kind));
  if (findings.length === 0) return null;
  return (
    <SectionCard title={title} subtitle={`${findings.length}`} icon="pulse" tint="orange">
      <div className="space-y-1.5">
        {findings.map((f, i) => {
          const m = severityMeta(f.severity);
          return (
            <div key={`${f.metric}-${i}`} className="flex items-center justify-between rounded-lg border border-[var(--hairline)] px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{f.detail || f.metric}</div>
                <div className="text-2xs text-faint">{f.baseline ?? '—'} → {f.current} ({f.deltaPct > 0 ? '+' : ''}{f.deltaPct}%)</div>
              </div>
              <Pill tone={m.tone} label={m.label} />
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

export function PerformancePanel(): JSX.Element {
  const { runDetail, validation, runningPipeline, runValidation } = useSandbox();
  const run = runDetail?.run ?? null;
  const cert = runDetail?.certification ?? null;
  const trend = validation ? trendMeta(validation.trends.performance) : null;

  if (!run) {
    return <EmptyState icon="gauge" title="No run selected" description="Run the Performance pipeline to profile latency, throughput, and resilience." />;
  }

  const latency = cert?.performance.latencyP95Ms ?? metricOf(run, 'latencyP95Ms');
  const throughput = cert?.performance.throughputPerSec ?? 0;
  const recovery = metricOf(run, 'recoveryRatePct', 100);

  return (
    <div>
      <SectionCard
        title="Performance"
        subtitle={pipelineLabel(run.pipeline)}
        icon="gauge"
        tint="accent"
        action={
          <div className="flex items-center gap-2">
            {trend && <span className={TEXT_TONE[trend.tone].split(' ')[0]}><span aria-hidden>{trend.glyph}</span> {trend.label}</span>}
            <Button size="sm" variant="secondary" icon="play" loading={runningPipeline === 'performance'} disabled={runningPipeline !== null} onClick={() => void runValidation('performance')}>Profile</Button>
          </div>
        }
      >
        <KpiGrid>
          <Metric label="Latency p95" value={formatMs(latency || null)} tone={latency && latency > 500 ? 'orange' : 'green'} />
          <Metric label="Throughput" value={throughput ? `${throughput}/s` : '—'} />
          <Metric label="Recovery" value={`${recovery}%`} tone={recovery >= 90 ? 'green' : 'orange'} />
          <Metric label="Regressions" value={run.regressionCount} tone={run.regressionCount ? 'orange' : 'green'} />
        </KpiGrid>
      </SectionCard>
      <RegressionFindings kinds={['latency', 'cpu', 'memory', 'performance', 'benchmark']} title="Performance regressions" />
      <LabStages />
    </div>
  );
}

export function SecurityPanel(): JSX.Element {
  const { runDetail, validation, runningPipeline, runValidation } = useSandbox();
  const run = runDetail?.run ?? null;
  const cert = runDetail?.certification ?? null;
  const trend = validation ? trendMeta(validation.trends.security) : null;

  if (!run) {
    return <EmptyState icon="shield" title="No run selected" description="Run the Security pipeline to check the platform's security posture." />;
  }

  const failures = cert?.security.failures ?? metricOf(run, 'securityFailures');
  const checks = cert?.security.checks ?? 0;
  const clean = failures === 0;

  return (
    <div>
      <SectionCard
        title="Security"
        subtitle={pipelineLabel(run.pipeline)}
        icon="shield"
        tint={clean ? 'green' : 'pink'}
        action={
          <div className="flex items-center gap-2">
            {trend && <span className={TEXT_TONE[trend.tone].split(' ')[0]}><span aria-hidden>{trend.glyph}</span> {trend.label}</span>}
            <Button size="sm" variant="secondary" icon="play" loading={runningPipeline === 'security'} disabled={runningPipeline !== null} onClick={() => void runValidation('security')}>Scan</Button>
          </div>
        }
      >
        <div className="mb-4 flex items-center gap-2">
          <Icon name={clean ? 'verified' : 'shield'} size={16} className={TEXT_TONE[clean ? 'green' : 'red'].split(' ')[0]} />
          <span className="text-sm font-semibold">{clean ? 'No security failures' : `${failures} security ${failures === 1 ? 'failure' : 'failures'}`}</span>
          <Pill tone={clean ? 'green' : 'red'} label={clean ? 'Clean' : 'Attention'} />
        </div>
        <KpiGrid>
          <Metric label="Checks" value={checks || '—'} />
          <Metric label="Failures" value={failures} tone={clean ? 'green' : 'red'} />
          <Metric label="Certification" value={run.certificationLevel ?? '—'} tone={failures ? 'red' : 'green'} />
          <Metric label="Regressions" value={(runDetail?.regression?.findings ?? []).filter((f) => f.kind === 'security').length} tone="orange" />
        </KpiGrid>
      </SectionCard>
      <RegressionFindings kinds={['security']} title="Security regressions" />
      <LabStages />
    </div>
  );
}
