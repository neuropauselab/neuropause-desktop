/** Sandbox › Certification — the Certification Center: the current run's report + exports. */
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { TEXT_TONE } from '@renderer/operations/lib';
import { useSandbox } from '@renderer/sandbox/SandboxProvider';
import { certMeta, formatMs, pipelineLabel, relativeTime } from '@renderer/sandbox/sandboxModel';
import { KpiGrid, Metric, Pill, SectionCard, copyText, downloadText } from './shared';

export function CertificationPanel(): JSX.Element {
  const { runDetail, summary, validation, runningPipeline, runValidation, loadRunDetail } = useSandbox();
  const nowMs = Date.now();
  const cert = runDetail?.certification ?? null;
  const exports = runDetail?.exports ?? null;
  const certifyingRuns = (validation?.history ?? []).filter((h) => h.level !== null);

  const runCert = (): void => void runValidation('certification');

  return (
    <div>
      <SectionCard
        title="Certification"
        subtitle={summary ? `latest: ${certMeta(summary.latestCertification).label}` : undefined}
        icon="verified"
        tint={cert ? certMeta(cert.level).tone === 'red' ? 'pink' : certMeta(cert.level).tone === 'orange' ? 'orange' : 'green' : 'accent'}
        action={
          <Button size="sm" variant="primary" icon="play" loading={runningPipeline === 'certification'} disabled={runningPipeline !== null} onClick={runCert}>
            Certify
          </Button>
        }
      >
        {!cert ? (
          <EmptyState
            icon="verified"
            title="No certification loaded"
            description="Run the Certification (or Release Candidate) pipeline to produce a signed certification report with exports."
            compact
          />
        ) : (
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Pill tone={certMeta(cert.level).tone} label={certMeta(cert.level).label} />
              <span className="text-sm font-semibold">{pipelineLabel(cert.pipeline)}</span>
              <span className="text-2xs text-faint">{cert.buildStatus} · {relativeTime(cert.generatedAt, nowMs)}</span>
              {exports && (
                <div className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" icon="clipboard" onClick={() => copyText(exports.markdown)}>Copy MD</Button>
                  <Button size="sm" variant="ghost" icon="download" onClick={() => downloadText(`certification-${cert.pipeline}.md`, 'text/markdown', exports.markdown)}>MD</Button>
                  <Button size="sm" variant="ghost" icon="download" onClick={() => downloadText(`certification-${cert.pipeline}.html`, 'text/html', exports.html)}>HTML</Button>
                  <Button size="sm" variant="ghost" icon="download" onClick={() => downloadText(`certification-${cert.pipeline}.json`, 'application/json', exports.json)}>JSON</Button>
                </div>
              )}
            </div>

            <KpiGrid className="mb-4">
              <Metric label="Scenarios" value={`${cert.scenarioResults.passed}/${cert.scenarioResults.total}`} tone={cert.scenarioResults.failed ? 'orange' : 'green'} caption={`${cert.scenarioResults.failed} failed`} />
              <Metric label="AI QA" value={`${cert.aiQaResults.bugs} bugs`} tone={cert.aiQaResults.bugs ? 'orange' : 'green'} caption={`${cert.aiQaResults.sessions} sessions`} />
              <Metric label="Latency p95" value={formatMs(cert.performance.latencyP95Ms)} caption={`${cert.performance.throughputPerSec}/s throughput`} />
              <Metric label="Security" value={cert.security.failures ? `${cert.security.failures} failing` : 'Clean'} tone={cert.security.failures ? 'red' : 'green'} caption={`${cert.security.checks} checks`} />
              <Metric label="Recovery" value={`${cert.recovery.rate}%`} tone={cert.recovery.rate >= 90 ? 'green' : 'orange'} />
              <Metric label="Benchmarks" value={`${cert.benchmarks.regressed} regressed`} tone={cert.benchmarks.regressed ? 'orange' : 'green'} caption={`${cert.benchmarks.compared} compared`} />
              <Metric label="Diagnostics" value={cert.diagnostics.level} caption={`${cert.diagnostics.cpuPercent}% cpu · ${cert.diagnostics.memoryUsedMb}mb`} />
              <Metric label="Regression" value={cert.regressionSummary || 'none'} />
            </KpiGrid>

            {cert.kpis.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-xs font-semibold">Executive KPIs</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {cert.kpis.map((k) => (
                    <div key={k.key} className="rounded-lg border border-[var(--hairline)] px-3 py-2">
                      <div className="text-2xs text-faint">{k.key}</div>
                      <div className="text-sm font-semibold">{k.value ?? '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cert.summary && (
              <div className="flex items-start gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-4 py-3">
                <Icon name="info" size={15} className={TEXT_TONE.blue.split(' ')[0]} />
                <p className="text-xs leading-relaxed text-muted">{cert.summary}</p>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {certifyingRuns.length > 0 && (
        <SectionCard title="Certified runs" subtitle="load a report" icon="clock" tint="blue">
          <div className="space-y-1">
            {certifyingRuns.slice(0, 10).map((h) => (
              <button
                key={h.runId}
                type="button"
                onClick={() => void loadRunDetail(h.runId)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition fill-hover"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{pipelineLabel(h.pipeline)}</div>
                  <div className="text-2xs text-faint">{relativeTime(h.at, nowMs)}</div>
                </div>
                {h.level && <Pill tone={certMeta(h.level).tone} label={certMeta(h.level).label} />}
              </button>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
