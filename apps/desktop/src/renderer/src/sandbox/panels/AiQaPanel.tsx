/**
 * Sandbox › AI QA — the AI QA Center. Shows the AI QA stages of the current run and their
 * outcomes. Per the P4 rule, only user-facing reasoning SUMMARIES are shown — never
 * chain-of-thought (every summary passes through `reasoningSummary`).
 */
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { TEXT_TONE } from '@renderer/operations/lib';
import { useSandbox } from '@renderer/sandbox/SandboxProvider';
import { pipelineLabel, reasoningSummary, stageStatusMeta } from '@renderer/sandbox/sandboxModel';
import { KpiGrid, Metric, Pill, SectionCard } from './shared';

export function AiQaPanel(): JSX.Element {
  const { runDetail, runningPipeline, runValidation } = useSandbox();
  const run = runDetail?.run ?? null;
  const cert = runDetail?.certification ?? null;
  const aiStages = (run?.stages ?? []).filter((s) => s.kind === 'ai-qa');

  return (
    <div>
      <SectionCard
        title="AI QA"
        subtitle={run ? pipelineLabel(run.pipeline) : undefined}
        icon="sparkles"
        tint="purple"
        action={
          <Button size="sm" variant="secondary" icon="play" loading={runningPipeline === 'regression'} disabled={runningPipeline !== null} onClick={() => void runValidation('regression')}>
            Run AI QA
          </Button>
        }
      >
        {!run ? (
          <EmptyState icon="sparkles" title="No run selected" description="Run a pipeline with AI QA stages (e.g. Regression, Certification) to see agent outcomes." compact />
        ) : (
          <>
            <KpiGrid className="mb-4">
              <Metric label="AI QA stages" value={aiStages.length} tone="purple" />
              <Metric label="Sessions" value={cert?.aiQaResults.sessions ?? aiStages.length} />
              <Metric label="Bugs found" value={cert?.aiQaResults.bugs ?? 0} tone={(cert?.aiQaResults.bugs ?? 0) ? 'orange' : 'green'} />
              <Metric label="Passing" value={`${aiStages.filter((s) => s.status === 'pass').length}/${aiStages.length}`} tone={aiStages.every((s) => s.status === 'pass') ? 'green' : 'orange'} />
            </KpiGrid>

            {aiStages.length === 0 ? (
              <EmptyState icon="sparkles" title="No AI QA stages in this run" compact />
            ) : (
              <div className="space-y-2">
                {aiStages.map((s) => {
                  const m = stageStatusMeta(s.status);
                  const summary = reasoningSummary(s.summary);
                  return (
                    <div key={s.id} className="rounded-xl border border-[var(--hairline)] px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Icon name="sparkles" size={14} className={TEXT_TONE.purple.split(' ')[0]} />
                          <span className="text-sm font-medium">{s.name}</span>
                        </div>
                        <Pill tone={m.tone} label={m.label} />
                      </div>
                      {summary && <p className="mt-1.5 text-xs leading-relaxed text-muted">{summary}</p>}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex items-center gap-1.5 text-2xs text-faint">
              <Icon name="lock" size={12} />
              Reasoning summaries only — internal chain-of-thought is never surfaced.
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}
